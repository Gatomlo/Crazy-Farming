'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../lib/engine');
const D = require('../lib/data');

function go(s) { if (s.menu) E.autoAssign(s); E.startYear(s); }

function newGame(n = 4) {
  const s = E.createSession('TEST');
  const profiles = Object.keys(D.PROFILES);
  for (let i = 0; i < n; i++) E.addTeam(s, { name: '', profile: profiles[i % profiles.length] + (i >= profiles.length ? '' : '') });
  return s;
}

function toSeason(s) {
  E.startSetup(s);
  go(s);
}

test('creation de session et fermes', () => {
  const s = newGame();
  assert.equal(s.teams.length, 4);
  assert.equal(s.teams[0].bank, 500);
  assert.deepEqual(s.teams[0].tiles, { lait: 2, oeuf: 1 });
  assert.throws(() => E.addTeam(s, { name: 'Les Bergers' }), /existe déjà/);
  assert.throws(() => E.startYear(s), /Rien à démarrer/);
});

test('une saison complete : 5 etapes puis saison suivante', () => {
  const s = newGame();
  toSeason(s);
  assert.equal(s.phase, 'season');
  assert.equal(s.timer.durationMs, 30000);
  E.nextStep(s);
  assert.equal(s.timer.durationMs, 90000); // recolte de printemps
  for (let i = 0; i < 3; i++) E.nextStep(s);
  assert.equal(s.step, 4);
  E.nextStep(s);
  assert.equal(s.season, 1);
  assert.equal(s.step, 0);
});

test('chrono : lancer, pause, remise a zero', () => {
  const s = newGame();
  toSeason(s);
  E.startTimer(s, 1000);
  assert.equal(E.timerRemaining(s, 11000), 20000);
  E.pauseTimer(s, 11000);
  assert.equal(s.timer.remainingMs, 20000);
  assert.equal(E.timerRemaining(s, 99999), 20000);
  E.resetTimer(s);
  assert.equal(s.timer.remainingMs, 30000);
});

test('carte : parade, +1 boule ou subir ; le de 6 ne donne plus de boule', () => {
  const s = newGame();
  toSeason(s);
  s.season = 2; // automne : renard / brouillard
  E.drawCard(s, 0);
  assert.equal(s.card.id, 'renard');
  const t = s.teams[0];
  assert.throws(() => E.setChoice(s, t.id, 'parade'), /matériel/);
  E.setChoice(s, t.id, 'boule');
  assert.equal(t.bocal, 1);
  assert.equal(t.bocalAdded, 1);
  assert.equal(E.viewFor(s, 'display').teams[0].exempt, true);
  E.setChoice(s, t.id, 'subit'); // changer d'avis rembourse la boule
  assert.equal(t.bocal, 0);
  assert.equal(t.bocalAdded, 0);
  t.equipment.push('chien');
  E.setChoice(s, t.id, 'parade');
  assert.equal(t.choice, 'parade');
  assert.equal(t.bocal, 0);
  E.drawCard(s, 1); // nouvelle carte : les choix sont remis a zero
  assert.equal(t.choice, null);
  E.rollDie(s, 6);
  assert.equal(t.bocal, 0);
});

test('boutique : prix, stock, etape achats', () => {
  const s = newGame();
  E.startSetup(s);
  const t = s.teams[0];
  assert.equal(E.priceOf(t, D.CATALOGUE.find((i) => i.id === 'tile_lait')), 35); // deja une chevrerie
  assert.equal(E.priceOf(t, D.CATALOGUE.find((i) => i.id === 'tile_viande')), 80); // type absent
  E.buy(s, t.id, 'tile_lait');
  assert.equal(t.tiles.lait, 3);
  assert.equal(t.bank, 465);
  E.buy(s, t.id, 'chien');
  assert.throws(() => E.buy(s, t.id, 'chien'), /Déjà acheté/);
  E.buy(s, t.id, 'brouette');
  E.buy(s, t.id, 'brouette'); // multi
  t.bank = 100;
  assert.throws(() => E.buy(s, t.id, 'tracteur'), /Solde insuffisant/);
  go(s);
  assert.throws(() => E.buy(s, t.id, 'lampe'), /étape Achats/);
  s.step = 4;
  E.buy(s, t.id, 'lampe');
  assert.throws(() => E.buy(s, t.id, 'tile_fl'), /agrandissements/); // pas de tuile en cours d'annee
  assert.throws(() => E.buy(s, t.id, 'tile_atelier'), /agrandissements/);
});

