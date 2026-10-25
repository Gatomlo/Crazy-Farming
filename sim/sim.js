'use strict';
// Simulation Monte-Carlo : equipes virtuelles qui jouent via le vrai moteur (lib/engine.js).
// L'economie "physique" (recolte, ventes) est modelisee ici ; hypotheses dans DEFAULTS.
const E = require('../lib/engine');
const D = require('../lib/data');

const DEFAULTS = {
  teams: 4, skillMean: 0.85, skillSd: 0.12, noiseSd: 0.10,
  rawPrice: 5, directPrice: 10, stallFee: 10, stallCap: 8, vanCap: 12,
  recipeRaw: 2, transMult: 3, mixedMult: 4, atelierRecipes: 4, handRecipes: 1,
  tripSec: 30, skillRef: 0.85, size: 5, years: 3, // size = joueurs par ferme = coureurs disponibles (une tuile sans coureur ne rapporte rien, les equipes n'achetent pas plus de tuiles que de coureurs)
  pFeteLeniency: 0, coop: 0.8
};

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }
const clip = (x, a, b) => Math.max(a, Math.min(b, x));
const TYPES = ['lait', 'oeuf', 'viande', 'fl'];

function play(P, seed, strat) {
  const r = rng(seed);
  const s = E.createSession('SIM');
  E.setMode(s, { size: P.size, years: P.years });
  const staff = P.staff || P.size;
  s.tripSec = P.tripSec; // l'animateur regle le parcours sur la duree reelle d'un aller-retour : la recolte dure 2 allers-retours
  const profs = Object.keys(D.PROFILES);
  const agents = [];
  for (let i = 0; i < P.teams; i++) {
    const t = E.addTeam(s, { name: 'F' + i, profile: profs[i % profs.length] });
    const team = s.teams[s.teams.length - 1];
    agents.push({ id: team.id, skill: clip(P.skillMean + P.skillSd * gauss(r), 0.45, 1.1), invest: strat === 'mix' ? r() : strat === 'invest' ? 1 : 0.4, trans: { simple: 0, mixed: 0 }, stock: { lait: 0, oeuf: 0, viande: 0, fl: 0 }, collier: false, income: 0, boughtTiles: 0 });
  }
  const T = (a) => s.teams.find((x) => x.id === a.id);
  const sum = (o) => TYPES.reduce((n, k) => n + (o[k] || 0), 0);

  function shop(a, reserve) {
    const t = T(a);
    const tryBuy = (id) => { try { E.buy(s, t.id, id); return true; } catch (e) { return false; } };
    const price = (id) => E.priceOf(t, D.CATALOGUE.find((i) => i.id === id));
    const can = (id) => { const p = price(id); return p != null && t.bank - p >= reserve; };
    const yearsLeft = P.years - s.year;
    // vacances si bocal haut
    if (s.phase === 'season' && t.bocal >= 6) {
      const n = Math.min(t.bocal - 3, Math.floor((t.bank - reserve) / D.VACATION_COST), 4);
      if (n > 0) E.vacation(s, t.id, n);
    }
    if (a.invest > 0.3 && yearsLeft >= 1) {
      // tuile : type possede le moins cher d'abord ; atelier si absent
      if ((t.tiles.atelier || 0) === 0 && can('tile_atelier') && yearsLeft >= 1) { if (tryBuy('tile_atelier')) a.boughtTiles++; }
      for (let k = 0; k < 2; k++) {
        if (TYPES.reduce((n, x) => n + (t.tiles[x] || 0), 0) >= staff) break; // pas plus de tuiles que de coureurs
        const owned = TYPES.filter((x) => (t.tiles[x] || 0) > 0);
        if (!owned.length) break;
        const id = 'tile_' + owned.sort((x, y) => (t.tiles[x] || 0) - (t.tiles[y] || 0))[0];
        if (a.invest * 100 > 25 * (3 - yearsLeft) && can(id) && t.bank > 120 + reserve && (yearsLeft >= 1)) { if (tryBuy(id)) a.boughtTiles++; }
      }
    }
    for (let k = t.equipment.filter((e) => e === 'panier').length; k < (P.forceBrouette || 0); k++) if (can('panier')) tryBuy('panier');
    if (a.invest > 0.5 && yearsLeft >= 1) {
      if (!P.noTracteur && !t.equipment.includes('tracteur') && can('tracteur') && t.bank > 250 && s.year === 1) tryBuy('tracteur');
      if (!P.noBrouette && can('panier') && t.equipment.filter((e) => e === 'panier').length < (P.maxBrouette || 2) && t.bank > 200) tryBuy('panier');
      if (!t.equipment.includes('camionnette') && can('camionnette') && t.bank > 250) tryBuy('camionnette');
      if (!P.noBrouette && !t.equipment.includes('brouette') && can('brouette') && t.bank > 300) tryBuy('brouette');
    }
    // Parades : 'meteo' = achat guide par la prevision de la saison suivante (le risque sans meteo n'est pas couvert).
    const f = s.phase === 'season' || s.phase === 'setup' || s.phase === 'rearrange' || s.phase === 'closing' ? E.viewFor(s, 'team', t.id).forecast : null;
    let paradeList = ['chien', 'serre', 'arrosage', 'lampe'];
    if (P.parades === 'meteo') {
      paradeList = [];
      if (f && f.id !== 'incertain') for (const c of D.CARDS[f.season]) if (c.weather === f.id && c.parade && c.tone === 'neg' && a.invest > 0.2) paradeList.push(c.parade);
    }
    if (P.parades !== 'none') for (const id of paradeList) if ((P.parades === 'all' || P.parades === 'meteo' || a.invest > 0.4) && !t.equipment.includes(id) && can(id) && t.bank > (P.parades === 'all' ? 60 : P.parades === 'meteo' ? 80 : 150) + reserve && (P.parades === 'all' || P.parades === 'meteo' || s.year <= 2)) tryBuy(id);
    if (t.bocal >= 4 && can('hamac') && t.equipment.filter((e) => e === 'hamac').length < 1 && yearsLeft >= 1) tryBuy('hamac');
  }

  // installation
  E.startSetup(s, r);
  for (const a of agents) shop(a, 150);
  E.autoAssign(s); E.startYear(s);
  let bonusFete = 0;
  const colStats = [];

  for (let year = 1; year <= P.years; year++) {
    for (const a of agents) { a.trans = { simple: 0, mixed: 0 }; }
    for (let season = 0; season < 4; season++) {
      // 1. Alea
      const card = E.drawCard(s, undefined, r);
      if (card.collective) {
        // chaque ferme donne sa part avec la probabilite P.coop ; l'objectif est regle a l'echeance par le moteur
        const g = card.goal;
        for (const a of agents) {
          const t = T(a);
          if (r() > P.coop) continue;
          const sumPot = () => Object.values(card.pot || {}).reduce((n, x) => n + x, 0);
          const left = card.need - sumPot();
          if (left <= 0) break;
          const share = Math.min(left, Math.ceil(card.need / agents.length));
          try {
            if (g.kind === 'eb') { if (t.bank > share + 120) E.contribute(s, t.id, share); }
            else if (g.kind === 'boule') { if (t.bocal <= 5) E.contribute(s, t.id, Math.min(left, 1)); }
            else if (g.kind === 'dish') { t.pantry[g.dish] = (t.pantry[g.dish] || 0) + share; t.dishes.simple += share; E.contribute(s, t.id, share); }
            else E.contribute(s, t.id, share);
          } catch (e) { /* ferme dans l'incapacite de donner */ }
        }
      }
      for (const a of agents) {
        const t = T(a); if (t.stopped || card.collective) continue;
        const neg = card.tone === 'neg';
        if (card.parade && t.equipment.includes(card.parade)) E.setChoice(s, t.id, 'parade');
        else if (neg && t.bocal <= 2 && a.invest < 0.5) E.setChoice(s, t.id, 'boule');
        else E.setChoice(s, t.id, 'subit');
      }
      E.nextStep(s, r);
      // 2. Recolte
      for (const a of agents) {
        const t = T(a); if (t.stopped) continue;
        a.collier = false;
        if (t.bocal <= 3 && r() < 0.5 + 0.3 * a.invest) { a.collier = true; E.coupDeCollier(s, t.id); }
        const me = E.viewFor(s, 'team', t.id).teams.find((x) => x.id === t.id);
        const nBrouette = t.equipment.filter((e) => e === 'panier').length;
        const typesOwned = me.harvest.filter((h) => h.runners > 0).sort((x, y) => y.runners - x.runners);
        const enc = {};
        let staffLeft = staff;
        typesOwned.forEach((h, i) => {
          // un coureur par tuile ; chaque produit court h.runSec (saison, aleas, bonus de temps) ; un trajet dure tripSec / habilete (bruite) ;
          // la brouette ajoute un jeton par trajet a un coureur (le premier des types les mieux dotes), un aleas positif a tous les coureurs du produit
          let tokens = 0;
          const crew = Math.min(h.runners, staffLeft); staffLeft -= crew;
          for (let k = 0; k < crew; k++) {
            const trip = P.tripSec * P.skillRef / clip(a.skill + P.noiseSd * gauss(r), 0.3, 1.1); // skillRef : habilete du joueur qui a chronometre l'essai
            tokens += Math.floor(h.runSec / trip) * (h.perTrip + (k === 0 && i < nBrouette ? 1 : 0));
          }
          enc[h.id] = tokens;
          a.stock[h.id] += tokens;
          a.tokens = (a.tokens || 0) + tokens; a.res = (a.res || 0) + tokens; a.tilesSeen = (a.tilesSeen || 0) + h.runners;
        });
        E.declareHarvest(s, t.id, enc, true);
      }
      E.nextStep(s, r);
      // 3. Transformation
      for (const a of agents) {
        const t = T(a); if (t.stopped) continue;
        const nRec = (t.tiles.atelier || 0) > 0 ? P.atelierRecipes * t.tiles.atelier : P.handRecipes;
        for (let i = 0; i < nRec; i++) {
          const have = TYPES.filter((x) => a.stock[x] >= 1).sort((x, y) => a.stock[y] - a.stock[x]);
          if (sum(a.stock) < P.recipeRaw) break;
          if (have.length >= 2) { a.stock[have[0]]--; a.stock[have[1]]--; a.trans.mixed++; }
          else if (a.stock[have[0]] >= P.recipeRaw) { a.stock[have[0]] -= P.recipeRaw; a.trans.simple++; }
          else break;
        }
      }
      E.nextStep(s, r);
      // 4. Marche : roue puis ventes
      for (const a of agents) {
        const t = T(a); if (t.stopped) { continue; }
        const greve = card.mods && card.mods.directBlocked && !t.equipment.includes('camionnette') && !(t.choice === 'parade');
        const cap = t.equipment.includes('camionnette') ? P.vanCap : P.stallCap;
        const bonus = card.id === 'hiver_gourmand' ? 5 : 0;
        const MM = D.MARKET.mult;
        // lots a vendre : [valeur au supermarche, quantite]
        const lots = [];
        const raw = sum(a.stock);
        if (raw > 0) { lots.push({ u: MM.raw * D.MARKET.superPrice, n: raw }); for (const k of TYPES) a.stock[k] = 0; }
        const need = E.feteCfg(s, year);
        if (!(season < 3 && (a.trans.simple + a.trans.mixed) <= need.perFarm)) {
          const ss = Math.max(0, Math.min(a.trans.simple, a.trans.simple + a.trans.mixed - need.perFarm));
          const sm = Math.max(0, Math.min(a.trans.mixed - need.mixed, a.trans.simple + a.trans.mixed - need.perFarm - ss));
          if (ss) lots.push({ u: MM.simple * D.MARKET.superPrice + bonus, n: ss });
          if (sm) lots.push({ u: MM.mixed * D.MARKET.superPrice + bonus, n: sm });
          a.trans.simple -= ss; a.trans.mixed -= sm;
        }
        // placement : l'etal (x2, risque) prend les lots les plus chers si au moins 6 produits y vont
        lots.sort((x, y) => y.u - x.u);
        let room = greve ? 0 : cap, stallUnits = 0, stallVal = 0, supVal = 0;
        for (const l of lots) { const k = Math.min(room, l.n); stallUnits += k; stallVal += k * l.u * 2; room -= k; supVal += (l.n - k) * l.u; }
        if (stallUnits < 6) { supVal += stallVal / 2; stallVal = 0; stallUnits = 0; }
        let gain = supVal;
        // l'etal ne peut contenir que des produits reellement en stock (jetons de la saison)
        const dec = {};
        if (stallUnits > 0) {
          const raw = E.viewFor(s, 'team', t.id).teams.find((x) => x.id === t.id).stock.raw;
          let left = stallUnits;
          for (const p of TYPES) { const k = Math.min(left, raw[p] || 0); if (k) { dec['dir_' + p] = k; left -= k; } }
          if (left === stallUnits) { gain += stallVal / 2; stallUnits = 0; }
        }
        if (stallUnits > 0) {
          E.declareSales(s, t.id, dec);
          let w = E.spinWheel(s, t.id, r);
          if (w.frac < 0.5 && !t.freeSpin && t.bocal <= 5 && r() < 0.6) w = E.spinWheel(s, t.id, r);
          if (t.freeSpin && w.frac < 0.5) w = E.spinWheel(s, t.id, r);
          gain += Math.round(stallVal * w.frac) - D.MARKET.stallFee;
        }
        const m = 1;
        gain = Math.round(gain * m);
        if (gain !== 0) E.addBank(s, t.id, gain, 'Ventes', true);
        a.income += gain;
      }
      E.nextStep(s, r);
      // 5. Achats / vacances
      for (const a of agents) {
        const t = T(a);
        const est = E.estimateCharges(t).total;
        const reserve = season === 3 ? est : Math.round(est * 0.3);
        if (!t.stopped) shop(a, reserve);
      }
      E.nextStep(s, r);
      if (card.collective) colStats.push(card.resolved === true);
    }
    // cloture
    E.closeYear(s);
    const need = E.feteCfg(s, year);
    let ok = true;
    for (const a of agents) {
      const total = a.trans.simple + a.trans.mixed;
      if (total < need.perFarm || a.trans.mixed < need.mixed) ok = false;
    }
    if (!ok && r() < P.pFeteLeniency) ok = true;
    E.fete(s, ok);
    if (year < P.years) {
      E.nextYear(s, r);
      for (const a of agents) shop(a, Math.round(E.estimateCharges(T(a)).total * 0.5));
      E.autoAssign(s); E.startYear(s);
    }
  }
  s.teams.forEach(() => {});
  // seuil 3e etoile parametrable
  E.finish(s);
  const totalBank = s.teams.reduce((n, t) => n + t.bank, 0);
  const target = P.s3mult ? P.s3mult * D.START_BANK * s.teams.length : E.s3Target(s);
  const stars = [s.stars.s1, s.stars.s2, totalBank >= target];
  return {
    stars, count: stars.filter(Boolean).length,
    burnouts: s.stars.burnouts, burnTeams: s.teams.filter((t) => t.burnouts > 0).length,
    banks: s.teams.map((t) => t.bank), totalBank, avgBank: totalBank / s.teams.length,
    bocalMax: Math.max(...s.teams.map((t) => t.bocal)), added: s.teams.map((t) => t.bocalAdded),
    tiles: s.teams.map((t) => Object.values(t.tiles).reduce((x, y) => x + y, 0)),
    perTile: agents.reduce((n, a) => n + (a.res || 0), 0) / Math.max(1, agents.reduce((n, a) => n + (a.tilesSeen || 0), 0)),
    tokPerRunner: agents.reduce((n, a) => n + (a.tokens || 0), 0) / Math.max(1, agents.reduce((n, a) => n + (a.tilesSeen || 0), 0)),
    fetes: s.fetes.map((f) => f.success), debtBoules: 0, colWins: colStats.filter(Boolean).length, colTotal: colStats.length
  };
}

