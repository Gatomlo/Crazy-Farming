'use strict';
// Moteur de jeu : fonctions pures sur un objet d'etat serialisable en JSON (aucune dependance).
// Chaque fonction qui change l'etat leve une Error('message lisible') si l'action est refusee.

const crypto = require('crypto');
const D = require('./data');

const now = () => Date.now();
const TILE_TYPES = ['lait', 'oeuf', 'viande', 'fl', 'atelier', 'activite'];

// Erreur "metier" : son message est affiche tel quel a l'utilisateur. Toute autre erreur = bug, message generique.
class GameError extends Error {}
function fail(msg) { throw new GameError(msg); }
const token = () => crypto.randomBytes(9).toString('base64url');
function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = '';
  for (let i = 0; i < 4; i++) c += letters[crypto.randomInt(letters.length)];
  return c;
}

function createSession(code) {
  return {
    code: code || newCode(),
    createdAt: now(),
    updatedAt: now(),
    adminToken: token(),
    label: '',
    phase: 'lobby', // lobby | setup | season | closing | rearrange | end
    year: 1, season: 0, step: 0,
    timer: { durationMs: 0, running: false, endsAt: 0, remainingMs: 0 },
    teams: [],
    card: null, die: null, dieSixApplied: false,
    closedYear: false, feteDone: false, fetes: [], lastCharges: null, menu: null, menuHistory: [],
    stars: null, showQr: false,
    tripSec: D.DEFAULT_TRIP_SEC, forecast: null, nextCard: null, collective: null, trades: [], tradeSeq: 0,
    log: []
  };
}

