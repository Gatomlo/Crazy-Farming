'use strict';
// Farming's Folies : jeu de gestion de ferme en equipes (teambuilding).
//
// Compatible node-gateway : ce fichier EXPORTE l'app Express (module.exports = app) et
// n'appelle app.listen() que s'il est lance directement (npm start). Le temps reel
// (Socket.IO) est branche par le hook optionnel app.attachToServer(httpServer, { mountPath }),
// que la passerelle appelle au montage. Cote navigateur, tous les chemins sont relatifs.

const path = require('path');
const express = require('express');
const store = require('./lib/store');
const E = require('./lib/engine');
const auth = require('./lib/auth');
const config = require('./lib/config');
config.load();
const { dispatch } = require('./lib/actions');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

const PUBLIC = path.join(__dirname, 'public');
const page = (name) => (req, res) => res.sendFile(path.join(PUBLIC, name));

// Les pages utilisent des chemins relatifs (vendor/..., app.css) : la racine doit donc se terminer par "/".
app.get('/', (req, res) => {
  const p = req.originalUrl.split('?')[0];
  if (!p.endsWith('/')) return res.redirect(302, p + '/' + req.originalUrl.slice(p.length));
  res.sendFile(path.join(PUBLIC, 'index.html'));
});
app.get('/admin', page('admin.html'));
app.get('/display', page('display.html'));
app.get('/team', page('team.html'));

// Client Socket.IO : fichier local public/vendor/socket.io.min.js (servi par express.static, chemin relatif au montage).

// ---------- Acces animateur (mot de passe) ----------
app.set('trust proxy', 1);
app.get('/api/status', (req, res) => res.json({ setup: auth.needsSetup() }));

app.post('/api/setup', (req, res) => {
  const r = auth.setup(req.ip, (req.body || {}).password);
  if (!r.ok) return res.status(r.status).json({ ok: false, error: r.error });
  res.json({ ok: true, token: r.token, expiresAt: auth.expiry(r.token), defaultPassword: false });
});

app.post('/api/login', (req, res) => {
  const r = auth.login(req.ip, (req.body || {}).password);
  if (!r.ok) return res.status(r.status).json({ ok: false, error: r.error, retryAfterSeconds: r.retryAfterSeconds });
  res.json({ ok: true, token: r.token, expiresAt: auth.expiry(r.token), defaultPassword: auth.usingDefault() });
});

app.post('/api/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const r = auth.changePassword(req.ip, currentPassword, newPassword);
  if (!r.ok) return res.status(r.status).json({ ok: false, error: r.error, retryAfterSeconds: r.retryAfterSeconds });
  res.json({ ok: true, token: r.token, expiresAt: auth.expiry(r.token) });
});

app.get('/api/me', auth.requireAdmin, (req, res) => res.json({ ok: true, defaultPassword: auth.usingDefault() }));

// ---------- Reglages communs a toutes les parties : effets des niveaux de stress ----------
app.get('/api/config/stress', auth.requireAdmin, (req, res) => res.json(config.view()));
app.put('/api/config/stress', auth.requireAdmin, (req, res) => {
  try { res.json(config.setStress((req.body || {}).levels)); } catch (e) {
    if (e instanceof config.ConfigError) return res.status(400).json({ error: e.message });
    internal(res, e);
  }
});
app.delete('/api/config/stress', auth.requireAdmin, (req, res) => res.json(config.resetStress()));

// ---------- Parties : creation et historique (animateur uniquement) ----------
const internal = (res, e) => {
  if (e instanceof E.GameError) return res.status(429).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: 'Erreur interne.' });
};

app.post('/api/sessions', auth.requireAdmin, (req, res) => {
  try {
    const s = store.create((req.body || {}).label);
    res.json({ code: s.code });
  } catch (e) { internal(res, e); }
});

app.get('/api/sessions', auth.requireAdmin, (req, res) => res.json({ sessions: store.list() }));

app.patch('/api/sessions/:code', auth.requireAdmin, (req, res) => {
  if (!store.rename(req.params.code, (req.body || {}).label)) return res.status(404).json({ error: 'Session introuvable.' });
  res.json({ ok: true });
});

