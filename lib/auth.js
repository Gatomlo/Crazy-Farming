'use strict';
// Acces animateur : un mot de passe unique et partage (meme politique que The Big Team Quiz).
//  - Installation vierge : aucun mot de passe. La premiere visite de la page d'accueil demande de le creer (POST /api/setup).
//  - Option : FF_ADMIN_PASSWORD (variable d'environnement) impose un mot de passe initial et saute cette creation.
//  - Une fois change depuis l'interface, seule l'empreinte salee (scrypt) est stockee, jamais le mot de passe.
//  - 5 echecs par IP => verrouillage 5 minutes (login ET changement de mot de passe partagent le compteur).
//  - La connexion donne un jeton signe (HMAC) a duree limitee, exige pour toutes les routes et pour la console temps reel.
// Aucune dependance npm : module crypto natif.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = process.env.FF_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'settings.json');
const TOKEN_TTL_MS = 12 * 3600 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

let settings = null;
function read() {
  if (settings) return settings;
  try { settings = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { settings = {}; }
  if (!settings.secret) { settings.secret = crypto.randomBytes(32).toString('hex'); write(); }
  return settings;
}
function write() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(settings));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { console.error('Reglages non sauvegardes :', e.message); }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyHash(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const cand = crypto.scryptSync(pw, salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === cand.length && crypto.timingSafeEqual(ref, cand);
}
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function checkPassword(pw) {
  if (typeof pw !== 'string' || !pw) return false;
  const s = read();
  if (s.passwordHash) return verifyHash(pw, s.passwordHash);
  return !!process.env.FF_ADMIN_PASSWORD && safeEqual(pw, process.env.FF_ADMIN_PASSWORD);
}

// Vrai tant que personne n'a cree le mot de passe animateur (ni variable d'environnement).
function needsSetup() { return !read().passwordHash && !process.env.FF_ADMIN_PASSWORD; }

// Creation du mot de passe a la premiere connexion : possible une seule fois.
function setup(ip, password) {
  if (!needsSetup()) return { ok: false, error: 'already_setup', status: 403 };
  if (typeof password !== 'string' || password.length < 6) return { ok: false, error: 'weak_password', status: 400 };
  const s = read();
  s.passwordHash = hashPassword(password);
  s.secret = crypto.randomBytes(32).toString('hex');
  write();
  return { ok: true, token: issueToken() };
}

// ---- limitation des tentatives (en memoire, par IP) ----
const attempts = new Map();
function isLocked(ip) { const e = attempts.get(ip); return !!e && e.lockedUntil > Date.now(); }
function lockSeconds(ip) { const e = attempts.get(ip); return e ? Math.max(0, Math.ceil((e.lockedUntil - Date.now()) / 1000)) : 0; }
function fail(ip) {
  const e = attempts.get(ip) || { count: 0, lockedUntil: 0 };
  e.count += 1;
  if (e.count >= MAX_ATTEMPTS) { e.lockedUntil = Date.now() + LOCKOUT_MS; e.count = 0; }
  attempts.set(ip, e);
}

// ---- jetons signes ----
function sign(payload) { return crypto.createHmac('sha256', read().secret).update(payload).digest('hex'); }
function issueToken(now = Date.now()) {
  const exp = String(now + TOKEN_TTL_MS);
  return exp + '.' + sign(exp);
}
function verifyToken(token, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return safeEqual(sig, sign(exp));
}
function expiry(token) { return Number(String(token).split('.')[0]) || 0; }

// ---- operations ----
function login(ip, password) {
  if (isLocked(ip)) return { ok: false, error: 'locked', retryAfterSeconds: lockSeconds(ip), status: 429 };
  if (!checkPassword(password)) { fail(ip); return { ok: false, error: 'bad_password', status: 401 }; }
  attempts.delete(ip);
  return { ok: true, token: issueToken() };
}

function changePassword(ip, current, next) {
  if (isLocked(ip)) return { ok: false, error: 'locked', retryAfterSeconds: lockSeconds(ip), status: 429 };
  if (typeof next !== 'string' || next.length < 6) return { ok: false, error: 'weak_password', status: 400 };
  if (!checkPassword(current)) { fail(ip); return { ok: false, error: 'bad_password', status: 401 }; }
  attempts.delete(ip);
  const s = read();
  s.passwordHash = hashPassword(next);
  s.secret = crypto.randomBytes(32).toString('hex'); // invalide les jetons emis avec l'ancien mot de passe
  write();
  return { ok: true, token: issueToken() };
}

function bearer(req) {
  const h = req.headers && req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7) : null;
}
function require_(req, res, next) {
  if (verifyToken(bearer(req))) return next();
  res.status(401).json({ error: 'Connexion requise.' });
}

function usingDefault() { return !read().passwordHash; }
function reset() { settings = null; attempts.clear(); }

module.exports = { login, setup, needsSetup, changePassword, verifyToken, issueToken, expiry, requireAdmin: require_, usingDefault, bearer, reset };