function log(state, text) {
  state.log.push({ at: now(), year: state.year, season: state.season, text });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

const teamOf = (state, id) => state.teams.find((t) => t.id === id) || fail('Ferme inconnue.');
const totalTiles = (t) => TILE_TYPES.reduce((n, k) => n + (t.tiles[k] || 0), 0);

// ---------- Equipes ----------
function addTeam(state, { name, profile }) {
  if (state.phase !== 'lobby') fail('Les fermes se créent avant le début de la partie.');
  const clean = String(name || '').trim().slice(0, 40);
  const prof = D.PROFILES[profile] || null;
  const finalName = clean || (prof ? prof.name : 'Ferme ' + (state.teams.length + 1));
  if (state.teams.length >= 8) fail('8 fermes au maximum.');
  if (state.teams.some((t) => t.name.toLowerCase() === finalName.toLowerCase())) fail('Ce nom de ferme existe déjà.');
  const team = {
    id: 't' + (state.teams.length + 1),
    token: token(),
    name: finalName,
    profile: prof ? profile : null,
    bank: D.START_BANK,
    bocal: 0, bocalAdded: 0, burnouts: 0, bocalPeak: 0, sales: null, transfo: null, dishes: { simple: 0, mixed: 0, composed: 0 }, pantry: {},
    stopSeasons: 0, stopped: false,
    tiles: Object.assign({}, prof ? prof.tiles : {}),
    equipment: [],
    ready: false, choice: null, wheel: null, freeSpin: false, camionnetteUsed: false,
    ledger: []
  };
  state.teams.push(team);
  log(state, `Ferme ajoutée : ${team.name}.`);
  return team;
}

function removeTeam(state, id) {
  if (state.phase !== 'lobby') fail('Impossible de retirer une ferme après le début.');
  const i = state.teams.findIndex((t) => t.id === id);
  if (i < 0) fail('Ferme inconnue.');
  state.teams.splice(i, 1);
}

// ---------- Chrono ----------
function timerRemaining(state, at = now()) {
  const t = state.timer;
  return t.running ? Math.max(0, t.endsAt - at) : t.remainingMs;
}
function setTimer(state, sec) {
  state.timer = { durationMs: sec * 1000, running: false, endsAt: 0, remainingMs: sec * 1000 };
}
// Reglage manuel du chrono : ajouter/retirer des secondes, ou fixer la duree de l'etape en cours
// (avec keep = true, la duree est reprise pour cette etape dans les saisons suivantes).
function adjustTimer(state, deltaSec, at = now()) {
  if (!Number.isInteger(deltaSec) || Math.abs(deltaSec) > 3600) fail('Ajustement invalide.');
  const t = state.timer;
  const rem = timerRemaining(state, at);
  const next = Math.max(0, rem + deltaSec * 1000);
  t.remainingMs = next;
  t.durationMs = Math.max(t.durationMs, next);
  if (t.running) t.endsAt = at + next;
}
function setTimerSeconds(state, sec, keep = false, at = now()) {
  if (!Number.isInteger(sec) || sec < 5 || sec > 3600) fail('Durée invalide (5 s à 60 min).');
  const t = state.timer;
  t.durationMs = sec * 1000; t.remainingMs = sec * 1000;
  if (t.running) t.endsAt = at + t.remainingMs;
  if (keep && state.phase === 'season') {
    state.stepOverrides = Object.assign({}, state.stepOverrides, { [D.STEPS[state.step].id]: sec });
    log(state, `Durée de « ${D.STEPS[state.step].name} » réglée à ${sec} s pour la suite.`);
  }
}
function startTimer(state, at = now()) {
  const t = state.timer;
  if (t.running) return;
  if (t.remainingMs <= 0) fail('Le chrono est à zéro : remets-le à zéro.');
  t.running = true; t.endsAt = at + t.remainingMs;
}
function pauseTimer(state, at = now()) {
  const t = state.timer;
  if (!t.running) return;
  t.remainingMs = timerRemaining(state, at); t.running = false; t.endsAt = 0;
}
function resetTimer(state) { setTimer(state, state.timer.durationMs / 1000); }

function stepSeconds(state) {
  const s = D.STEPS[state.step];
  if (state.stepOverrides && state.stepOverrides[s.id] != null) return state.stepOverrides[s.id];
  return s.sec == null ? harvestSecOf(state) : s.sec;
}

// ---------- Deroule ----------
function startSetup(state, rand = Math.random) {
  if (state.phase !== 'lobby') fail('La partie est déjà lancée.');
  if (state.teams.length < 1) fail('Ajoute au moins une ferme.');
  state.phase = 'setup';
  setTimer(state, D.SETUP_SEC);
  drawMenu(state);
  ensureCollective(state, 1, rand);
  prepareForecast(state, rand);
  log(state, 'Installation des fermes (10 minutes).');
}

function startYear(state) {
  if (state.phase !== 'setup' && state.phase !== 'rearrange') fail('Rien à démarrer maintenant.');
  const free = state.menu ? state.menu.items.filter((x) => !x.team).length : 0;
  if (free) fail(`Il reste ${free} plat${free > 1 ? 's' : ''} de la commande à répartir : laisse les fermes se décider ou répartis le reste au hasard.`);
  state.phase = 'season';
  state.season = 0; state.step = 0;
  state.card = null; state.die = null; state.dieSixApplied = false;
  setTimer(state, stepSeconds(state));
  log(state, `Année ${state.year} : le printemps commence.`);
}

function resetSeasonFlags(state) {
  for (const t of state.teams) {
    t.ready = false; t.choice = null; t.wheel = null; t.freeSpin = false; t.camionnetteUsed = false;
    t.stopped = false; t.sales = null; t.transfo = null; t.harvest = null; t.collier = false; t.rawAdj = {};
    if (t.stopSeasons > 0) { t.stopped = true; t.stopSeasons -= 1; }
  }
  state.card = null; state.die = null; state.dieSixApplied = false;
}

function nextStep(state, rand = Math.random) {
  if (state.phase !== 'season') fail('Pas de saison en cours.');
  if (state.card && state.card.collective && (state.card.resolved === null || state.card.resolved === undefined) && D.STEPS[state.step].id === state.card.due) settleCollective(state);
  if (state.step < D.STEPS.length - 1) {
    state.step += 1;
    for (const t of state.teams) t.ready = false;
    setTimer(state, stepSeconds(state));
    if (D.STEPS[state.step].id === 'achats') prepareForecast(state, rand);
    return;
  }
  // Fin de saison : les hamacs retirent une boule.
  for (const t of state.teams) {
    const n = t.equipment.filter((e) => e === 'hamac').length;
    if (n) { addBocal(state, t.id, -n, 'Hamac'); }
  }
  if (state.season < 3) {
    state.season += 1; state.step = 0;
    resetSeasonFlags(state);
    setTimer(state, stepSeconds(state));
    log(state, `${D.SEASONS[state.season].name} de l'année ${state.year}.`);
  } else {
    resetSeasonFlags(state);
    state.phase = 'closing'; state.closedYear = false; state.feteDone = false; state.lastCharges = null;
    setTimer(state, 0);
    log(state, `Clôture de l'année ${state.year}.`);
  }
}

// Saut libre a une saison d'une annee : pour accelerer ou rejouer. Les charges, la fete et les achats des annees sautees ne sont pas rejoues.
function jumpTo(state, year, season) {
  if (!['setup', 'season', 'closing', 'rearrange'].includes(state.phase)) fail('Le saut se fait pendant la partie.');
  if (!Number.isInteger(year) || year < 1 || year > 3) fail('Année invalide.');
  if (!Number.isInteger(season) || season < 0 || season > 3) fail('Saison invalide.');
  const newYear = year !== state.year;
  state.phase = 'season';
  state.year = year; state.season = season; state.step = 0;
  state.closedYear = false; state.feteDone = false; state.lastCharges = null;
  resetSeasonFlags(state);
  if (newYear || !state.menu) { drawMenu(state); autoAssign(state); }
  setTimer(state, stepSeconds(state));
  log(state, `Saut : ${D.SEASONS[season].name} de l'année ${year}.`);
}

function prevStep(state) {
  if (state.phase !== 'season') fail('Pas de saison en cours.');
  if (state.step === 0) fail('Déjà à la première étape.');
  state.step -= 1;
  setTimer(state, stepSeconds(state));
}

// ---------- Tirages ----------
// Annule la boule prise pour eviter une carte : elle ne compte pas non plus dans le trophee du Sage.
function revertBoule(state, t) {
  if (t.bocal > 0) t.bocal -= 1;
  t.bocalAdded = Math.max(0, t.bocalAdded - 1);
}

function clearChoices(state) {
  for (const t of state.teams) {
    if (t.choice === 'boule') revertBoule(state, t);
    t.choice = null;
  }
}

// ---------- Meteo et aleas collectifs ----------
const posOf = (year, season) => year * 4 + season;

// Un alea collectif par an, tire parmi toutes les saisons ; il remplace la carte de sa saison.
function ensureCollective(state, year, rand = Math.random) {
  if (state.collective && state.collective.year === year) return state.collective;
  const c = D.COLLECTIVE[Math.floor(rand() * D.COLLECTIVE.length)];
  state.collective = { year, id: c.id, season: c.season, done: false };
  return state.collective;
}

const collectiveCard = (state) => {
  const c = state.collective;
  return c && c.year === state.year && c.season === state.season && !c.done ? D.COLLECTIVE.find((x) => x.id === c.id) : null;
};

// Tire a l'avance la carte de la prochaine saison et en deduit la prevision meteo (visible de tous).
function prepareForecast(state, rand = Math.random) {
  let year, season;
  if (state.phase === 'setup') { year = 1; season = 0; }
  else if (state.phase === 'season') {
    if (state.season < 3) { year = state.year; season = state.season + 1; }
    else if (state.year < 3) { year = state.year + 1; season = 0; }
    else { state.forecast = null; state.nextCard = null; return null; }
  } else return null;
  const col = ensureCollective(state, year, rand);
  const pool = D.CARDS[season];
  let weather = 'incertain';
  if (col.season === season) {
    state.nextCard = { year, season, id: col.id, collective: true };
  } else {
    const card = pool[Math.floor(rand() * pool.length)];
    state.nextCard = { year, season, id: card.id };
    const tags = [...new Set(pool.map((c) => c.weather).filter(Boolean))];
    const decoy = (not) => { const o = tags.filter((x) => x !== not); return o.length ? o[Math.floor(rand() * o.length)] : 'incertain'; };
    if (card.weather) weather = rand() < D.FORECAST_RELIABLE ? card.weather : (rand() < 0.5 ? decoy(card.weather) : 'incertain');
    else weather = rand() < D.FORECAST_BLUFF ? decoy(null) : 'incertain';
  }
  state.forecast = { year, season, weather, used: false };
  log(state, `Prévision météo pour ${D.SEASONS[season].name.toLowerCase()} de l'année ${year} : ${D.WEATHER[weather].name}.`);
  return state.forecast;
}

function forecastView(state, role) {
  const f = state.forecast;
  if (!f || f.used) return null;
  if (state.phase === 'season' && posOf(f.year, f.season) < posOf(state.year, state.season)) return null;
  if (state.phase === 'season' && f.year === state.year && f.season === state.season && state.card) return null;
  if (state.phase === 'lobby' || state.phase === 'end') return null;
  const w = D.WEATHER[f.weather];
  const out = { year: f.year, season: f.season, seasonName: D.SEASONS[f.season].name, id: f.weather, icon: w.icon, name: w.name, text: w.text };
  if (role === 'admin' && state.nextCard && state.nextCard.year === f.year && state.nextCard.season === f.season) {
    const src = state.nextCard.collective ? D.COLLECTIVE : D.CARDS[f.season];
    const c = src.find((x) => x.id === state.nextCard.id);
    out.truth = c ? c.title + (state.nextCard.collective ? ' (collectif)' : '') : null;
    if (c) {
      if (state.nextCard.collective) {
        const need = Math.max(1, Math.ceil(c.goal.perFarm * state.teams.length));
        out.truthEffect = `${c.story} Objectif : ${goalLabel(c.goal, need)} avant la fin de l’étape ${D.STEPS.find((x) => x.id === c.due).name}.`;
        out.truthTone = 'col';
      } else {
        const par = c.parade ? D.CATALOGUE.find((x) => x.id === c.parade) : null;
        out.truthEffect = c.effect + (c.tone === 'neg' ? (par ? ` Parade : ${par.name.toLowerCase()}.` : ' Pas de parade.') : '');
        out.truthTone = c.tone;
      }
    }
  }
  return out;
}

function drawCard(state, index, rand = Math.random) {
  if (state.phase !== 'season') fail('Les cartes se tirent pendant une saison.');
  if (state.card && state.card.collective) return state.card; // le defi collectif est deja la
  const pool = D.CARDS[state.season];
  ensureCollective(state, state.year, rand);
  let card = null;
  if (!Number.isInteger(index)) {
    const col = collectiveCard(state);
    if (col) { const need = Math.max(1, Math.ceil(col.goal.perFarm * state.teams.length)); card = Object.assign({}, col, { collective: true, tone: 'col', parade: null, mods: {}, resolved: null, pot: {}, need, goalText: goalLabel(col.goal, need), effect: col.story }); }
    else {
      // Premier tirage : la carte preparee en secret. Nouveau tirage (une carte est deja la) : une autre carte du paquet, au hasard.
      const nc = state.nextCard;
      const redraw = !!state.card && state.card.season === state.season;
      const planned = !redraw && nc && !nc.collective && nc.year === state.year && nc.season === state.season ? pool.find((c) => c.id === nc.id) : null;
      const others = redraw ? pool.filter((c) => c.id !== state.card.id) : pool;
      card = planned || others[Math.floor(rand() * others.length)];
    }
  } else {
    if (index < 0 || index >= pool.length) fail('Carte inconnue.');
    card = pool[index];
  }
  clearChoices(state);
  state.card = Object.assign({ season: state.season }, card);
  if (state.forecast && state.forecast.year === state.year && state.forecast.season === state.season) state.forecast.used = true;
  log(state, `${state.card.collective ? 'Aléa collectif' : 'Carte aléa'} : ${state.card.title}.`);
  return state.card;
}

// ---------- Alea collectif : objectif commun a reunir avant l'echeance ----------
const potTotal = (card) => Object.values(card.pot || {}).reduce((n, x) => n + x, 0);

function goalLabel(g, need) {
  if (g.kind === 'eb') return `${need} EB`;
  if (g.kind === 'dish') return `${need} × ${dishOf(g.dish).name.toLowerCase()}`;
  if (g.kind === 'raw') return `${need} jeton${need > 1 ? 's' : ''} de ${D.PRODUCTS.find((p) => p.id === g.product).name.toLowerCase()}`;
  return `${need} boule${need > 1 ? 's' : ''} à répartir`;
}

function collectiveOf(state) {
  const c = state.card;
  if (state.phase !== 'season' || !c || !c.collective) fail('Aucun aléa collectif en cours.');
  return c;
}

// Un don : argent (deduit de la banque), plat transforme (deduit du stock), jetons bruts (declares, remis a l'animateur), boules (prises par la ferme).
function contribute(state, teamId, n) {
  const c = collectiveOf(state);
  const t = teamOf(state, teamId);
  if (c.resolved !== null && c.resolved !== undefined) fail('Cet aléa est déjà réglé.');
  if (t.stopped && c.goal.kind !== 'eb') fail('Cette ferme est à l’arrêt cette saison.');
  if (!Number.isInteger(n) || n < 1) fail('Quantité invalide.');
  const left = c.need - potTotal(c);
  if (left <= 0) fail('L’objectif est déjà atteint.');
  if (n > left) fail(`Il ne manque plus que ${left} : donne au plus ${left}.`);
  const g = c.goal;
  if (g.kind === 'eb') {
    if (t.bank < n) fail('Solde insuffisant.');
    addBank(state, teamId, -n, 'Don au village : ' + c.title);
  } else if (g.kind === 'dish') {
    if ((t.pantry[g.dish] || 0) < n) fail(`Il vous faut ${n} ${dishOf(g.dish).name.toLowerCase()} en stock.`);
    t.pantry[g.dish] -= n; t.dishes[TIER_KEY[dishOf(g.dish).tier]] -= n;
  } else if (g.kind === 'boule') {
    addBocal(state, teamId, n, 'Aléa collectif : ' + c.title);
  }
  c.pot = Object.assign({}, c.pot);
  c.pot[teamId] = (c.pot[teamId] || 0) + n;
  log(state, `${t.name} donne ${n} pour « ${c.title} » (${potTotal(c)} / ${c.need}).`);
  return potTotal(c);
}

// Correction animateur d'un don en jetons bruts (remise physique mal declaree) : sans effet sur la banque.
function adjustContribution(state, teamId, delta) {
  const c = collectiveOf(state);
  teamOf(state, teamId);
  if (c.resolved !== null && c.resolved !== undefined) fail('Cet aléa est déjà réglé.');
  if (!Number.isInteger(delta) || delta === 0) fail('Quantité invalide.');
  c.pot = Object.assign({}, c.pot);
  c.pot[teamId] = Math.max(0, (c.pot[teamId] || 0) + delta);
  log(state, `Don de ${teamOf(state, teamId).name} corrigé : ${c.pot[teamId]}.`);
}

// Regle l'alea : objectif atteint = win, sinon lose. Appele a l'echeance, ou par l'animateur.
function settleCollective(state) {
  const c = collectiveOf(state);
  if (c.resolved !== null && c.resolved !== undefined) return c;
  const ok = potTotal(c) >= c.need;
  const eff = (ok ? c.win : c.lose) || {};
  c.resolved = ok;
  for (const t of state.teams) {
    if (eff.bocalAll) addBocal(state, t.id, eff.bocalAll, 'Aléa collectif', true);
    if (eff.bankAll) addBank(state, t.id, eff.bankAll, c.title, true);
  }
  if (state.collective && state.collective.year === state.year) state.collective.done = true;
  log(state, `Aléa collectif « ${c.title} » : ${ok ? 'objectif atteint' : 'objectif manqué'} (${potTotal(c)} / ${c.need}). ${ok ? c.winText : c.loseText}`);
  return c;
}

function rollDie(state, value, rand = Math.random) {
  if (state.phase !== 'season') fail('Le dé se lance pendant une saison.');
  const v = Number.isInteger(value) ? value : 1 + Math.floor(rand() * 6);
  if (v < 1 || v > 6) fail('Valeur de dé invalide.');
  state.die = v;
  log(state, `Dé des activités : ${v} (${D.DIE[v - 1].split(' :')[0]}).`);
  return v;
}

function spinWheel(state, teamId, rand = Math.random) {
  if (state.phase !== 'season') fail('La roue tourne pendant une saison.');
  const t = teamOf(state, teamId);
  if (t.stopped) fail('Cette ferme est à l’arrêt cette saison.');
  if (!t.sales) fail('Placez d’abord vos produits (étal et supermarché), puis tournez la roue.');
  if (t.sales.settled) fail('Les ventes sont déjà payées : la roue ne tourne plus.');
  if (!SALE_FIELDS.some((k) => k.startsWith('dir_') && t.sales[k] > 0)) fail('Rien sur l’étal : la roue ne sert à rien.');
  const hasVan = t.equipment.includes('camionnette') && !t.camionnetteUsed;
  if (t.wheel) {
    if (t.freeSpin) t.freeSpin = false;
    else if (hasVan) t.camionnetteUsed = true;
    else addBocal(state, t.id, 1, 'Relance de la roue');
  }
  const touristes = state.card && state.card.id === 'touristes';
  let seg;
  let guard = 0;
  do { seg = D.WHEEL[Math.floor(rand() * D.WHEEL.length)]; guard += 1; }
  while (touristes && seg.frac < 0.75 && guard < 50);
  t.wheel = { label: seg.label, frac: seg.frac };
  if (seg.free) t.freeSpin = true;
  log(state, `${t.name} : roue du marché, ${seg.label}.`);
  return t.wheel;
}

// ---------- Banque et bocal ----------
function addBank(state, teamId, amount, label, force = false) {
  const t = teamOf(state, teamId);
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount === 0) fail('Montant invalide.');
  if (!force && t.bank + amount < 0) fail('Solde insuffisant.');
  t.bank += amount;
  t.ledger.push({ at: now(), label: String(label || 'Mouvement').slice(0, 60), amount, year: state.year, season: state.season });
  if (t.ledger.length > 60) t.ledger.shift();
  return t.bank;
}

