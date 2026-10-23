'use strict';
// Simulation Monte-Carlo : equipes virtuelles qui jouent via le vrai moteur (lib/engine.js).
// L'economie "physique" (recolte, ventes) est modelisee ici ; hypotheses dans DEFAULTS.
const E = require('../lib/engine');
const D = require('../lib/data');

const DEFAULTS = {
  teams: 4, skillMean: 0.85, skillSd: 0.12, noiseSd: 0.10,
  rawPrice: 5, directPrice: 10, stallFee: 10, stallCap: 8, vanCap: 12,
  recipeRaw: 2, transMult: 3, mixedMult: 4, atelierRecipes: 4, handRecipes: 1,
  runnerBonus: 0.2, brouetteBonus: 0.15, collierBonus: 0.3,
  s3mult: D.S3_MULT, pFeteLeniency: 0
};

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }
const clip = (x, a, b) => Math.max(a, Math.min(b, x));
const TYPES = ['lait', 'oeuf', 'viande', 'fl'];

function play(P, seed, strat) {
  const r = rng(seed);
  const s = E.createSession('SIM');
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
    const yearsLeft = 3 - s.year;
    // vacances si bocal haut
    if (s.phase === 'season' && t.bocal >= 6) {
      const n = Math.min(t.bocal - 3, Math.floor((t.bank - reserve) / D.VACATION_COST), 4);
      if (n > 0) E.vacation(s, t.id, n);
    }
    if (a.invest > 0.3 && yearsLeft >= 1) {
      // tuile : type possede le moins cher d'abord ; atelier si absent
      if ((t.tiles.atelier || 0) === 0 && can('tile_atelier') && yearsLeft >= 1) { if (tryBuy('tile_atelier')) a.boughtTiles++; }
      for (let k = 0; k < 2; k++) {
        const owned = TYPES.filter((x) => (t.tiles[x] || 0) > 0);
        if (!owned.length) break;
        const id = 'tile_' + owned.sort((x, y) => (t.tiles[x] || 0) - (t.tiles[y] || 0))[0];
        if (a.invest * 100 > 25 * (3 - yearsLeft) && can(id) && t.bank > 120 + reserve && (yearsLeft >= 1)) { if (tryBuy(id)) a.boughtTiles++; }
      }
    }
    if (a.invest > 0.5 && yearsLeft >= 1) {
      if (!t.equipment.includes('tracteur') && can('tracteur') && t.bank > 300 && s.year === 1) tryBuy('tracteur');
      if (can('brouette') && t.equipment.filter((e) => e === 'brouette').length < 2 && t.bank > 200) tryBuy('brouette');
      if (!t.equipment.includes('camionnette') && can('camionnette') && t.bank > 250) tryBuy('camionnette');
    }
    if (P.parades !== 'none') for (const id of ['chien', 'serre', 'arrosage', 'lampe']) if ((P.parades === 'all' || a.invest > 0.4) && !t.equipment.includes(id) && can(id) && t.bank > (P.parades === 'all' ? 60 : 150) + reserve && (P.parades === 'all' || s.year <= 2)) tryBuy(id);
    if (t.bocal >= 4 && can('hamac') && t.equipment.filter((e) => e === 'hamac').length < 1 && yearsLeft >= 1) tryBuy('hamac');
  }

  // installation
  E.startSetup(s);
  for (const a of agents) shop(a, 150);
  E.autoAssign(s); E.startYear(s);
  let bonusFete = 0;

  for (let year = 1; year <= 3; year++) {
    for (const a of agents) { a.trans = { simple: 0, mixed: 0 }; }
    for (let season = 0; season < 4; season++) {
      // 1. Alea
      const card = E.drawCard(s, undefined, r);
      E.rollDie(s, undefined, r);
      for (const a of agents) {
        const t = T(a); if (t.stopped) continue;
        const neg = card.tone === 'neg';
        if (card.parade && t.equipment.includes(card.parade)) E.setChoice(s, t.id, 'parade');
        else if (neg && t.bocal <= 2 && a.invest < 0.5) E.setChoice(s, t.id, 'boule');
        else E.setChoice(s, t.id, 'subit');
      }
      E.nextStep(s);
      // 2. Recolte
      for (const a of agents) {
        const t = T(a); if (t.stopped) continue;
        a.collier = false;
        if (t.bocal <= 3 && r() < 0.5 + 0.3 * a.invest) { a.collier = true; E.coupDeCollier(s, t.id); }
        const extra = (type) => (t.equipment.includes('tracteur') ? 1 : 0) + t.equipment.filter((e) => e === 'charrette').length * 0.5;
        const me = E.viewFor(s, 'team', t.id).teams.find((x) => x.id === t.id);
        const early = me.stopEarly ? (D.SEASONS[season].harvestSec - me.stopEarly) / D.SEASONS[season].harvestSec : 1;
        for (const h of me.harvest) {
          const type = h.id;
          const q = h.tokens; if (!q) continue;
          let f = clip(a.skill + P.noiseSd * gauss(r), 0.3, 1.1) * early;
          f *= 1 + P.runnerBonus * extra(type) + P.brouetteBonus * Math.min(1, t.equipment.filter((e) => e === 'brouette').length / TYPES.filter((x) => t.tiles[x]).length * 2);
          if (a.collier) f *= 1 + P.collierBonus;
          a.stock[type] += Math.round(q * Math.min(f, 1.6));
        }
      }
      E.nextStep(s);
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
      E.nextStep(s);
      // 4. Marche : roue puis ventes
      for (const a of agents) {
        const t = T(a); if (t.stopped) { continue; }
        const greve = card.id === 'greve' && !t.equipment.includes('camionnette') && !(t.choice === 'parade');
        const cap = t.equipment.includes('camionnette') ? P.vanCap : P.stallCap;
        const bonus = card.id === 'hiver_gourmand' ? 5 : 0;
        const MM = D.MARKET.mult;
        // lots a vendre : [valeur au supermarche, quantite]
        const lots = [];
        const raw = sum(a.stock);
        if (raw > 0) { lots.push({ u: MM.raw * D.MARKET.superPrice, n: raw }); for (const k of TYPES) a.stock[k] = 0; }
        const need = D.FETE[year - 1];
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
        if (stallUnits > 0) {
          E.declareSales(s, t.id, { dir_raw: stallUnits });
          let w = E.spinWheel(s, t.id, r);
          if (w.frac < 0.5 && !t.freeSpin && t.bocal <= 5 && r() < 0.6) w = E.spinWheel(s, t.id, r);
          if (t.freeSpin && w.frac < 0.5) w = E.spinWheel(s, t.id, r);
          gain += Math.round(stallVal * w.frac) - D.MARKET.stallFee;
        }
        const m = 1;
        gain = Math.round(gain * m);
        if (gain !== 0) E.addBank(s, t.id, gain, 'Ventes', true);
        a.income += gain;
        if ((t.tiles.activite || 0) > 0 && s.die >= 1 && s.die <= 5 && s.die !== 1) { E.addBank(s, t.id, 15 * t.tiles.activite, 'Activite', true); a.income += 15 * t.tiles.activite; }
      }
      E.nextStep(s);
      // 5. Achats / vacances
      for (const a of agents) {
        const t = T(a);
        const est = E.estimateCharges(t).total;
        const reserve = season === 3 ? est : Math.round(est * 0.3);
        if (!t.stopped) shop(a, reserve);
      }
      E.nextStep(s);
    }
    // cloture
    E.closeYear(s);
    const need = D.FETE[year - 1];
    let ok = true;
    for (const a of agents) {
      const total = a.trans.simple + a.trans.mixed;
      if (total < need.perFarm || a.trans.mixed < need.mixed) ok = false;
    }
    if (!ok && r() < P.pFeteLeniency) ok = true;
    E.fete(s, ok);
    if (year < 3) {
      E.nextYear(s);
      for (const a of agents) shop(a, Math.round(E.estimateCharges(T(a)).total * 0.5));
      E.autoAssign(s); E.startYear(s);
    }
  }
  s.teams.forEach(() => {});
  // seuil 3e etoile parametrable
  E.finish(s);
  const totalBank = s.teams.reduce((n, t) => n + t.bank, 0);
  const target = P.s3mult * D.START_BANK * s.teams.length;
  const stars = [s.stars.s1, s.stars.s2, totalBank >= target];
  return {
    stars, count: stars.filter(Boolean).length,
    burnouts: s.stars.burnouts, burnTeams: s.teams.filter((t) => t.burnouts > 0).length,
    banks: s.teams.map((t) => t.bank), totalBank, avgBank: totalBank / s.teams.length,
    bocalMax: Math.max(...s.teams.map((t) => t.bocal)), added: s.teams.map((t) => t.bocalAdded),
    tiles: s.teams.map((t) => Object.values(t.tiles).reduce((x, y) => x + y, 0)),
    fetes: s.fetes.map((f) => f.success), debtBoules: 0
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
    tiles: mean((g) => g.tiles.reduce((x, y) => x + y, 0) / g.tiles.length)
  };
}

module.exports = { play, batch, DEFAULTS };
if (require.main === module) {
  const f = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  console.log(f(batch({}, 200)));
}
