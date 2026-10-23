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

const light = (hex, k) => '#' + [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16); return Math.round(v + (255 - v) * k).toString(16).padStart(2, '0'); }).join('');
const OL = `stroke="${INK}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"`;

// Pictogrammes "autocollant" (viewBox 100x100) : aplats colores, gros contour, reflet.
const ICONS = {
  lait: `<rect x="40" y="14" width="20" height="14" rx="3" fill="#E04F4F" ${OL}/>
    <path d="M40 28h20l10 16v40a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6V44z" fill="#fff" ${OL}/>
    <rect x="30" y="52" width="40" height="20" fill="#6BB6F0" stroke="${INK}" stroke-width="3"/>
    <path d="M38 36l-4 8" stroke="#cfe6f7" stroke-width="3.5" stroke-linecap="round"/>`,
  oeuf: `<path d="M50 12C66 12 80 40 80 60a30 30 0 0 1-60 0C20 40 34 12 50 12z" fill="#FFFDF5" ${OL}/>
    <path d="M33 50c2-10 7-20 12-25" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".9"/>
    <path d="M28 66c2 8 9 14 18 15" fill="none" stroke="#E9C27A" stroke-width="3.5" stroke-linecap="round"/>`,
  viande: `<path d="M58 20c14-6 28 6 24 20-3 10-13 15-22 14l-6 1-16 16-5-5 15-17 1-6c-1-9 2-18 9-23z" fill="#C2543E" ${OL}/>
    <circle cx="68" cy="34" r="6" fill="#E08A70" stroke="${INK}" stroke-width="2.6"/>
    <path d="M32 62l-8 8" stroke="#FFF4D8" stroke-width="9" stroke-linecap="round"/><path d="M32 62l-8 8" stroke="${INK}" stroke-width="3" stroke-linecap="round" opacity=".0"/>
    <circle cx="22" cy="74" r="6.5" fill="#FFF4D8" ${OL}/><circle cx="30" cy="80" r="6.5" fill="#FFF4D8" ${OL}/>`,
  fl: `<path d="M50 30C26 24 14 44 22 64c6 16 20 22 28 18 8 4 22-2 28-18 8-20-4-40-28-34z" fill="#E4503E" ${OL}/>
    <path d="M50 30c0-8 2-14 8-18" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/>
    <path d="M54 20c8-8 20-6 24 0-8 6-18 6-24 0z" fill="#4E9A34" ${OL}/>
    <path d="M30 48c-3 5-3 11-1 16" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" opacity=".85"/>`
};
function icon(id, cx, cy, size) {
  const k = size / 100;
  return `<g transform="translate(${cx - 50 * k} ${cy - 50 * k}) scale(${k})">${ICONS[id]}</g>`;
}

// Bord crante + face bombee (degrade) : donne l'allure d'une vraie piece.
function coin(key, base) {
  return `<defs><radialGradient id="g-${key}" cx="35%" cy="28%" r="85%"><stop offset="0" stop-color="${light(base, .55)}"/><stop offset=".55" stop-color="${base}"/><stop offset="1" stop-color="${shade(base, .82)}"/></radialGradient></defs>
    <circle cx="50" cy="50" r="49" fill="${shade(base, .62)}"/>
    <circle cx="50" cy="50" r="46.2" fill="none" stroke="${light(base, .35)}" stroke-width="4.4" stroke-dasharray="2.1 1.7"/>
    <circle cx="50" cy="50" r="42.5" fill="${shade(base, .62)}"/>
    <circle cx="50" cy="50" r="41" fill="url(#g-${key})"/>
    <path d="M17 38A36 36 0 0 1 50 14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/>`;
}

// Jeton de produit brut : piece coloree, gros pictogramme, nom en bandeau.
function rawToken(p, d) {
  const lines = p.short.split('|');
  return `<svg class="tok" width="${d}mm" height="${d}mm" viewBox="0 0 100 100">${coin(p.id, p.color)}
    ${icon(p.id, 50, 46, 56)}
    <rect x="22" y="${lines.length > 1 ? 66 : 70}" width="56" height="${lines.length > 1 ? 21 : 14}" rx="7" fill="${INK}"/>
    ${lines.map((l, i) => `<text x="50" y="${(lines.length > 1 ? 76 : 80) + i * 9}" text-anchor="middle" font-size="${lines.length > 1 ? 8.5 : 10}" font-weight="800" letter-spacing=".8" fill="#fff9ec">${l}</text>`).join('')}</svg>`;
}

// Jeton de plat : bord crante partage en couleurs d'ingredients, coeur creme, nom, produits utilises et niveau.
function dishToken(dish, d) {
  const prods = [];
  const walk = (req) => Object.keys(req).forEach((k) => {
    if (D.PRODUCTS.some((p) => p.id === k)) { if (!prods.includes(k)) prods.push(k); }
    else { const sub = D.DISHES.find((x) => x.id === k); if (sub) walk(sub.req); }
  });
  walk(dish.req);
  const cols = prods.map((k) => COL[k]);
  const n = cols.length, R = 49;
  const pt = (a, r) => [50 + r * Math.cos(a), 50 + r * Math.sin(a)].map((v) => v.toFixed(2)).join(' ');
  let ring = '';
  cols.forEach((c, i) => {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    ring += n === 1 ? `<circle cx="50" cy="50" r="${R}" fill="${c}"/>` : `<path d="M50 50L${pt(a0, R)}A${R} ${R} 0 0 1 ${pt(a1, R)}Z" fill="${c}"/>`;
    if (n > 1) ring += `<path d="M50 50L${pt(a0, R)}" stroke="${INK}" stroke-width="1.6"/>`;
  });
  const words = dish.name.split(' ');
  const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words.length === 2 && dish.name.length > 9 ? words : [dish.name];
  const fs = lines.some((x) => x.length > 11) ? 7 : lines.length > 1 ? 8.5 : 9.5;
  const text = lines.map((l, i) => `<text x="50" y="${(lines.length === 1 ? 57 : 52 + i * 9.5)}" text-anchor="middle" font-size="${fs}" font-weight="800" fill="${INK}">${l}</text>`).join('');
  const sz = 19, gap = 1;
  const mini = prods.map((k, i) => icon(k, 50 + (i - (prods.length - 1) / 2) * (sz + gap), 36, sz)).join('');
  const dots = Array.from({ length: dish.tier }, (_, i) => `<circle cx="${50 + (i - (dish.tier - 1) / 2) * 7.5}" cy="72" r="2.8" fill="#C2543E" stroke="${INK}" stroke-width="1.2"/>`).join('');
  return `<svg class="tok" width="${d}mm" height="${d}mm" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="49.5" fill="${INK}"/>${ring}
    <circle cx="50" cy="50" r="47" fill="none" stroke="${INK}" stroke-width="1.6"/>
    <circle cx="50" cy="50" r="44.5" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="2.1 1.7" opacity=".7"/>
    <circle cx="50" cy="50" r="30" fill="#FFF6E6" stroke="${INK}" stroke-width="2.4"/>
    <circle cx="50" cy="50" r="27.5" fill="none" stroke="#E9C27A" stroke-width="1" stroke-dasharray="1.5 2"/>
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