// Virement d'une ferme : vers l'animateur (taxe, achat...) ou vers une autre ferme. Motifs imposes.
function transfer(state, fromId, to, amount, reason) {
  if (!['setup', 'season', 'closing', 'rearrange'].includes(state.phase)) fail('Les virements sont ouverts pendant la partie.');
  const from = teamOf(state, fromId);
  if (!Number.isInteger(amount) || amount < 1 || amount > 5000) fail('Montant invalide.');
  if (from.bank < amount) fail('Solde insuffisant.');
  if (to === 'animateur') {
    if (!D.TRANSFER_REASONS.animateur.includes(reason)) fail('Choisis un motif.');
    addBank(state, from.id, -amount, `Paiement à l’animateur · ${reason}`);
    log(state, `${from.name} paie ${amount} EB à l’animateur (${reason}).`);
    return;
  }
  const dest = teamOf(state, to);
  if (dest.id === from.id) fail('Choisis une autre ferme.');
  if (!D.TRANSFER_REASONS.ferme.includes(reason)) fail('Choisis un motif.');
  addBank(state, from.id, -amount, `Virement à ${dest.name} · ${reason}`);
  addBank(state, dest.id, amount, `Virement de ${from.name} · ${reason}`);
  log(state, `${from.name} vire ${amount} EB à ${dest.name} (${reason}).`);
}

function addBocal(state, teamId, delta, reason, silent = false) {
  const t = teamOf(state, teamId);
  if (!Number.isInteger(delta) || delta === 0) return t.bocal;
  const before = t.bocal;
  t.bocal = Math.max(0, t.bocal + delta);
  if (delta > 0) t.bocalAdded += delta;
  if (t.bocal > (t.bocalPeak || 0)) t.bocalPeak = Math.min(t.bocal, D.BOCAL_MAX);
  if (!silent) log(state, `${t.name} : bocal ${before} → ${t.bocal}${reason ? ' (' + reason + ')' : ''}.`);
  if (t.bocal >= D.BOCAL_MAX) {
    t.burnouts += 1; t.bocal = D.BURNOUT_RESTART; t.stopSeasons = 1;
    log(state, `${t.name} : BURN-OUT. La ferme s’arrête une saison et repart avec ${D.BURNOUT_RESTART} boules.`);
  }
  return t.bocal;
}

function levelOf(n) { return n <= 3 ? 'Zen' : n <= 6 ? 'Agité' : 'Stressé'; }

function setReady(state, teamId, ready) {
  teamOf(state, teamId).ready = !!ready;
}

// ---------- Boutique ----------
function priceOf(team, item) {
  if (item.kind === 'tile') {
    if (item.price) return item.price;
    return (team.tiles[item.tile] || 0) > 0 ? D.TILE_PRICE.owned : D.TILE_PRICE.new;
  }
  if (!item.multi && team.equipment.includes(item.id)) return null;
  return item.price;
}

function canShop(state) {
  if (state.phase === 'setup' || state.phase === 'closing' || state.phase === 'rearrange') return true;
  return state.phase === 'season' && D.STEPS[state.step].id === 'achats';
}

// Agrandissements (tuiles) : seulement a l'installation et en fin d'annee.
function canExpand(state) { return state.phase === 'setup' || state.phase === 'rearrange'; }

function buy(state, teamId, itemId, force = false) {
  const t = teamOf(state, teamId);
  const item = D.CATALOGUE.find((i) => i.id === itemId) || fail('Article inconnu.');
  if (!force && !canShop(state)) fail('Les achats se font à l’étape Achats, à l’installation ou au réaménagement.');
  if (item.kind === 'tile' && !force && !canExpand(state)) fail('Les agrandissements s’achètent à l’installation et en fin d’année, pas pendant les saisons ni à la clôture.');
  if (state.phase === 'closing' && !state.closedYear && !force) fail('Applique d’abord les charges de l’année.');
  const price = priceOf(t, item);
  if (price == null) fail('Déjà acheté.');
  if (t.bank < price) fail('Solde insuffisant.');
  addBank(state, teamId, -price, item.name);
  if (item.kind === 'tile') t.tiles[item.tile] = (t.tiles[item.tile] || 0) + 1;
  else t.equipment.push(item.id);
  t.lastBuy = force ? null : { itemId, price, at: now() };
  log(state, `${t.name} achète : ${item.name} (${price} EB).`);
  return price;
}

// Annulation d'un achat, possible quelques secondes apres (erreur de clic).
const UNDO_MS = 15000;
const at0 = () => now();
function undoBuy(state, teamId, at = now()) {
  const t = teamOf(state, teamId);
  const b = t.lastBuy;
  if (!b || at - b.at > UNDO_MS) fail('Plus possible d’annuler : le délai est écoulé.');
  const item = D.CATALOGUE.find((i) => i.id === b.itemId);
  if (item.kind === 'tile') { if (!(t.tiles[item.tile] > 0)) fail('Tuile introuvable.'); t.tiles[item.tile] -= 1; }
  else { const i = t.equipment.lastIndexOf(item.id); if (i < 0) fail('Matériel introuvable.'); t.equipment.splice(i, 1); }
  addBank(state, teamId, b.price, 'Annulation : ' + item.name, true);
  t.lastBuy = null;
  log(state, `${t.name} annule son achat : ${item.name}.`);
}

function giftTile(state, teamId, tile) {
  const t = teamOf(state, teamId);
  if (!TILE_TYPES.includes(tile)) fail('Type de tuile inconnu.');
  t.tiles[tile] = (t.tiles[tile] || 0) + 1;
  log(state, `${t.name} reçoit une tuile gratuite : ${D.TILE_NAMES[tile]}.`);
}

function removeTile(state, teamId, tile) {
  const t = teamOf(state, teamId);
  if (!(t.tiles[tile] > 0)) fail('Pas de tuile de ce type.');
  t.tiles[tile] -= 1;
}

