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
  rollDie: (s, a) => E.rollDie(s, a.value === undefined ? undefined : int(a.value)),
  spinWheel: (s, a) => E.spinWheel(s, str(a.teamId, 10)),
  bank: (s, a) => E.addBank(s, str(a.teamId, 10), int(a.amount), str(a.label) || 'Ajustement animateur', true),
  bocal: (s, a) => E.addBocal(s, str(a.teamId, 10), int(a.delta), str(a.reason) || 'Ajustement animateur'),
  buy: (s, a) => E.buy(s, str(a.teamId, 10), str(a.itemId, 30), true),
  giftTile: (s, a) => E.giftTile(s, str(a.teamId, 10), str(a.tile, 20)),
  removeTile: (s, a) => E.removeTile(s, str(a.teamId, 10), str(a.tile, 20)),
  setReady: (s, a) => E.setReady(s, str(a.teamId, 10), !!a.ready),
  setChoice: (s, a) => E.setChoice(s, str(a.teamId, 10), str(a.choice, 10)),
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
  toggleQr: (s, a) => { s.showQr = a.show === undefined ? !s.showQr : !!a.show; }
};

// Une ferme ne peut agir que sur elle-meme.
const TEAM = {
  buy: (s, id, a) => E.buy(s, id, str(a.itemId, 30)),
  setChoice: (s, id, a) => E.setChoice(s, id, str(a.choice, 10)),
  vacation: (s, id, a) => E.vacation(s, id, int(a.n)),
  collier: (s, id) => E.coupDeCollier(s, id),
  undoBuy: (s, id) => E.undoBuy(s, id),
  contribute: (s, id, a) => E.contribute(s, id, int(a.n)),
  offerTrade: (s, id, a) => E.offerTrade(s, id, { to: str(a.to, 10), items: a.items && typeof a.items === 'object' ? a.items : {}, price: a.price === undefined ? 0 : int(a.price) }),
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
    return fn(session, action);
  }
  if (auth.role === 'team') {
    const fn = Object.prototype.hasOwnProperty.call(TEAM, action.type) ? TEAM[action.type] : null;
    if (!fn) throw new E.GameError('Action non autorisée.');
    return fn(session, auth.teamId, action);
  }
  if (auth.role === 'guest') return guestAct(session, action);
  throw new E.GameError('Cet écran est en lecture seule.');
}

// Ecran de connexion unique : un joueur cree sa ferme (salle d'attente) ou reprend une ferme existante.
// Retourne { token } que le client garde pour se reconnecter ensuite en tant que ferme.
function guestAct(session, action) {
  if (action.type === 'createTeam') {
    const used = new Set(session.teams.map((t) => t.profile));
    const prof = Object.keys(E.PROFILES || {}).find((k) => !used.has(k)) || '';
    const t = E.addTeam(session, { name: str(action.name, 40), profile: prof });
    return { token: t.token, teamId: t.id };
  }
  if (action.type === 'joinTeam') {
    const t = session.teams.find((x) => x.id === str(action.teamId, 10));
    if (!t) throw new E.GameError('Ferme inconnue.');
    return { token: t.token, teamId: t.id };
  }
  throw new E.GameError('Action non autorisée.');
}

module.exports = { dispatch };
