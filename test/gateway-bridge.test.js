'use strict';
// Connexion centralisee de node-gateway : avec le droit « admin » fourni par la passerelle (req.gateway), le front
// recoit un jeton animateur COURT (2 h) via /api/auth/gateway. Un « membre », un anonyme ou un droit nul : 204.
// Le mot de passe partage reste valable. Hors passerelle : inchange.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-gw-'));
process.env.FF_DATA_DIR = dir;
const express = require('express');
const app = require('../server');

let srv, base;
const gw = (role) => ({ 'x-test-gateway': JSON.stringify({ app: 'farming-folies', role, user: { login: 'anim', name: 'Anim', email: null, isSuper: false } }) });
const bridge = (headers = {}) => fetch(base + '/api/auth/gateway', { headers });
const me = (token) => fetch(base + '/api/me', { headers: token ? { Authorization: 'Bearer ' + token } : {} });

test.before(async () => {
  const outer = express();
  outer.use((req, res, next) => { const h = req.get('x-test-gateway'); if (h) req.gateway = JSON.parse(h); next(); });
  outer.use('/farming-folies', app);
  srv = http.createServer(outer);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}/farming-folies`;
});
test.after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); setImmediate(() => process.exit(0)); });

test('droit admin de la passerelle -> jeton animateur court, accepte par les routes protegees', async () => {
  const r = await bridge(gw('admin'));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.token);
  const ttl = j.expiresAt - Date.now();
  assert.ok(ttl > 60 * 60 * 1000 && ttl <= 2 * 60 * 60 * 1000 + 5000, 'jeton de 2 h au plus, obtenu ' + ttl);
  assert.equal((await me(j.token)).status, 200);
  assert.equal((await me()).status, 401);
});

test('un simple membre, un anonyme ou un droit nul n\'obtiennent rien (204)', async () => {
  for (const h of [gw('member'), gw(null), {}]) assert.equal((await bridge(h)).status, 204);
});

test('mot de passe partage inchange : creation puis connexion', async () => {
  let r = await fetch(base + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'motdepasse-solide' }) });
  assert.equal(r.status, 200);
  r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'motdepasse-solide' }) });
  assert.equal(r.status, 200);
  assert.equal((await me((await r.json()).token)).status, 200);
});