function setChoice(state, teamId, choice) {
  const t = teamOf(state, teamId);
  if (state.phase !== 'season' || !state.card) fail('Aucune carte aléa en cours.');
  if (state.card.collective) fail('Aléa collectif : pas de choix individuel, le village réunit l’objectif ensemble.');
  if (!['subit', 'parade', 'boule'].includes(choice)) fail('Choix invalide.');
  if (choice === 'parade' && !(state.card.parade && t.equipment.includes(state.card.parade))) fail('Tu n’as pas le matériel de parade.');
  if (t.choice === 'boule') revertBoule(state, t);
  t.choice = choice;
  if (choice === 'boule') addBocal(state, teamId, 1, 'Éviter l’effet de la carte');
  return choice;
}

function vacation(state, teamId, n, force = false) {
  const t = teamOf(state, teamId);
  if (!Number.isInteger(n) || n < 1 || n > 8) fail('Nombre de voyageurs invalide.');
  if (state.phase !== 'season') fail('Les vacances se prennent pendant une saison.');
  if (!force && D.STEPS[state.step].id !== 'achats') fail('Les vacances se prennent à l’étape Achats.');
  const cost = n * D.VACATION_COST;
  if (t.bank < cost) fail('Solde insuffisant.');
  addBank(state, teamId, -cost, `Vacances (${n})`);
  addBocal(state, teamId, -Math.min(n, t.bocal), `Vacances de ${n} joueur(s)`);
  return cost;
}

function coupDeCollier(state, teamId) {
  if (state.phase !== 'season') fail('Le coup de collier se joue pendant une saison.');
  const t = teamOf(state, teamId);
  if (t.collier) fail('Le coup de collier est déjà lancé cette saison.');
  addBocal(state, teamId, 1, 'Coup de collier');
  t.collier = true;
}

// ---------- Transformation : l'equipe declare ses recettes, l'animateur echange les jetons puis valide ----------
// Remet a niveau une partie sauvegardee avec une version plus ancienne.
function migrate(state) {
  if (!state || !state.teams) return state;
  if (state.trades === undefined) { state.trades = []; state.tradeSeq = 0; }
  if (state.forecast === undefined) state.forecast = null;
  if (state.tripSec === undefined) state.tripSec = D.DEFAULT_TRIP_SEC;
  if (state.nextCard === undefined) state.nextCard = null;
  if (state.collective === undefined) state.collective = null;
  for (const t of state.teams) {
    if (!t.dishes) t.dishes = { simple: 0, mixed: 0, composed: 0 };
    if (!t.pantry) t.pantry = {};
    if (t.transfo && !t.transfo.items) t.transfo = null;
    if (t.transfo === undefined) t.transfo = null;
    if (t.sales && t.sales.sup !== undefined && t.sales.sup_raw === undefined) t.sales = null; // ancien format de vente
    if (t.wheel && t.wheel.frac === undefined) t.wheel = null;
  }
  return state;
}

function recipeLimit(t) { return (t.tiles && t.tiles.atelier > 0) ? 4 * t.tiles.atelier : 1; }

const TIER_KEY = { 1: 'simple', 2: 'mixed', 3: 'composed' };
const dishOf = (id) => D.DISHES.find((x) => x.id === id);

// Ce que l'animateur doit recevoir (jetons bruts), rendre (jetons de plat) et reprendre (plats servant d'ingredients).
function transfoQuote(items) {
  const receive = {}, give = {}, use = {};
  for (const id of Object.keys(items)) {
    const n = items[id]; if (!n) continue;
    const dd = dishOf(id);
    give[id] = n;
    for (const k of Object.keys(dd.req)) {
      const bucket = D.PRODUCTS.some((p) => p.id === k) ? receive : use;
      bucket[k] = (bucket[k] || 0) + dd.req[k] * n;
    }
  }
  return { receive, give, use };
}

function requestTransfo(state, teamId, input) {
  if (state.phase !== 'season' || D.STEPS[state.step].id !== 'bourse') fail('Les recettes se déclarent à l’étape Transformation et bourse.');
  const t = teamOf(state, teamId);
  if (t.stopped) fail('Cette ferme est à l’arrêt cette saison.');
  if (t.transfo && t.transfo.done) fail('Vos recettes sont déjà validées par l’animateur.');
  const items = {};
  let n = 0;
  for (const id of Object.keys(input || {})) {
    if (!dishOf(id)) fail('Plat inconnu.');
    const v = input[id];
    if (!Number.isInteger(v) || v < 0 || v > 20) fail('Quantité invalide.');
    if (v) { items[id] = v; n += v; }
  }
  if (n > recipeLimit(t)) fail(`Votre ferme peut faire ${recipeLimit(t)} recette(s) par saison.`);
  // un plat compose utilise des plats deja fabriques (stock ou meme demande)
  const q = transfoQuote(items);
  for (const k of Object.keys(q.use)) {
    const have = (t.pantry[k] || 0) + (items[k] || 0);
    if (have < q.use[k]) fail(`Il vous manque ${q.use[k] - have} ${dishOf(k).name.toLowerCase()} pour ce plat composé.`);
  }
  t.transfo = { done: false, items };
  log(state, `${t.name} demande ${n} recette(s).`);
}

function validateTransfo(state, teamId) {
  if (state.phase !== 'season') fail('Les recettes se jouent pendant une saison.');
  const t = teamOf(state, teamId);
  if (!t.transfo) fail('Aucune recette demandée.');
  if (t.transfo.done) fail('Déjà validé.');
  const items = t.transfo.items;
  // les plats simples/mixtes d'abord, puis les composes (qui consomment ces plats)
  const order = Object.keys(items).sort((x, y) => dishOf(x).tier - dishOf(y).tier);
  for (const id of order) {
    const dd = dishOf(id), c = TIER_KEY[dd.tier];
    for (const k of Object.keys(dd.req)) {
      if (!dishOf(k)) continue;
      const need = dd.req[k] * items[id];
      if ((t.pantry[k] || 0) < need) fail(`Il manque ${need - (t.pantry[k] || 0)} ${dishOf(k).name.toLowerCase()} en stock.`);
      t.pantry[k] -= need; t.dishes[TIER_KEY[dishOf(k).tier]] -= need;
    }
    t.pantry[id] = (t.pantry[id] || 0) + items[id];
    t.dishes[c] += items[id];
  }
  t.transfo.done = true;
  log(state, `${t.name} : recettes validées (jetons échangés).`);
}

// ---------- Marche : placement des produits, roue, paiement ----------
// Supermarche : prix garanti, jamais de roue. Etal (vente directe) : prix double mais la roue decide de la part vendue,
// decalee produit par produit selon le gout du moment (DEMAND) ; ce qui reste invendu est perdu.
// Les produits se placent AVANT de tourner la roue, par produit (4 bruts, 9 plats).
const SELL = [].concat(D.PRODUCTS.map((p) => ({ id: p.id, kind: 'raw', name: p.name, mult: D.MARKET.mult.raw })),
  D.DISHES.map((d) => ({ id: d.id, kind: 'dish', tier: d.tier, name: d.name, mult: D.MARKET.mult[TIER_KEY[d.tier]] })));
const SALE_FIELDS = [].concat(SELL.map((x) => 'sup_' + x.id), SELL.map((x) => 'dir_' + x.id));

// Etal : 8 produits ; la table de marche ajoute 2 (10), la camionnette ajoute 4 (12) ; les deux cumulees : 14.
function stallCap(t) {
  const M = D.MARKET;
  return M.stallCap + (t.equipment.includes('table') ? M.tableCap - M.stallCap : 0) + (t.equipment.includes('camionnette') ? M.vanCap - M.stallCap : 0);
}

// Jetons bruts disponibles : jetons rapportes (encodes) x valeur du jeton, moins ce que les recettes validees ou demandees ont pris.
// (L'animateur verifie le compte physique avant de payer.)
function rawStock(state, t) {
  const out = {};
  for (const p of D.PRODUCTS) out[p.id] = 0;
  if (state.phase !== 'season' || state.step < 1) return out;
  if (!t.stopped) for (const h of harvestOf(state, t)) out[h.id] = h.value; // jetons rapportes x valeur du jeton (0 tant que la recolte n'est pas encodee)
  if (t.transfo && t.transfo.items) {
    const q = transfoQuote(t.transfo.items);
    for (const k of Object.keys(q.receive)) out[k] = Math.max(0, (out[k] || 0) - q.receive[k]);
  }
  for (const p of D.PRODUCTS) out[p.id] = Math.max(0, out[p.id] + ((t.rawAdj && t.rawAdj[p.id]) || 0)); // echanges de la bourse
  if (t.sales && t.sales.settled) for (const p of D.PRODUCTS) out[p.id] = Math.max(0, out[p.id] - (t.sales['sup_' + p.id] || 0) - (t.sales['dir_' + p.id] || 0));
  return out;
}

function stockOf(state, t) {
  const dishes = {};
  for (const d of D.DISHES) if ((t.pantry[d.id] || 0) > 0) dishes[d.id] = t.pantry[d.id];
  return { raw: rawStock(state, t), dishes };
}

const stockFor = (state, t, id) => (D.PRODUCTS.some((p) => p.id === id) ? rawStock(state, t)[id] : (t.pantry[id] || 0));

// Gout du moment : +DEMAND_ADJ (recherche), -DEMAND_ADJ (boude) ou 0, selon la saison.
function demandOf(season, id) {
  const d = D.DEMAND[season];
  return d.hot.ids.includes(id) ? 'hot' : d.cold.ids.includes(id) ? 'cold' : null;
}

