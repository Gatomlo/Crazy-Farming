'use strict';
// Aiguillage des actions recues par Socket.IO vers le moteur, avec controle des droits.
// Pas de dependance : testable sans serveur.

const E = require('./engine');

const int = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);
const str = (v, max = 60) => String(v == null ? '' : v).slice(0, max);

const ADMIN = {
  addTeam: (s, a) => E.addTeam(s, { name: str(a.name, 40), profile: str(a.profile, 20) }),
  removeTeam: (s, a) => E.removeTeam(s, str(a.teamId, 10)),
  startSetup: (s) => E.startSetup(s),
  startYear: (s) => E.startYear(s),
  nextStep: (s) => E.nextStep(s),
  prevStep: (s) => E.prevStep(s),
  jumpTo: (s, x) => E.jumpTo(s, int(x.year), int(x.season)),
  timerStart: (s) => E.startTimer(s),
  timerPause: (s) => E.pauseTimer(s),
  timerReset: (s) => E.resetTimer(s),
  timerAdjust: (s, x) => E.adjustTimer(s, int(x.delta)),
  timerSet: (s, x) => E.setTimerSeconds(s, int(x.sec), !!x.keep),
  drawCard: (s, a) => E.drawCard(s, a.index === undefined ? undefined : int(a.index)),
  rollActivity: (s, a) => E.rollActivity(s, str(a.teamId, 10), str(a.activity, 20), a.value === undefined ? undefined : int(a.value), Math.random, true),
  rollAllActivities: (s) => E.rollAllActivities(s),
  setRecap: (s, a) => E.setRecap(s, !!a.on),
  spinWheel: (s, a) => E.spinWheel(s, str(a.teamId, 10)),
  bank: (s, a) => E.addBank(s, str(a.teamId, 10), int(a.amount), str(a.label) || 'Ajustement du maire du village', true),
  bocal: (s, a) => E.addBocal(s, str(a.teamId, 10), int(a.delta), str(a.reason) || 'Ajustement du maire du village'),
  buy: (s, a) => E.buy(s, str(a.teamId, 10), str(a.itemId, 30), true),
  giftTile: (s, a) => E.giftTile(s, str(a.teamId, 10), str(a.tile, 20)),
  removeTile: (s, a) => E.removeTile(s, str(a.teamId, 10), str(a.tile, 20)),
  setReady: (s, a) => E.setReady(s, str(a.teamId, 10), !!a.ready),
  setChoice: (s, a) => E.setChoice(s, str(a.teamId, 10), str(a.choice, 10), true),
  releaseTeam: (s, a) => E.releaseTeam(s, str(a.teamId, 10)),
  vacation: (s, a) => E.vacation(s, str(a.teamId, 10), int(a.n), true),
  closeYear: (s) => E.closeYear(s),
  validateTransfo: (s, x) => E.validateTransfo(s, str(x.teamId, 10)),
  settleSales: (s, x) => E.settleSales(s, str(x.teamId, 10)),
  drawMenu: (s) => E.drawMenu(s),
  assignDish: (s, a) => E.assignDish(s, str(a.key, 8), a.teamId ? str(a.teamId, 10) : null),
  autoAssign: (s) => E.autoAssign(s),
  setDelivered: (s, a) => E.setDelivered(s, str(a.key, 8), !!a.delivered),
  fete: (s, a) => E.fete(s, a.success === undefined ? undefined : !!a.success),
  nextYear: (s) => E.nextYear(s),
  finish: (s) => E.finish(s),
  settleCollective: (s) => E.settleCollective(s),
  cancelTrade: (s, a) => E.cancelTrade(s, null, str(a.tradeId, 10), true),
  revertTrade: (s, a) => E.revertTrade(s, str(a.tradeId, 10)),
  adjustHarvest: (s, a) => E.adjustHarvest(s, str(a.teamId, 10), str(a.product, 10), int(a.delta)),
  adjustContribution: (s, a) => E.adjustContribution(s, str(a.teamId, 10), int(a.delta)),
  setTripSec: (s, a) => E.setTripSec(s, int(a.sec)),
  undo: () => null, // traite dans dispatch
  setMode: (s, a) => E.setMode(s, { size: int(a.size), years: int(a.years), challenge: a.challenge === undefined ? undefined : !!a.challenge, recap: a.recap === undefined ? undefined : !!a.recap }),
  toggleQr: (s, a) => { s.showQr = a.show === undefined ? !s.showQr : !!a.show; },
  setTuto: (s, a) => { const n = int(a.slide); s.tuto = Number.isNaN(n) ? -1 : Math.max(-1, Math.min(99, n)); },
  toggleGoals: (s, a) => { s.showGoals = a.show === undefined ? !s.showGoals : !!a.show; }
};