test('vacances : cout et boules', () => {
  const s = newGame();
  toSeason(s);
  s.step = 4;
  const t = s.teams[1];
  E.addBocal(s, t.id, 3, 'test');
  E.vacation(s, t.id, 2);
  assert.equal(t.bocal, 1);
  assert.equal(t.bank, 440);
  assert.throws(() => E.vacation(s, t.id, 99), /invalide/);
});

test('burn-out : 10 boules, arret une saison, repart a 3', () => {
  const s = newGame();
  toSeason(s);
  const t = s.teams[0];
  E.addBocal(s, t.id, 10, 'test');
  assert.equal(t.bocal, 3);
  assert.equal(t.burnouts, 1);
  assert.equal(t.stopSeasons, 1);
  s.step = 4;
  E.nextStep(s);
  assert.equal(t.stopped, true);
  assert.throws(() => E.spinWheel(s, t.id), /à l’arrêt/);
  s.step = 4;
  E.nextStep(s);
  assert.equal(t.stopped, false);
});

test('roue : relance payante, relance gratuite, touristes', () => {
  const s = newGame();
  toSeason(s);
  const t = s.teams[0];
  assert.throws(() => E.spinWheel(s, t.id), /Placez d’abord/);
  s.step = 3;
  E.declareSales(s, t.id, { dir_raw: 4 });
  E.spinWheel(s, t.id, () => 0.99); // case 12 : relance gratuite
  assert.equal(t.freeSpin, true);
  E.spinWheel(s, t.id, () => 0);
  assert.equal(t.bocal, 0);
  E.spinWheel(s, t.id, () => 0);
  assert.equal(t.bocal, 1); // relance payante
  s.card = { id: 'touristes' };
  let calls = 0;
  const rand = () => (calls++ < 3 ? 0.9 : 0.0); // rien ne se vend puis tout
  E.declareSales(s, s.teams[1].id, { dir_raw: 2 });
  E.spinWheel(s, s.teams[1].id, rand);
  assert.ok(s.teams[1].wheel.frac >= 0.75);
});

test('cloture : charges, dette, fete, annee suivante', () => {
  const s = newGame();
  toSeason(s);
  const t = s.teams[2]; // eleveurs : viande x2 + lait = 3 tuiles
  assert.deepEqual(E.estimateCharges(t), { taxes: 60, eau: 0, nourriture: 30, electricite: 0, total: 90 });
  const poor = s.teams[3]; // gourmets : viande, fl, atelier
  poor.bank = 20;
  s.phase = 'closing';
  E.closeYear(s);
  assert.equal(t.bank, 410);
  assert.equal(poor.bank, 0);
  assert.equal(poor.bocal, 3); // manque 70 -> 3 boules (plafond)
  assert.throws(() => E.nextYear(s), /Fête/);
  E.fete(s, true);
  assert.equal(t.bocal, 0);
  E.nextYear(s);
  assert.equal(s.phase, 'rearrange');
  assert.equal(s.year, 2);
  assert.equal(s.timer.durationMs, 300000);
  go(s);
  assert.equal(s.phase, 'season');
  assert.equal(s.season, 0);
});

test('hamac : -1 boule a chaque fin de saison', () => {
  const s = newGame();
  toSeason(s);
  const t = s.teams[0];
  t.equipment.push('hamac');
  E.addBocal(s, t.id, 2, 'test');
  s.step = 4;
  E.nextStep(s);
  assert.equal(t.bocal, 1);
});

