// Utilitaires partages par les ecrans. Tous les chemins sont RELATIFS au prefixe de montage
// (node-gateway monte l'app sous /<nom> ; en autonome le prefixe est vide).
(function () {
  var BASE = location.pathname.replace(/\/(admin|display|team)?\/?$/, '');
  var qs = new URLSearchParams(location.search);

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(ms) {
    var s = Math.ceil(Math.max(0, ms) / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // Temps restant "maintenant" : le serveur envoie la valeur au moment de l'envoi, on retire le temps ecoule.
  function remaining(v) {
    if (!v) return 0;
    return v.timer.running ? Math.max(0, v.timer.remainingMs - (Date.now() - v._rcv)) : v.timer.remainingMs;
  }

  // Temps restant sans plancher a zero : negatif apres la fin du chrono tant qu'il tourne.
  function rawRemaining(v) {
    if (!v.timer.running) return v.timer.remainingMs;
    return (v.timer.rawMs !== undefined ? v.timer.rawMs : v.timer.remainingMs) - (Date.now() - v._rcv);
  }
  // Temps ecoule depuis le depart du chrono (continue apres zero tant que le chrono tourne : bonus de temps, produits les plus longs).
  function elapsed(v) {
    if (!v) return 0;
    return v.timer.durationMs - rawRemaining(v);
  }
  // Decompte d'un produit : el porte data-run (secondes de course). Etats : idle (avant le depart), go, low (10 dernieres secondes), stop.
  function paintProd(el, v, vibrate) {
    var run = parseInt(el.getAttribute('data-run'), 10) * 1000;
    if (!run) { el.textContent = '—'; el.className = el.className.replace(/ ?pc-\w+/g, '') + ' pc-idle'; return; }
    var rem = rawRemaining(v);
    var state, left = run - elapsed(v);
    if (!v.timer.running && rem >= v.timer.durationMs) { state = 'idle'; left = run; }
    else if (left > 0) state = left <= 10000 ? 'low' : 'go';
    else state = 'stop';
    el.textContent = state === 'stop' ? '✋ STOP' : fmt(left);
    el.className = el.className.replace(/ ?pc-\w+/g, '') + ' pc-' + state;
    var row = el.closest('[data-prow]');
    if (row) row.classList.toggle('pc-row-stop', state === 'stop');
    var key = v.code + '.' + v.year + '.' + v.season + '.' + el.getAttribute('data-pid'), seen = paintProd.seen = paintProd.seen || {};
    if (state === 'stop' && !seen[key]) { seen[key] = true; if (vibrate) { try { navigator.vibrate([400, 150, 400]); } catch (e) { /* pas de vibration */ } } }
    if (state !== 'stop') seen[key] = false;
  }

  // Aide courte par etape (bouton « ? » des mobiles et de la console).
  var HELP = [
    ['Aléa', 'Une carte tombe sur le village. Négative : chaque ferme choisit de subir l\'effet, de jouer sa parade (si elle a le matériel) ou d\'ajouter 1 stress pour l\'éviter. Positive : rien à faire. Aléa collectif : tout le village doit réunir un objectif avant l\'échéance, sans choix individuel. Si vous avez acheté des activités complémentaires, lancez le dé de chacune : 1 = elle ne fonctionne pas, 2 à 6 = effet de plus en plus fort.'],
    ['Récolte en relais', 'Un coureur par tuile. Chaque produit a sa durée de course, avec un décompte et un STOP. Un trajet = un jeton rapporté = une ressource en stock, sans plafond. Comptez vos jetons avec + et −, puis encodez-les. Le coup de collier (+1 stress) et le tracteur ajoutent du temps de course : seules les fermes qui y ont droit continuent de courir.'],
    ['Transformation et bourse', 'Demandez vos recettes (1 par saison, 4 de plus par atelier) : le maire du village échange vos jetons contre des plats, qui valent 3, 4 ou 5 fois un produit brut. Les cases grisées manquent d\'ingrédients. Échangez avec les autres fermes depuis le mobile, produits contre produits ou contre des EB : tout accord est définitif. Les matières brutes ni transformées ni vendues sont perdues en fin de saison.'],
    ['Marché', 'Placez d\'abord vos produits, puis tournez la roue. Grande distribution : 7 EB le produit brut, toujours payé. Étal : 14 EB, mais la roue décide de la part vendue, et le goût du moment ajoute ou retire 25 points. Les invendus de l\'étal sont perdus. Vos activités (gîte, magasin, restaurant) peuvent sauver une partie de l\'étal.'],
    ['Achats et vacances', 'Remplissez votre panier à la boutique, puis validez-le : matériel, vacances (30 EB par voyageur, −1 stress, mais le voyageur ne court pas la saison suivante). Les agrandissements et activités ne s\'achètent qu\'à l\'installation et en fin d\'année. Regardez la météo de la saison suivante : elle n\'est juste que 7 fois sur 10.']
  ];
  function showHelp(step) {
    var h = HELP[step];
    if (!h) return;
    var old = document.getElementById('helpModal'); if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'helpModal'; el.className = 'help-modal'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Aide : ' + h[0]);
    el.innerHTML = '<div class="help-box"><div class="eyebrow">Étape ' + (step + 1) + ' sur 5</div><h2 style="font-size:36px;margin:2px 0 8px">' + esc(h[0]) + '</h2><p style="margin:0 0 14px;line-height:1.45">' + esc(h[1]) + '</p><button class="btn primary block" data-help-close="1">Compris</button></div>';
    el.addEventListener('click', function (e) { if (e.target === el || (e.target.dataset && e.target.dataset.helpClose)) el.remove(); });
    document.body.appendChild(el);
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'alert'); document.body.appendChild(el); }
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.display = 'none'; }, 4000);
  }

  function setOffline(on) {
    var el = document.getElementById('offline');
    if (!el && on) { el = document.createElement('div'); el.id = 'offline'; el.className = 'offline'; el.textContent = 'Connexion perdue, reconnexion…'; document.body.appendChild(el); }
    if (el) el.style.display = on ? 'block' : 'none';
  }

  // Re-affiche un conteneur sans perdre ce que l'utilisateur est en train de saisir.
  function keepInputs(root, draw) {
    var saved = {};
    root.querySelectorAll('input[id], select[id]').forEach(function (el) { saved[el.id] = el.value; });
    var active = document.activeElement && document.activeElement.id;
    var sel = active && document.activeElement.selectionStart != null ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    var open = {};
    root.querySelectorAll('details[id]').forEach(function (d) { open[d.id] = d.open; });
    draw();
    Object.keys(saved).forEach(function (id) { var el = document.getElementById(id); if (el && saved[id] !== '') el.value = saved[id]; });
    Object.keys(open).forEach(function (id) { var d = document.getElementById(id); if (d) d.open = open[id]; });
    if (active) {
      var a = document.getElementById(active);
      if (a) { a.focus(); if (sel && a.setSelectionRange) { try { a.setSelectionRange(sel[0], sel[1]); } catch (e) { /* champ sans selection */ } } }
    }
  }

  function connect(opts) {
    var socket = io({ path: BASE + '/socket.io' });
    function join() {
      socket.emit('join', { role: opts.role, code: opts.code, token: opts.token }, function (r) {
        if (!r || !r.ok) { opts.onFatal((r && r.error) || 'Connexion refusée.'); socket.disconnect(); } else { setOffline(false); }
      });
    }
    socket.on('connect', join);
    socket.on('disconnect', function () { setOffline(true); });
    socket.on('state', function (v) { v._rcv = Date.now(); opts.onState(v); });
    return {
      socket: socket,
      act: function (type, extra) {
        return new Promise(function (resolve) {
          socket.emit('act', Object.assign({ type: type }, extra || {}), function (r) {
            if (r && !r.ok) toast(r.error);
            resolve(r);
          });
        });
      }
    };
  }

  function dots(n, max) {
    var h = '';
    for (var i = 0; i < max; i++) h += '<span class="dot' + (i < n ? ' on' : '') + '"></span>';
    return '<div class="dots" role="img" aria-label="' + n + ' points de stress sur ' + max + '">' + h + '</div>';
  }

  // Il n'existe pas d'emoji de brouette ni d'etal de marche : deux petits dessins en ligne.
  var SVG_BARROW = '<svg viewBox="0 0 64 64" width="1.15em" height="1.15em" aria-hidden="true" style="vertical-align:-.2em"><path d="M10 20h36l-6 18H18z" fill="#c98a3d" stroke="#6b4423" stroke-width="3" stroke-linejoin="round"/><path d="M10 20 2 34M18 38l-4 14M40 38l6 8" stroke="#6b4423" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="48" cy="47" r="9" fill="#3a3a3a"/><circle cx="48" cy="47" r="3.5" fill="#d9d9d9"/><circle cx="26" cy="15" r="4" fill="#e0443a"/><circle cx="34" cy="14" r="4" fill="#8fd36b"/><circle cx="41" cy="16" r="3.5" fill="#f2b63d"/></svg>';
  var SVG_STALL = '<svg viewBox="0 0 64 64" width="1.15em" height="1.15em" aria-hidden="true" style="vertical-align:-.2em"><path d="M5 12h54l-5 15H10z" fill="#e0443a"/><path d="M16 12l-2 15M27 12l-1 15M37 12l1 15M48 12l2 15" stroke="#fff" stroke-width="4" fill="none"/><rect x="8" y="34" width="48" height="6" rx="1.5" fill="#8a5a2b"/><rect x="12" y="40" width="5" height="18" fill="#6b4423"/><rect x="47" y="40" width="5" height="18" fill="#6b4423"/><circle cx="21" cy="30" r="3.5" fill="#f2b63d"/><circle cx="29" cy="30" r="3.5" fill="#8fd36b"/><circle cx="37" cy="30" r="3.5" fill="#f29cb0"/></svg>';

  // Icones (emoji : aucune dependance, rendu chaleureux sur tous les appareils)
  var ICON = {
    lait: '🥛', oeuf: '🥚', viande: '🥩', fl: '🥕', atelier: '🍳', activite: '🎪',
    seasons: ['🌱', '☀️', '🍂', '❄️'], steps: ['🎴', '🧺', '🍳', '🏪', '🛒'],
    level: { Zen: '😌', Agité: '😬', Stressé: '🤯' }, bank: '💰', fete: '🎉', clock: '⏱️', farm: '🚜',
    equip: { chien: '🐕', serre: '🌿', arrosage: '🚿', lampe: '🔦', panier: '🧺', brouette: SVG_BARROW, tracteur: '🚜', hamac: '🛌', camionnette: '🚐', table: SVG_STALL, vacance: '🏖️' },
    act: { gite: '🛏️', magasin: '🥫', resto: '🍽️', pedago: '🐑' }
  };

  // Acces animateur : jeton signe delivre par le serveur apres mot de passe, garde dans le navigateur.
  var AUTH_KEY = 'ff-auth';
  var auth = {
    token: function () {
      try { var a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); return a && a.exp > Date.now() ? a.token : null; } catch (e) { return null; }
    },
    save: function (token, exp) { try { localStorage.setItem(AUTH_KEY, JSON.stringify({ token: token, exp: exp })); } catch (e) { /* ignore */ } },
    clear: function () { try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ } },
    // fetch avec jeton ; renvoie { ok, status, j }
    api: function (path, opts) {
      opts = opts || {};
      var h = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      var t = auth.token(); if (t) h.Authorization = 'Bearer ' + t;
      return fetch(BASE + '/' + path, Object.assign({}, opts, { headers: h, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body }))
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 401 && t) auth.clear(); return { ok: r.ok, status: r.status, j: j }; }); });
    }
  };

  // ---------- Roue du marche (animation sur les mobiles) ----------
  var WHEEL_COLOR = { 'Tout est vendu': '#5fae48', 'Les trois quarts vendus': '#a5d96b', 'La moitié vendue': '#f2b63d', 'Rien ne se vend': '#d6453b', 'Relance gratuite': '#4da3ff' };
  var WHEEL_SHORT = { 'Tout est vendu': '100 %', 'Les trois quarts vendus': '75 %', 'La moitié vendue': '50 %', 'Rien ne se vend': '0 %', 'Relance gratuite': '↻' };
  function wheelSvg(segs) {
    var n = segs.length, r = 100, out = '';
    var pt = function (deg, rad) { var a = deg * Math.PI / 180; return [(rad * Math.sin(a)).toFixed(2), (-rad * Math.cos(a)).toFixed(2)]; };
    segs.forEach(function (sg, i) {
      var a0 = i * 360 / n, a1 = (i + 1) * 360 / n, p0 = pt(a0, r), p1 = pt(a1, r), mid = pt((a0 + a1) / 2, 70);
      var ink = sg.label === 'Les trois quarts vendus' || sg.label === 'La moitié vendue' ? '#2b1100' : '#fff';
      out += '<path d="M0 0L' + p0.join(' ') + 'A' + r + ' ' + r + ' 0 0 1 ' + p1.join(' ') + 'Z" fill="' + (WHEEL_COLOR[sg.label] || '#999') + '" stroke="#fff" stroke-width="1.5"/>' ;
    });
    return '<svg class="wheel-svg" viewBox="-116 -116 232 232" role="img" aria-label="Roue du marché, ' + n + ' cases"><g class="wheel-rot">' + out + '<circle r="9" fill="#2A1D15"/></g><path d="M-10 -114L10 -114L0 -94Z" fill="#2A1D15" stroke="#fff" stroke-width="2"/></svg>';
  }
  // Legende : chaque issue possible et son nombre de cases.
  function wheelLegend(segs) {
    var groups = [];
    segs.forEach(function (sg) { var g = groups.filter(function (x) { return x.label === sg.label; })[0]; if (g) g.n += 1; else groups.push({ label: sg.label, n: 1, frac: sg.frac }); });
    return '<div class="wheel-legend">' + groups.map(function (g) {
      return '<div><i style="background:' + (WHEEL_COLOR[g.label] || '#999') + '"></i><span>' + esc(g.label) + '</span><b>' + g.n + ' / ' + segs.length + '</b></div>';
    }).join('') + '</div>';
  }
  // Fait tourner la roue jusqu'a la case tiree (w.idx) puis annonce le resultat.
  function showWheel(segs, w, opts) {
    opts = opts || {};
    var old = document.getElementById('wheelModal'); if (old) old.remove();
    var n = segs.length, idx = Math.max(0, Math.min(n - 1, w.idx || 0));
    var el = document.createElement('div');
    el.id = 'wheelModal'; el.className = 'wheel-modal'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Roue du marché');
    var good = w.frac >= 0.75, mid = w.frac > 0;
    el.innerHTML = '<div class="wheel-box"><div class="eyebrow">Marché · roue de l\'étal</div><h2 class="wheel-title">' + (opts.title ? esc(opts.title) : 'La roue tourne…') + '</h2>' + wheelSvg(segs) +
      '<div class="wheel-result" style="visibility:hidden"><div class="wheel-res-label" style="color:' + (good ? 'var(--good)' : mid ? 'var(--warn)' : 'var(--bad)') + '">' + esc(w.label) + (w.free ? ' !' : '') + '</div></div>' +
      wheelLegend(segs) + '<button class="btn primary block" data-wheel-close="1">Voir mes ventes</button></div>';
    document.body.appendChild(el);
    var rot = el.querySelector('.wheel-rot'), title = el.querySelector('.wheel-title'), res = el.querySelector('.wheel-result');
    var done = false;
    function end() {
      if (done) return; done = true;
      rot.style.transition = 'none'; rot.style.transform = 'rotate(' + finalDeg + 'deg)';
      title.textContent = good ? 'Beau coup !' : mid ? 'Pas mal' : 'Aïe…'; res.style.visibility = 'visible';
      if (good) { try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) { /* pas de vibration */ } }
    }
    // la case idx doit se retrouver sous le repere (en haut) : rotation = tours entiers - milieu de la case
    var finalDeg = 360 * 5 - (idx + 0.5) * 360 / n;
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) end();
    else {
      rot.style.transformOrigin = '0 0';
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        rot.style.transition = 'transform 4.4s cubic-bezier(.12,.62,.12,1)'; rot.style.transform = 'rotate(' + finalDeg + 'deg)';
      }); });
      rot.addEventListener('transitionend', function () { setTimeout(end, 150); });
      setTimeout(end, 5200);
    }
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-wheel-close]')) { el.remove(); return; }
      if (!done) end();
    });
  }

  // ---------- Qui court encore ? Un decompte par ferme et par produit (protections, bonus de temps) ----------
  function runsDiffer(v) {
    return !!v.teams.some(function (t) { return !t.stopped && t.runs && Object.keys(t.runs).some(function (k) { return t.runs[k] !== v.runEff[k]; }); });
  }
  function runBoard(v) {
    var prods = v.meta.products.filter(function (p) { return v.ownedProducts.indexOf(p.id) >= 0; });
    var rows = v.teams.filter(function (t) { return !t.stopped && t.runs && Object.keys(t.runs).length; }).map(function (t) {
      var notes = (t.exempt && v.card && v.card.tone === 'neg' ? '<small class="rb-note ok">protégée</small>' : '') + (t.bonusSec ? '<small class="rb-note ok">+' + t.bonusSec + ' s</small>' : '');
      var cells = prods.map(function (p) {
        var r = t.runs[p.id];
        if (r === undefined) return '<td><span class="muted">—</span></td>';
        var diff = r !== v.runEff[p.id];
        return '<td><span class="pclock pc-idle' + (diff ? ' rb-diff' : '') + '" data-pclock data-nobeep data-pid="rb-' + t.id + '-' + p.id + '" data-run="' + r + '">' + (r ? fmt(r * 1000) : '—') + '</span></td>';
      }).join('');
      return '<tr><td class="rb-team"><b>' + esc(t.name) + '</b>' + notes + '</td>' + cells + '</tr>';
    }).join('');
    var head = '<tr><th></th>' + prods.map(function (p) { return '<th><i style="background:' + p.color + '"></i>' + esc(p.name) + '</th>'; }).join('') + '</tr>';
    return '<table class="rb"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
  }

  window.FF = { showWheel: showWheel, wheelSvg: wheelSvg, wheelLegend: wheelLegend, runBoard: runBoard, runsDiffer: runsDiffer, showHelp: showHelp, elapsed: elapsed, paintProd: paintProd, ICON: ICON, auth: auth, BASE: BASE, qs: qs, esc: esc, fmt: fmt, remaining: remaining, toast: toast, connect: connect, keepInputs: keepInputs, dots: dots, setOffline: setOffline };
})();