// Une ferme ne peut agir que sur elle-meme.
// Corrections de l'animateur annulables (libelle affiche sur le bouton). Chrono, changements d'etape et creation de fermes n'en font pas partie.
const UNDOABLE = {
  adjustHarvest: 'correction de récolte', bank: 'correction de banque', bocal: 'correction de bocal', adjustContribution: 'correction de don',
  buy: 'achat', giftTile: 'tuile offerte', removeTile: 'tuile retirée', vacation: 'vacances', setChoice: 'choix de ferme', drawCard: 'tirage de carte',
  rollActivity: 'dé d’activité', rollAllActivities: 'dés des activités', spinWheel: 'roue de marché', settleSales: 'paiement des ventes', validateTransfo: 'transformation validée', assignDish: 'répartition de plat',
  setDelivered: 'livraison de plat', cancelTrade: 'annulation d’échange', revertTrade: 'annulation d’échange conclu', settleCollective: 'aléa collectif', closeYear: 'charges de l’année', fete: 'fête du Phoenix'
};

const TEAM = {
  buy: (s, id, a) => E.buy(s, id, str(a.itemId, 30)),
  renameTeam: (s, id, a) => E.renameTeam(s, id, str(a.name, 40)),
  buyCart: (s, id, a) => E.buyCart(s, id, Array.isArray(a.items) ? a.items.slice(0, 40).map((x) => str(x, 30)) : []),
  setChoice: (s, id, a) => E.setChoice(s, id, str(a.choice, 10)),
  vacation: (s, id, a) => E.vacation(s, id, int(a.n)),
  collier: (s, id) => E.coupDeCollier(s, id),
  undoBuy: (s, id) => E.undoBuy(s, id),
  contribute: (s, id, a) => E.contribute(s, id, int(a.n)),
  offerTrade: (s, id, a) => E.offerTrade(s, id, { to: str(a.to, 10), items: a.items && typeof a.items === 'object' ? a.items : {}, want: a.want && typeof a.want === 'object' ? a.want : {}, price: a.price === undefined ? 0 : int(a.price), payer: a.payer === 'from' ? 'from' : 'to' }),
  rollActivity: (s, id, a) => E.rollActivity(s, id, str(a.activity, 20)),
  deliverDish: (s, id, a) => E.deliverDish(s, id, str(a.key, 8), a.delivered === undefined ? true : !!a.delivered),
  respondTrade: (s, id, a) => E.respondTrade(s, id, str(a.tradeId, 10), !!a.accept),
  cancelTrade: (s, id, a) => E.cancelTrade(s, id, str(a.tradeId, 10)),
  declareHarvest: (s, id, a) => E.declareHarvest(s, id, a.tokens || {}),
  setReady: (s, id, a) => E.setReady(s, id, !!a.ready),
  spinWheel: (s, id) => { if (s.phase !== 'season' || s.step !== 3) throw new E.GameError('La roue tourne à l’étape Marché.'); return E.spinWheel(s, id); },
  requestTransfo: (s, id, x) => E.requestTransfo(s, id, x.transfo || {}),
  declareSales: (s, id, x) => E.declareSales(s, id, x.sales),
  claimDish: (s, id, a) => E.claimDish(s, id, str(a.key, 8)),
  releaseDish: (s, id, a) => E.releaseDish(s, id, str(a.key, 8)),
  transfer: (s, id, a) => E.transfer(s, id, str(a.to, 12), int(a.amount), str(a.reason, 30))
};

function dispatch(session, auth, action) {
  if (!action || typeof action.type !== 'string') throw new E.GameError('Action invalide.');
  E.migrate(session.state || session);
  if (auth.role === 'admin') {
    const fn = Object.prototype.hasOwnProperty.call(ADMIN, action.type) ? ADMIN[action.type] : null;
    if (!fn) throw new E.GameError('Action inconnue.');
    if (action.type === 'undo') return E.undoLast(session);
    const label = UNDOABLE[action.type];
    const snap = label ? JSON.stringify(session) : null;
    const out = fn(session, action);
    if (snap) E.recordUndo(session, label, snap);
    return out;
  }
  if (auth.role === 'team') {
    const fn = Object.prototype.hasOwnProperty.call(TEAM, action.type) ? TEAM[action.type] : null;
    if (!fn) throw new E.GameError('Action non autorisée.');
    E.blockUndo(session);
    return fn(session, auth.teamId, action);
  }
  if (auth.role === 'guest') return guestAct(session, action);
  throw new E.GameError('Cet écran est en lecture seule.');
}

// Ecran de connexion unique : un joueur choisit une ferme libre proposee par le maire du village et peut la renommer.
// Une ferme ne peut etre prise que par une seule equipe ; la reconnexion se fait avec le lien (jeton) garde dans le telephone.
// Retourne { token } que le client garde pour se reconnecter ensuite en tant que ferme.
function guestAct(session, action) {
  if (action.type === 'claimTeam') {
    const t = E.claimTeam(session, str(action.teamId, 10), str(action.name, 40));
    return { token: t.token, teamId: t.id };
  }
  throw new E.GameError('Action non autorisée.');
}

module.exports = { dispatch };
