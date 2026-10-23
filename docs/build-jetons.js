'use strict';
// Genere docs/jetons.html : planches A4 de jetons a imprimer (produits bruts + plats), a decouper a la main ou au laser.
// Usage : node docs/build-jetons.js [nbProduits=40] [nbParPlat=12]
const fs = require('fs');
const path = require('path');
const D = require('../lib/data');

const NB_RAW = parseInt(process.argv[2], 10) || 40;
const NB_DISH = parseInt(process.argv[3], 10) || 12;
const INK = '#3a2a1c';

const COL = Object.fromEntries(D.PRODUCTS.map((p) => [p.id, p.color]));
// Les plats de base prennent la couleur de leur produit ; les plats composes melangent leurs ingredients.
COL.fromage = COL.lait; COL.confiture = COL.fl; COL.saucisson = COL.viande;

const FG = '#1F1A17';

// Pictogrammes plats (viewBox 100x100) : formes pleines, sans contour, une seule couleur.
const ICONS = {
  lait: '<path fill-rule="evenodd" d="M30 40L50 20l20 20v42a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4zM38 54v14h24V54z"/>',
  oeuf: '<path d="M50 14C66 14 80 42 80 60a30 30 0 0 1-60 0C20 42 34 14 50 14z"/>',
  viande: '<ellipse cx="62" cy="38" rx="23" ry="19" transform="rotate(-40 62 38)"/><path d="M47 54L26 75" fill="none" stroke="#1F1A17" stroke-width="9" stroke-linecap="round"/><circle cx="19" cy="74" r="7"/><circle cx="27" cy="82" r="7"/>',
  fl: '<path d="M50 30C36 22 14 28 16 56c2 20 18 32 34 26 16 6 32-6 34-26 2-28-20-34-34-26z"/><path d="M52 26c0-10 6-16 16-18 1 10-5 16-16 18z"/>'
};
function icon(id, cx, cy, size, fill) {
  const k = size / 100;
  return `<g transform="translate(${cx - 50 * k} ${cy - 50 * k}) scale(${k})" fill="${fill || FG}">${ICONS[id]}</g>`;
}

// Jeton de produit brut : aplat de couleur, filet interieur, gros pictogramme, nom en capitales espacees.
function rawToken(p, d) {
  const lines = p.short.split('|');
  return `<svg class="tok" width="${d}mm" height="${d}mm" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="50" fill="${p.color}"/>
    <circle cx="50" cy="50" r="44" fill="none" stroke="${FG}" stroke-opacity=".22" stroke-width="1.6"/>
    ${icon(p.id, 50, lines.length > 1 ? 38 : 40, 54)}
    ${lines.map((l, i) => `<text x="50" y="${(lines.length > 1 ? 72 : 78) + i * 9}" text-anchor="middle" font-size="${lines.length > 1 ? 8.5 : 9.5}" font-weight="800" letter-spacing="2" fill="${FG}">${l}</text>`).join('')}</svg>`;
}

// Jeton de plat : disque partage en couleurs d'ingredients, coeur blanc, nom, produits utilises, niveau (pastilles pleines / vides).
function dishToken(dish, d) {
  const prods = [];
  const walk = (req) => Object.keys(req).forEach((k) => {
    if (D.PRODUCTS.some((p) => p.id === k)) { if (!prods.includes(k)) prods.push(k); }
    else { const sub = D.DISHES.find((x) => x.id === k); if (sub) walk(sub.req); }
  });
  walk(dish.req);
  const cols = prods.map((k) => COL[k]);
  const n = cols.length, R = 50;
  const pt = (a, r) => [50 + r * Math.cos(a), 50 + r * Math.sin(a)].map((v) => v.toFixed(2)).join(' ');
  let ring = '';
  cols.forEach((c, i) => {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    ring += n === 1 ? `<circle cx="50" cy="50" r="${R}" fill="${c}"/>` : `<path d="M50 50L${pt(a0, R)}A${R} ${R} 0 0 1 ${pt(a1, R)}Z" fill="${c}"/>`;
  });
  const words = dish.name.split(' ');
  const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words.length === 2 && dish.name.length > 9 ? words : [dish.name];
  const fs = lines.some((x) => x.length > 11) ? 7.2 : lines.length > 1 ? 8.6 : 9.6;
  const text = lines.map((l, i) => `<text x="50" y="${(lines.length === 1 ? 57 : 52 + i * 9.5)}" text-anchor="middle" font-size="${fs}" font-weight="800" fill="${FG}">${l}</text>`).join('');
  const sz = 20, gap = 3;
  const mini = prods.map((k, i) => icon(k, 50 + (i - (prods.length - 1) / 2) * (sz + gap), 35, sz)).join('');
  const dots = [0, 1, 2].map((i) => `<circle cx="${50 + (i - 1) * 7.5}" cy="72" r="2.4" fill="${i < dish.tier ? FG : 'none'}" stroke="${FG}" stroke-width="1.1"/>`).join('');
  return `<svg class="tok" width="${d}mm" height="${d}mm" viewBox="0 0 100 100">${ring}
    <circle cx="50" cy="50" r="32" fill="#fff"/>
    ${mini}${text}${dots}</svg>`;
}

const SHORT = { lait: 'LAIT', oeuf: 'ŒUFS', viande: 'VIANDE', fl: 'FRUITS &|LÉGUMES' };
const prods = D.PRODUCTS.map((p) => ({ ...p, short: SHORT[p.id] }));
const sheet = (title, sub, body) => `<section class="page"><h2>${title}</h2><p>${sub}</p><div class="grid">${body}</div></section>`;
const rep = (html, n) => Array.from({ length: n }, () => html).join('');

const pages = prods.map((p) => sheet(`Jetons ${p.name}`, `${NB_RAW} jetons · Ø 30 mm · à découper`, rep(rawToken(p, 30), NB_RAW)))
  .concat(sheet('Jetons de plats', `${NB_DISH} par plat · Ø 40 mm · 1 pastille = simple, 2 = mixte, 3 = composé · couleurs = produits d'origine`,
    D.DISHES.map((x) => rep(dishToken(x, 40), NB_DISH)).join('')));

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jetons — Farming's Folies</title>
<style>
@page { size: A4; margin: 10mm; }
body { margin: 0; font-family: system-ui, "Segoe UI", sans-serif; background: #eee; color: ${INK}; }
.page { width: 190mm; min-height: 277mm; margin: 8mm auto; padding: 0; background: #fff; box-sizing: border-box; page-break-after: always; break-after: page; }
h2 { margin: 0 0 2mm; font-size: 6mm; } p { margin: 0 0 4mm; font-size: 3.4mm; color: #7a6a58; }
.grid { display: flex; flex-wrap: wrap; gap: 2mm; align-content: flex-start; }
.tok { display: block; }
@media print { body { background: #fff; } .page { margin: 0; width: auto; } p { color: #555; } }
</style></head><body>${pages.join('')}</body></html>`;

fs.writeFileSync(path.join(__dirname, 'jetons.html'), html);
console.log('docs/jetons.html : ' + prods.length + ' produits x ' + NB_RAW + ', ' + D.DISHES.length + ' plats x ' + NB_DISH);
