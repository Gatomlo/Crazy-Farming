'use strict';
// Sessions en memoire, sauvegardees en JSON (un fichier par session) pour survivre a un
// redemarrage de l'hebergement. Aucune base de donnees ni module natif : fonctionne partout.

const fs = require('fs');
const path = require('path');
const E = require('./engine');

const DIR = process.env.FF_DATA_DIR || path.join(__dirname, '..', 'data');
const MAX_SESSIONS = 500; // l'historique est conserve jusqu'a suppression par l'animateur
const sessions = new Map();
const timers = new Map();

function file(code) { return path.join(DIR, 'session-' + code + '.json'); }

function load() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) { /* ignore */ }
  let names = [];
  try { names = fs.readdirSync(DIR); } catch (e) { return; }
  for (const n of names) {
    if (!/^session-[A-Z]{4}\.json$/.test(n)) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
      // Un chrono qui tournait pendant l'arret est fige a sa valeur restante.
      if (s.timer && s.timer.running) { s.timer.remainingMs = Math.max(0, s.timer.endsAt - Date.now()); s.timer.running = false; }
      sessions.set(s.code, s);
    } catch (e) { console.error('Session illisible ignoree :', n, e.message); }
  }
}

function save(session) {
  session.updatedAt = Date.now();
  clearTimeout(timers.get(session.code));
  timers.set(session.code, setTimeout(() => {
    timers.delete(session.code);
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(file(session.code) + '.tmp', JSON.stringify(session));
      fs.renameSync(file(session.code) + '.tmp', file(session.code));
    } catch (e) { console.error('Sauvegarde impossible :', e.message); }
  }, 300));
}

function create(label) {
  if (sessions.size >= MAX_SESSIONS) throw new E.GameError('Trop de sessions actives sur ce serveur.');
  let code;
  do { code = E.newCode(); } while (sessions.has(code));
  const s = E.createSession(code);
  s.label = String(label || '').trim().slice(0, 60);
  sessions.set(code, s);
  save(s);
  return s;
}

function get(code) { return sessions.get(String(code || '').toUpperCase().slice(0, 4)) || null; }

function list() {
  return [...sessions.values()].map((s) => E.summary(s)).sort((a, b) => b.createdAt - a.createdAt);
}

function remove(code) {
  const c = String(code || '').toUpperCase().slice(0, 4);
  if (!sessions.has(c)) return false;
  sessions.delete(c);
  clearTimeout(timers.get(c)); timers.delete(c);
  try { fs.unlinkSync(file(c)); } catch (e) { /* deja absent */ }
  return true;
}

function rename(code, label) {
  const s = get(code);
  if (!s) return false;
  s.label = String(label || '').trim().slice(0, 60);
  save(s);
  return true;
}

load();

module.exports = { create, get, save, list, remove, rename };
