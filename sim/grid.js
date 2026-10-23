'use strict';
const D = require('../lib/data');
const { batch } = require('./sim');
const r2 = (x) => Math.round(x * 100) / 100;
function row(label, P, n = 300, strat = 'mix') {
  const b = batch(P, n, strat);
  console.log(label.padEnd(34), 'banqueMed', String(Math.round(b.bankMed)).padStart(5), 'p10', String(Math.round(b.bankP10)).padStart(5), 'p90', String(Math.round(b.bankP90)).padStart(5),
    '| s1', r2(b.s1), 's2', r2(b.s2), 's3', r2(b.s3), '| 3★', r2(b.p3), '0★', r2(b.p0), '| burn', r2(b.burn), 'boules+', r2(b.boulesAjoutees), 'tuiles', r2(b.tiles));
}
console.log('--- niveau de joueurs (seuil s3 = 2x capital)');
for (const m of [0.6, 0.7, 0.85, 1.0]) row('habilete ' + m, { skillMean: m });
console.log('--- seuil 3e etoile, joueurs moyens (0.85) et faibles (0.7)');
for (const k of [2, 2.5, 3, 3.5]) { row('s3 x' + k + ' (moy)', { s3mult: k }); row('s3 x' + k + ' (faibles)', { s3mult: k, skillMean: 0.7 }); }
console.log('--- nombre d equipes');
for (const n of [3, 5, 6]) row(n + ' equipes', { teams: n });
console.log('--- charges x1.5');
const C = Object.assign({}, D.CHARGES);
for (const k of Object.keys(D.CHARGES)) D.CHARGES[k] = Math.round(C[k] * 1.5);
row('charges x1.5', {}); row('charges x1.5 faibles', { skillMean: 0.7 });
Object.assign(D.CHARGES, C);
console.log('--- prix des tuiles x1.5');
const TP = Object.assign({}, D.TILE_PRICE); D.TILE_PRICE.owned = 55; D.TILE_PRICE.new = 120;
row('tuiles 55/120', {});
Object.assign(D.TILE_PRICE, TP);
console.log('--- prix de vente direct 8 / 12');
row('direct 8', { directPrice: 8 }); row('direct 12', { directPrice: 12 });
console.log('--- capital de depart');
const SB = D.START_BANK; for (const sb of [300, 400, 600]) { D.START_BANK = sb; row('capital ' + sb, {}); } D.START_BANK = SB;
console.log('--- fete: tolerance (le sim exige 100% des fermes)');
row('lenience 50% fetes', { pFeteLeniency: 0.5 });
console.log('--- strategies');
row('toutes prudentes', {}, 300, 'prudent'); row('toutes investisseuses', {}, 300, 'invest');