test('partie complete de 3 ans et etoiles', () => {
  const s = newGame(3);
  E.startSetup(s);
  go(s);
  for (let year = 1; year <= 3; year++) {
    for (let step = 0; step < 20; step++) E.nextStep(s); // 4 saisons x 5 etapes
    assert.equal(s.phase, 'closing');
    E.closeYear(s);
    E.fete(s, true);
    if (year < 3) { E.nextYear(s); go(s); }
  }
  s.teams[1].bank = 5000;
  E.finish(s);
  assert.equal(s.phase, 'end');
  assert.equal(s.stars.s1, true);
  assert.equal(s.stars.s2, true);
  assert.equal(s.stars.s3, true);
  assert.equal(s.stars.count, 3);
  assert.deepEqual(s.stars.richest, [s.teams[1].name]);
});

test('vues : la banque des autres equipes reste privee', () => {
  const s = newGame();
  toSeason(s);
  const display = E.viewFor(s, 'display');
  assert.equal(display.teams[0].bank, undefined);
  assert.equal(display.teams[0].token, undefined);
  const mine = E.viewFor(s, 'team', 't1');
  assert.equal(mine.teams[0].bank, 500);
  assert.equal(mine.teams[1].bank, undefined);
  assert.equal(mine.teams[0].token, undefined);
  const admin = E.viewFor(s, 'admin');
  assert.ok(admin.teams[0].token);
  assert.ok(Array.isArray(admin.log));
});

test('virements : animateur, autre ferme, motifs imposes, solde', () => {
  const s = newGame();
  toSeason(s);
  const [a, b] = s.teams;
  E.transfer(s, a.id, 'animateur', 40, 'Taxe');
  assert.equal(a.bank, 460);
  E.transfer(s, a.id, b.id, 100, 'Échange à la bourse');
  assert.equal(a.bank, 360);
  assert.equal(b.bank, 600);
  assert.match(b.ledger[b.ledger.length - 1].label, /^Virement de /);
  assert.throws(() => E.transfer(s, a.id, a.id, 10, 'Remboursement'), /autre ferme/);
  assert.throws(() => E.transfer(s, a.id, b.id, 10, 'Texte libre'), /motif/);
  assert.throws(() => E.transfer(s, a.id, 'animateur', 10, 'Remboursement'), /motif/);
  assert.throws(() => E.transfer(s, a.id, b.id, 9999, 'Remboursement'), /Montant|Solde/);
  assert.throws(() => E.transfer(s, a.id, b.id, 5.5, 'Remboursement'), /Montant/);
  assert.throws(() => E.transfer(s, a.id, 'zzz', 10, 'Remboursement'), /inconnue/);
  assert.throws(() => require('../lib/actions').dispatch(s, { role: 'team', teamId: a.id }, { type: 'movement', amount: 50 }), /non autorisée/);
});

test('alea : grille effective, fermes protegees, chrono canicule', () => {
  const s = newGame(2);
  toSeason(s); // printemps
  const [a, b] = s.teams;
  E.drawCard(s, 0); // gel tardif
  assert.equal(E.viewFor(s, 'display').quotaEff.fl, 1);
  assert.equal(E.viewFor(s, 'display').quota.fl, 3);
  b.tiles.fl = 2;
  assert.equal(E.viewFor(s, 'team', b.id).teams[1].harvest.find((h) => h.id === 'fl').tokens, 2);
  b.equipment.push('serre');
  E.setChoice(s, b.id, 'parade');
  const h = E.viewFor(s, 'team', b.id).teams[1].harvest.find((x) => x.id === 'fl');
  assert.equal(h.tokens, 6);
  assert.equal(E.viewFor(s, 'display').teams[1].exempt, true);
  s.season = 1; E.drawCard(s, 0); // canicule
  assert.equal(E.viewFor(s, 'team', a.id).teams[0].stopEarly, 30);
  s.season = 2; E.drawCard(s, 0); // renard
  assert.equal(E.viewFor(s, 'display').quotaEff.oeuf, 0);
  s.season = 2; E.drawCard(s, 1); // brouillard : -1 sur tout
  assert.deepEqual(E.viewFor(s, 'display').quotaEff, { lait: 1, oeuf: 1, viande: 2, fl: 1 });
  s.season = 0; E.drawCard(s, 1); // naissances
  assert.equal(E.viewFor(s, 'display').quotaEff.lait, 5);
  assert.equal(E.viewFor(s, 'team', a.id).teams[0].harvest.find((x) => x.id === 'lait').tokens, 10);
});

