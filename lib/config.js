'use strict';
// Reglages de l'application communs a toutes les parties : effets des niveaux de stress (lib/data.js : STRESS_LEVELS).
// Sauvegardes dans data/config.json ; modifiables depuis l'accueil du maire du village (Reglages).
const fs = require('fs');
const path = require('path');
const D = require('./data');

const DIR = process.env.FF_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'config.json');
const DEFAULTS = D.STRESS_DEFAULTS;
const LIMITS = { runSec: [-60, 60], chargesPct: [-50, 50] };

class ConfigError extends Error {}

// Verifie une saisie et retourne { Zen: { title, text, runSec, chargesPct }, ... } complete.
function clean(input) {
  const out = {};
  for (const lvl of Object.keys(DEFAULTS)) {
    const x = (input && input[lvl]) || {};
    const cur = D.STRESS_LEVELS[lvl];
    const title = x.title === undefined ? cur.title : String(x.title).trim();
    const text = x.text === undefined ? cur.text : String(x.text).trim();
    if (!title || title.length > 40) throw new ConfigError(`${lvl} : titre de 1 à 40 caractères.`);
    if (!text || text.length > 400) throw new ConfigError(`${lvl} : texte de 1 à 400 caractères.`);
    const num = (k, step) => {
      const v = x[k] === undefined ? cur.effects[k] : x[k];
      if (!Number.isInteger(v) || v < LIMITS[k][0] || v > LIMITS[k][1] || v % step) throw new ConfigError(`${lvl} : ${k === 'runSec' ? 'secondes de course (multiple de 5, de −60 à 60)' : 'charges en % (entier, de −50 à 50)'}.`);
      return v;
    };
    out[lvl] = { title, text, runSec: num('runSec', 5), chargesPct: num('chargesPct', 1) };
  }
  return out;
}

function apply(levels) {
  for (const lvl of Object.keys(levels)) {
    const l = levels[lvl];
    Object.assign(D.STRESS_LEVELS[lvl], { title: l.title, text: l.text, effects: { runSec: l.runSec, chargesPct: l.chargesPct } });
  }
}

function write(levels) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify({ stressLevels: levels }));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { console.error('Reglages non sauvegardes :', e.message); }
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (j && j.stressLevels) apply(clean(j.stressLevels));
  } catch (e) { /* aucun reglage sauvegarde, ou fichier illisible : valeurs par defaut */ }
}

const flat = (src) => Object.fromEntries(Object.keys(src).map((k) => [k, { icon: src[k].icon, title: src[k].title, text: src[k].text, runSec: src[k].effects ? src[k].effects.runSec : src[k].runSec, chargesPct: src[k].effects ? src[k].effects.chargesPct : src[k].chargesPct }]));
const view = () => ({ levels: flat(D.STRESS_LEVELS), defaults: flat(DEFAULTS), limits: LIMITS });
function setStress(input) { const levels = clean(input); apply(levels); write(levels); return view(); }
function resetStress() { apply(clean(flat(DEFAULTS))); try { fs.unlinkSync(FILE); } catch (e) { /* deja absent */ } return view(); }

module.exports = { load, view, setStress, resetStress, ConfigError };
