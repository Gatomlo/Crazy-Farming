'use strict';
// Reglages de l'application communs a toutes les parties : titres, textes et gages physiques des niveaux de stress (lib/data.js : STRESS_LEVELS).
// Sauvegardes dans data/config.json ; modifiables depuis l'accueil du maire du village (Reglages).
const fs = require('fs');
const path = require('path');
const D = require('./data');

const DIR = process.env.FF_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'config.json');
const DEFAULTS = D.STRESS_DEFAULTS;
const MAX_GAGES = 12, MAX_GAGE_LEN = 200;

class ConfigError extends Error {}

// Verifie une saisie et retourne { Zen: { title, text, gages: [...] }, ... } complete (un niveau non precise reste inchange).
function clean(input) {
  const out = {};
  for (const lvl of Object.keys(DEFAULTS)) {
    const x = (input && input[lvl]) || {};
    const cur = D.STRESS_LEVELS[lvl];
    const title = x.title === undefined ? cur.title : String(x.title).trim();
    const text = x.text === undefined ? cur.text : String(x.text).trim();
    if (!title || title.length > 40) throw new ConfigError(`${lvl} : titre de 1 à 40 caractères.`);
    if (!text || text.length > 400) throw new ConfigError(`${lvl} : texte de 1 à 400 caractères.`);
    let gages = x.gages === undefined ? cur.gages : x.gages;
    if (!Array.isArray(gages)) throw new ConfigError(`${lvl} : les gages forment une liste.`);
    gages = gages.map((g) => String(g).trim()).filter(Boolean);
    if (gages.length > MAX_GAGES) throw new ConfigError(`${lvl} : ${MAX_GAGES} gages au plus.`);
    if (gages.some((g) => g.length > MAX_GAGE_LEN)) throw new ConfigError(`${lvl} : chaque gage fait ${MAX_GAGE_LEN} caractères au plus.`);
    out[lvl] = { title, text, gages };
  }
  return out;
}

function apply(levels) {
  for (const lvl of Object.keys(levels)) Object.assign(D.STRESS_LEVELS[lvl], { title: levels[lvl].title, text: levels[lvl].text, gages: levels[lvl].gages.slice() });
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

const flat = (src) => Object.fromEntries(Object.keys(src).map((k) => [k, { icon: src[k].icon, title: src[k].title, text: src[k].text, gages: src[k].gages.slice() }]));
const view = () => ({ levels: flat(D.STRESS_LEVELS), defaults: flat(DEFAULTS), limits: { gages: MAX_GAGES, gageLength: MAX_GAGE_LEN } });
function setStress(input) { const levels = clean(input); apply(levels); write(levels); return view(); }
function resetStress() { apply(clean(flat(DEFAULTS))); try { fs.unlinkSync(FILE); } catch (e) { /* deja absent */ } return view(); }

module.exports = { load, view, setStress, resetStress, ConfigError };