test('menu de la fete : tirage, repartition, livraison, responsabilite', () => {
  const s = newGame();
  E.startSetup(s);
  assert.equal(s.menu.items.length, 8); // 4 fermes x 2 plats
  assert.equal(s.menu.perFarm, 2);
  const [a, b] = s.teams;
  const k = s.menu.items.map((i) => i.key);
  E.claimDish(s, a.id, k[0]);
  E.claimDish(s, a.id, k[1]);
  assert.throws(() => E.claimDish(s, a.id, k[2]), /prend 2 plats/);
  assert.throws(() => E.claimDish(s, b.id, k[0]), /déjà pris/);
  E.releaseDish(s, a.id, k[1]);
  assert.throws(() => E.releaseDish(s, b.id, k[0]), /pas à vous/);
  E.autoAssign(s, () => 0.3);
  for (const t of s.teams) assert.equal(s.menu.items.filter((i) => i.team === t.id).length, 2);
  go(s);
  s.phase = 'closing'; s.closedYear = true;
  for (const it of s.menu.items) E.setDelivered(s, it.key, true);
  s.menu.items[0].delivered = false;
  const resp = s.teams.find((t) => t.id === s.menu.items[0].team);
  E.fete(s); // calculee : un plat manque
  assert.equal(s.fetes[0].success, false);
  assert.equal(resp.bocal, 2); // +1 fete ratee, +1 responsable
  assert.equal(s.teams.find((t) => t !== resp).bocal, 1);
  // annee 2 : menu plus complexe et different
  E.nextYear(s);
  assert.equal(s.menu.items.length, 12);
  assert.ok(s.menu.items.some((i) => E.viewFor(s, 'display').menu.items.find((x) => x.key === i.key).tier === 2));
  assert.equal(E.viewFor(s, 'display').menu.items.filter((x) => x.tier >= 2).length, 4);
});

test('marche : placement, roue sur l etal, paiement, greve, plafond', () => {
  const s = newGame();
  toSeason(s);
  s.step = 3;
  const t = s.teams[0];
  t.dishes.simple = 1; s.teams[1].dishes.composed = 1;
  assert.throws(() => E.settleSales(s, t.id), /Aucun produit/);
  assert.throws(() => E.declareSales(s, t.id, { dir_raw: 9 }), /8 produits/);
  assert.throws(() => E.declareSales(s, t.id, { sup_raw: -1 }), /invalide/);
  E.declareSales(s, t.id, { sup_raw: 4, dir_raw: 8, sup_simple: 1 });
  let q = E.salesQuote(s, t, t.sales);
  assert.equal(q.safeTotal, 4 * 7 + 21);
  assert.equal(q.total, null);
  assert.throws(() => E.settleSales(s, t.id), /roue/);
  E.spinWheel(s, t.id, () => 0.5); // indice 6 : trois quarts
  assert.equal(t.wheel.frac, 0.75);
  assert.throws(() => E.declareSales(s, t.id, { sup_raw: 1 }), /figé/);
  q = E.salesQuote(s, t, t.sales);
  assert.equal(q.total, 49 + Math.round(8 * 14 * 0.75) - 10);
  const bank = t.bank;
  E.settleSales(s, t.id);
  assert.equal(t.bank, bank + q.total);
  assert.throws(() => E.settleSales(s, t.id), /Déjà payé/);
  assert.throws(() => E.spinWheel(s, t.id), /déjà payées/);
  // supermarche seul : paye sans roue
  const u = s.teams[1];
  s.card = { id: 'greve', tone: 'neg', mods: {} };
  assert.throws(() => E.declareSales(s, u.id, { dir_raw: 3 }), /Grève/);
  E.declareSales(s, u.id, { sup_raw: 2, sup_composed: 1 });
  const before = u.bank; E.settleSales(s, u.id);
  assert.equal(u.bank, before + 14 + 35);
  s.step = 2;
  assert.throws(() => E.declareSales(s, s.teams[2].id, { sup_raw: 1 }), /Marché/);
});


