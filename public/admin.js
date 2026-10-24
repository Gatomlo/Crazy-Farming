(function () {
  var esc = FF.esc;
  var code = (FF.qs.get('s') || '').toUpperCase();
  // Jeton : celui de la connexion animateur (mot de passe), ou ?k= pour le banc d'essai.
  var token = FF.qs.get('k') || FF.auth.token();
  var root = document.getElementById('app');
  var V = null;
  var conn = null;

  if (!code) { location.replace(FF.BASE + '/'); return; }
  if (!token) { root.innerHTML = '<div class="panel" style="max-width:420px;margin:10vh auto;text-align:center"><h2>Connexion requise</h2><p class="muted">Connecte-toi avec le mot de passe animateur.</p><a class="btn primary" style="display:inline-flex;align-items:center;text-decoration:none" href="./">Se connecter</a></div>'; return; }

  conn = FF.connect({
    role: 'admin', code: code, token: token,
    onState: function (v) { V = v; FF.keepInputs(root, render); tick(); },
    onFatal: function (m) { root.innerHTML = '<div class="panel" style="max-width:420px;margin:10vh auto;text-align:center"><h2>' + esc(m) + '</h2><a class="btn primary" style="display:inline-flex;align-items:center;text-decoration:none" href="./">Retour aux parties</a></div>'; }
  });

  var PHASES = { lobby: 'Salle d\'attente', setup: 'Installation', season: 'Saison', closing: 'Clôture de l\'année', rearrange: 'Réaménagement', end: 'Partie terminée' };

  function tilesText(t) {
    var parts = [];
    Object.keys(t.tilesByType).forEach(function (k) { if (t.tilesByType[k] > 0) parts.push(t.tilesByType[k] + ' ' + V.meta.tileNames[k]); });
    return parts.length ? parts.join(' · ') : 'Aucune tuile';
  }
  function equipName(id) { var c = V.meta.catalogue.filter(function (x) { return x.id === id; })[0]; return c ? c.name : id; }

  // ---------- Blocs ----------
  function header() {
    var title = V.phase === 'season' ? V.seasonName + ' · année ' + V.year : PHASES[V.phase];
    return '<header class="row" style="justify-content:space-between">' +
      '<div class="brand"><div class="logo" aria-hidden="true">🚜</div><div><h1 style="font-size:44px">Farming\'s Folies</h1><div class="muted">Console de l\'animateur · partie <b class="num" style="color:var(--fg);letter-spacing:.15em">' + esc(V.code) + '</b></div></div></div>' +
      '<div class="row"><span class="pill" style="background:' + (V.phase === 'season' ? V.seasonColor : 'var(--panel2)') + ';color:' + (V.phase === 'season' ? 'var(--ink)' : 'var(--text)') + '">' + esc(title) + '</span>' +
      '<a class="btn small" style="display:inline-flex;align-items:center;text-decoration:none" href="display?s=' + esc(V.code) + '" target="_blank" rel="noopener">📺 Écran joueurs</a><button class="btn small' + (V.showQr ? ' primary' : '') + '" data-act="toggleQr" aria-pressed="' + (V.showQr ? 'true' : 'false') + '">' + (V.showQr ? '✖ Masquer le QR code' : '📱 Afficher le QR code') + '</button><button class="btn small" data-logtoggle="1">📜 Journal</button><button class="btn small" data-doc="rules">📖 Règles</button><button class="btn small" data-doc="guide">🧭 Guide</button><a class="btn small" style="display:inline-flex;align-items:center;text-decoration:none" href="./">← Parties</a></div></header>';
  }

  function lobby() {
    var opts = V.meta.profiles.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('') + '<option value="">Sans profil (aucune tuile)</option>';
    var list = V.teams.map(function (t) {
      return '<div class="row panel" style="padding:12px 16px"><b style="flex:1">' + esc(t.name) + '</b><span class="muted">' + esc(tilesText(t)) + '</span>' +
        '<button class="btn small" data-act="removeTeam" data-team="' + t.id + '">Retirer</button></div>';
    }).join('');
    return '<section class="panel" style="display:flex;flex-direction:column;gap:12px"><h2 style="font-size:20px">Les fermes</h2>' +
      '<form class="row" data-form="addTeam"><label class="muted" for="newName">Nom</label><input id="newName" maxlength="40" placeholder="Nom de la ferme (facultatif)">' +
      '<label class="muted" for="newProfile">Profil</label><select id="newProfile">' + opts + '</select><button class="btn primary">Ajouter</button></form>' +
      (list || '<p class="muted" style="margin:0">Aucune ferme pour le moment.</p>') +
      '<div class="row"><button class="btn primary" data-act="startSetup"' + (V.teams.length ? '' : ' disabled') + '>Lancer l\'installation</button><span class="muted">Chrono de 10 minutes pour poser les tuiles.</span></div></section>';
  }

  function timerPanel(title, sub) {
    var run = V.timer.running;
    var adj = [[-30, '−30 s'], [-15, '−15 s'], [15, '+15 s'], [30, '+30 s'], [60, '+1 min']].map(function (a) { return '<button class="btn small" data-act="timerAdjust" data-delta="' + a[0] + '">' + a[1] + '</button>'; }).join('');
    var cur = V.step != null && V.phase === 'season';
    return '<section class="panel" style="flex:2 1 460px;display:flex;flex-direction:column;gap:12px">' +
      '<div class="eyebrow">' + esc(sub) + '</div>' +
      '<h2 style="font-size:52px;line-height:1">' + (cur ? FF.ICON.steps[V.step] + ' ' : '') + esc(title) + '</h2>' +
      '<div class="clock" data-clock>' + FF.fmt(FF.remaining(V)) + '</div>' +
      '<div class="bar"><i data-bar style="width:100%"></i></div>' +
      '<div class="row"><button class="btn primary" style="min-height:52px;font-size:17px" data-act="' + (run ? 'timerPause' : 'timerStart') + '">' + (run ? '⏸ Pause' : '▶ Lancer le chrono') + '</button>' +
      '<button class="btn" style="min-height:52px" data-act="timerReset">↺ Remettre à zéro</button></div>' +
      '<details id="timerAdj"><summary>⏱ Régler le chrono</summary><div class="stack" style="margin-top:8px"><div class="tools">' + adj + '</div>' +
      '<div class="row"><label for="timerSec" class="muted">Durée (secondes)</label><input id="timerSec" inputmode="numeric" placeholder="ex. 90" style="width:100px"><button class="btn small" data-act="timerSet">Fixer</button></div>' +
      (cur ? '<label class="row" style="font-weight:500"><input type="checkbox" id="timerKeep" style="min-height:0;width:20px;height:20px"> Garder cette durée pour cette étape aux saisons suivantes</label>' : '') + '</div></details>' + tripBlock() + '</section>';
  }

  // Duree d'un aller-retour sur le parcours : met a l'echelle la valeur d'un jeton (grille calibree pour V.meta.refTripSec).
  function tripBlock() {
    var opts = V.meta.tripChoices.map(function (n) { return '<option value="' + n + '"' + (n === V.tripSec ? ' selected' : '') + '>' + n + ' s</option>'; }).join('');
    return '<div class="row" style="border-top:1px solid var(--line);padding-top:10px"><label for="tripSec" class="muted">🏃 Aller-retour d\'un coureur</label><select id="tripSec" data-trip="1" aria-label="Durée d\'un aller-retour">' + opts + '</select><span class="muted" style="font-size:12px">Chronométrez un essai : plus le parcours est court, moins un jeton rapporte.</span></div>';
  }

  // Saut libre a une saison (accelerer la partie). Deux clics : les charges, la fete et les achats des annees sautees ne sont pas rejoues.
  function jumpPanel() {
    if (['setup', 'season', 'closing', 'rearrange'].indexOf(V.phase) < 0) return '';
    var yo = [1, 2, 3].map(function (y) { return '<option value="' + y + '"' + (y === V.year ? ' selected' : '') + '>Année ' + y + '</option>'; }).join('');
    var so = ['Printemps', 'Été', 'Automne', 'Hiver'].map(function (n, i) { return '<option value="' + i + '"' + (V.phase === 'season' && i === V.season ? ' selected' : '') + '>' + n + '</option>'; }).join('');
    return '<div class="row" style="gap:8px;border-top:1px solid var(--line,var(--line));padding-top:10px"><select id="jumpYear" aria-label="Année">' + yo + '</select><select id="jumpSeason" aria-label="Saison">' + so + '</select><button class="btn small" data-act="jumpTo">Aller à</button></div>' +
      '<div class="muted" id="jumpNote" style="font-size:12px">Saut direct au début de la saison : les charges et la fête des années sautées ne sont pas jouées.</div>';
  }

  // Phrase a dire a chaque etape (mode pas a pas).
  var SAY = [
    '« Une carte aléa est tirée. Chaque ferme choisit : subir, jouer sa parade ou ajouter une boule. »',
    '« Coureurs en place… Trois, deux, un, partez ! À la fin, chaque ferme encode les jetons réellement rapportés. »',
    '« Encodez votre récolte, puis déclarez vos recettes : je prépare vos jetons. Rappel : les matières brutes que vous ne transformez pas ni ne vendez seront perdues en fin de saison. »',
    '« Placez vos produits, déclarez, puis tournez la roue. Attention : tout ce qui n\'est ni vendu ni transformé est perdu ! »',
    '« Dernière minute : matériel et vacances. Regardez la météo de la saison suivante ! »'
  ];

  function forecastBanner() {
    var f = V.forecast;
    if (!f) return '';
    return '<section class="panel row" style="gap:14px;flex-wrap:nowrap"><div style="font-size:36px;line-height:1" aria-hidden="true">' + f.icon + '</div><div style="flex:1;min-width:0"><div class="muted" style="font-size:13px">Prévision météo affichée aux joueurs · ' + esc(f.seasonName.toLowerCase()) + ', année ' + f.year + '</div><div style="font-weight:800">' + esc(f.text) + '</div></div>' +
      (f.truth ? '<div class="muted" style="font-size:13px;text-align:right">Carte déjà tirée en secret :<br><b style="color:var(--fg)">' + esc(f.truth) + '</b></div>' : '') + '</section>';
  }

  function stepsPanel() {
    var items = V.meta.steps.map(function (s, i) {
      var cls = i === V.step ? 'active' : i < V.step ? 'done' : '';
      var dur = i === 1 ? V.harvestSec : [30, 0, 60, 60, 30][i];
      var say = i === V.step ? '<div style="font-size:13px;margin-top:4px;color:var(--sand)">' + esc(i === 0 && V.card && V.card.collective ? '« Aléa collectif : le village doit réunir l\'objectif ensemble avant la fin de l\'étape indiquée ! »' : SAY[i]) + '</div>' : '';
      return '<div class="step ' + cls + '"><b class="n">' + (i < V.step ? '✓' : i + 1) + '</b><div style="flex:1"><b>' + esc(s.name) + '</b><div class="muted" style="font-size:13px">' + esc(s.hint) + '</div>' + say + '</div><span class="muted num">' + FF.fmt(dur * 1000) + '</span></div>';
    }).join('');
    var last = V.step === 4;
    var nextLabel = last ? (V.season === 3 ? 'Clôturer l\'année' : 'Saison suivante') : 'Étape suivante';
    var allReady = V.teams.length > 0 && V.teams.every(function (t) { return t.ready || t.stopped; }) && V.teams.some(function (t) { return t.ready; });
    return '<section class="panel" style="flex:1 1 300px;display:flex;flex-direction:column;gap:10px"><h2 style="font-size:18px">Déroulé de la saison</h2>' + items +
      '<div class="row" style="margin-top:auto"><button class="btn" style="flex:1" data-act="prevStep"' + (V.step === 0 ? ' disabled' : '') + '>Précédente</button><button class="btn primary' + (allReady ? ' pulse' : '') + '" style="flex:1" data-act="nextStep">' + (allReady ? '✓ Toutes prêtes · ' : '') + nextLabel + '</button></div>' + jumpPanel() + '</section>';
  }

  // Alea collectif : suivi de l'objectif commun et des dons de chaque ferme.
  function collectiveAdmin(c) {
    var tot = Object.keys(c.pot || {}).reduce(function (n, k) { return n + c.pot[k]; }, 0);
    var done = c.resolved !== null && c.resolved !== undefined;
    var due = (V.meta.steps.filter(function (x) { return x.id === c.due; })[0] || {}).name || '';
    var raw = c.goal.kind === 'raw';
    var rows = V.teams.map(function (t) {
      return '<div class="row" style="justify-content:space-between"><span>' + esc(t.name) + '</span><span class="row" style="gap:6px"><b class="num">' + ((c.pot || {})[t.id] || 0) + '</b>' +
        (raw && !done ? '<button class="btn small" data-act="adjustContribution" data-team="' + t.id + '" data-delta="-1" aria-label="Retirer un jeton à ' + esc(t.name) + '">−1</button><button class="btn small" data-act="adjustContribution" data-team="' + t.id + '" data-delta="1" aria-label="Ajouter un jeton à ' + esc(t.name) + '">+1</button>' : '') + '</span></div>';
    }).join('');
    return '<span class="pill warn" style="align-self:flex-start">Aléa collectif · tout le village</span><div style="font-size:28px;font-weight:800">' + esc(c.title) + '</div><div style="font-size:16px">' + esc(c.story) + '</div>' +
      '<div><b>Objectif : ' + esc(c.goalText) + '</b> <span class="muted">· avant la fin de « ' + esc(due) + ' »</span></div>' +
      '<div class="bar" style="height:12px"><i style="width:' + Math.min(100, Math.round(tot / c.need * 100)) + '%"></i></div><div class="num"><b>' + tot + ' / ' + c.need + '</b></div>' + rows +
      (raw && !done ? '<div class="muted" style="font-size:13px">Les fermes déclarent leurs jetons sur mobile : vérifie la remise physique et corrige avec −1 / +1 si besoin.</div>' : '') +
      (done ? '<div class="pill ' + (c.resolved ? 'ok' : 'bad') + '" style="align-self:flex-start">' + (c.resolved ? 'Objectif atteint' : 'Objectif manqué') + '</div><div>' + esc(c.resolved ? c.winText : c.loseText) + '</div>'
        : '<div class="muted" style="font-size:13px">Réussite : ' + esc(c.winText) + '<br>Échec : ' + esc(c.loseText) + '<br>Réglé automatiquement à la fin de l\'étape.</div><button class="btn small" data-act="settleCollective">Clôturer maintenant</button>');
  }

  function cardPanel() {
    var c = V.card;
    var q = V.quotaEff, prods = V.meta.products.map(function (p) {
      return '<span class="pill" style="display:inline-flex;gap:8px;align-items:center"><i style="width:10px;height:10px;border-radius:50%;background:' + p.color + ';display:inline-block"></i>' + esc(p.name) + ' ' + q[p.id] + '</span>';
    }).join(' ');
    var cardHtml = c && c.collective
      ? collectiveAdmin(c)
      : c
      ? '<span class="pill ' + (c.tone === 'neg' ? 'lv-Stressé' : 'lv-Zen') + '" style="align-self:flex-start">' + (c.tone === 'neg' ? 'Négatif' : 'Positif') + '</span>' +
        '<div style="font-size:28px;font-weight:800">' + esc(c.title) + '</div><div style="font-size:16px">' + esc(c.effect) + '</div>' +
        '<div class="muted">Parade : <b style="color:var(--text)">' + esc(c.parade ? equipName(c.parade) : 'aucune') + '</b></div>'
      : '<p class="muted" style="margin:0">Aucune carte tirée pour cette saison.</p>';
    return '<section style="flex:1 1 340px;display:flex;flex-direction:column;gap:16px">' +
      '<div class="panel" style="display:flex;flex-direction:column;gap:10px;flex:1"><h2 style="font-size:18px">Carte aléa</h2>' + cardHtml +
      '<div class="muted" style="font-size:13px">La grille « à rapporter par tuile » est déjà ajustée sur l\'écran des joueurs ; les fermes qui ont joué leur parade ou pris +1 boule gardent les valeurs de base.</div>' +
      (c && c.collective ? '' : '<button class="btn" style="margin-top:auto" data-act="drawCard">' + (c ? 'Tirer une autre carte' : 'Tirer une carte') + '</button>') + '</div>' +
      '<div class="panel row"><div style="width:64px;height:64px;border-radius:14px;background:var(--text);color:var(--ink);display:grid;place-items:center;font-size:40px;font-weight:800">' + (V.die || '–') + '</div>' +
      '<div style="flex:1;min-width:140px"><div class="muted" style="font-size:13px">Dé des activités</div><div style="font-weight:700">' + esc(V.dieLabel || 'Pas encore lancé') + '</div></div>' +
      '<button class="btn primary" data-act="rollDie">Lancer le dé</button></div>' +
      '<div class="panel"><div class="muted" style="font-size:13px;margin-bottom:8px">Quota de jetons par tuile · ' + esc(V.seasonName) + '</div><div class="row" style="gap:6px">' + prods + '</div></div></section>';
  }

  // Bourse : echanges de stock entre fermes (suivi, annulation).
  function tradesPanel() {
    if (V.phase !== 'season' || V.step !== 2) return '';
    var name = function (id) { var t = V.teams.filter(function (x) { return x.id === id; })[0]; return t ? t.name : '?'; };
    var ST = { pending: ['En attente', 'warn'], done: ['Conclu', 'ok'], refused: ['Refusé', 'bad'], cancelled: ['Annulé', ''], reverted: ['Annulé après coup', ''] };
    var rows = (V.trades || []).slice().reverse().map(function (tr) {
      var st = ST[tr.status] || [tr.status, ''];
      var act = tr.status === 'pending' ? '<button class="btn small" data-act="cancelTrade" data-trade="' + tr.id + '">Annuler</button>' : tr.status === 'done' ? '<button class="btn small" data-act="revertTrade" data-trade="' + tr.id + '">Annuler l\'échange</button>' : '';
      return '<tr><td>' + esc(name(tr.from)) + ' → ' + esc(name(tr.to)) + '</td><td>' + tr.items.map(function (i) { return i.n + ' × ' + esc(i.name.toLowerCase()); }).join(', ') + '</td><td class="num">' + (tr.price ? tr.price + ' EB' : 'don') + '</td><td><span class="pill ' + st[1] + '">' + st[0] + '</span></td><td>' + act + '</td></tr>';
    }).join('');
    return '<section class="panel" style="display:flex;flex-direction:column;gap:8px"><h2 style="font-size:18px">Bourse : échanges entre fermes</h2>' +
      (rows ? '<div class="tbl"><table><thead><tr><th>Échange</th><th>Produits</th><th>Prix</th><th>État</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="muted" style="margin:0">Aucun échange pour le moment. Les fermes proposent depuis leur mobile ; le destinataire accepte.</p>') +
      '<p class="muted" style="margin:0;font-size:13px">Le stock et l\'argent suivent automatiquement à l\'acceptation ; les jetons passent de main en main entre les fermes.</p></section>';
  }

  // Recolte encodee par une ferme (jetons rapportes / maximum), avec correction -1 / +1.
  function harvestLine(t) {
    if (V.phase !== 'season' || V.step < 1 || !t.harvest || !t.harvest.length) return '';
    var cells = t.harvest.map(function (h) {
      return '<span style="white-space:nowrap">' + (FF.ICON[h.id] || '') + ' ' + (h.brought === null ? '<span class="muted">?</span>' : h.brought) + ' <button class="btn small" style="min-height:26px;padding:0 8px" data-act="adjustHarvest" data-team="' + t.id + '" data-product="' + h.id + '" data-delta="-1" aria-label="Retirer un jeton">−</button><button class="btn small" style="min-height:26px;padding:0 8px" data-act="adjustHarvest" data-team="' + t.id + '" data-product="' + h.id + '" data-delta="1" aria-label="Ajouter un jeton">+</button></span>';
    }).join(' ');
    return '<div style="font-size:13px;margin-top:4px">🧺 ' + cells + '</div>';
  }

  // Stock d'une ferme : jetons bruts de la saison et plats transformes.
  function stockLine(t) {
    if (!t.stock) return '';
    var parts = [];
    V.meta.sell.forEach(function (x) {
      var n = x.kind === 'raw' ? t.stock.raw[x.id] : t.stock.dishes[x.id];
      if (n > 0) parts.push((x.kind === 'raw' ? (FF.ICON[x.id] || '') + ' ' : '') + esc(x.name) + ' ' + n);
    });
    return harvestLine(t) + '<div style="font-size:13px;margin-top:4px">📦 ' + (parts.length ? parts.join(' · ') : '<span class="muted">stock vide</span>') + '</div>';
  }

  function teamsTable() {
    var tileOpts = Object.keys(V.meta.tileNames).map(function (k) { return '<option value="' + k + '">' + esc(V.meta.tileNames[k]) + '</option>'; }).join('');
    var showWheel = V.phase === 'season' && V.step === 3;
    var rows = V.teams.map(function (t) {
      var choice = { subit: 'Subit l\'effet', parade: 'Parade jouée', boule: '+1 boule' }[t.choice] || (V.card ? 'En attente' : '–');
      var eq = t.equipment.length ? t.equipment.map(equipName).join(', ') : 'Aucun matériel';
      return '<tr><td><b>' + esc(t.name) + '</b>' + (t.stopped ? '<div><span class="pill lv-Stressé">Burn-out : à l\'arrêt</span></div>' : '') + (t.burnouts ? '<div class="muted" style="font-size:13px">' + t.burnouts + ' burn-out(s)</div>' : '') + '</td>' +
        '<td class="nowrap"><div class="num" style="font-size:22px;font-weight:800">' + t.bank + ' EB</div>' +
        '<details id="adj-' + t.id + '"><summary>Ajuster</summary><div class="row" style="margin-top:6px"><input id="amt-' + t.id + '" inputmode="numeric" placeholder="± montant" style="width:110px"><input id="lbl-' + t.id + '" placeholder="Motif" style="width:140px"><button class="btn small" data-act="bank" data-team="' + t.id + '">Valider</button></div></details></td>' +
        '<td class="wide">' + FF.dots(t.bocal, V.meta.bocalMax) + '<div class="row" style="margin-top:6px;gap:8px"><span class="pill lv-' + t.level + '">' + t.level + '</span><span class="muted num">' + t.bocal + ' / ' + V.meta.bocalMax + '</span>' +
        '<button class="btn small" data-act="bocal" data-team="' + t.id + '" data-delta="-1" aria-label="Retirer une boule à ' + esc(t.name) + '">−1</button><button class="btn small" data-act="bocal" data-team="' + t.id + '" data-delta="1" aria-label="Ajouter une boule à ' + esc(t.name) + '">+1</button></div></td>' +
        '<td><div>' + esc(tilesText(t)) + '</div><div class="muted" style="font-size:13px">' + esc(eq) + '</div>' + stockLine(t) +
        '<details id="gift-' + t.id + '"><summary>Tuile gratuite</summary><div class="row" style="margin-top:6px"><select id="tile-' + t.id + '">' + tileOpts + '</select><button class="btn small" data-act="giftTile" data-team="' + t.id + '">Donner</button></div></details></td>' +
        '<td><button class="btn small ' + (t.ready ? 'good' : '') + '" data-act="setReady" data-team="' + t.id + '" data-ready="' + (t.ready ? '' : '1') + '">' + (t.ready ? '✓ Prête' : 'En cours') + '</button><div class="muted" style="font-size:13px;margin-top:4px">Aléa : ' + esc(choice) + '</div></td>' +
        (showWheel ? '<td><button class="btn small" data-act="spinWheel" data-team="' + t.id + '">Tourner</button><div style="margin-top:4px;font-weight:700">' + (t.wheel ? esc(t.wheel.label) : '<span class="muted" style="font-weight:400">Pas encore</span>') + '</div></td>' : '') + '</tr>';
    }).join('');
    return '<section class="panel" style="flex:3 1 640px;display:flex;flex-direction:column;gap:8px"><h2 style="font-size:18px">Les fermes</h2><div class="tbl"><table><thead><tr><th>Ferme</th><th>Banque</th><th>Bocal de stress</th><th>Tuiles et matériel</th><th>Étape</th>' + (showWheel ? '<th>Roue du marché</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-logtoggle]');
    if (!t) return;
    if (t.dataset.logtoggle === '1' && t.tagName !== 'BUTTON' && e.target.closest('[data-stop]')) return;
    window.__logOpen = !window.__logOpen;
    if (typeof render === 'function') render();
  });
  var DOCS = { rules: ['📖 Règles du jeu', 'rules'], guide: ['🧭 Guide de l\'animateur', 'guide'] };
  document.addEventListener('click', function (e) {
    var d = e.target.closest && e.target.closest('[data-doc]');
    if (d) { window.__doc = d.dataset.doc === 'close' ? null : d.dataset.doc; if (typeof render === 'function') render(); return; }
    var bg = e.target.closest && e.target.closest('[data-docbg]');
    if (bg && !e.target.closest('[data-stop]')) { window.__doc = null; render(); }
  });
  function docModal() {
    var d = window.__doc && DOCS[window.__doc];
    if (!d || !window.FFGuide) return '';
    var tabs = Object.keys(DOCS).map(function (k) { return '<button class="btn small' + (k === window.__doc ? ' primary' : '') + '" data-doc="' + k + '">' + DOCS[k][0] + '</button>'; }).join('');
    return '<div data-docbg="1" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px">' +
      '<section class="panel doc" role="dialog" aria-label="' + d[0] + '" data-stop="1" style="width:min(820px,100%);max-height:88vh;overflow:auto;display:flex;flex-direction:column;gap:10px">' +
      '<div class="row" style="justify-content:space-between;position:sticky;top:-20px;background:inherit;padding:4px 0;z-index:1"><div class="row">' + tabs + '</div><button class="btn small" data-doc="close">Fermer</button></div>' +
      '<h2 style="font-size:30px">' + d[0] + '</h2><div class="doc-body">' + window.FFGuide[d[1]] + '</div></section></div>';
  }

  function logModal() {
    if (!window.__logOpen) return '';
    var lines = (V.log || []).slice(0, 40).map(function (l) {
      var d = new Date(l.at);
      return '<div class="logline"><span class="muted num">' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + '</span><span>' + esc(l.text) + '</span></div>';
    }).join('');
    return '<div data-logtoggle="1" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px">' +
      '<section class="panel" role="dialog" aria-label="Journal" data-stop="1" style="width:min(640px,100%);max-height:80vh;overflow:auto;display:flex;flex-direction:column;gap:8px">' +
      '<div class="row" style="justify-content:space-between"><h2 style="font-size:22px">📜 Journal</h2><button class="btn small" data-logtoggle="1">Fermer</button></div>' +
      (lines || '<p class="muted" style="margin:0">Rien pour le moment.</p>') + '</section></div>';
  }

  // Transformation : l'animateur echange les jetons et valide.
  function transfoPanel() {
    if (V.phase !== 'season' || V.step !== 2) return '';
    var names = {}; V.meta.products.forEach(function (p) { names[p.id] = p.name.toLowerCase(); }); V.meta.dishes.forEach(function (d) { names[d.id] = d.name.toLowerCase(); });
    var list = function (o) { var p = Object.keys(o || {}).map(function (k) { return '<b>' + o[k] + '</b> ' + esc(names[k] || k); }); return p.length ? p.join(' · ') : '—'; };
    var rows = V.teams.map(function (t) {
      if (t.stopped) return '<tr><td><b>' + esc(t.name) + '</b></td><td colspan="3" class="muted">À l\'arrêt</td></tr>';
      var T = t.transfo;
      var det = T ? '<div>Reçoit : ' + list(T.receive) + (Object.keys(T.use).length ? ' + plats : ' + list(T.use) : '') + '</div><div>Rend : ' + list(T.give) + '</div>' : '<span class="muted">pas encore demandé</span>';
      var btn = T && T.done ? '<span class="pill lv-Zen">Validé</span>' : '<button class="btn small primary" data-act="validateTransfo" data-team="' + t.id + '"' + (T ? '' : ' disabled') + '>Jetons échangés</button>';
      return '<tr><td><b>' + esc(t.name) + '</b></td><td>' + det + '</td><td class="muted">' + t.recipeLimit + ' max</td><td>' + btn + '</td></tr>';
    }).join('');
    return '<section class="panel" style="display:flex;flex-direction:column;gap:8px"><h2 style="font-size:18px">Transformation : échanges de jetons</h2><div class="tbl"><table><thead><tr><th>Ferme</th><th>Échange à faire</th><th>Limite</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="margin:0;font-size:13px">Reprenez les jetons de la colonne « Reçoit », donnez les jetons de plat, puis validez : le stock de plats de la ferme est mis à jour.</p></section>';
  }

  // Ventes du marche : chaque ferme declare, l'animateur verifie les produits remis puis paie.
  function marketPanel() {
    if (V.phase !== 'season' || V.step !== 3) return '';
    var rows = V.teams.map(function (t) {
      var S = t.sales, Q = S.quote;
      if (t.stopped) return '<tr><td><b>' + esc(t.name) + '</b></td><td colspan="4" class="muted">À l\'arrêt</td></tr>';
      var det = S.declared ? Q.lines.map(function (l) { var tg = l.tag === 'hot' ? ' 🔥' : l.tag === 'cold' ? ' ❄️' : ''; return esc(l.name) + tg + ' : ' + l.sup + ' super / ' + l.dir + ' étal' + (l.frac != null && l.dir ? ' (vendu ' + l.soldUnits + ')' : ''); }).join(' · ') || 'Rien placé' : '<span class="muted">Pas encore placé</span>';
      var amt = S.settled ? '<b class="num">' + S.amount + ' EB</b>' : Q.total == null ? '<span class="muted">roue ?</span>' : '<b class="num">' + Q.total + ' EB</b>';
      var btn = S.settled ? '<span class="pill lv-Zen">Payé</span>' : '<button class="btn small primary" data-act="settleSales" data-team="' + t.id + '"' + (S.declared && (t.wheel || !Q.stallUnits) ? '' : ' disabled') + '>Valider et payer</button>';
      return '<tr><td><b>' + esc(t.name) + '</b></td><td>' + (t.wheel ? esc(t.wheel.label) : '<span class="muted">pas tournée</span>') + '</td><td>' + det + '</td><td>' + amt + '</td><td>' + btn + '</td></tr>';
    }).join('');
    return '<section class="panel" style="display:flex;flex-direction:column;gap:8px"><h2 style="font-size:18px">Marché : ventes des fermes</h2><div class="tbl"><table><thead><tr><th>Ferme</th><th>Roue</th><th>Produits placés</th><th>À payer</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="margin:0;font-size:13px">Vérifiez les produits remis, puis validez : la banque de la ferme est créditée (part de l\'étal vendue selon la roue, frais d\'étal déduits).</p></section>';
  }

  var TIER = { 1: 'simple', 2: 'mixte', 3: 'composé' };
  function menuPanel() {
    var M = V.menu;
    if (!M) return '';
    var closing = V.phase === 'closing', locked = closing && V.closedYear;
    var rows = M.items.map(function (i) {
      var opts = '<option value="">— à prendre —</option>' + V.teams.map(function (t) { return '<option value="' + t.id + '"' + (i.team === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
      var deliv = closing ? '<button class="btn small ' + (i.delivered ? 'good' : '') + '" data-act="setDelivered" data-key="' + i.key + '" data-delivered="' + (i.delivered ? '' : '1') + '">' + (i.delivered ? '✓ Livré' : 'Livré ?') + '</button>' : '';
      return '<tr><td><b>' + esc(i.name) + '</b><div class="muted" style="font-size:13px">' + esc(TIER[i.tier]) + ' · ' + esc(i.needs) + (i.makers && i.makers.length ? ' · équipées : ' + esc(i.makers.join(', ')) : ' · aucune ferme équipée') + '</div></td><td><select data-assign="' + i.key + '" aria-label="Ferme responsable de ' + esc(i.name) + '">' + opts + '</select></td><td>' + deliv + '</td></tr>';
    }).join('');
    var free = M.items.filter(function (i) { return !i.team; }).length;
    var late = V.phase === 'season' && V.step >= 2;
    return '<section class="panel" style="display:flex;flex-direction:column;gap:10px"><div class="row" style="justify-content:space-between"><h2 style="font-size:28px">🎉 Commande de la Fête du Phoenix · année ' + V.year + '</h2><span class="muted">' + M.items.length + ' plats · ' + M.perFarm + ' par ferme · ' + (free ? free + ' à répartir' : 'tout est réparti') + '</span></div>' +
      '<div class="tbl"><table><thead><tr><th>Plat</th><th>Ferme responsable</th><th>' + (closing ? 'Livraison' : '') + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="row"><button class="btn small" data-act="autoAssign"' + (locked || !free ? ' disabled' : '') + '>Répartir le reste au hasard</button><button class="btn small" data-act="drawMenu"' + (!V.menu.open ? ' disabled' : '') + '>Tirer un autre menu</button></div></section>';
  }

  // Demarrage de l'annee : la commande de la fete doit etre entierement repartie.
  function startBtn(label) {
    var free = V.menu ? V.menu.items.filter(function (i) { return !i.team; }).length : 0;
    return '<button class="btn primary" data-act="startYear"' + (free ? ' disabled' : '') + '>' + label + '</button>' +
      (free ? '<div class="pill warn" style="align-self:flex-start">Il reste ' + free + ' plat' + (free > 1 ? 's' : '') + ' à répartir</div>' : '');
  }

  function closing() {
    var rows = V.teams.map(function (t) {
      var c = V.lastCharges && V.lastCharges[t.id];
      var ch = c || t.charges;
      return '<tr><td><b>' + esc(t.name) + '</b></td><td class="num">' + ch.taxes + '</td><td class="num">' + ch.eau + '</td><td class="num">' + ch.nourriture + '</td><td class="num">' + ch.electricite + '</td><td class="num"><b>' + ch.total + ' EB</b></td>' +
        '<td>' + (c ? (c.missing ? '<span class="pill lv-Stressé">Manque ' + c.missing + ' EB, +' + c.boules + ' boule(s)</span>' : '<span class="pill lv-Zen">Payé</span>') : '<span class="muted">À appliquer</span>') + '</td></tr>';
    }).join('');
    var f = V.fete;
    var buttons;
    if (!V.closedYear) buttons = '<button class="btn primary" data-act="closeYear">Appliquer les charges</button>';
    else if (!V.feteDone) buttons = '<button class="btn primary" data-act="fete">Jouer la fête (résultat selon les plats livrés)</button><details id="feteForce"><summary>Forcer le résultat</summary><div class="row" style="margin-top:6px"><button class="btn small good" data-act="fete" data-success="1">Réussie (−2 boules)</button><button class="btn small danger" data-act="fete" data-success="0">Ratée (+1 boule)</button></div></details>';
    else buttons = V.year < 3 ? '<button class="btn primary" data-act="nextYear">Année suivante (réaménagement 5 min)</button>' : '<button class="btn primary" data-act="finish">Terminer la partie</button>';
    return '<section class="panel" style="display:flex;flex-direction:column;gap:12px"><h2 style="font-size:20px">Clôture de l\'année ' + V.year + '</h2>' +
      '<div class="tbl"><table style="min-width:640px"><thead><tr><th>Ferme</th><th>Taxes</th><th>Eau</th><th>Nourriture</th><th>Électricité</th><th>Total</th><th>Résultat</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (V.feteDone ? '<span class="pill lv-Zen" style="align-self:flex-start">Fête jouée</span>' : '') +
      '<div class="row">' + buttons + '</div>' +
      '<p class="muted" style="margin:0;font-size:14px">Pense à décaler les badges de rôles d\'un cran avant le réaménagement.</p></section>' + menuPanel();
  }

  function ended() {
    var s = V.stars;
    var star = function (ok, label) { return '<div class="step ' + (ok ? 'won' : '') + '"><b class="n">' + (ok ? '★' : '☆') + '</b><span>' + label + '</span></div>'; };
    return '<section class="panel" style="display:flex;flex-direction:column;gap:12px"><h2 style="font-size:24px">Fin de partie : ' + s.count + ' étoile(s) sur 3</h2>' +
      star(s.s1, 'Aucun burn-out et aucune ferme au-dessus de 5 boules (pic : ' + s.peak + ')') +
      star(s.s2, 'Les trois fêtes du Phoenix réussies') +
      star(s.s3, 'Caisse du village : ' + s.totalBank + ' EB sur ' + s.target + ' EB attendus') +
      '<div>Ferme la plus riche : <b>' + esc(s.richest.join(', ')) + '</b></div><div>Trophée du Sage : <b>' + esc(s.sage.join(', ')) + '</b></div></section>';
  }

  function render() {
    if (!V) return;
    var h = header();
    if (V.phase === 'lobby') h += lobby();
    else {
      h += forecastBanner();
      if (V.phase === 'setup') {
        h += '<div class="cols">' + timerPanel('Installation des fermes', 'Avant l\'année 1') + '<section class="panel" style="flex:1 1 320px;display:flex;flex-direction:column;gap:10px"><p style="margin:0">1. La commande de la fête est tirée : les fermes se la répartissent. 2. Elles posent leurs tuiles et dépensent leurs 500 EB.</p>' + startBtn('Démarrer l\'année 1') + '</section></div>' + menuPanel() + teamsTable() + '';
      } else if (V.phase === 'season') {
        h += '<div class="cols">' + stepsPanel() + timerPanel(V.stepName, 'Étape ' + (V.step + 1) + ' sur 5') + (V.step <= 1 ? cardPanel() : V.card && V.card.collective ? '<section class="panel" style="flex:1 1 340px;display:flex;flex-direction:column;gap:10px"><h2 style="font-size:18px">Aléa collectif</h2>' + collectiveAdmin(V.card) + '</section>' : '') + '</div>' + tradesPanel() + transfoPanel() + marketPanel() + (V.step === 2 ? menuPanel() : '') + teamsTable() + '';
      } else if (V.phase === 'closing') {
        h += closing() + teamsTable() + '';
      } else if (V.phase === 'rearrange') {
        h += '<div class="cols">' + timerPanel('Réaménagement', 'Avant l\'année ' + V.year) + '<section class="panel" style="flex:1 1 320px;display:flex;flex-direction:column;gap:10px"><p style="margin:0">1. Répartition de la commande de la fête. 2. Achats de tuiles sur mobile (ou tuile gratuite ci-dessous). Décale les badges de rôles.</p>' + startBtn('Démarrer l\'année ' + V.year) + '</section></div>' + menuPanel() + teamsTable() + '';
      } else {
        h += ended() + teamsTable() + '';
      }
    }
    root.innerHTML = h + logModal() + docModal();
  }

  root.addEventListener('change', function (e) {
    var k = e.target && e.target.dataset && e.target.dataset.assign;
    if (k) conn.act('assignDish', { key: k, teamId: e.target.value });
    if (e.target && e.target.dataset && e.target.dataset.trip) conn.act('setTripSec', { sec: parseInt(e.target.value, 10) });
  });

  // ---------- Chrono local ----------
  function tick() {
    if (!V) return;
    var ms = FF.remaining(V);
    document.querySelectorAll('[data-clock]').forEach(function (el) {
      el.textContent = FF.fmt(ms);
      el.classList.toggle('low', V.timer.running && ms <= 10000);
    });
    document.querySelectorAll('[data-bar]').forEach(function (el) {
      el.style.width = (V.timer.durationMs ? Math.round((ms / V.timer.durationMs) * 100) : 0) + '%';
    });
  }
  setInterval(tick, 250);

  // ---------- Actions ----------
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  root.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    if (f.dataset.form === 'addTeam') {
      conn.act('addTeam', { name: val('newName'), profile: val('newProfile') }).then(function (r) { if (r && r.ok) document.getElementById('newName').value = ''; });
    }
  });

  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var a = b.dataset.act, t = b.dataset.team;
    if (a === 'copy') {
      var text = b.dataset.text;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { FF.toast('Lien copié.'); }, function () { FF.toast(text); });
      else FF.toast(text);
      return;
    }
    if (a === 'bank') {
      var amount = parseInt(val('amt-' + t), 10);
      if (!amount) return FF.toast('Saisis un montant (positif ou négatif).');
      return conn.act('bank', { teamId: t, amount: amount, label: val('lbl-' + t) }).then(function (r) { if (r && r.ok) { document.getElementById('amt-' + t).value = ''; document.getElementById('lbl-' + t).value = ''; } });
    }
    if (a === 'bocal') return conn.act('bocal', { teamId: t, delta: parseInt(b.dataset.delta, 10), reason: 'Ajustement animateur' });
    if (a === 'giftTile') return conn.act('giftTile', { teamId: t, tile: val('tile-' + t) });
    if (a === 'setReady') return conn.act('setReady', { teamId: t, ready: !!b.dataset.ready });
    if (a === 'validateTransfo') return conn.act('validateTransfo', { teamId: t });
    if (a === 'settleSales') return conn.act('settleSales', { teamId: t });
    if (a === 'spinWheel') return conn.act('spinWheel', { teamId: t });
    if (a === 'removeTeam') return conn.act('removeTeam', { teamId: t });
    if (a === 'fete') return conn.act('fete', b.dataset.success === undefined ? {} : { success: b.dataset.success === '1' });
    if (a === 'setDelivered') return conn.act('setDelivered', { key: b.dataset.key, delivered: !!b.dataset.delivered });
    if (a === 'autoAssign') return conn.act('autoAssign');
    if (a === 'drawMenu') return conn.act('drawMenu');
    if (a === 'timerAdjust') return conn.act('timerAdjust', { delta: parseInt(b.dataset.delta, 10) });
    if (a === 'timerSet') {
      var sec = parseInt(val('timerSec'), 10);
      if (!(sec >= 5)) return FF.toast('Saisis une durée d\'au moins 5 secondes.');
      var keepEl = document.getElementById('timerKeep');
      return conn.act('timerSet', { sec: sec, keep: !!(keepEl && keepEl.checked) }).then(function (r) { if (r && r.ok) FF.toast('Chrono réglé.'); });
    }
    if (a === 'cancelTrade' || a === 'revertTrade') return conn.act(a, { tradeId: b.dataset.trade });
    if (a === 'adjustHarvest') return conn.act('adjustHarvest', { teamId: t, product: b.dataset.product, delta: parseInt(b.dataset.delta, 10) });
    if (a === 'adjustContribution') return conn.act('adjustContribution', { teamId: t, delta: parseInt(b.dataset.delta, 10) });
    if (a === 'jumpTo') {
      var jy = parseInt(val('jumpYear'), 10), js = parseInt(val('jumpSeason'), 10);
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirmer le saut'; return; }
      return conn.act('jumpTo', { year: jy, season: js });
    }
    if (a === 'finish' && b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirmer : terminer la partie'; return; }
    conn.act(a);
  });
})();
