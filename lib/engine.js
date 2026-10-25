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
    card: null, wheelSeq: 0, equipV: 2,
    closedYear: false, feteDone: false, fetes: [], lastCharges: null, menu: null, menuHistory: [],
    stars: null, showQr: false, showGoals: false, tuto: -1,
    mode: Object.assign({}, D.MODE_DEFAULT), tripSec: D.DEFAULT_TRIP_SEC, forecast: null, nextCard: null, collective: null, trades: [], tradeSeq: 0,
    log: []
  };
}

function log(state, text) {
  state.log.push({ at: now(), year: state.year, season: state.season, text });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

// ---------- Modes de partie (taille des equipes, duree) ----------
const modeOf = (state) => state.mode || D.MODE_DEFAULT;
const yearsOf = (state) => modeOf(state).years;
const rulesOf = (state) => D.YEARS_RULES[yearsOf(state)];
const bocalMaxOf = (state) => rulesOf(state).bocalMax;
// Fete de l'annee en cours : une partie courte joue l'annee 1 puis la finale complete.
const feteCfg = (state, year = state.year) => D.FETE[rulesOf(state).fete[Math.min(year, yearsOf(state)) - 1]];
const s3Mult = (state) => rulesOf(state).s3Mult[modeOf(state).size];
const s3Target = (state) => s3Mult(state) * D.START_BANK * state.teams.length;
const tilesFor = (state, profile) => {
  const prof = D.PROFILES[profile];
  if (!prof) return {};
  return Object.assign({}, (D.PROFILE_TILES[profile] || {})[modeOf(state).size] || prof.tiles);
};
const collectiveNeed = (state, goal) => Math.max(1, Math.ceil(goal.perFarm * D.COLLECTIVE_SCALE[modeOf(state).size] * state.teams.length));
// Le bilan de saison s'active ou se coupe a tout moment.
function setRecap(state, on) {
  state.mode = Object.assign({}, modeOf(state), { recap: !!on });
  log(state, `Bilan de saison ${on ? 'activé' : 'désactivé'}.`);
}

function setMode(state, { size, years, challenge, recap }) {
  if (state.phase !== 'lobby') fail('Le mode de jeu se règle avant le début de la partie.');
  if (!D.TEAM_SIZES.includes(size)) fail('Taille d’équipe invalide (3 à 6 joueurs).');
  if (!D.YEAR_CHOICES.includes(years)) fail('Durée invalide (2 ou 3 ans).');
  const cur = modeOf(state);
  state.mode = { size, years, challenge: challenge === undefined ? !!cur.challenge : !!challenge, recap: recap === undefined ? cur.recap !== false : !!recap };
  for (const t of state.teams) if (t.profile) t.tiles = tilesFor(state, t.profile);
  log(state, `Mode de jeu : ${size} joueurs par ferme, ${years} ans${state.mode.challenge ? ', défi de saison' : ''}${state.mode.recap ? ', bilan de saison' : ''}.`);
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
    activities: [], actRolls: {}, chargesLog: [], purchases: [],
    stopSeasons: 0, stopped: false,
    tiles: tilesFor(state, profile),
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
  ensureChallenge(state, 1, rand);
  prepareForecast(state, rand);
  log(state, 'Installation des fermes (10 minutes).');
}

function startYear(state) {
  if (state.phase !== 'setup' && state.phase !== 'rearrange') fail('Rien à démarrer maintenant.');
  const free = state.menu ? state.menu.items.filter((x) => !x.team).length : 0;
  if (free) fail(`Il reste ${free} plat${free > 1 ? 's' : ''} de la commande à répartir : laisse les fermes se décider ou répartis le reste au hasard.`);
  state.phase = 'season';
  state.season = 0; state.step = 0;
  state.card = null;
  setTimer(state, stepSeconds(state));
  log(state, `Année ${state.year} : le printemps commence.`);
}

function resetSeasonFlags(state) {
  for (const t of state.teams) {
    t.ready = false; t.choice = null; t.wheel = null; t.freeSpin = false; t.camionnetteUsed = false;
    t.stopped = false; t.sales = null; t.transfo = null; t.harvest = null; t.collier = false; t.rawAdj = {}; t.actRolls = {};
    if (t.stopSeasons > 0) { t.stopped = true; t.stopSeasons -= 1; }
  }
  state.card = null;
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
  // Fin de saison : defi, bilan, puis les hamacs retirent une boule.
  settleChallenge(state);
  state.prevRecap = recapNow(state);
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
  if (!Number.isInteger(year) || year < 1 || year > yearsOf(state)) fail('Année invalide.');
  if (!Number.isInteger(season) || season < 0 || season > 3) fail('Saison invalide.');
  const newYear = year !== state.year;
  state.phase = 'season';
  state.year = year; state.season = season; state.step = 0;
  state.closedYear = false; state.feteDone = false; state.lastCharges = null;
  resetSeasonFlags(state);
  if (newYear || !state.menu) { drawMenu(state); autoAssign(state); }
  ensureChallenge(state, state.year);
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

// ---------- Defi de saison (facultatif) : une saison par an, hors aleas collectif, annoncee au projecteur ----------
function ensureChallenge(state, year, rand = Math.random) {
  if (!modeOf(state).challenge) return null;
  if (state.challenge && state.challenge.year === year) return state.challenge;
  const col = state.collective && state.collective.year === year ? state.collective.season : -1;
  const seasons = [0, 1, 2, 3].filter((x) => x !== col);
  state.challenge = { year, season: seasons[Math.floor(rand() * seasons.length)] };
  return state.challenge;
}
const challengeOf = (state) => {
  const c = state.challenge;
  return modeOf(state).challenge && c && c.year === state.year && c.season === state.season && state.phase === 'season' ? c : null;
};
const rawTotal = (state, t) => Object.values(rawStock(state, t)).reduce((n, x) => n + x, 0);
const harvestedTokens = (state, t) => (t.harvest ? harvestOf(state, t).reduce((n, h) => n + h.value, 0) : 0);
// Zero perte : au moins un jeton recolte et plus aucune matiere brute en fin de saison (tout vendu ou transforme) -> -1 boule.
const challengeOk = (state, t) => !t.stopped && harvestedTokens(state, t) > 0 && rawTotal(state, t) === 0;
function settleChallenge(state) {
  const c = challengeOf(state);
  if (!c) return;
  const active = state.teams.filter((t) => !t.stopped);
  const winners = active.filter((t) => challengeOk(state, t));
  for (const t of winners) addBocal(state, t.id, -1, 'Défi zéro perte réussi');
  state.lastChallenge = { year: c.year, season: c.season, winners: winners.map((t) => t.name), total: active.length };
  log(state, `Défi zéro perte : ${winners.length}/${active.length} ferme(s) réussie(s).`);
}

// ---------- Bilan de saison (projecteur) ----------
function recapNow(state) {
  const teams = state.teams.filter((t) => !t.stopped);
  const dishes = teams.reduce((n, t) => n + (t.transfo && t.transfo.items ? Object.values(t.transfo.items).reduce((a, b) => a + b, 0) : 0), 0);
  const income = teams.reduce((n, t) => n + (t.sales && t.sales.settled ? t.sales.amount : 0), 0);
  return { year: state.year, season: state.season, tokens: teams.reduce((n, t) => n + harvestedTokens(state, t), 0), dishes, income, farms: teams.length };
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
    else if (state.year < yearsOf(state)) { year = state.year + 1; season = 0; }
    else { state.forecast = null; state.nextCard = null; return null; }
  } else return null;
  const col = ensureCollective(state, year, rand);
  const pool = D.CARDS[season];
  let weather = 'incertain';
  if (col.season === season) {
    state.nextCard = { year, season, id: col.id, collective: true };
  } else {
    const fresh = freshCards(state, season, null);
    const card = fresh[Math.floor(rand() * fresh.length)];
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
        const need = collectiveNeed(state, c.goal);
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

// Tirage sans remise : une carte deja jouee a cette saison (annees precedentes) ne revient pas tant que le paquet n'est pas epuise.
function freshCards(state, season, excludeId) {
  const seen = (state.cardsSeen && state.cardsSeen[season]) || [];
  const pool = D.CARDS[season];
  const fresh = pool.filter((c) => !seen.includes(c.id) && c.id !== excludeId);
  return fresh.length ? fresh : pool.filter((c) => c.id !== excludeId);
}
function markSeen(state, season, id, previousId) {
  state.cardsSeen = state.cardsSeen || {};
  let seen = (state.cardsSeen[season] || []).filter((x) => x !== previousId); // une carte ecartee par un nouveau tirage peut revenir
  if (D.CARDS[season].every((c) => seen.includes(c.id) || c.id === id)) seen = []; // paquet epuise : on remelange
  if (!seen.includes(id) && !D.CARDS[season].every((c) => c.id === id)) seen.push(id);
  state.cardsSeen[season] = seen;
}

function drawCard(state, index, rand = Math.random) {
  if (state.phase !== 'season') fail('Les cartes se tirent pendant une saison.');
  if (state.card && state.card.collective) return state.card; // le defi collectif est deja la
  const pool = D.CARDS[state.season];
  ensureCollective(state, state.year, rand);
  let card = null;
  if (!Number.isInteger(index)) {
    const col = collectiveCard(state);
    if (col) { const need = collectiveNeed(state, col.goal); card = Object.assign({}, col, { collective: true, tone: 'col', parade: null, mods: {}, resolved: null, pot: {}, need, goalText: goalLabel(col.goal, need), effect: col.story }); }
    else {
      // Premier tirage : la carte preparee en secret. Nouveau tirage (une carte est deja la) : une autre carte du paquet, au hasard.
      const nc = state.nextCard;
      const redraw = !!state.card && state.card.season === state.season;
      const planned = !redraw && nc && !nc.collective && nc.year === state.year && nc.season === state.season ? pool.find((c) => c.id === nc.id) : null;
      const others = freshCards(state, state.season, redraw ? state.card.id : null);
      card = planned || others[Math.floor(rand() * others.length)];
    }
  } else {
    if (index < 0 || index >= pool.length) fail('Carte inconnue.');
    card = pool[index];
  }
  const previous = state.card && !state.card.collective && state.card.season === state.season ? state.card.id : null;
  if (!card.collective) markSeen(state, state.season, card.id, previous);
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
  return `${need} point${need > 1 ? 's' : ''} de stress à répartir`;
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

// Compte du village : la cagnotte de l'alea collectif quand l'objectif est en argent (ouvert tant que l'alea n'est pas regle).
function villageAccount(state) {
  const c = state.card;
  if (state.phase !== 'season' || !c || !c.collective || c.goal.kind !== 'eb') return null;
  const open = (c.resolved === null || c.resolved === undefined) && potTotal(c) < c.need;
  return { title: c.title, pot: potTotal(c), need: c.need, open, resolved: c.resolved === undefined ? null : c.resolved };
}

// Correction du maire d'un don en jetons bruts (remise physique mal declaree) : sans effet sur la banque.
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

// ---------- Activites complementaires : un de par activite et par ferme, a chaque saison ----------
const activityOf = (id) => D.ACTIVITIES.find((x) => x.id === id) || fail('Activité inconnue.');
// Effet d'une activite pour un resultat de de (1 a 6) : { n, text }. 1 = l'activite ne fonctionne pas.
function activityEffect(id, die) {
  const a = activityOf(id), n = a.n[die - 1] || 0;
  return { n, text: n ? a.each(n) : 'L’activité ne fonctionne pas cette saison.' };
}
const actN = (t, id) => (t.activities || []).includes(id) && t.actRolls && t.actRolls[id] ? activityEffect(id, t.actRolls[id]).n : 0;

function rollActivity(state, teamId, activity, value, rand = Math.random, byAdmin = false) {
  if (state.phase !== 'season') fail('Le dé d’une activité se lance pendant une saison.');
  const t = teamOf(state, teamId);
  const a = activityOf(activity);
  if (!(t.activities || []).includes(a.id)) fail(`Votre ferme n’a pas acheté l’activité « ${a.name} ».`);
  if (t.stopped) fail('Cette ferme est à l’arrêt cette saison.');
  t.actRolls = t.actRolls || {};
  if (t.actRolls[a.id] && !byAdmin) fail('Le dé de cette activité est déjà lancé cette saison.');
  if (!byAdmin && t.sales && t.sales.settled) fail('Les ventes sont déjà payées : trop tard pour cette saison.');
  const v = Number.isInteger(value) ? value : 1 + Math.floor(rand() * 6);
  if (v < 1 || v > 6) fail('Valeur de dé invalide.');
  t.actRolls[a.id] = v;
  log(state, `${t.name} : dé de ${a.name.toLowerCase()}, ${v} (${activityEffect(a.id, v).text}).`);
  return v;
}

// Le maire lance les dés qui manquent pour toutes les fermes.
function rollAllActivities(state, rand = Math.random) {
  if (state.phase !== 'season') fail('Les dés se lancent pendant une saison.');
  let n = 0;
  for (const t of state.teams) {
    if (t.stopped) continue;
    for (const id of t.activities || []) if (!(t.actRolls && t.actRolls[id])) { rollActivity(state, t.id, id, undefined, rand); n += 1; }
  }
  if (!n) fail('Tous les dés sont déjà lancés.');
  return n;
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
  t.wheel = { label: seg.label, frac: seg.frac, idx: D.WHEEL.indexOf(seg), n: ++state.wheelSeq };
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
  if (to === 'village') { // compte du village : la cagnotte de l'alea collectif en argent
    if (!villageAccount(state)) fail('Le compte du village n’est ouvert que pendant un aléa collectif en argent.');
    if (!D.TRANSFER_REASONS.village.includes(reason)) fail('Choisis un motif.');
    contribute(state, from.id, amount);
    return;
  }
  if (to === 'animateur') {
    if (!D.TRANSFER_REASONS.animateur.includes(reason)) fail('Choisis un motif.');
    addBank(state, from.id, -amount, `Paiement au maire du village · ${reason}`);
    log(state, `${from.name} paie ${amount} EB au maire du village (${reason}).`);
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
  if (t.bocal > (t.bocalPeak || 0)) t.bocalPeak = Math.min(t.bocal, bocalMaxOf(state));
  if (!silent) log(state, `${t.name} : bocal ${before} → ${t.bocal}${reason ? ' (' + reason + ')' : ''}.`);
  if (t.bocal >= bocalMaxOf(state)) {
    const restart = rulesOf(state).burnoutRestart;
    t.burnouts += 1; t.bocal = restart; t.stopSeasons = 1;
    log(state, `${t.name} : BURN-OUT. La ferme s’arrête une saison et repart avec ${restart} points de stress.`);
  }
  return t.bocal;
}

// Niveaux du bocal en proportion du maximum (10 : Zen 0-3, Agite 4-6, Stresse 7-9).
function levelOf(n, max = D.BOCAL_MAX) { return n < Math.ceil(0.4 * max) ? 'Zen' : n < Math.ceil(0.7 * max) ? 'Agité' : 'Stressé'; }

function setReady(state, teamId, ready) {
  teamOf(state, teamId).ready = !!ready;
}

// ---------- Boutique ----------
const itemById = (id) => D.CATALOGUE.find((i) => i.id === id) || fail('Article inconnu.');
const isExpansion = (item) => item.kind === 'tile' || item.kind === 'activity';
const countOfItem = (t, item) => item.kind === 'activity' ? ((t.activities || []).includes(item.activity) ? 1 : 0) : t.equipment.filter((e) => e === item.id).length;

// Prix d'un article pour une ferme dans son etat actuel (null : deja achete et non cumulable).
function priceOf(team, item) {
  if (item.kind === 'tile') {
    if (item.price) return item.price;
    return (team.tiles[item.tile] || 0) > 0 ? D.TILE_PRICE.owned : D.TILE_PRICE.new;
  }
  if (item.kind === 'activity') return (team.activities || []).includes(item.activity) ? null : item.price;
  if (item.kind === 'service') return item.price;
  if (!item.multi && team.equipment.includes(item.id)) return null;
  return item.price;
}

function canShop(state) {
  if (state.phase === 'setup' || state.phase === 'closing' || state.phase === 'rearrange') return true;
  return state.phase === 'season' && D.STEPS[state.step].id === 'achats';
}

// Agrandissements (tuiles, activites) : seulement a l'installation et en fin d'annee.
function canExpand(state) { return state.phase === 'setup' || state.phase === 'rearrange'; }

// Ce que l'article fait, avec des durees en secondes calculees d'apres le parcours de la partie.
function effectOf(state, item) {
  const sec = (n) => `${n} s`;
  if (item.id === 'tracteur') return `Vous pouvez courir ${sec(tracteurSec(state))} de plus à chaque récolte, après la fin du chrono.`;
  if (item.id === 'serre') {
    const base = round5(baseTrips(3, 'fl') * state.tripSec), withSerre = round5(D.WINTER_FL_SERRE_TRIPS * state.tripSec);
    return `Parade contre le gel tardif et la grêle. En hiver, vous pouvez courir ${sec(withSerre - base)} de plus pour les fruits et légumes (${sec(withSerre)} au lieu de ${sec(base)}).`;
  }
  return item.effect;
}

// Un achat (ou plusieurs) pris en bloc : tout passe ou rien. Les prix des tuiles tiennent compte des achats precedents du meme panier.
function buyCart(state, teamId, ids, force = false) {
  const t = teamOf(state, teamId);
  if (!Array.isArray(ids) || !ids.length) fail('Le panier est vide.');
  if (ids.length > 40) fail('Panier trop grand.');
  const items = ids.map(itemById);
  if (!force && !canShop(state)) fail('Les achats se font à l’étape Achats, à l’installation ou au réaménagement.');
  if (state.phase === 'closing' && !state.closedYear && !force) fail('Applique d’abord les charges de l’année.');
  if (!force && items.some(isExpansion) && !canExpand(state)) fail('Les agrandissements et activités s’achètent à l’installation et en fin d’année, pas pendant les saisons ni à la clôture.');
  const trial = { tiles: Object.assign({}, t.tiles), equipment: t.equipment.slice(), activities: (t.activities || []).slice() };
  const lines = [];
  let total = 0, travellers = 0;
  for (const item of items) {
    if (item.kind === 'service') {
      if (state.phase !== 'season') fail('Les vacances se prennent pendant une saison.');
      if (!force && D.STEPS[state.step].id !== 'achats') fail('Les vacances se prennent à l’étape Achats.');
      travellers += 1;
      if (travellers > D.VACATION_MAX) fail(`${D.VACATION_MAX} voyageurs au maximum par saison.`);
      if (!force && travellers > t.bocal) fail(`Votre ferme n’a que ${t.bocal} stress à relâcher : pas plus de ${t.bocal} voyageur${t.bocal > 1 ? 's' : ''}.`);
      lines.push({ item, price: item.price }); total += item.price;
      continue;
    }
    const price = priceOf(trial, item);
    if (price == null) fail(`${item.name} : déjà acheté.`);
    if (item.kind === 'tile') trial.tiles[item.tile] = (trial.tiles[item.tile] || 0) + 1;
    else if (item.kind === 'activity') { trial.activities.push(item.activity); trial.tiles.activite = (trial.tiles.activite || 0) + 1; }
    else trial.equipment.push(item.id);
    lines.push({ item, price }); total += price;
  }
  if (t.bank < total) fail(`Solde insuffisant : le panier coûte ${total} EB, la ferme en a ${t.bank}.`);
  const bought = [];
  let removed = 0;
  for (const { item, price } of lines) {
    addBank(state, teamId, -price, item.name);
    if (item.kind === 'tile') t.tiles[item.tile] = (t.tiles[item.tile] || 0) + 1;
    else if (item.kind === 'activity') { t.activities = (t.activities || []).concat(item.activity); t.tiles.activite = (t.tiles.activite || 0) + 1; }
    else if (item.kind === 'service') { const before = t.bocal; addBocal(state, teamId, -Math.min(1, t.bocal), 'Vacances'); removed += before - t.bocal; }
    else t.equipment.push(item.id);
    bought.push({ itemId: item.id, price });
    t.purchases = (t.purchases || []).concat({ itemId: item.id, name: item.name, price, year: state.year, season: state.season, phase: state.phase });
  }
  if (t.purchases.length > 60) t.purchases = t.purchases.slice(-60);
  t.lastBuy = force ? null : { items: bought, removed, at: now() };
  log(state, `${t.name} achète : ${lines.map((l) => l.item.name).join(', ')} (${total} EB).`);
  return total;
}

function buy(state, teamId, itemId, force = false) { return buyCart(state, teamId, [itemId], force); }

// Annulation du dernier achat (ou panier), possible quelques secondes apres (erreur de clic).
const UNDO_MS = 15000;
const at0 = () => now();
function undoBuy(state, teamId, at = now()) {
  const t = teamOf(state, teamId);
  const b = t.lastBuy;
  if (!b || at - b.at > UNDO_MS) fail('Plus possible d’annuler : le délai est écoulé.');
  const list = b.items || [{ itemId: b.itemId, price: b.price }];
  // on verifie tout avant de rien retirer
  const probe = { tiles: Object.assign({}, t.tiles), equipment: t.equipment.slice(), activities: (t.activities || []).slice() };
  for (const x of list) {
    const item = itemById(x.itemId);
    if (item.kind === 'tile') { if (!(probe.tiles[item.tile] > 0)) fail('Tuile introuvable.'); probe.tiles[item.tile] -= 1; }
    else if (item.kind === 'activity') { const i = probe.activities.indexOf(item.activity); if (i < 0) fail('Activité introuvable.'); probe.activities.splice(i, 1); probe.tiles.activite = Math.max(0, (probe.tiles.activite || 0) - 1); }
    else if (item.kind === 'equipment') { const i = probe.equipment.lastIndexOf(item.id); if (i < 0) fail('Matériel introuvable.'); probe.equipment.splice(i, 1); }
  }
  t.tiles = probe.tiles; t.equipment = probe.equipment; t.activities = probe.activities;
  for (const x of list) {
    const item = itemById(x.itemId);
    addBank(state, teamId, x.price, 'Annulation : ' + item.name, true);
    if (t.purchases && t.purchases.length) { const i = t.purchases.map((p) => p.itemId).lastIndexOf(x.itemId); if (i >= 0) t.purchases.splice(i, 1); }
  }
  if (b.removed) { t.bocal = Math.min(bocalMaxOf(state) - 1, t.bocal + b.removed); }
  t.lastBuy = null;
  log(state, `${t.name} annule son achat : ${list.map((x) => itemById(x.itemId).name).join(', ')}.`);
}

function giftTile(state, teamId, tile) {
  const t = teamOf(state, teamId);
  const act = D.ACTIVITIES.find((a) => a.id === tile);
  if (act) { // activite offerte
    if ((t.activities || []).includes(act.id)) fail('Cette ferme a déjà cette activité.');
    t.activities = (t.activities || []).concat(act.id); t.tiles.activite = (t.tiles.activite || 0) + 1;
    log(state, `${t.name} reçoit une activité gratuite : ${act.name}.`);
    return;
  }
  if (!TILE_TYPES.includes(tile) || tile === 'activite') fail('Type de tuile inconnu.');
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
  if (!Number.isInteger(n) || n < 1 || n > D.VACATION_MAX) fail('Nombre de voyageurs invalide.');
  if (state.phase !== 'season') fail('Les vacances se prennent pendant une saison.');
  if (!force && D.STEPS[state.step].id !== 'achats') fail('Les vacances se prennent à l’étape Achats.');
  if (!force && n > t.bocal) fail(`Votre ferme n’a que ${t.bocal} stress à relâcher : pas plus de ${t.bocal} voyageur${t.bocal > 1 ? 's' : ''}.`);
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
// Une partie sauvegardee garde la carte aleas telle qu'elle etait tiree : on la remet au format des donnees actuelles
// (effets, textes, illustration), en conservant l'etat de jeu d'un aleas collectif (dons, objectif, resultat).
function refreshCard(state) {
  const c = state.card;
  if (!c || !c.id) return;
  const src = (c.collective ? D.COLLECTIVE : D.CARDS.flat()).find((x) => x.id === c.id);
  if (!src) return;
  if (c.collective) {
    state.card = Object.assign({}, src, { season: c.season, collective: true, tone: 'col', parade: null, mods: {}, resolved: c.resolved === undefined ? null : c.resolved, pot: c.pot || {}, need: c.need, goalText: c.goalText, effect: src.story });
  } else {
    state.card = Object.assign({ season: c.season === undefined ? state.season : c.season }, src);
  }
}

// ---------- Annulation des corrections de l'animateur ----------
// Un instantane est pris avant chaque action de correction ; l'annulation n'est plus possible des qu'une ferme a joue depuis.
const UNDO = new WeakMap();
function recordUndo(state, label, snap) { UNDO.set(state, { label, snap, blocked: false }); }
function blockUndo(state) { const u = UNDO.get(state); if (u) u.blocked = true; }
const undoInfo = (state) => { const u = UNDO.get(state); return u && !u.blocked ? { label: u.label } : null; };
function undoLast(state) {
  const u = UNDO.get(state);
  if (!u) fail('Rien à annuler.');
  if (u.blocked) fail('Une ferme a joué depuis : impossible d’annuler.');
  const timer = state.timer; // le chrono n'est jamais remis en arriere
  const snap = JSON.parse(u.snap);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, snap, { timer });
  UNDO.delete(state);
  log(state, `Annulé : ${u.label}.`);
}

function migrate(state) {
  if (!state || !state.teams) return state;
  if (state.trades === undefined) { state.trades = []; state.tradeSeq = 0; }
  if (state.forecast === undefined) state.forecast = null;
  if (state.tripSec === undefined) state.tripSec = D.DEFAULT_TRIP_SEC;
  if (state.mode === undefined) state.mode = Object.assign({}, D.MODE_DEFAULT);
  if (state.cardsSeen === undefined) state.cardsSeen = {};
  if (state.wheelSeq === undefined) state.wheelSeq = 0;
  if (state.tuto === undefined) state.tuto = -1;
  delete state.die; delete state.dieSixApplied;
  // v2 : l'ancienne brouette (un jeton de plus par trajet) devient le panier de récolte ; la brouette est un nouveau matériel
  if (!state.equipV) {
    state.equipV = 2;
    for (const t of state.teams) { t.equipment = (t.equipment || []).map((e) => (e === 'brouette' ? 'panier' : e)); t.lastBuy = null; }
  }
  if (state.mode.challenge === undefined) state.mode.challenge = false;
  if (state.mode.recap === undefined) state.mode.recap = true;
  if (state.nextCard === undefined) state.nextCard = null;
  if (state.collective === undefined) state.collective = null;
  refreshCard(state);
  for (const t of state.teams) {
    if (!t.dishes) t.dishes = { simple: 0, mixed: 0, composed: 0 };
    if (!t.pantry) t.pantry = {};
    if (!t.activities) t.activities = [];
    if (!t.actRolls) t.actRolls = {};
    if (!t.chargesLog) t.chargesLog = [];
    if (!t.purchases) t.purchases = [];
    if (t.equipment && t.equipment.filter((e) => e === 'hamac').length > 1) t.equipment = t.equipment.filter((e, i, a) => e !== 'hamac' || a.indexOf(e) === i);
    if (t.transfo && !t.transfo.items) t.transfo = null;
    if (t.transfo === undefined) t.transfo = null;
    if (t.sales && t.sales.sup !== undefined && t.sales.sup_raw === undefined) t.sales = null; // ancien format de vente
    if (t.wheel && t.wheel.frac === undefined) t.wheel = null;
  }
  return state;
}

const recipeBase = (t) => ((t.tiles && t.tiles.atelier > 0) ? 4 * t.tiles.atelier : 1);
// Le restaurant a la ferme ajoute des recettes (de de la saison).
function recipeLimit(t) { return recipeBase(t) + actN(t, 'resto'); }

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
  if (t.transfo && t.transfo.done) fail('Vos recettes sont déjà validées par le maire du village.');
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
  let sup = 0, stall = 0, stallUnits = 0;
  const lines = [];
  for (const x of SELL) {
    const su = d['sup_' + x.id] || 0, du = d['dir_' + x.id] || 0;
    if (!su && !du) continue;
    const b = x.kind === 'raw' ? 0 : bonus;
    const unitSup = x.mult * M.superPrice + b, unitDir = x.mult * M.directPrice + b;
    sup += su * unitSup; stall += du * unitDir; stallUnits += du;
    const tag = frac == null ? null : demandOf(state.season, x.id);
    const fp = frac == null ? null : Math.max(0, Math.min(1, frac + (tag === 'hot' ? D.DEMAND_ADJ : tag === 'cold' ? -D.DEMAND_ADJ : 0)));
    lines.push({ id: x.id, name: x.name, kind: x.kind, sup: su, dir: du, unitSup, unitDir, tag, frac: fp, guaranteed: 0, soldUnits: null, revenue: null });
  }
  // Activites : le magasin vend d'office n produits bruts de l'etal (les plus chers d'abord) ; le gite verse une recette en EB.
  const act = D.ACTIVITIES.map((a) => ({ id: a.id, name: a.name, icon: a.icon, owned: (t.activities || []).includes(a.id), roll: (t.actRolls && t.actRolls[a.id]) || null, n: actN(t, a.id), gain: 0 }));
  const actOf = (id) => act.find((a) => a.id === id);
  const income = actOf('gite').n;
  actOf('gite').gain = income;
  let sold = 0, soldUnits = 0;
  if (frac != null) {
    let left = actOf('magasin').n;
    for (const l of lines.filter((y) => y.kind === 'raw' && y.dir > 0).sort((p, q) => q.unitDir - p.unitDir)) { l.guaranteed = Math.min(left, l.dir); left -= l.guaranteed; }
    for (const l of lines) {
      if (!l.dir) { l.soldUnits = 0; l.revenue = 0; continue; }
      const rest = l.dir - l.guaranteed;
      l.soldUnits = l.guaranteed + Math.round(rest * l.frac);
      l.revenue = l.guaranteed * l.unitDir + Math.round(rest * l.unitDir * l.frac);
      actOf('magasin').gain += l.revenue - Math.round(l.dir * l.unitDir * l.frac);
    }
    for (const l of lines) { sold += l.revenue; soldUnits += l.soldUnits; }
  }
  const fee = stallUnits > 0 ? M.stallFee : 0;
  const report = frac == null ? [] : lines.filter((l) => l.dir > 0).map((l) => Object.assign(marketLine(state.season, l.id, l.frac, l.tag), { tag: l.tag }));
  return {
    sup, stall, stallUnits, fee, frac, sold: frac == null ? null : sold,
    soldUnits: stallUnits === 0 ? 0 : frac == null ? null : soldUnits,
    total: stallUnits === 0 ? sup + income : frac == null ? null : sup + sold - fee + income,
    safeTotal: sup, income, cap: stallCap(t), lines, report, activities: act.filter((a) => a.owned && (a.id === 'gite' || a.id === 'magasin')),
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

function tradeItems(items, allowEmpty = false) {
  const out = {};
  for (const id of Object.keys(items || {})) {
    const n = items[id];
    if (!n) continue;
    if (!SELL.some((x) => x.id === id)) fail('Produit inconnu.');
    if (!Number.isInteger(n) || n < 1 || n > 99) fail('Quantité invalide.');
    out[id] = n;
  }
  if (!allowEmpty && !Object.keys(out).length) fail('Choisis au moins un produit à échanger.');
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

const tradeLabel = (items) => Object.keys(items).map((id) => `${items[id]} ${SELL.find((x) => x.id === id).name.toLowerCase()}`).join(', ') || 'rien';
// "3 laits contre 2 fromages + 20 EB" : ce que la ferme qui propose donne, ce qu'elle demande, le prix en EB (paye par `payer`).
const tradeText = (tr) => `${tradeLabel(tr.items)} contre ${tradeLabel(tr.want || {})}${tr.price ? ` + ${tr.price} EB (payés par ${tr.payer === 'from' ? 'celui qui propose' : 'le destinataire'})` : ''}`;

// Offre d'echange : la ferme donne `items` (facultatif) et demande `want` (facultatif) a la ferme destinataire, avec un prix en EB (facultatif)
// paye par le destinataire (ou par la ferme qui propose si payer = 'from'). Au moins un produit d'un cote ou de l'autre.
function offerTrade(state, fromId, input) {
  if (state.phase !== 'season' || D.STEPS[state.step].id !== 'bourse') fail('Les échanges se font à l’étape Transformation et bourse.');
  const from = teamOf(state, fromId), to = teamOf(state, input && input.to);
  if (from.id === to.id) fail('Choisis une autre ferme.');
  const items = tradeItems(input.items, true), want = tradeItems(input.want, true);
  if (!Object.keys(items).length && !Object.keys(want).length) fail('Choisis au moins un produit à donner ou à demander.');
  const price = input.price === undefined || input.price === null ? 0 : input.price;
  if (!Number.isInteger(price) || price < 0 || price > 9999) fail('Prix invalide.');
  const payer = input.payer === 'from' ? 'from' : 'to';
  checkTradeStock(state, from, items);
  if (payer === 'from' && from.bank < price) fail('Solde insuffisant pour proposer ce prix.');
  if (state.trades.filter((x) => x.status === 'pending' && x.from === from.id).length >= 5) fail('Trop d’offres en attente : annule-en une.');
  const tr = { id: 'e' + (++state.tradeSeq), from: from.id, to: to.id, items, want, price, payer, status: 'pending', at: now(), year: state.year, season: state.season };
  state.trades.push(tr);
  if (state.trades.length > 60) state.trades.splice(0, state.trades.length - 60);
  log(state, `${from.name} propose à ${to.name} : ${tradeText(tr)}.`);
  return tr.id;
}

function respondTrade(state, teamId, tradeId, accept) {
  const tr = tradeOf(state, tradeId);
  if (tr.status !== 'pending') fail('Cette offre n’est plus en attente.');
  if (tr.to !== teamId) fail('Seule la ferme destinataire peut répondre.');
  const from = teamOf(state, tr.from), to = teamOf(state, tr.to);
  if (!accept) { tr.status = 'refused'; log(state, `${to.name} refuse l’offre de ${from.name}.`); return tr; }
  if (state.phase !== 'season' || D.STEPS[state.step].id !== 'bourse') fail('Les échanges se font à l’étape Transformation et bourse.');
  const want = tr.want || {}, payer = tr.payer === 'from' ? from : to, payee = tr.payer === 'from' ? to : from;
  checkTradeStock(state, from, tr.items);
  checkTradeStock(state, to, want);
  if (payer.bank < tr.price) fail(`Solde insuffisant : ${payer.name} ne peut pas payer cet échange.`);
  moveStock(from, tr.items, -1); moveStock(to, tr.items, 1);
  moveStock(to, want, -1); moveStock(from, want, 1);
  if (tr.price > 0) { addBank(state, payer.id, -tr.price, `Bourse : paiement à ${payee.name}`); addBank(state, payee.id, tr.price, `Bourse : paiement de ${payer.name}`, true); }
  tr.status = 'done'; tr.doneAt = now();
  log(state, `Bourse : ${from.name} ↔ ${to.name} : ${tradeText(tr)}.`);
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
  const want = tr.want || {}, payer = tr.payer === 'from' ? from : to, payee = tr.payer === 'from' ? to : from;
  checkTradeStock(state, to, tr.items);
  checkTradeStock(state, from, want);
  if (payee.bank < tr.price) fail(`${payee.name} n’a plus l’argent à rembourser : corrige à la main.`);
  moveStock(to, tr.items, -1); moveStock(from, tr.items, 1);
  moveStock(from, want, -1); moveStock(to, want, 1);
  if (tr.price > 0) { addBank(state, payee.id, -tr.price, `Bourse annulée : remboursement à ${payer.name}`, true); addBank(state, payer.id, tr.price, `Bourse annulée : remboursement de ${payee.name}`, true); }
  tr.status = 'reverted';
  log(state, `Échange annulé par le maire du village : ${from.name} ↔ ${to.name}.`);
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
    t.chargesLog = (t.chargesLog || []).filter((x) => x.year !== state.year).concat(Object.assign({ year: state.year, paid, missing, boules }, ch));
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
  const cfg = feteCfg(state);
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

// Le maire valide une livraison a la main (sans toucher au stock) ; s'il retire une livraison faite depuis le stock de la ferme, le plat y retourne.
function setDelivered(state, key, delivered) {
  if (state.phase !== 'closing') fail('Les livraisons se valident à la clôture.');
  const it = itemOf(state, key);
  if (!delivered && it.delivered && it.viaStock && it.team) returnDishToStock(state, it);
  it.delivered = !!delivered;
  if (!delivered) it.viaStock = false;
}

function returnDishToStock(state, it) {
  const t = teamOf(state, it.team);
  moveStock(t, { [it.dish]: 1 }, 1);
  it.viaStock = false;
}

// Jour de fete : la ferme responsable livre elle-meme un plat de son stock (il quitte alors le stock), ou reprend sa livraison tant que la fete n'est pas jouee.
function deliverDish(state, teamId, key, delivered = true) {
  if (state.phase !== 'closing' || !state.closedYear) fail('Les plats se livrent le jour de la fête, une fois les charges payées.');
  if (state.feteDone) fail('La fête est déjà jouée.');
  const t = teamOf(state, teamId), it = itemOf(state, key);
  if (it.team !== t.id) fail('Ce plat n’est pas à vous.');
  const name = D.DISHES.find((d) => d.id === it.dish).name;
  if (delivered) {
    if (it.delivered) fail('Ce plat est déjà livré.');
    if ((t.pantry[it.dish] || 0) < 1) fail(`Il vous manque ${name.toLowerCase()} dans votre stock : fabriquez-le d’abord, ou demandez au maire du village de valider la livraison.`);
    moveStock(t, { [it.dish]: 1 }, -1);
    it.delivered = true; it.viaStock = true;
    log(state, `${t.name} livre son plat : ${name}.`);
  } else {
    if (!it.delivered) fail('Ce plat n’est pas livré.');
    if (!it.viaStock) fail('Ce plat a été validé par le maire du village : demande-lui de le reprendre.');
    returnDishToStock(state, it);
    it.delivered = false;
    log(state, `${t.name} reprend son plat : ${name}.`);
  }
}

function menuOk(state) {
  return !!(state.menu && state.menu.items.length && state.menu.items.every((x) => x.team && x.delivered));
}

// success omis : la fete reussit si tout le menu est livre. Les fermes responsables d'un plat manquant prennent +1 de stress en plus.
function fete(state, success) {
  if (state.phase !== 'closing' || !state.closedYear) fail('Applique d’abord les charges de l’année.');
  if (state.feteDone) fail('La fête a déjà été jouée cette année.');
  const ok = success === undefined ? menuOk(state) : !!success;
  for (const t of state.teams) addBocal(state, t.id, ok ? D.FETE_WIN : D.FETE_FAIL, ok ? 'Fête réussie' : 'Fête ratée');
  const missing = [];
  if (!ok && state.menu) {
    for (const it of state.menu.items) if (!it.delivered && it.team) missing.push(it);
    for (const t of state.teams) {
      const n = missing.filter((x) => x.team === t.id).length;
      if (n) addBocal(state, t.id, Math.min(D.FETE_MISSING_CAP, n * D.FETE_MISSING), `Plat non livré (${n})`);
    }
  }
  state.feteDone = true;
  state.fetes.push({ year: state.year, success: ok, missing: missing.length, at: now() });
  log(state, `Fête du Phoenix ${ok ? 'réussie' : 'ratée'} (année ${state.year}).`);
}

function nextYear(state, rand = Math.random) {
  if (state.phase !== 'closing') fail('Pas de clôture en cours.');
  if (!state.closedYear) fail('Applique d’abord les charges de l’année.');
  if (!state.feteDone) fail('Joue d’abord la Fête du Phoenix (réussie ou ratée).');
  if (state.year >= yearsOf(state)) fail('C’était la dernière année : termine la partie.');
  state.year += 1;
  state.phase = 'rearrange';
  setTimer(state, D.REARRANGE_SEC);
  drawMenu(state);
  ensureCollective(state, state.year, rand);
  ensureChallenge(state, state.year, rand);
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
  const s1 = burnouts === 0 && peak <= rulesOf(state).peakMax;
  const s2 = state.fetes.length >= yearsOf(state) && state.fetes.every((f) => f.success);
  const s3 = totalBank >= s3Target(state);
  state.stars = {
    s1, s2, s3, count: [s1, s2, s3].filter(Boolean).length,
    totalBank, burnouts, target: s3Target(state), peak, peakMax: rulesOf(state).peakMax, years: yearsOf(state),
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
// Jetons bonus de la recolte (en plus de ce que les coureurs rapportent) : la ferme pedagogique ajoute son jeton de de sur le produit le plus cultive.
// (Panier de recolte et brouette ne changent rien a l'encodage : ils permettent aux coureurs de prendre 2 jetons par trajet, ils les comptent eux-memes.)
function harvestOf(state, t) {
  const chrono = harvestSecOf(state);
  const list = D.PRODUCTS.filter((p) => (t.tiles[p.id] || 0) > 0);
  const runs = {};
  for (const p of list) runs[p.id] = runSecOf(state, t, p.id);
  const main = list.filter((p) => runs[p.id] > 0).sort((a, b) => t.tiles[b.id] - t.tiles[a.id])[0];
  return list.map((p) => {
    const tiles = t.tiles[p.id], run = runs[p.id], m = runMod(state, t, p.id);
    const brought = t.harvest ? t.harvest[p.id] || 0 : null;
    const bonus = { pedago: 0 };
    if (run > 0) {
      if (main && main.id === p.id) bonus.pedago = actN(t, 'pedago');
    }
    const extra = bonus.pedago;
    return { id: p.id, name: p.name, color: p.color, tiles, runners: tiles, runSec: run, baseRunSec: tripsFor(state, t, p.id) ? round5(tripsFor(state, t, p.id) * state.tripSec) : 0,
      perTrip: m.perTrip, stopAt: Math.max(0, chrono - run), overSec: Math.max(0, run - chrono), brought, bonus, value: brought === null ? 0 : brought + extra };
  });
}

// Encodage de la recolte : nombre de jetons reellement rapportes par type (pas de plafond : tout depend de la vitesse des coureurs). 1 jeton = 1 ressource.
function declareHarvest(state, teamId, input, force = false) {
  const t = teamOf(state, teamId);
  if (state.phase !== 'season') fail('La récolte se joue pendant une saison.');
  if (!force && !['recolte', 'bourse'].includes(D.STEPS[state.step].id)) fail('La récolte s’encode à l’étape Récolte (ou au début de Transformation).');
  if (t.stopped) fail('Cette ferme est à l’arrêt cette saison.');
  if (!force && t.transfo) fail('Les recettes sont déjà demandées : demande au maire du village de corriger la récolte.');
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
    id: t.id, name: t.name, bocal: t.bocal, level: levelOf(t.bocal, bocalMaxOf(state)), burnouts: t.burnouts,
    stopped: t.stopped, ready: t.ready, choice: t.choice, wheel: t.wheel,
    tiles: totalTiles(t), collier: !!t.collier, bonusSec: state && state.phase === 'season' ? bonusSec(state, t) : 0,
    // secondes de course de chaque produit pour cette ferme (protegee, bonus de temps...) : l'ecran suit ainsi chaque ferme
    runs: state && state.phase === 'season' && !t.stopped ? Object.fromEntries(harvestOf(state, t).map((h) => [h.id, h.runSec])) : {},
    acts: (t.activities || []).map((id) => { const a = activityOf(id); const roll = (t.actRolls && t.actRolls[id]) || null; return { id, name: a.name, icon: a.icon, roll, n: roll ? activityEffect(id, roll).n : 0 }; })
  };
}

function ownTeam(t, state) {
  return Object.assign(publicTeam(t, state), {
    transfo: t.transfo ? Object.assign({}, t.transfo, transfoQuote(t.transfo.items)) : null, dishes: t.dishes, pantry: t.pantry, recipeLimit: recipeLimit(t), recipeBonus: actN(t, 'resto'),
    sales: state && state.phase === 'season' ? (() => { const d = SALE_FIELDS.reduce((o, k) => { o[k] = t.sales ? t.sales[k] : 0; return o; }, {}); return Object.assign({ declared: !!t.sales, settled: !!(t.sales && t.sales.settled), amount: t.sales ? t.sales.amount : 0 }, d, { quote: salesQuote(state, t, d) }); })() : null,
    harvest: state && state.phase === 'season' ? harvestOf(state, t) : [], stopEarly: state && state.phase === 'season' ? stopEarlySec(state, t) : 0,
    stock: state ? stockOf(state, t) : null,
    challengeOk: state && challengeOf(state) ? challengeOk(state, t) : null,
    bank: t.bank, tilesByType: Object.assign({}, t.tiles), equipment: t.equipment.slice(),
    ledger: t.ledger.slice(-12).reverse(), charges: estimateCharges(t), freeSpin: t.freeSpin,
    bocalAdded: t.bocalAdded,
    undo: t.lastBuy && at0() - t.lastBuy.at <= UNDO_MS ? { name: (t.lastBuy.items || [{ itemId: t.lastBuy.itemId }]).map((x) => (D.CATALOGUE.find((i) => i.id === x.itemId) || {}).name).join(', '), ms: UNDO_MS - (at0() - t.lastBuy.at) } : null,
    chargesHistory: (t.chargesLog || []).slice(), purchases: (t.purchases || []).slice(-30),
    activities: (t.activities || []).slice(), actRolls: Object.assign({}, t.actRolls),
    shop: D.CATALOGUE.map((i) => ({
      id: i.id, kind: i.kind, name: i.name, effect: effectOf(state, i), price: priceOf(t, i), multi: !!i.multi,
      owned: i.kind === 'activity' ? (t.activities || []).includes(i.activity) : i.kind === 'equipment' && !i.multi && t.equipment.includes(i.id),
      count: i.kind === 'service' ? 0 : countOfItem(t, i), max: i.kind === 'service' ? Math.min(D.VACATION_MAX, t.bocal) : null
    }))
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
    id: x.id, from: x.from, to: x.to, price: x.price, payer: x.payer === 'from' ? 'from' : 'to', status: x.status, year: x.year, season: x.season,
    items: Object.keys(x.items).map((id) => ({ id, n: x.items[id], name: SELL.find((y) => y.id === id).name })),
    want: Object.keys(x.want || {}).map((id) => ({ id, n: x.want[id], name: SELL.find((y) => y.id === id).name }))
  }));
}

// Rappel des objectifs de la partie (les 3 etoiles, annee par annee) et ou en est le village.
function goalsView(state) {
  if (!state.teams.length) return null;
  const R = rulesOf(state), years = yearsOf(state), nFetes = R.fete.length;
  const burn = state.teams.reduce((n, t) => n + t.burnouts, 0);
  const peak = Math.max(0, ...state.teams.map((t) => t.bocalPeak || 0));
  const bank = state.teams.reduce((n, t) => n + t.bank, 0), target = s3Target(state);
  const okF = state.fetes.filter((f) => f.success).length, koF = state.fetes.length - okF;
  const stars = [
    { id: 's1', title: 'Étoile 1 · Un village serein', text: `Aucun burn-out, et aucune ferme au-dessus de ${R.peakMax} points de stress.`, ok: burn === 0 && peak <= R.peakMax, lost: burn > 0 || peak > R.peakMax, detail: `Stress le plus haut atteint : ${peak} · burn-out : ${burn}` },
    { id: 's2', title: 'Étoile 2 · Toutes les fêtes réussies', text: `Réussir les ${nFetes} Fêtes du Phoenix, une par année : tous les plats de la commande livrés.`, ok: koF === 0, lost: koF > 0, detail: `${okF} fête${okF > 1 ? 's' : ''} réussie${okF > 1 ? 's' : ''} sur ${nFetes}` },
    { id: 's3', title: 'Étoile 3 · Une caisse bien remplie', text: `La caisse du village (somme des banques de toutes les fermes) atteint ${target} EB à la fin de la partie.`, ok: bank >= target, lost: false, detail: `Caisse aujourd’hui : ${bank} EB sur ${target} EB (${Math.min(100, Math.round(bank / target * 100))} %)` }
  ];
  const dishText = (cfg) => {
    const c = { 1: 0, 2: 0, 3: 0 };
    for (const t of cfg.tiers) c[t] += 1;
    return [c[1] && `${c[1]} plat${c[1] > 1 ? 's' : ''} simple${c[1] > 1 ? 's' : ''}`, c[2] && `${c[2]} mixte${c[2] > 1 ? 's' : ''}`, c[3] && `${c[3]} composé${c[3] > 1 ? 's' : ''}`].filter(Boolean).join(', ');
  };
  const perYear = [];
  for (let y = 1; y <= years; y++) {
    const f = state.fetes.find((x) => x.year === y);
    const hasFete = R.fete.length >= y;
    perYear.push({
      year: y, current: y === state.year && state.phase !== 'end' && state.phase !== 'lobby',
      fete: !hasFete ? null : f ? (f.success ? 'success' : 'fail') : 'todo', dishes: hasFete ? `${dishText(feteCfg(state, y))} par ferme` : '',
      stress: `Garder chaque ferme à ${R.peakMax} points de stress au plus`, bankMilestone: Math.round(target * y / years)
    });
  }
  return { stars, perYear, target, bank, peakMax: R.peakMax, bocalMax: bocalMaxOf(state), years };
}

// Diapositive de presentation projetee (-1 : fermee). Les {variables} des textes prennent les valeurs de la partie.
function tutoView(state) {
  const i = state.tuto;
  if (!Number.isInteger(i) || i < 0 || !['lobby', 'setup'].includes(state.phase)) return null;
  const R = rulesOf(state);
  const vars = { years: yearsOf(state), peakMax: R.peakMax, bocalMax: bocalMaxOf(state), bank: D.START_BANK, target: s3Target(state) || Math.round(s3Mult(state) * D.START_BANK * 4),
    fetes: R.fete.length === 2 ? 'deux fêtes' : 'trois fêtes' };
  const fill = (str) => str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const n = D.TUTO.length, sl = D.TUTO[Math.min(i, n - 1)];
  return { index: Math.min(i, n - 1), total: n, icon: sl.icon, title: sl.title, say: sl.say, points: sl.points.map(fill), titles: D.TUTO.map((x) => x.title) };
}

function viewFor(state, role, teamId, at = now()) {
  migrate(state);
  const season = D.SEASONS[state.season];
  const view = {
    code: state.code, role, serverNow: at, phase: state.phase, year: state.year, season: state.season,
    seasonName: season.name, seasonColor: season.color, runBase: Object.fromEntries(D.PRODUCTS.map((p) => [p.id, baseTrips(state.season, p.id) ? round5(baseTrips(state.season, p.id) * state.tripSec) : 0])), stopEarlySec: stopEarlySec(state, null), runEff: Object.fromEntries(D.PRODUCTS.map((p) => [p.id, runSecOf(state, null, p.id)])), perTripEff: Object.fromEntries(D.PRODUCTS.map((p) => [p.id, runMod(state, null, p.id).perTrip])), harvestSec: harvestSecOf(state),
    step: state.step, stepName: D.STEPS[state.step].name,
    timer: { running: state.timer.running, remainingMs: timerRemaining(state, at), rawMs: state.timer.running ? state.timer.endsAt - at : state.timer.remainingMs, durationMs: state.timer.durationMs },
    card: state.card, seasonOf: season.of,
    closedYear: state.closedYear, feteDone: state.feteDone, fetes: state.fetes,
    fete: feteCfg(state), lastCharges: role === 'admin' ? state.lastCharges : null,
    menu: state.menu ? { perFarm: state.menu.perFarm, open: menuOpen(state), items: state.menu.items.map((it) => { const d = D.DISHES.find((x) => x.id === it.dish); const tm = state.teams.find((x) => x.id === it.team); return { key: it.key, name: d.name, needs: d.needs, tier: d.tier, makers: makersOf(state, it.dish).map((x) => x.name), team: it.team, teamName: tm ? tm.name : null, delivered: it.delivered, viaStock: !!it.viaStock, dish: it.dish }; }) } : null,
    challenge: challengeOf(state) ? { title: 'Défi : zéro perte', text: 'Terminez la saison sans aucune matière brute restante : vendez ou transformez tout. −1 stress pour chaque ferme qui y arrive.' } : null,
    lastChallenge: state.lastChallenge || null,
    recap: state.phase === 'season' && modeOf(state).recap ? recapNow(state) : null, prevRecap: state.prevRecap || null,
    tripSec: state.tripSec, undo: role === 'admin' ? undoInfo(state) : null, stars: state.stars, showQr: !!state.showQr, showGoals: !!state.showGoals, tuto: tutoView(state), goals: goalsView(state), villageAccount: villageAccount(state), forecast: forecastView(state, role),
    trades: tradesView(state, role, teamId),
    ownedProducts: D.PRODUCTS.filter((p) => state.teams.some((t) => !t.stopped && (t.tiles[p.id] || 0) > 0)).map((p) => p.id),
    villageBank: state.teams.reduce((n, t) => n + t.bank, 0), villageGoal: s3Target(state), mode: modeOf(state), years: yearsOf(state), peakMax: rulesOf(state).peakMax,
    roleShift: (state.year - 1) % 6,
    teams: state.teams.map((t) => (role === 'admin' ? adminTeam(t, state) : role === 'team' && t.id === teamId ? ownTeam(t, state) : publicTeam(t, state))),
    me: role === 'team' ? teamId : null,
    meta: {
      sell: SELL.map((x) => ({ id: x.id, kind: x.kind, tier: x.tier || 0, name: x.name, mult: x.mult })),
      steps: D.STEPS.map((x) => ({ id: x.id, name: x.name, hint: x.hint })),
      seasons: D.SEASONS.map((x, i) => ({ name: x.name, of: x.of, color: x.color, harvestSec: harvestSecOf(state, i) })),
      products: D.PRODUCTS, tileNames: D.TILE_NAMES, bocalMax: bocalMaxOf(state), teamSizes: D.TEAM_SIZES, yearChoices: D.YEAR_CHOICES, vacationCost: D.VACATION_COST, tripChoices: D.TRIP_CHOICES, collierSec: collierSec(state), tracteurSec: tracteurSec(state),
      catalogue: D.CATALOGUE.map((x) => ({ id: x.id, kind: x.kind, name: x.name, tile: x.tile || null, activity: x.activity || null })),
      activities: D.ACTIVITIES.map((a) => ({ id: a.id, name: a.name, icon: a.icon, price: a.price, short: a.short, how: a.how, effects: [1, 2, 3, 4, 5, 6].map((d) => activityEffect(a.id, d).text) })),
      wheel: D.WHEEL.map((w) => ({ label: w.label, frac: w.frac, free: !!w.free })), vacationMax: D.VACATION_MAX,
      giftables: Object.keys(D.TILE_NAMES).filter((k) => k !== 'activite').map((k) => ({ id: k, name: D.TILE_NAMES[k] })).concat(D.ACTIVITIES.map((a) => ({ id: a.id, name: a.name }))),
      tuto: D.TUTO.map((x) => ({ title: x.title, say: x.say })),
      fete: { win: D.FETE_WIN, fail: D.FETE_FAIL, missing: D.FETE_MISSING, cap: D.FETE_MISSING_CAP },
      profiles: Object.keys(D.PROFILES).map((k) => ({ id: k, name: D.PROFILES[k].name })),
      startBank: D.START_BANK, transferReasons: D.TRANSFER_REASONS, market: D.MARKET, dishes: D.DISHES.map((d) => ({ id: d.id, name: d.name, needs: d.needs, tier: d.tier, req: d.req })), tilePrice: D.TILE_PRICE
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
  jumpTo, setTripSec, offerTrade, respondTrade, cancelTrade, revertTrade, declareHarvest, adjustHarvest, contribute, adjustContribution, settleCollective, undoBuy, prepareForecast, adjustTimer, setTimerSeconds, drawCard, rollActivity, rollAllActivities, activityEffect, buyCart, deliverDish, setRecap, villageAccount, effectOf, spinWheel, addBank, transfer, declareSales, settleSales, salesQuote, requestTransfo, validateTransfo, migrate, drawMenu, claimDish, releaseDish, assignDish, autoAssign, setDelivered, menuOk, addBocal, setReady, buy, giftTile, removeTile, setChoice,
  undoInfo, undoLast, recordUndo, blockUndo, setMode, feteCfg, modeOf, yearsOf, s3Target, vacation, coupDeCollier, closeYear, fete, nextYear, finish, estimateCharges, priceOf, levelOf,
  viewFor, summary, canShop, log, newCode
};
