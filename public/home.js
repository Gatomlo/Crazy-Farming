(function () {
  var esc = FF.esc, root = document.getElementById('app');
  var games = [], filter = 'all', msg = '';

  var PH = { lobby: 'Salle d\'attente', setup: 'Installation', season: 'En saison', closing: 'Clôture', rearrange: 'Réaménagement', end: 'Terminée' };
  var SN = ['Printemps', 'Été', 'Automne', 'Hiver'];

  function say(t) { var el = document.getElementById('msg'); if (el) { el.textContent = t || ''; } msg = t || ''; }
  function brand(right) {
    return '<header class="row" style="justify-content:space-between"><div class="brand"><div class="logo" aria-hidden="true">🚜</div><div><h1>Farming\'s Folies</h1><div class="muted">Le jeu de gestion de ferme du Ranch du Phoenix</div></div></div>' + (right || '') + '</header>';
  }

  // ---------- Creation du mot de passe (premiere connexion apres installation) ----------
  function setupView() {
    root.innerHTML =
      '<section class="login-card panel">' +
        '<div class="logo brand" style="justify-content:center"><div class="logo" aria-hidden="true">🚜</div></div>' +
        '<h1>Bienvenue !</h1><p class="muted" style="margin:0">Première connexion : crée le mot de passe de l\'espace du maire du village.</p>' +
        '<form id="setupForm" class="stack"><label for="pw1" class="muted" style="text-align:left">Mot de passe (6 caractères minimum)</label>' +
        '<input id="pw1" type="password" autocomplete="new-password" autofocus>' +
        '<label for="pw2" class="muted" style="text-align:left">Confirmation</label>' +
        '<input id="pw2" type="password" autocomplete="new-password">' +
        '<button class="btn primary">Créer et entrer</button></form>' +
        '<div id="msg" class="muted" role="status" style="min-height:22px"></div></section>';
    document.getElementById('setupForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var a = document.getElementById('pw1').value, b = document.getElementById('pw2').value;
      if (a.length < 6) return say('Au moins 6 caractères.');
      if (a !== b) return say('Les deux mots de passe ne correspondent pas.');
      FF.auth.api('api/setup', { method: 'POST', body: { password: a } }).then(function (r) {
        if (r.ok) { FF.auth.save(r.j.token, r.j.expiresAt); load(false); return; }
        say(r.status === 403 ? 'Le mot de passe existe déjà : recharge la page.' : 'Création impossible.');
      }).catch(function () { say('Serveur injoignable.'); });
    });
  }

  // ---------- Connexion ----------
  function loginView() {
    root.innerHTML =
      '<section class="login-card panel">' +
        '<div class="logo brand" style="justify-content:center"><div class="logo" aria-hidden="true">🚜</div></div>' +
        '<h1>Farming\'s Folies</h1><p class="muted" style="margin:0">Espace du maire du village</p>' +
        '<form id="loginForm" class="stack"><label for="pw" class="muted" style="text-align:left">Mot de passe</label>' +
        '<input id="pw" type="password" autocomplete="current-password" autofocus>' +
        '<button class="btn primary">Se connecter</button></form>' +
        '<div id="msg" class="muted" role="status" style="min-height:22px"></div>' +
        '<hr class="hr"><form id="joinDisplay" class="row" style="justify-content:center"><label class="muted" for="code">Écran joueurs : code</label>' +
        '<input id="code" maxlength="4" autocomplete="off" style="width:96px;text-transform:uppercase;font-weight:800;letter-spacing:.2em;text-align:center"><button class="btn">Ouvrir</button></form>' +
      '</section>';
    document.getElementById('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      say('Connexion…');
      FF.auth.api('api/login', { method: 'POST', body: { password: document.getElementById('pw').value } }).then(function (r) {
        if (r.ok) { FF.auth.save(r.j.token, r.j.expiresAt); load(r.j.defaultPassword); return; }
        if (r.status === 429) return say('Trop d\'essais. Réessaie dans ' + Math.ceil((r.j.retryAfterSeconds || 300) / 60) + ' min.');
        say('Mot de passe incorrect.');
      }).catch(function () { say('Serveur injoignable.'); });
    });
    document.getElementById('joinDisplay').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = document.getElementById('code').value.trim().toUpperCase();
      if (code.length !== 4) return say('Le code compte 4 lettres.');
      fetch('api/sessions/' + encodeURIComponent(code)).then(function (r) { if (!r.ok) throw new Error('x'); location.href = 'display?s=' + encodeURIComponent(code); }).catch(function () { say('Session introuvable.'); });
    });
  }

  // ---------- Historique ----------
  function when(ts) { var d = new Date(ts); return d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }); }

  function card(g) {
    var done = g.phase === 'end';
    var status = done ? (g.stars ? '<span class="stars" title="' + g.stars.count + ' étoile(s)">' + '★'.repeat(g.stars.count) + '<span class="muted">' + '☆'.repeat(3 - g.stars.count) + '</span></span>' : '') : '<span class="pill warn">' + esc(PH[g.phase] || g.phase) + (g.phase === 'season' ? ' · ' + SN[g.season] + ' an ' + g.year : g.phase === 'closing' || g.phase === 'rearrange' ? ' · an ' + g.year : '') + '</span>';
    var teams = g.teams.length ? g.teams.map(function (t) { return esc(t.name); }).join(', ') : 'Aucune ferme';
    return '<div class="game-card" data-code="' + esc(g.code) + '">' +
      '<div class="code">' + esc(g.code) + '</div>' +
      '<div class="info"><div><b>' + (g.label ? esc(g.label) : '<span class="muted">Sans titre</span>') + '</b> ' + status + '</div>' +
      '<div class="muted" style="font-size:13px">' + esc(when(g.createdAt)) + ' · ' + g.teams.length + ' ferme' + (g.teams.length > 1 ? 's' : '') + (done ? ' · cagnotte ' + g.totalBank + ' EB' : '') + '</div>' +
      '<div class="muted" style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + teams + '</div></div>' +
      '<div class="tools"><a class="btn small primary" style="display:inline-flex;align-items:center;text-decoration:none" href="admin?s=' + esc(g.code) + '">' + (done ? 'Voir' : 'Reprendre') + '</a>' +
      '<a class="btn small" style="display:inline-flex;align-items:center;text-decoration:none" href="display?s=' + esc(g.code) + '" target="_blank" rel="noopener">Écran</a>' +
      '<button class="btn small" data-act="rename">Renommer</button>' +
      '<button class="btn small" data-act="export">Exporter</button>' +
      '<button class="btn small danger" data-act="delete">Supprimer</button></div></div>';
  }

  function dashboard(defaultPw) {
    var shown = games.filter(function (g) { return filter === 'all' || (filter === 'done' ? g.phase === 'end' : g.phase !== 'end'); });
    var seg = [['all', 'Toutes'], ['live', 'En cours'], ['done', 'Terminées']].map(function (f) { return '<button data-filter="' + f[0] + '" class="' + (filter === f[0] ? 'on' : '') + '">' + f[1] + '</button>'; }).join('');
    root.innerHTML = brand('<div class="row"><button class="btn small" data-act="logout">Se déconnecter</button></div>') +
      (defaultPw ? '<div class="panel warn"><b>Mot de passe par défaut.</b> Change-le dans « Mot de passe » avant le premier événement.</div>' : '') +
      '<section class="panel stack"><h2>Nouvelle partie</h2><form id="newForm" class="row"><input id="newLabel" maxlength="60" placeholder="Titre (ex. Séminaire Condorcet, 12 mai)" style="flex:1;min-width:220px"><button class="btn primary">Créer et ouvrir</button></form></section>' +
      '<section class="panel stack"><div class="row" style="justify-content:space-between"><h2>Historique des parties</h2><div class="seg" style="min-width:260px">' + seg + '</div></div>' +
      (shown.length ? shown.map(card).join('') : '<p class="muted" style="margin:0">' + (games.length ? 'Aucune partie dans ce filtre.' : 'Aucune partie pour le moment. Crée la première ci-dessus.') + '</p>') + '</section>' +
      '<details id="pwBox" class="panel"><summary>Mot de passe</summary><form id="pwForm" class="stack" style="margin-top:10px;max-width:360px">' +
      '<input id="pwOld" type="password" placeholder="Mot de passe actuel" autocomplete="current-password"><input id="pwNew" type="password" placeholder="Nouveau mot de passe (6 caractères min.)" autocomplete="new-password"><button class="btn">Changer le mot de passe</button></form></details>' +
      '<div id="msg" class="muted" role="status" style="min-height:22px"></div>';
    var nf = document.getElementById('newForm');
    nf.addEventListener('submit', function (e) {
      e.preventDefault();
      FF.auth.api('api/sessions', { method: 'POST', body: { label: document.getElementById('newLabel').value } }).then(function (r) {
        if (!r.ok) return say(r.j.error || 'Impossible de créer la partie.');
        location.href = 'admin?s=' + encodeURIComponent(r.j.code);
      });
    });
    document.getElementById('pwForm').addEventListener('submit', function (e) {
      e.preventDefault();
      FF.auth.api('api/change-password', { method: 'POST', body: { currentPassword: document.getElementById('pwOld').value, newPassword: document.getElementById('pwNew').value } }).then(function (r) {
        if (r.ok) { FF.auth.save(r.j.token, r.j.expiresAt); document.getElementById('pwForm').reset(); return say('Mot de passe changé.'); }
        say(r.status === 429 ? 'Trop d\'essais, réessaie plus tard.' : r.j.error === 'weak_password' ? 'Nouveau mot de passe trop court.' : 'Mot de passe actuel incorrect.');
      });
    });
  }

  function load(defaultPw) {
    FF.auth.api('api/sessions').then(function (r) {
      if (r.status === 401) { FF.auth.clear(); return entry(); }
      games = (r.j && r.j.sessions) || [];
      dashboard(defaultPw);
    }).catch(function () { root.innerHTML = '<p class="muted">Serveur injoignable.</p>'; });
  }

  root.addEventListener('click', function (e) {
    var f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; return dashboard(false); }
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var cardEl = b.closest('[data-code]'), code = cardEl && cardEl.dataset.code;
    if (b.dataset.act === 'logout') { FF.auth.clear(); return entry(); }
    if (b.dataset.act === 'rename') {
      var g = games.filter(function (x) { return x.code === code; })[0];
      var info = cardEl.querySelector('.info');
      info.innerHTML = '<form class="row" data-rename="' + esc(code) + '"><input maxlength="60" value="' + esc(g.label) + '" style="flex:1;min-width:160px" aria-label="Titre"><button class="btn small primary">OK</button></form>';
      info.querySelector('input').focus();
      return;
    }
    if (b.dataset.act === 'export') {
      return FF.auth.api('api/sessions/' + code + '/export').then(function (r) {
        if (!r.ok) return say('Export impossible.');
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(r.j, null, 1)], { type: 'application/json' }));
        a.download = 'farming-folies-' + code + '.json'; a.click();
      });
    }
    if (b.dataset.act === 'delete') {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirmer'; setTimeout(function () { b.dataset.armed = ''; b.textContent = 'Supprimer'; }, 4000); return; }
      FF.auth.api('api/sessions/' + code, { method: 'DELETE' }).then(function (r) { if (r.ok) load(false); else say('Suppression impossible.'); });
    }
  });
  root.addEventListener('submit', function (e) {
    var code = e.target.dataset && e.target.dataset.rename;
    if (!code) return;
    e.preventDefault();
    FF.auth.api('api/sessions/' + code, { method: 'PATCH', body: { label: e.target.querySelector('input').value } }).then(function () { load(false); });
  });

  function entry() {
    FF.auth.api('api/status').then(function (r) { if (r.ok && r.j && r.j.setup) setupView(); else loginView(); }).catch(function () { loginView(); });
  }
  if (FF.auth.token()) load(false); else entry();
})();
