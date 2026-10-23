'use strict';
// Convertit docs/regles.md et docs/guide.md en HTML pour la console animateur : public/guide.js
// Usage : node docs/build-guide.js
const fs = require('fs');
const path = require('path');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');

function convert(md) {
  const out = []; let list = false;
  const close = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line) { close(); continue; }
    if (line.startsWith('# ')) { close(); continue; } // le titre est porte par la fenetre
    if (line.startsWith('## ')) { close(); out.push('<h3>' + inline(line.slice(3)) + '</h3>'); continue; }
    if (line.startsWith('- ')) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inline(line.slice(2)) + '</li>'); continue; }
    close(); out.push('<p>' + inline(line) + '</p>');
  }
  close();
  return out.join('');
}

const rd = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const src = '// Fichier genere par docs/build-guide.js : ne pas modifier a la main (editer docs/*.md).\n' +
  'window.FFGuide = ' + JSON.stringify({ rules: convert(rd('regles.md')), guide: convert(rd('guide.md')) }) + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'public', 'guide.js'), src);
console.log('public/guide.js', src.length, 'octets');
