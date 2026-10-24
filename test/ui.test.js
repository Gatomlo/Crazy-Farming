'use strict';
// Test de fumee des ecrans (console, mobile, projecteur) : on rejoue une partie avec le vrai moteur et on pousse chaque etat dans les vraies pages,
// reseau simule. Echoue sur la moindre erreur de script. Ignore si Playwright / Chromium ne sont pas installes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const E = require('../lib/engine');

let chromium = null;
try { chromium = require('playwright').chromium; } catch (e) { /* Playwright absent */ }

const PUBLIC = 'file://' + path.join(__dirname, '..', 'public') + '/';

// Une partie jouee : etats (admin / ferme / projecteur) a chaque point de passage.
function scenario(mode) {
  const s = E.createSession('SMOK');
  for (let i = 0; i < 3; i++) E.addTeam(s, { name: '', profile: ['bergers', 'maraichers', 'eleveurs'][i] });
  if (mode) E.setMode(s, mode);
  const out = { admin: [], team: [], display: [] };
  const t = s.teams[0].id;
  const snap = () => {
    const j = (v) => JSON.parse(JSON.stringify(v));
    out.admin.push(j(E.viewFor(s, 'admin'))); out.team.push(j(E.viewFor(s, 'team', t))); out.display.push(j(E.viewFor(s, 'display')));
  };
  snap();
  E.startSetup(s); snap();
  E.autoAssign(s); E.startYear(s); snap();
  for (const idx of [0, 1, 2, 3]) { // une carte de chaque saison, avec tout le deroule de la saison
    E.jumpTo(s, 1, idx); E.drawCard(s, 0); snap();
    E.nextStep(s); snap(); // recolte
    E.declareHarvest(s, t, Object.fromEntries(E.viewFor(s, 'team', t).teams.find((x) => x.id === t).harvest.map((h) => [h.id, h.runSec ? 2 : 0])), true);
    E.coupDeCollier(s, t); snap();
    E.nextStep(s); snap(); E.nextStep(s); snap(); E.nextStep(s); snap();
  }
  E.jumpTo(s, 1, 1); s.collective = { year: 1, id: 'inondation', season: 1, done: false }; E.drawCard(s); snap(); // alea collectif
  s.phase = 'closing'; s.closedYear = false; snap();
  E.finish(s); snap();
  return out;
}

async function playPage(browser, page, states, query) {
  const pg = await browser.newPage({ viewport: { width: page === 'display' ? 1280 : 420, height: page === 'display' ? 720 : 900 } });
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript((st) => {
    window.__st = st;
    window.io = function () {
      var h = {};
      var sock = { on: function (e, f) { h[e] = f; }, emit: function (e, p, cb) { if (cb) cb({ ok: true }); }, disconnect: function () {} };
      window.__push = function (i) { var v = JSON.parse(JSON.stringify(window.__st[i])); v.serverNow = Date.now(); h.state(v); };
      setTimeout(function () { if (h.connect) h.connect(); }, 0);
      return sock;
    };
  }, states);
  await pg.route('**/vendor/socket.io.min.js', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
  await pg.route('**/fonts.g*/**', (r) => r.abort());
  await pg.goto(PUBLIC + page + '.html?' + query);
  await pg.waitForTimeout(200);
  if (page === 'display') { await pg.keyboard.press('c'); await pg.keyboard.press('f'); await pg.keyboard.press('f'); } // fort contraste, effets coupes puis remis
  for (let i = 0; i < states.length; i++) {
    await pg.evaluate((n) => window.__push(n), i);
    await pg.waitForTimeout(40);
    const len = await pg.evaluate(() => (document.getElementById('app') || document.getElementById('stage') || document.body).textContent.trim().length);
    assert.ok(len > 0, `${page} : écran vide à l’état ${i}`);
  }
  await pg.close();
  return errs;
}

for (const [label, mode] of [['partie normale', null], ['3 joueurs, partie courte', { size: 3, years: 2 }], ['6 joueurs avec défi de saison', { size: 6, years: 3, challenge: true }]]) {
  test(`écrans : aucune erreur de script sur toute une partie (${label})`, { skip: !chromium && 'Playwright indisponible', timeout: 120000 }, async (t) => {
    let browser;
    try { browser = await chromium.launch(); } catch (e) { t.skip('Chromium indisponible'); return; }
    try {
      const sc = scenario(mode);
      const problems = [];
      for (const [page, query] of [['admin', 's=SMOK&k=x'], ['team', 's=SMOK&t=x'], ['display', 's=SMOK']]) {
        const errs = await playPage(browser, page, sc[page], query);
        if (errs.length) problems.push(page + ' : ' + errs[0]);
      }
      assert.deepEqual(problems, []);
    } finally { await browser.close(); }
  });
}