// Phrase de retour de marche pour un produit de l'etal.
function marketLine(season, id, frac, tag) {
  const T = D.SELL_TEXT[id];
  const level = frac >= 0.9 ? 'tout' : frac >= 0.5 ? 'bien' : frac > 0 ? 'peu' : 'rien';
  const ag = (g, pl) => (g === 'f' ? 'e' : '') + (pl ? 's' : '');
  const verb = {
    tout: T.pl ? `se sont arrach${'é' + ag(T.g, true)}` : `s’est arrach${'é' + ag(T.g, false)}`,
    bien: T.pl ? 'ont bien marché' : 'a bien marché',
    peu: T.pl ? 'ont peu séduit' : 'a peu séduit',
    rien: T.pl ? 'n’ont intéressé personne' : 'n’a intéressé personne'
  }[level];
  const subj = `${T.pl ? 'Vos' : 'Votre'} ${T.name}`;
  const d = D.DEMAND[season];
  let text = `${subj} ${verb}`;
  if (tag === 'hot' && (level === 'tout' || level === 'bien')) text += ` : ${d.hot.why}`;
  else if (tag === 'cold' && (level === 'peu' || level === 'rien')) text += ` : ${d.cold.why}`;
  return { id, level, text: text + (level === 'tout' ? ' !' : '.') };
}

function salesQuote(state, t, d) {
  const M = D.MARKET;
  const bonus = state.card && state.card.id === 'hiver_gourmand' ? M.gourmandBonus : 0;
  const frac = t.wheel ? t.wheel.frac : null;
  let sup = 0, stall = 0, stallUnits = 0, sold = 0, soldUnits = 0;
  const lines = [];
  for (const x of SELL) {
    const su = d['sup_' + x.id] || 0, du = d['dir_' + x.id] || 0;
    if (!su && !du) continue;
    const b = x.kind === 'raw' ? 0 : bonus;
    const unitSup = x.mult * M.superPrice + b, unitDir = x.mult * M.directPrice + b;
    sup += su * unitSup; stall += du * unitDir; stallUnits += du;
    const tag = frac == null ? null : demandOf(state.season, x.id);
    const fp = frac == null ? null : Math.max(0, Math.min(1, frac + (tag === 'hot' ? D.DEMAND_ADJ : tag === 'cold' ? -D.DEMAND_ADJ : 0)));
    const rev = fp == null ? null : Math.round(du * unitDir * fp);
    const su2 = fp == null ? null : Math.round(du * fp);
    if (fp != null) { sold += rev; soldUnits += su2; }
    lines.push({ id: x.id, name: x.name, sup: su, dir: du, unitSup, unitDir, tag, frac: fp, soldUnits: su2, revenue: rev });
  }
  const fee = stallUnits > 0 ? M.stallFee : 0;
  const report = frac == null ? [] : lines.filter((l) => l.dir > 0).map((l) => Object.assign(marketLine(state.season, l.id, l.frac, l.tag), { tag: l.tag }));
  return {
    sup, stall, stallUnits, fee, frac, sold: frac == null ? null : sold,
    soldUnits: stallUnits === 0 ? 0 : frac == null ? null : soldUnits,
    total: stallUnits === 0 ? sup : frac == null ? null : sup + sold - fee,
    safeTotal: sup, cap: stallCap(t), lines, report,
    directBlocked: !!(state.card && (state.card.id === 'greve' || (state.card.mods && state.card.mods.directBlocked)) && !isExempt(state, t))
  };
}

function cleanSales(state, t, input) {
  const d = {};
  for (const k of SALE_FIELDS) {
    const v = input && input[k] !== undefined ? input[k] : 0;
    if (!Number.isInteger(v) || v < 0 || v > 99) fail('Quantité invalide.');
    d[k] = v;
  }
  for (const x of SELL) {
    const n = (d['sup_' + x.id] || 0) + (d['dir_' + x.id] || 0);
    const have = stockFor(state, t, x.id);
    if (n > have) fail(have ? `Vous n’avez que ${have} ${x.name.toLowerCase()} en stock.` : `Vous n’avez pas de ${x.name.toLowerCase()} en stock.`);
  }
  const q = salesQuote(state, t, d);
  if (q.stallUnits > q.cap) fail(`L’étal contient ${q.cap} produits au maximum.`);
  if (q.stallUnits > 0 && q.directBlocked) fail('Pas de vente directe cette saison.');
  return d;
}

function declareSales(state, teamId, input) {
  if (state.phase !== 'season' || D.STEPS[state.step].id !== 'marche') fail('Les ventes se déclarent à l’étape Marché.');
  const t = teamOf(state, teamId);
  if (t.stopped) fail('Cette ferme est à l’arrêt cette saison.');
  if (t.sales && t.sales.settled) fail('Les ventes de cette saison sont déjà payées.');
  if (t.wheel) fail('La roue a tourné : le placement des produits est figé.');
  const d = cleanSales(state, t, input);
  t.sales = Object.assign({ settled: false, amount: 0 }, d);
  log(state, `${t.name} a placé ses produits (étal et supermarché).`);
}

// L'animateur verifie les produits remis puis paie. Paiement unique par saison.
function settleSales(state, teamId) {
  if (state.phase !== 'season') fail('Le marché se joue pendant une saison.');
  const t = teamOf(state, teamId);
  if (t.sales && t.sales.settled) fail('Déjà payé.');
  if (!t.sales) fail('Aucun produit placé.');
  const d = cleanSales(state, t, t.sales);
  const q = salesQuote(state, t, d);
  if (q.total == null) fail('La roue de cette ferme n’a pas encore tourné.');
  t.sales = Object.assign({ settled: true, amount: q.total }, d);
  for (const x of SELL.filter((y) => y.kind === 'dish')) { const k = (d['sup_' + x.id] || 0) + (d['dir_' + x.id] || 0); if (k) { t.pantry[x.id] -= k; t.dishes[TIER_KEY[x.tier]] -= k; } }
  if (q.total > 0) addBank(state, t.id, q.total, `Ventes du marché (étal : ${q.soldUnits} sur ${q.stallUnits})`);
  else if (q.total < 0) addBank(state, t.id, q.total, 'Ventes du marché (frais d’étal)', true);
  log(state, `${t.name} : ventes payées, ${q.total} EB.`);
  return q.total;
}

// ---------- Bourse : transferts de stock entre fermes (offre, acceptation du destinataire, paiement optionnel) ----------
// Le geste physique (les jetons passent de main en main) reste necessaire : l'application ne fait que suivre le stock et l'argent.
const tradeOf = (state, id) => state.trades.find((x) => x.id === id) || fail('Échange inconnu.');

function tradeItems(items) {
  const out = {};
  for (const id of Object.keys(items || {})) {
    const n = items[id];
    if (!n) continue;
    if (!SELL.some((x) => x.id === id)) fail('Produit inconnu.');
    if (!Number.isInteger(n) || n < 1 || n > 99) fail('Quantité invalide.');
    out[id] = n;
  }
  if (!Object.keys(out).length) fail('Choisis au moins un produit à échanger.');
  return out;
}

function checkTradeStock(state, t, items) {
  for (const id of Object.keys(items)) {
    const have = stockFor(state, t, id);
    if (have < items[id]) fail(`${t.name} n’a que ${have} ${SELL.find((x) => x.id === id).name.toLowerCase()} en stock.`);
  }
}

function moveStock(t, items, sign) {
  for (const id of Object.keys(items)) {
    const x = SELL.find((y) => y.id === id), n = sign * items[id];
    if (x.kind === 'raw') { t.rawAdj = Object.assign({}, t.rawAdj); t.rawAdj[id] = (t.rawAdj[id] || 0) + n; }
    else { t.pantry[id] = (t.pantry[id] || 0) + n; t.dishes[TIER_KEY[x.tier]] += n; }
  }
}

const tradeLabel = (items) => Object.keys(items).map((id) => `${items[id]} ${SELL.find((x) => x.id === id).name.toLowerCase()}`).join(', ');

function offerTrade(state, fromId, input) {
  if (state.phase !== 'season' || D.STEPS[state.step].id !== 'bourse') fail('Les échanges se font à l’étape Transformation et bourse.');
  const from = teamOf(state, fromId), to = teamOf(state, input && input.to);
  if (from.id === to.id) fail('Choisis une autre ferme.');
  const items = tradeItems(input.items);
  const price = input.price === undefined || input.price === null ? 0 : input.price;
  if (!Number.isInteger(price) || price < 0 || price > 9999) fail('Prix invalide.');
  checkTradeStock(state, from, items);
  if (state.trades.filter((x) => x.status === 'pending' && x.from === from.id).length >= 5) fail('Trop d’offres en attente : annule-en une.');
  const tr = { id: 'e' + (++state.tradeSeq), from: from.id, to: to.id, items, price, status: 'pending', at: now(), year: state.year, season: state.season };
  state.trades.push(tr);
  if (state.trades.length > 60) state.trades.splice(0, state.trades.length - 60);
  log(state, `${from.name} propose à ${to.name} : ${tradeLabel(items)} pour ${price} EB.`);
  return tr.id;
}

