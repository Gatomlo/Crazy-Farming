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

  // Rendement d'un jeton : decimale a la francaise (0,75), sans zeros inutiles.
  function yld(x) { return String(Math.round(x * 100) / 100).replace('.', ','); }
  window.FF = { yld: yld, ICON: ICON, auth: auth, BASE: BASE, qs: qs, esc: esc, fmt: fmt, remaining: remaining, toast: toast, connect: connect, keepInputs: keepInputs, dots: dots, setOffline: setOffline };
})();
