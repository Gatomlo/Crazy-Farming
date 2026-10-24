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
    return '<div class="dots" role="img" aria-label="' + n + ' boules sur ' + max + '">' + h + '</div>';
  }

  // Icones (emoji : aucune dependance, rendu chaleureux sur tous les appareils)
  var ICON = {
    lait: '🥛', oeuf: '🥚', viande: '🥩', fl: '🥕', atelier: '🍳', activite: '🎪',
    seasons: ['🌱', '☀️', '🍂', '❄️'], steps: ['🎴', '🧺', '🍳', '🏪', '🛒'],
    level: { Zen: '😌', Agité: '😬', Stressé: '🤯' }, bank: '💰', fete: '🎉', clock: '⏱️', farm: '🚜',
    equip: { chien: '🐕', serre: '🌿', arrosage: '🚿', lampe: '🔦', brouette: '🛒', charrette: '🛺', tracteur: '🚜', hamac: '🛌', camionnette: '🚐', table: '🪑' }
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

  window.FF = { elapsed: elapsed, paintProd: paintProd, ICON: ICON, auth: auth, BASE: BASE, qs: qs, esc: esc, fmt: fmt, remaining: remaining, toast: toast, connect: connect, keepInputs: keepInputs, dots: dots, setOffline: setOffline };
})();