function respondTrade(state, teamId, tradeId, accept) {
  const tr = tradeOf(state, tradeId);
  if (tr.status !== 'pending') fail('Cette offre n’est plus en attente.');
  if (tr.to !== teamId) fail('Seule la ferme destinataire peut répondre.');
  const from = teamOf(state, tr.from), to = teamOf(state, tr.to);
  if (!accept) { tr.status = 'refused'; log(state, `${to.name} refuse l’offre de ${from.name}.`); return tr; }
  if (state.phase !== 'season' || D.STEPS[state.step].id !== 'bourse') fail('Les échanges se font à l’étape Transformation et bourse.');
  checkTradeStock(state, from, tr.items);
  if (to.bank < tr.price) fail('Solde insuffisant pour payer cet échange.');
  moveStock(from, tr.items, -1); moveStock(to, tr.items, 1);
  if (tr.price > 0) { addBank(state, to.id, -tr.price, `Bourse : achat à ${from.name}`); addBank(state, from.id, tr.price, `Bourse : vente à ${to.name}`, true); }
  tr.status = 'done'; tr.doneAt = now();
  log(state, `Bourse : ${from.name} → ${to.name} : ${tradeLabel(tr.items)} pour ${tr.price} EB.`);
  return tr;
}

// Annulation d'une offre en attente (par son auteur ou par l'animateur).
function cancelTrade(state, teamId, tradeId, byAdmin = false) {
  const tr = tradeOf(state, tradeId);
  if (tr.status !== 'pending') fail('Cette offre n’est plus en attente.');
  if (!byAdmin && tr.from !== teamId) fail('Seule la ferme qui propose peut annuler.');
  tr.status = 'cancelled';
  log(state, `Offre annulée : ${teamOf(state, tr.from).name} → ${teamOf(state, tr.to).name}.`);
  return tr;
}

// Annulation animateur d'un echange deja conclu : on remet stock et argent si c'est encore possible.
function revertTrade(state, tradeId) {
  const tr = tradeOf(state, tradeId);
  if (tr.status !== 'done') fail('Seul un échange conclu peut être annulé.');
  const from = teamOf(state, tr.from), to = teamOf(state, tr.to);
  checkTradeStock(state, to, tr.items);
  if (from.bank < tr.price) fail(`${from.name} n’a plus l’argent à rembourser : corrige à la main.`);
  moveStock(to, tr.items, -1); moveStock(from, tr.items, 1);
  if (tr.price > 0) { addBank(state, from.id, -tr.price, `Bourse annulée : remboursement à ${to.name}`, true); addBank(state, to.id, tr.price, `Bourse annulée : remboursement de ${from.name}`, true); }
  tr.status = 'reverted';
  log(state, `Échange annulé par l’animateur : ${from.name} → ${to.name}.`);
  return tr;
}

// ---------- Cloture ----------
function estimateCharges(t) {
  const c = D.CHARGES;
  const taxes = c.taxes * totalTiles(t);
  const eau = c.eau * (t.tiles.fl || 0);
  const nourriture = c.nourriture * ((t.tiles.lait || 0) + (t.tiles.oeuf || 0) + (t.tiles.viande || 0));
  const electricite = c.electricite * (t.tiles.atelier || 0);
  return { taxes, eau, nourriture, electricite, total: taxes + eau + nourriture + electricite };
}

function closeYear(state) {
  if (state.phase !== 'closing') fail('La clôture se fait après l’hiver.');
  if (state.closedYear) fail('Les charges ont déjà été appliquées.');
  state.lastCharges = {};
  for (const t of state.teams) {
    const ch = estimateCharges(t);
    const paid = Math.min(t.bank, ch.total);
    const missing = ch.total - paid;
    if (paid > 0) addBank(state, t.id, -paid, `Charges de l’année ${state.year}`);
    const boules = missing > 0 ? Math.min(3, Math.ceil(missing / 30)) : 0;
    if (boules) addBocal(state, t.id, boules, `Dette de ${missing} EB`);
    state.lastCharges[t.id] = Object.assign({ paid, missing, boules }, ch);
  }
  state.closedYear = true;
  log(state, `Charges de l’année ${state.year} appliquées.`);
}

// ---------- Menu de la Fete du Phoenix ----------
// Tire au debut de l'annee : meme nombre de plats pour chaque ferme, de plus en plus complexes d'annee en annee.
// Produits bruts necessaires a un plat (recursif pour les plats composes).
function leavesOf(dishId, acc = new Set()) {
  const dd = D.DISHES.find((x) => x.id === dishId);
  for (const k of Object.keys(dd.req)) { if (D.DISHES.some((x) => x.id === k)) leavesOf(k, acc); else acc.add(k); }
  return acc;
}
// Fermes qui possedent deja toutes les tuiles necessaires a un plat.
function makersOf(state, dishId) {
  const need = [...leavesOf(dishId)];
  return state.teams.filter((t) => need.every((p) => (t.tiles[p] || 0) > 0));
}
// Un plat n'est tire que si au moins une ferme du village peut le produire avec ses tuiles actuelles.
function feasible(state, dishId) { return makersOf(state, dishId).length > 0; }

function drawMenu(state, rand = Math.random) {
  if (state.phase === 'season' && state.step >= 2) fail('Le menu ne se retire plus après la récolte.');
  if (state.phase === 'closing' || state.phase === 'end') fail('Le menu de cette année est figé.');
  const cfg = D.FETE[Math.min(state.year, 3) - 1];
  const used = state.menuHistory || [];
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // Pour chaque niveau : les plats pas encore vus les annees precedentes d'abord, puis on fait tourner la liste (variete).
  const rank = (tier) => {
    let pool = D.DISHES.filter((d) => d.tier === tier);
    const ok = pool.filter((d) => feasible(state, d.id));
    if (ok.length) pool = ok;
    return shuffle(pool.filter((d) => !used.includes(d.id))).concat(shuffle(pool.filter((d) => used.includes(d.id))));
  };
  const items = [];
  const n = Math.max(1, state.teams.length);
  let k = 0;
  for (const tier of cfg.tiers.filter((v, i, arr) => arr.indexOf(v) === i)) {
    const count = cfg.tiers.filter((x) => x === tier).length * n;
    const order = rank(tier);
    for (let i = 0; i < count; i++) items.push({ key: 'p' + (++k), dish: order[i % order.length].id, team: null, delivered: false });
  }
  state.menuHistory = (state.menuHistory || []).concat(items.map((x) => x.dish));
  state.menu = { year: state.year, perFarm: cfg.tiers.length, items };
  log(state, `Menu de la fête tiré : ${items.length} plats à répartir.`);
  return state.menu;
}

const itemOf = (state, key) => (state.menu && state.menu.items.find((x) => x.key === key)) || fail('Plat inconnu.');
const countOf = (state, teamId) => (state.menu ? state.menu.items.filter((x) => x.team === teamId).length : 0);

// La commande de la fete se repartit uniquement au tout debut de l'annee (installation ou reamenagement).
const menuOpen = (state) => state.phase === 'setup' || state.phase === 'rearrange';

function claimDish(state, teamId, key) {
  if (!state.menu) fail('Pas de menu pour le moment.');
  if (!menuOpen(state)) fail('La commande est figée : elle se répartit au tout début de l’année.');
  const t = teamOf(state, teamId), it = itemOf(state, key);
  if (it.team) fail(it.team === t.id ? 'Ce plat est déjà à vous.' : 'Ce plat est déjà pris.');
  if (countOf(state, t.id) >= state.menu.perFarm) fail(`Une ferme prend ${state.menu.perFarm} plat${state.menu.perFarm > 1 ? 's' : ''} : rendez-en un d’abord.`);
  it.team = t.id;
  log(state, `${t.name} se charge du plat : ${D.DISHES.find((d) => d.id === it.dish).name}.`);
}

function releaseDish(state, teamId, key) {
  if (!menuOpen(state)) fail('La commande est figée : elle se répartit au tout début de l’année.');
  const t = teamOf(state, teamId), it = itemOf(state, key);
  if (it.team !== t.id) fail('Ce plat n’est pas à vous.');
  if (it.delivered) fail('Ce plat est déjà livré.');
  it.team = null;
  log(state, `${t.name} rend un plat : ${D.DISHES.find((d) => d.id === it.dish).name}.`);
}

function assignDish(state, key, teamId) {
  const it = itemOf(state, key);
  if (teamId) teamOf(state, teamId);
  it.team = teamId || null;
}

// Repartit au hasard les plats restants (equitablement) : pour les fermes qui n'ont pas decide.
function autoAssign(state, rand = Math.random) {
  if (!state.menu) fail('Pas de menu pour le moment.');
  const free = state.menu.items.filter((x) => !x.team);
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
  for (const it of free) {
    const open = state.teams.filter((t) => countOf(state, t.id) < state.menu.perFarm);
    if (!open.length) break;
    open.sort((a, b) => countOf(state, a.id) - countOf(state, b.id));
    it.team = open[0].id;
  }
}

function setDelivered(state, key, delivered) {
  if (state.phase !== 'closing') fail('Les livraisons se valident à la clôture.');
  const it = itemOf(state, key);
  it.delivered = !!delivered;
}

function menuOk(state) {
  return !!(state.menu && state.menu.items.length && state.menu.items.every((x) => x.team && x.delivered));
}

