'use strict';
// Assemble un banc d'essai en un seul fichier HTML : moteur + ecrans reels, reseau simule par postMessage.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');

const SHIM = `
window.io = function () {
  var id = Math.random().toString(36).slice(2), handlers = {}, pend = {}, n = 0, closed = false;
  function fire(ev, a) { (handlers[ev] || []).forEach(function (f) { f(a); }); }
  window.addEventListener('message', function (e) {
    var m = e.data; if (!m || closed) return;
    if (m.ff === 'res' && pend[m.rid]) { var cb = pend[m.rid]; delete pend[m.rid]; cb(m.r); }
    else if (m.ff === 'state' && m.id === id) fire('state', m.data);
  });
  var sock = {
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    emit: function (ev, p, cb) { var rid = ++n; if (cb) pend[rid] = cb; parent.postMessage({ ff: 'req', id: id, ev: ev, p: p, rid: rid }, '*'); },
    disconnect: function () { closed = true; }
  };
  setTimeout(function () { fire('connect'); }, 0);
  return sock;
};`;

function page(name, js) {
  let h = rd('public/' + name + '.html');
  const css = rd('public/app.css');
  h = h.replace(/<link rel="stylesheet" href="app.css">/, () => '<style>' + css + '</style>');
  h = h.replace(/<script src="vendor\/socket.io.min.js"><\/script>/, () => '<script>' + safe(SHIM) + '</script>');
  h = h.replace(/<script src="vendor\/qrcode.min.js"><\/script>/, () => '<script>' + safe(rd('public/vendor/qrcode.min.js')) + '</script>');
  h = h.replace(/<script src="common.js"><\/script>/, () => '<script>' + safe(rd('public/common.js').replace('new URLSearchParams(location.search)', 'new URLSearchParams(window.__QS || location.search)')) + '</script>');
  h = h.replace(/<script src="guide.js"><\/script>/, () => '<script>' + safe(rd('public/guide.js')) + '</script>');
  h = h.replace(new RegExp('<script src="' + js + '"></script>'), () => '<script>' + safe(rd('public/' + js)) + '</script>');
  if (!/<head>/.test(h)) throw new Error('pas de <head> dans ' + name);
  return h;
}
// Accueil (connexion + historique) : l'API HTTP est simulee dans la page (mot de passe de demonstration : phoenix2024).
const HOMESHIM = `(function () {
  var code = new URLSearchParams(window.__QS || '').get('s') || 'DEMO';
  var now = Date.now(), pw = null;
  var games = [
    { code: code, label: 'Partie du banc d\\'essai (en cours)', createdAt: now - 60000, phase: 'lobby', teams: [], stars: null, totalBank: 0 },
    { code: 'ABCD', label: 'Séminaire Condorcet', createdAt: now - 86400000 * 20, phase: 'end', teams: [{ name: 'Les Bergers' }, { name: 'Les Foins' }, { name: 'Les Vignes' }], stars: { count: 2 }, totalBank: 3120 },
    { code: 'WXYZ', label: '', createdAt: now - 86400000 * 3, phase: 'season', teams: [{ name: 'Les Chèvres' }], stars: null, totalBank: 0 }
  ];
  function reply(o, status) { return Promise.resolve({ ok: !status || status < 400, status: status || 200, json: function () { return Promise.resolve(o); } }); }
  var real = window.fetch;
  window.fetch = function (url, opts) {
    url = String(url); opts = opts || {};
    var m = url.match(/api\\/(login|setup|status|change-password|sessions)(?:\\/([A-Za-z0-9]{4}))?(?:\\/(export))?/);
    if (!m) return real.apply(this, arguments);
    var body = {}; try { body = JSON.parse(opts.body || '{}'); } catch (e) {}
    var method = (opts.method || 'GET').toUpperCase(), g;
    if (m[1] === 'status') return reply({ setup: pw === null });
    if (m[1] === 'setup') { if (pw !== null) return reply({ ok: false }, 403); if (String(body.password || '').length < 6) return reply({ ok: false }, 400); pw = body.password; return reply({ ok: true, token: 'demo', expiresAt: Date.now() + 43200000, defaultPassword: false }); }
    if (m[1] === 'login') return body.password === pw ? reply({ ok: true, token: 'demo', expiresAt: Date.now() + 43200000, defaultPassword: false }) : reply({ ok: false }, 401);
    if (m[1] === 'change-password') { if (body.currentPassword !== pw) return reply({ ok: false }, 403); if (String(body.newPassword || '').length < 8) return reply({ ok: false, error: 'weak_password' }, 400); pw = body.newPassword; return reply({ ok: true, token: 'demo', expiresAt: Date.now() + 43200000 }); }
    if (!m[2]) {
      if (method === 'POST') { var c = ''; while (c.length < 4) c += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]; games.unshift({ code: c, label: String(body.label || ''), createdAt: Date.now(), phase: 'lobby', teams: [], stars: null, totalBank: 0 }); return reply({ code: c }); }
      return reply({ sessions: games });
    }
    g = games.filter(function (x) { return x.code === m[2]; })[0];
    if (!g) return reply({ exists: false }, 404);
    if (m[3]) return reply({ code: g.code, label: g.label, demo: true });
    if (method === 'DELETE') { games = games.filter(function (x) { return x !== g; }); return reply({ ok: true }); }
    if (method === 'PATCH') { g.label = String(body.label || ''); return reply({ ok: true }); }
    return reply({ exists: true, phase: g.phase, teams: g.teams.length });
  };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var h = a.getAttribute('href');
    if (/^admin/.test(h)) { e.preventDefault(); parent.postMessage({ ff: 'goto', pane: 'console' }, '*'); }
    else if (/^display/.test(h)) { e.preventDefault(); parent.postMessage({ ff: 'goto', pane: 'display' }, '*'); }
  }, true);
})();`;
const PAGES = { admin: page('admin', 'admin.js'), display: page('display', 'display.js'), team: page('team', 'team.js') };
PAGES.home = page('index', 'home.js').replace('<head>', () => '<head><script>' + safe(HOMESHIM) + '</script>');

const CRYPTO = `{
  randomBytes: function (n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return { toString: function () { var s = btoa(String.fromCharCode.apply(null, a)); return s.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); } }; },
  randomInt: function (n) { return Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * n); }
}`;
const mods = { './data': rd('lib/data.js'), './engine': rd('lib/engine.js'), './actions': rd('lib/actions.js') };
let engine = 'window.FFEngine = (function () {\n var defs = {}, cache = {};\n';
engine += ' var crypto_ = ' + CRYPTO + ';\n';
for (const [k, src] of Object.entries(mods)) engine += ' defs[' + JSON.stringify(k) + '] = function (module, exports, require) {\n' + src + '\n};\n';
engine += ` function req(name) { if (name === 'crypto') return crypto_; if (cache[name]) return cache[name].exports; var m = cache[name] = { exports: {} }; defs[name](m, m.exports, req); return m.exports; }
 return { engine: req('./engine'), dispatch: req('./actions').dispatch };
})();`;

let out = fs.readFileSync(path.join(__dirname, 'hub.template.html'), 'utf8');
out = out.replace('/*__ENGINE__*/', () => safe(engine)).replace('/*__PAGES__*/', () => safe(JSON.stringify(PAGES)));
fs.writeFileSync(path.join(__dirname, 'bench.html'), out);
console.log('bench.html', Math.round(out.length / 1024) + ' Ko');