test('transformation : demande par plat, jetons a echanger, stock, plats composes', () => {
  const s = newGame();
  toSeason(s);
  const t = s.teams[0];
  t.tiles.atelier = 1;
  s.step = 3;
  assert.throws(() => E.requestTransfo(s, t.id, { fromage: 1 }), /Transformation/);
  s.step = 2;
  assert.throws(() => E.requestTransfo(s, t.id, { fromage: 5 }), /4 recette/);
  assert.throws(() => E.requestTransfo(s, t.id, { quiche: 1 }), /manque/);
  E.requestTransfo(s, t.id, { fromage: 1, lasagne: 1 });
  const v = E.viewFor(s, 'admin').teams.find((x) => x.id === t.id).transfo;
  assert.deepEqual(v.receive, { lait: 3, viande: 1 });
  assert.deepEqual(v.give, { fromage: 1, lasagne: 1 });
  E.validateTransfo(s, t.id);
  assert.equal(t.dishes.simple, 1); assert.equal(t.dishes.mixed, 1);
  assert.throws(() => E.validateTransfo(s, t.id), /Déjà/);
  s.step = 2; t.transfo = null;
  E.requestTransfo(s, t.id, { quiche: 1 }); // 1 fromage en stock + 1 oeuf brut
  assert.deepEqual(E.viewFor(s, 'admin').teams.find((x) => x.id === t.id).transfo.use, { fromage: 1 });
  E.validateTransfo(s, t.id);
  assert.equal(t.dishes.simple, 0); assert.equal(t.dishes.composed, 1);
  s.step = 3;
  assert.throws(() => E.declareSales(s, t.id, { sup_composed: 2 }), /en stock/);
  E.declareSales(s, t.id, { sup_composed: 1 });
  E.settleSales(s, t.id);
  assert.equal(t.dishes.composed, 0); assert.equal(t.pantry.quiche, 0);
});

test('menu : seuls les plats realisables avec les tuiles du village sont tires', () => {
  const s = E.createSession();
  E.addTeam(s, { name: 'Laitiers', profile: 'bergers' }); // lait + oeufs seulement
  E.startSetup(s);
  const names = s.menu.items.map((i) => i.dish);
  for (const id of names) assert.ok(!['saucisson', 'confiture', 'lasagne', 'omelette', 'cake'].includes(id), id);
  const v = E.viewFor(s, 'display').menu.items[0];
  assert.deepEqual(v.makers, ['Laitiers']);
  assert.throws(() => { go(s); E.buy(s, s.teams[0].id, 'tile_fl'); }, /achats se font/);
});

test('saut libre : saison et annee au choix', () => {
  const s = newGame();
  toSeason(s);
  E.jumpTo(s, 2, 2);
  assert.equal(s.year, 2); assert.equal(s.season, 2); assert.equal(s.step, 0); assert.equal(s.phase, 'season');
  assert.equal(s.menu.year, 2);
  E.jumpTo(s, 2, 0);
  assert.equal(s.season, 0);
  assert.throws(() => E.jumpTo(s, 4, 0), /Année/);
  assert.throws(() => E.jumpTo(s, 1, 5), /Saison/);
});