// success omis : la fete reussit si tout le menu est livre. Les fermes responsables d'un plat manquant prennent +1 de stress en plus.
function fete(state, success) {
  if (state.phase !== 'closing' || !state.closedYear) fail('Applique d’abord les charges de l’année.');
  if (state.feteDone) fail('La fête a déjà été jouée cette année.');
  const ok = success === undefined ? menuOk(state) : !!success;
  for (const t of state.teams) addBocal(state, t.id, ok ? -2 : 1, ok ? 'Fête réussie' : 'Fête ratée');
  const missing = [];
  if (!ok && state.menu) {
    for (const it of state.menu.items) if (!it.delivered && it.team) missing.push(it);
    for (const t of state.teams) {
      const n = missing.filter((x) => x.team === t.id).length;
      if (n) addBocal(state, t.id, 1, `Plat non livré (${n})`);
    }
  }
  state.feteDone = true;
  state.fetes.push({ year: state.year, success: ok });
  log(state, `Fête du Phoenix ${ok ? 'réussie' : 'ratée'} (année ${state.year}).`);
}

function nextYear(state, rand = Math.random) {
  if (state.phase !== 'closing') fail('Pas de clôture en cours.');
  if (!state.closedYear) fail('Applique d’abord les charges de l’année.');
  if (!state.feteDone) fail('Joue d’abord la Fête du Phoenix (réussie ou ratée).');
  if (state.year >= 3) fail('C’était la dernière année : termine la partie.');
  state.year += 1;
  state.phase = 'rearrange';
  setTimer(state, D.REARRANGE_SEC);
  drawMenu(state);
  ensureCollective(state, state.year, rand);
  log(state, `Réaménagement avant l'année ${state.year}.`);
}

function finish(state) {
  if (state.phase === 'lobby') fail('La partie n’a pas commencé.');
  const teams = state.teams;
  const totalBank = teams.reduce((n, t) => n + t.bank, 0);
  const burnouts = teams.reduce((n, t) => n + t.burnouts, 0);
  const maxBank = Math.max(...teams.map((t) => t.bank));
  const minAdded = Math.min(...teams.map((t) => t.bocalAdded));
  const peak = Math.max(...teams.map((t) => t.bocalPeak || 0));
  const s1 = burnouts === 0 && peak <= D.PEAK_MAX;
  const s2 = state.fetes.length >= 3 && state.fetes.every((f) => f.success);
  const s3 = totalBank >= D.S3_MULT * D.START_BANK * teams.length;
  state.stars = {
    s1, s2, s3, count: [s1, s2, s3].filter(Boolean).length,
    totalBank, burnouts, target: D.S3_MULT * D.START_BANK * teams.length, peak,
    richest: teams.filter((t) => t.bank === maxBank).map((t) => t.name),
    sage: teams.filter((t) => t.bocalAdded === minAdded).map((t) => t.name)
  };
  state.phase = 'end';
  setTimer(state, 0);
  log(state, `Fin de la partie : ${state.stars.count} étoile(s).`);
}

// ---------- Effets des cartes aleas sur la course de chaque produit ----------
// Une carte negative ne touche pas une ferme qui a joue sa parade ou paye une boule.
function isExempt(state, t) {
  return !!(state.card && state.card.tone === 'neg' && (t.choice === 'parade' || t.choice === 'boule'));
}
const round5 = (x) => Math.max(5, Math.round(x / 5) * 5);
const baseTrips = (season, pid) => D.SEASONS[season].trips[pid];
// Allers-retours de base d'un produit pour une ferme : la serre permet de cultiver davantage de fruits et legumes en hiver.
const tripsFor = (state, t, pid) => (t && state.season === 3 && pid === 'fl' && t.equipment.includes('serre') ? D.WINTER_FL_SERRE_TRIPS : baseTrips(state.season, pid));
function cardRun(state, pid) {
  const q = state.card && state.card.mods && state.card.mods.run;
  return (q && (q[pid] || q.all)) || null;
}
// Effet de la carte sur un produit : { dur : multiplicateur de duree, perTrip : jetons par trajet }
function runMod(state, t, pid) {
  const m = cardRun(state, pid);
  if (!m || (t && isExempt(state, t))) return { dur: 1, perTrip: 1 };
  return { dur: m.zero ? 0 : m.dur === undefined ? 1 : m.dur, perTrip: m.perTrip || 1 };
}
// Duree de l'etape : le produit le plus long (en allers-retours), cartes positives comprises, x duree de l'aller-retour.
function harvestSecOf(state, season = state.season) {
  let max = 0;
  for (const p of D.PRODUCTS) {
    const m = season === state.season ? cardRun(state, p.id) : null;
    max = Math.max(max, baseTrips(season, p.id) * (m && m.dur > 1 ? m.dur : 1));
  }
  return round5(max * (state.tripSec || D.DEFAULT_TRIP_SEC));
}
// Secondes de course d'un produit pour une ferme : duree du produit (carte aleas, arret anticipe), plus les bonus de temps.
function runSecOf(state, t, pid) {
  const m = runMod(state, t, pid);
  const trips = tripsFor(state, t, pid) * m.dur;
  if (trips < D.MIN_RUN_TRIPS) return 0; // moins de 3/4 d'aller-retour : course impossible, produit non recoltable
  const core = Math.min(round5(trips * state.tripSec), Math.max(5, harvestSecOf(state) - stopEarlySec(state, t)));
  if (core < D.MIN_RUN_TRIPS * state.tripSec - 2.5) return 0; // meme apres un arret anticipe
  return core + bonusSec(state, t);
}
function harvestOf(state, t) {
  const chrono = harvestSecOf(state);
  return D.PRODUCTS.filter((p) => (t.tiles[p.id] || 0) > 0).map((p) => {
    const tiles = t.tiles[p.id], run = runSecOf(state, t, p.id), m = runMod(state, t, p.id);
    const brought = t.harvest ? t.harvest[p.id] || 0 : null;
    return { id: p.id, name: p.name, color: p.color, tiles, runners: tiles, runSec: run, baseRunSec: tripsFor(state, t, p.id) ? round5(tripsFor(state, t, p.id) * state.tripSec) : 0,
      perTrip: m.perTrip, stopAt: Math.max(0, chrono - run), overSec: Math.max(0, run - chrono), brought, value: brought || 0 };
  });
}

// Encodage de la recolte : nombre de jetons reellement rapportes par type (pas de plafond : tout depend de la vitesse des coureurs). 1 jeton = 1 ressource.
function declareHarvest(state, teamId, input, force = false) {
  const t = teamOf(state, teamId);
  if (state.phase !== 'season') fail('La récolte se joue pendant une saison.');
  if (!force && !['recolte', 'bourse'].includes(D.STEPS[state.step].id)) fail('La récolte s’encode à l’étape Récolte (ou au début de Transformation).');
  if (t.stopped) fail('Cette ferme est à l’arrêt cette saison.');
  if (!force && t.transfo) fail('Les recettes sont déjà demandées : demande à l’animateur de corriger la récolte.');
  const out = {};
  for (const h of harvestOf(state, t)) {
    const v = input && input[h.id] !== undefined ? input[h.id] : 0;
    if (!Number.isInteger(v) || v < 0) fail('Quantité invalide.');
    if (!force && v > 0 && !h.runSec) fail(`${h.name} : non récoltable cette saison (course trop courte).`);
    if (v > D.MAX_TOKENS) fail(`${h.name} : au plus ${D.MAX_TOKENS} jetons.`);
    out[h.id] = v;
  }
  if (input) for (const k of Object.keys(input)) if (input[k] && !(k in out)) fail('Vous ne produisez pas ce type.');
  t.harvest = out;
  log(state, `${t.name} : récolte encodée (${harvestOf(state, t).map((h) => `${h.name} ${out[h.id]}`).join(', ')}).`);
  return out;
}

// Correction animateur : +/- 1 jeton rapporte pour un type.
function adjustHarvest(state, teamId, product, delta) {
  const t = teamOf(state, teamId);
  const h = harvestOf(state, t).find((x) => x.id === product);
  if (!h) fail('Cette ferme ne produit pas ce type.');
  if (!Number.isInteger(delta) || delta === 0) fail('Quantité invalide.');
  const cur = Object.assign({}, t.harvest || {});
  for (const x of harvestOf(state, t)) if (cur[x.id] === undefined) cur[x.id] = 0;
  cur[product] = Math.max(0, Math.min(D.MAX_TOKENS, (cur[product] || 0) + delta));
  return declareHarvest(state, teamId, cur, true);
}
// Duree d'un aller-retour sur le parcours, mesuree par l'animateur : elle fixe la duree de course de chaque produit.
function setTripSec(state, sec) {
  if (!D.TRIP_CHOICES.includes(sec)) fail('Durée d’aller-retour invalide.');
  if (state.phase === 'season' && D.STEPS[state.step].id === 'recolte') fail('Le parcours se règle avant la récolte.');
  state.tripSec = sec;
  if (state.stepOverrides) delete state.stepOverrides.recolte; // la duree de recolte suit le parcours
  log(state, `Parcours réglé : aller-retour d’environ ${sec} s.`);
}

// Secondes de course apres la fin du chrono : coup de collier et tracteur.
const collierSec = (state) => round5(D.COLLIER_TRIPS * state.tripSec);
const tracteurSec = (state) => round5(D.TRACTEUR_TRIPS * state.tripSec);
function bonusSec(state, t) {
  if (!t) return 0;
  return (t.collier ? collierSec(state) : 0) + (t.equipment.includes('tracteur') ? tracteurSec(state) : 0);
}
function stopEarlySec(state, t) {
  const n = state.card && state.card.mods && state.card.mods.stopEarlySec;
  return n && !(t && isExempt(state, t)) ? round5(harvestSecOf(state) * n / 90) : 0;
}