app.delete('/api/sessions/:code', auth.requireAdmin, (req, res) => {
  if (!store.remove(req.params.code)) return res.status(404).json({ error: 'Session introuvable.' });
  res.json({ ok: true });
});

// Export complet d'une partie (etat, journal, resultats) en JSON.
app.get('/api/sessions/:code/export', auth.requireAdmin, (req, res) => {
  const s = store.get(req.params.code);
  if (!s) return res.status(404).json({ error: 'Session introuvable.' });
  res.setHeader('Content-Disposition', `attachment; filename="farming-folies-${s.code}.json"`);
  res.json(s);
});

// Existence d'une session : utilisee par l'ecran joueurs (code a 4 lettres). Ne revele rien d'autre.
app.get('/api/sessions/:code', (req, res) => {
  const s = store.get(req.params.code);
  if (!s) return res.status(404).json({ exists: false });
  res.json({ exists: true, phase: s.phase, teams: s.teams.length });
});

app.use(express.static(PUBLIC, { index: false }));

// ---------- Temps reel ----------
function broadcast(io, session) {
  const room = io.sockets.adapter.rooms.get(session.code);
  if (!room) return;
  for (const id of room) {
    const sock = io.sockets.sockets.get(id);
    if (!sock || !sock.data.auth) continue;
    sock.emit('state', E.viewFor(session, sock.data.auth.role, sock.data.auth.teamId));
  }
}

function wire(io) {
  io.on('connection', (socket) => {
    let hits = 0;
    const reset = setInterval(() => { hits = 0; }, 1000);
    socket.on('disconnect', () => clearInterval(reset));

    socket.on('join', (p, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const session = p && store.get(p.code);
      if (!session) return reply({ ok: false, error: 'Session introuvable.' });
      let who = null;
      if (p.role === 'admin') {
        if (p.token && auth.verifyToken(p.token)) who = { role: 'admin', exp: auth.expiry(p.token) };
      } else if (p.role === 'team') {
        const t = p.token && session.teams.find((x) => x.token === p.token);
        if (t) who = { role: 'team', teamId: t.id };
      } else if (p.role === 'display') {
        who = { role: 'display' };
      } else if (p.role === 'guest') {
        who = { role: 'guest' };
      }
      if (!who) return reply({ ok: false, error: 'Lien invalide.' });
      if (socket.data.code && socket.data.code !== session.code) socket.leave(socket.data.code);
      socket.data.auth = who;
      socket.data.code = session.code;
      socket.join(session.code);
      reply({ ok: true, role: who.role });
      socket.emit('state', E.viewFor(session, who.role, who.teamId));
    });

    socket.on('act', (action, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!socket.data.auth) return reply({ ok: false, error: 'Connexion non établie.' });
      if (socket.data.auth.role === 'admin' && socket.data.auth.exp < Date.now()) return reply({ ok: false, error: 'Session animateur expirée : reconnecte-toi.' });
      if (++hits > 20) return reply({ ok: false, error: 'Trop d’actions à la suite, ralentis.' });
      const session = store.get(socket.data.code);
      if (!session) return reply({ ok: false, error: 'Session introuvable.' });
      try {
        const out = dispatch(session, socket.data.auth, action);
        store.save(session);
        broadcast(io, session);
        reply(socket.data.auth.role === 'guest' ? { ok: true, token: out.token } : { ok: true });
      } catch (e) {
        if (e instanceof E.GameError) return reply({ ok: false, error: e.message });
        console.error('Erreur inattendue :', e);
        reply({ ok: false, error: 'Erreur interne.' });
      }
    });
  });
}

// Hook appele par node-gateway (voir son README) : le serveur HTTP de la passerelle nous est confie.
app.attachToServer = (httpServer, { mountPath = '' } = {}) => {
  const { Server } = require('socket.io');
  const io = new Server(httpServer, { path: mountPath + '/socket.io', serveClient: false, maxHttpBufferSize: 1e5 });
  wire(io);
  return io;
};

if (require.main === module) {
  const http = require('http');
  const PORT = process.env.PORT || 3000;
  const server = http.createServer(app);
  app.attachToServer(server, { mountPath: '' });
  server.listen(PORT, () => console.log(`Farming's Folies : http://localhost:${PORT}`));
}

module.exports = app;