test('chrono : ajustement manuel et duree gardee pour les saisons suivantes', () => {
  const s = newGame();
  toSeason(s);
  const base = s.timer.remainingMs;
  E.adjustTimer(s, 15);
  assert.equal(s.timer.remainingMs, base + 15000);
  E.adjustTimer(s, -9999 % 3600);
  assert.ok(s.timer.remainingMs >= 0);
  assert.throws(() => E.setTimerSeconds(s, 2), /Durée/);
  E.setTimerSeconds(s, 45, true);
  assert.equal(s.timer.remainingMs, 45000);
  s.step = 4; E.nextStep(s); // saison suivante, alea
  assert.equal(s.timer.remainingMs, 45000);
  E.startTimer(s); E.adjustTimer(s, 10);
  assert.ok(s.timer.running && s.timer.endsAt > Date.now() + 50000);
});

test('auth : connexion, jeton signe, verrouillage, changement de mot de passe', () => {
  process.env.FF_DATA_DIR = require('os').tmpdir() + '/ff-auth-' + process.pid;
  delete require.cache[require.resolve('../lib/auth')];
  delete process.env.FF_ADMIN_PASSWORD;
  const A = require('../lib/auth');
  assert.equal(A.needsSetup(), true);
  assert.equal(A.login('1.1.1.1', 'phoenix2024').status, 401); // aucun mot de passe par defaut
  assert.equal(A.setup('1.1.1.1', 'abc').status, 400);
  const first = A.setup('1.1.1.1', 'phoenix2024');
  assert.ok(first.ok && A.verifyToken(first.token));
  assert.equal(A.needsSetup(), false);
  assert.equal(A.setup('9.9.9.9', 'autre-mdp').status, 403); // creation possible une seule fois
  assert.equal(A.login('1.1.1.1', 'faux').status, 401);
  const ok = A.login('1.1.1.1', 'phoenix2024');
  assert.ok(ok.ok && A.verifyToken(ok.token));
  assert.equal(A.verifyToken(ok.token + 'x'), false);
  assert.equal(A.verifyToken('1.abc'), false);
  for (let i = 0; i < 5; i++) A.login('2.2.2.2', 'faux');
  assert.equal(A.login('2.2.2.2', 'phoenix2024').status, 429); // verrouille meme avec le bon mot de passe
  assert.equal(A.changePassword('1.1.1.1', 'phoenix2024', 'abc').status, 400);
  const ch = A.changePassword('1.1.1.1', 'phoenix2024', 'nouveau-mdp');
  assert.ok(ch.ok);
  assert.equal(A.verifyToken(ok.token), false); // ancien jeton invalide
  assert.equal(A.login('3.3.3.3', 'phoenix2024').status, 401);
  assert.ok(A.login('3.3.3.3', 'nouveau-mdp').ok);
  assert.equal(A.usingDefault(), false);
  assert.equal(A.needsSetup(), false);
});

test('commande de la fete : repartie en debut d annee, figee ensuite', () => {
  const s = newGame();
  E.startSetup(s);
  const a = s.teams[0].id;
  assert.throws(() => E.startYear(s), /à répartir/);
  E.claimDish(s, a, s.menu.items[0].key);
  E.autoAssign(s);
  E.startYear(s);
  assert.throws(() => E.claimDish(s, a, s.menu.items[0].key), /figée/);
  assert.throws(() => E.releaseDish(s, s.menu.items[0].team, s.menu.items[0].key), /figée/);
  assert.equal(E.viewFor(s, 'display').menu.open, false);
});

test('ecran de connexion unique : un invite cree ou reprend une ferme', () => {
  const { dispatch } = require('../lib/actions');
  const s = E.createSession('GUES');
  const a = dispatch(s, { role: 'guest' }, { type: 'createTeam', name: 'Les Foins' });
  assert.ok(a.token);
  assert.equal(s.teams.length, 1);
  assert.equal(dispatch(s, { role: 'guest' }, { type: 'joinTeam', teamId: 't1' }).token, a.token);
  assert.throws(() => dispatch(s, { role: 'guest' }, { type: 'joinTeam', teamId: 'zz' }));
  assert.throws(() => dispatch(s, { role: 'guest' }, { type: 'startSetup' }));
});