// ---------- Vues (ce que chaque ecran a le droit de voir) ----------
// Phrase de retour de marche mise en avant sur l'ecran de projection : le produit le plus extreme (succes ou echec).
function marketNote(state, t) {
  if (!state || state.phase !== 'season' || !t.sales || !t.wheel) return null;
  const rep = salesQuote(state, t, t.sales).report;
  if (!rep.length) return null;
  const score = (l) => Math.abs((l.level === 'tout' ? 1 : l.level === 'bien' ? 0.7 : l.level === 'peu' ? 0.3 : 0) - 0.5) + (l.tag ? 0.2 : 0);
  return rep.slice().sort((a, b) => score(b) - score(a))[0].text;
}

function publicTeam(t, state) {
  return {
    marketNote: marketNote(state, t),
    exempt: state ? isExempt(state, t) : false, paid: !!(t.sales && t.sales.settled),
    id: t.id, name: t.name, bocal: t.bocal, level: levelOf(t.bocal), burnouts: t.burnouts,
    stopped: t.stopped, ready: t.ready, choice: t.choice, wheel: t.wheel,
    tiles: totalTiles(t), collier: !!t.collier, bonusSec: state && state.phase === 'season' ? bonusSec(state, t) : 0
  };
}

function ownTeam(t, state) {
  return Object.assign(publicTeam(t, state), {
    transfo: t.transfo ? Object.assign({}, t.transfo, transfoQuote(t.transfo.items)) : null, dishes: t.dishes, pantry: t.pantry, recipeLimit: recipeLimit(t),
    sales: state && state.phase === 'season' ? (() => { const d = SALE_FIELDS.reduce((o, k) => { o[k] = t.sales ? t.sales[k] : 0; return o; }, {}); return Object.assign({ declared: !!t.sales, settled: !!(t.sales && t.sales.settled), amount: t.sales ? t.sales.amount : 0 }, d, { quote: salesQuote(state, t, d) }); })() : null,
    harvest: state && state.phase === 'season' ? harvestOf(state, t) : [], stopEarly: state && state.phase === 'season' ? stopEarlySec(state, t) : 0,
    stock: state ? stockOf(state, t) : null,
    bank: t.bank, tilesByType: Object.assign({}, t.tiles), equipment: t.equipment.slice(),
    ledger: t.ledger.slice(-12).reverse(), charges: estimateCharges(t), freeSpin: t.freeSpin,
    bocalAdded: t.bocalAdded,
    undo: t.lastBuy && at0() - t.lastBuy.at <= UNDO_MS ? { name: (D.CATALOGUE.find((i) => i.id === t.lastBuy.itemId) || {}).name, ms: UNDO_MS - (at0() - t.lastBuy.at) } : null,
    shop: D.CATALOGUE.map((i) => ({ id: i.id, kind: i.kind, name: i.name, effect: i.effect, price: priceOf(t, i), owned: i.kind === 'equipment' && !i.multi && t.equipment.includes(i.id) }))
  });
}

function adminTeam(t, state) {
  return Object.assign(ownTeam(t, state), { token: t.token, profile: t.profile, ledger: t.ledger.slice(-6).reverse() });
}

// Fiche resumee d'une partie pour l'historique.
function summary(state) {
  const tot = state.teams.reduce((n, t) => n + t.bank, 0);
  return {
    code: state.code, label: state.label || '', createdAt: state.createdAt, updatedAt: state.updatedAt,
    phase: state.phase, year: state.year, season: state.season,
    teams: state.teams.map((t) => ({ name: t.name, bank: t.bank, burnouts: t.burnouts })),
    totalBank: tot, fetes: state.fetes.map((f) => f.success),
    stars: state.stars ? { count: state.stars.count, s1: state.stars.s1, s2: state.stars.s2, s3: state.stars.s3 } : null
  };
}

function tradesView(state, role, teamId) {
  if (role !== 'admin' && role !== 'team') return [];
  const mine = role === 'admin' ? state.trades : state.trades.filter((x) => x.from === teamId || x.to === teamId);
  return mine.slice(-15).map((x) => ({
    id: x.id, from: x.from, to: x.to, price: x.price, status: x.status, year: x.year, season: x.season,
    items: Object.keys(x.items).map((id) => ({ id, n: x.items[id], name: SELL.find((y) => y.id === id).name }))
  }));
}

function viewFor(state, role, teamId, at = now()) {
  migrate(state);
  const season = D.SEASONS[state.season];
  const view = {
    code: state.code, role, serverNow: at, phase: state.phase, year: state.year, season: state.season,
    seasonName: season.name, seasonColor: season.color, runBase: Object.fromEntries(D.PRODUCTS.map((p) => [p.id, baseTrips(state.season, p.id) ? round5(baseTrips(state.season, p.id) * state.tripSec) : 0])), stopEarlySec: stopEarlySec(state, null), runEff: Object.fromEntries(D.PRODUCTS.map((p) => [p.id, runSecOf(state, null, p.id)])), perTripEff: Object.fromEntries(D.PRODUCTS.map((p) => [p.id, runMod(state, null, p.id).perTrip])), harvestSec: harvestSecOf(state),
    step: state.step, stepName: D.STEPS[state.step].name,
    timer: { running: state.timer.running, remainingMs: timerRemaining(state, at), rawMs: state.timer.running ? state.timer.endsAt - at : state.timer.remainingMs, durationMs: state.timer.durationMs },
    card: state.card, die: state.die, dieLabel: state.die ? D.DIE[state.die - 1] : null,
    closedYear: state.closedYear, feteDone: state.feteDone, fetes: state.fetes,
    fete: D.FETE[Math.min(state.year, 3) - 1], lastCharges: role === 'admin' ? state.lastCharges : null,
    menu: state.menu ? { perFarm: state.menu.perFarm, open: menuOpen(state), items: state.menu.items.map((it) => { const d = D.DISHES.find((x) => x.id === it.dish); const tm = state.teams.find((x) => x.id === it.team); return { key: it.key, name: d.name, needs: d.needs, tier: d.tier, makers: makersOf(state, it.dish).map((x) => x.name), team: it.team, teamName: tm ? tm.name : null, delivered: it.delivered }; }) } : null,
    tripSec: state.tripSec, stars: state.stars, showQr: !!state.showQr, forecast: forecastView(state, role),
    trades: tradesView(state, role, teamId),
    ownedProducts: D.PRODUCTS.filter((p) => state.teams.some((t) => !t.stopped && (t.tiles[p.id] || 0) > 0)).map((p) => p.id),
    villageBank: state.teams.reduce((n, t) => n + t.bank, 0), villageGoal: D.S3_MULT * D.START_BANK * state.teams.length,
    roleShift: (state.year - 1) % 6,
    teams: state.teams.map((t) => (role === 'admin' ? adminTeam(t, state) : role === 'team' && t.id === teamId ? ownTeam(t, state) : publicTeam(t, state))),
    me: role === 'team' ? teamId : null,
    meta: {
      sell: SELL.map((x) => ({ id: x.id, kind: x.kind, tier: x.tier || 0, name: x.name, mult: x.mult })),
      steps: D.STEPS.map((x) => ({ id: x.id, name: x.name, hint: x.hint })),
      seasons: D.SEASONS.map((x, i) => ({ name: x.name, color: x.color, harvestSec: harvestSecOf(state, i) })),
      products: D.PRODUCTS, tileNames: D.TILE_NAMES, die: D.DIE, bocalMax: D.BOCAL_MAX, vacationCost: D.VACATION_COST, tripChoices: D.TRIP_CHOICES, collierSec: collierSec(state), tracteurSec: tracteurSec(state),
      catalogue: D.CATALOGUE.map((x) => ({ id: x.id, kind: x.kind, name: x.name, tile: x.tile || null })),
      profiles: Object.keys(D.PROFILES).map((k) => ({ id: k, name: D.PROFILES[k].name })),
      startBank: D.START_BANK, transferReasons: D.TRANSFER_REASONS, market: D.MARKET, dishes: D.DISHES.map((d) => ({ id: d.id, name: d.name, needs: d.needs, tier: d.tier }))
    }
  };
  view.canShop = canShop(state);
  view.canExpand = canExpand(state);
  if (role === 'admin') view.log = state.log.slice(-40).reverse();
  if (role === 'team') view.lastCharges = state.lastCharges ? state.lastCharges[teamId] || null : null;
  return view;
}

module.exports = {
  PROFILES: D.PROFILES, GameError, createSession, addTeam, removeTeam, startSetup, startYear, nextStep, prevStep,
  startTimer, pauseTimer, resetTimer, setTimer, timerRemaining,
  jumpTo, setTripSec, offerTrade, respondTrade, cancelTrade, revertTrade, declareHarvest, adjustHarvest, contribute, adjustContribution, settleCollective, undoBuy, prepareForecast, adjustTimer, setTimerSeconds, drawCard, rollDie, spinWheel, addBank, transfer, declareSales, settleSales, salesQuote, requestTransfo, validateTransfo, migrate, drawMenu, claimDish, releaseDish, assignDish, autoAssign, setDelivered, menuOk, addBocal, setReady, buy, giftTile, removeTile, setChoice,
  vacation, coupDeCollier, closeYear, fete, nextYear, finish, estimateCharges, priceOf, levelOf,
  viewFor, summary, canShop, log, newCode
};