function batch(P0, n = 200, strat = 'mix', seed0 = 1000) {
  const P = Object.assign({}, DEFAULTS, P0);
  const res = [];
  for (let i = 0; i < n; i++) res.push(play(P, seed0 + i, strat));
  const mean = (f) => res.reduce((x, g) => x + f(g), 0) / n;
  const all = res.flatMap((g) => g.banks).sort((a, b) => a - b);
  const q = (p) => all[Math.floor(p * (all.length - 1))];
  const adds = res.flatMap((g) => g.added);
  return {
    s1: mean((g) => +g.stars[0]), s2: mean((g) => +g.stars[1]), s3: mean((g) => +g.stars[2]),
    avgStars: mean((g) => g.count), p3: mean((g) => +(g.count === 3)), p0: mean((g) => +(g.count === 0)),
    burn: mean((g) => g.burnouts), burnTeamsPct: mean((g) => g.burnTeams / g.banks.length),
    bankP10: q(0.1), bankMed: q(0.5), bankP90: q(0.9), bankMean: mean((g) => g.avgBank),
    boulesAjoutees: adds.reduce((x, y) => x + y, 0) / adds.length,
    fete1: mean((g) => +g.fetes[0]), fete2: mean((g) => +g.fetes[1]), fete3: mean((g) => +g.fetes[2]),
    tiles: mean((g) => g.tiles.reduce((x, y) => x + y, 0) / g.tiles.length),
    colWin: res.reduce((n, g) => n + g.colWins, 0) / Math.max(1, res.reduce((n, g) => n + g.colTotal, 0)),
    perTile: mean((g) => g.perTile), tokPerRunner: mean((g) => g.tokPerRunner)
  };
}

module.exports = { play, batch, DEFAULTS };
if (require.main === module) {
  const f = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  console.log(f(batch({}, 200)));
}
