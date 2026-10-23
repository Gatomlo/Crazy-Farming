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
const shade = (hex, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');

// Pictogrammes simples (viewBox 24x24, centres)
const ICONS = {
  lait: '<path d="M12 3c3 4.5 6 7.2 6 10.5A6 6 0 0 1 6 13.5C6 10.2 9 7.5 12 3z"/>',
  oeuf: '<ellipse cx="12" cy="13" rx="6" ry="7.5"/>',
  viande: '<ellipse cx="14" cy="9.5" rx="7" ry="6" transform="rotate(-35 14 9.5)"/><path d="M9.5 13.5L5 18" fill="none" stroke-width="2.6" stroke-linecap="round"/><circle cx="4" cy="18" r="1.8"/><circle cx="6" cy="20" r="1.8"/>',
  fl: '<path d="M5 19C4 10 9 4 19 5c1 10-5 15-14 14zM5 19l8-8" fill-rule="evenodd"/>'
};
function icon(id, x, y, size, fill) {
  const k = size / 24;
  return `<g transform="translate(${x - size / 2} ${y - size / 2}) scale(${k})" fill="${fill}" stroke="${INK}" stroke-width="${1.2}" stroke-linejoin="round">${ICONS[id]}</g>`;
}

// Jeton de produit brut : disque colore, anneau fonce, pointilles, pictogramme + nom.
function rawToken(p, d) {
  const r = d / 2;
  return `<svg class="tok" width="${d}mm" height="${d}mm" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="49" fill="${p.color}" stroke="${shade(p.color, .55)}" stroke-width="2"/>
    <circle cx="50" cy="50" r="42" fill="none" stroke="${shade(p.color, .55)}" stroke-width="1.5" stroke-dasharray="3 3.5"/>
    ${icon(p.id, 50, 44, 40, '#fff')}
    ${p.short.split('|').map((l, i, a) => `<text x="50" y="${(a.length > 1 ? 76 : 82) + i * 11}" text-anchor="middle" font-size="11" font-weight="800" letter-spacing="1" fill="${INK}">${l}</text>`).join('')}</svg>`;
}

// Jeton de plat : anneau partage en couleurs d'ingredients, coeur creme avec nom, pastilles de niveau.
function dishToken(dish, d) {
  const prods = [];
  const walk = (req) => Object.keys(req).forEach((k) => {
    if (COL[k] && D.PRODUCTS.some((p) => p.id === k)) { if (!prods.includes(k)) prods.push(k); }
    else { const sub = D.DISHES.find((x) => x.id === k); if (sub) walk(sub.req); }
  });
  walk(dish.req);
  const cols = prods.map((k) => COL[k]);
  let ring = '';
  const n = cols.length, R = 49;
  cols.forEach((c, i) => {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    const pt = (a) => [50 + R * Math.cos(a), 50 + R * Math.sin(a)].map((v) => v.toFixed(2)).join(' ');
    ring += n === 1 ? `<circle cx="50" cy="50" r="${R}" fill="${c}"/>` : `<path d="M50 50 L${pt(a0)} A${R} ${R} 0 ${1 / n > .5 ? 1 : 0} 1 ${pt(a1)} Z" fill="${c}"/>`;
  });
  const words = dish.name.split(' ');
  const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words.length === 2 && dish.name.length > 9 ? words : [dish.name];
  const text = lines.map((l, i) => `<text x="50" y="${(lines.length === 1 ? 52 : 47 + i * 12)}" text-anchor="middle" font-size="${lines.some((x) => x.length > 11) ? 8 : 10}" font-weight="800" fill="${INK}">${l}</text>`).join('');
  const dots = Array.from({ length: dish.tier }, (_, i) => `<circle cx="${50 + (i - (dish.tier - 1) / 2) * 9}" cy="72" r="3.2" fill="${INK}"/>`).join('');
  return `<svg class="tok" width="${d}mm" height="${d}mm" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="49" fill="#fff" stroke="${INK}" stroke-width="2"/>
    ${ring}
    <circle cx="50" cy="50" r="49" fill="none" stroke="${INK}" stroke-width="2"/>
    <circle cx="50" cy="50" r="32" fill="#FFF6E6" stroke="${INK}" stroke-width="1.5"/>
    ${text}${dots}</svg>`;
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
