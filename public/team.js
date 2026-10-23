(function () {
  var esc = FF.esc;
  var code = (FF.qs.get('s') || '').toUpperCase();
  var token = FF.qs.get('t');
  var root = document.getElementById('app');
  var V = null, me = null;
  var tab = (location.hash || '#ferme').slice(1);
  if (['ferme', 'boutique', 'banque'].indexOf(tab) < 0) tab = 'ferme';

  var stored = null;
  try { stored = JSON.parse(localStorage.getItem('ff-team') || 'null'); } catch (e) { /* ignore */ }
  if (!token && !FF.qs.get('g') && stored && (!code || stored.code === code)) { code = stored.code; token = stored.token; }
  if (!code) { root.innerHTML = '<p style="padding:16px">Lien incomplet. Demande le lien de la partie à l\'animateur.</p>'; return; }
  if (!token) { guestScreen(); } else { boot(); }

  // Ecran de connexion unique : creer sa ferme ou reprendre une ferme existante.
  function guestScreen() {
    var G = null, busy = false;
    var gc = FF.connect({
      role: 'guest', code: code,
      onState: function (v) { G = v; draw(); },
      onFatal: function (m) { root.innerHTML = '<p style="padding:16px">' + esc(m) + '</p>'; }
    });
    function enter(r) {
      busy = false;
      if (!r || !r.ok || !r.token) return;
      try { localStorage.setItem('ff-team', JSON.stringify({ code: code, token: r.token })); } catch (e) { /* ignore */ }
      token = r.token; gc.socket.disconnect(); root.innerHTML = '<p style="padding:16px">Connexion…</p>'; boot();
    }
    function draw() {
      if (!G) return;
      var lobby = G.phase === 'lobby';
      var keep = document.getElementById('gName');
      var typed = keep ? keep.value : '';
      var list = G.teams.map(function (t) {
        return '<button class="btn" style="justify-content:flex-start;text-align:left;min-height:52px" data-join="' + esc(t.id) + '">🚜 ' + esc(t.name) + '</button>';
      }).join('');
      root.innerHTML = '<div style="padding:24px 16px;display:flex;flex-direction:column;gap:16px;max-width:460px;margin:0 auto">' +
        '<div style="text-align:center"><div style="font-family:\'Amatic SC\',cursive;font-size:44px;line-height:1">Farming\'s Folies</div><div class="muted">Partie ' + esc(code) + '</div></div>' +
        (lobby ? '<section class="panel" style="display:flex;flex-direction:column;gap:10px"><h2 style="font-size:20px">🌱 Créer ma ferme</h2>' +
          '<input id="gName" maxlength="40" placeholder="Nom de votre ferme" autocomplete="off" value="' + esc(typed) + '">' +
          '<button class="btn primary" data-create="1"' + (busy ? ' disabled' : '') + '>Créer ma ferme</button></section>' : '') +
        '<section class="panel" style="display:flex;flex-direction:column;gap:8px"><h2 style="font-size:20px">🔑 ' + (lobby ? 'Rejoindre ma ferme' : 'Reprendre ma ferme') + '</h2>' +
        (list || '<p class="muted" style="margin:0">Aucune ferme pour le moment.' + (lobby ? ' Créez la vôtre ci-dessus.' : '') + '</p>') + '</section></div>';
    }
    root.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b || busy) return;
      if (b.dataset.join) { busy = true; gc.act('joinTeam', { teamId: b.dataset.join }).then(enter); }
      else if (b.dataset.create) { busy = true; gc.act('createTeam', { name: (document.getElementById('gName') || {}).value || '' }).then(enter); }
    });
    root.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'gName') { var b = root.querySelector('[data-create]'); if (b) b.click(); } });
  }

  function boot() {
  try { localStorage.setItem('ff-team', JSON.stringify({ code: code, token: token })); } catch (e) { /* ignore */ }
  var conn = FF.connect({
    role: 'team', code: code, token: token,
    onState: function (v) { notifyIncoming(v); buzzOnChange(v); V = v; me = v.teams.filter(function (t) { return t.id === v.me; })[0]; FF.keepInputs(root, render); tick(); },
    onFatal: function (m) { root.innerHTML = '<p style="padding:16px">' + esc(m) + '</p>'; }
  });

  var PHASE = { lobby: 'En attente du départ', setup: 'Installation', closing: 'Clôture de l\'année', rearrange: 'Réaménagement', end: 'Partie terminée' };

  function context() {
    if (V.phase === 'season') return 'Année ' + V.year + ' · ' + V.seasonName + ' · ' + V.meta.steps[V.step].name;
    return PHASE[V.phase] + (V.phase === 'closing' || V.phase === 'rearrange' ? ' · année ' + V.year : '');
  }

  function bocalPanel() {
    var left = V.meta.bocalMax - me.bocal;
    return '<section class="panel" style="display:flex;flex-direction:column;gap:8px"><div class="row" style="justify-content:space-between"><b>🫙 Bocal de stress</b><span class="row" style="gap:8px"><span class="pill lv-' + me.level + '">' + me.level + '</span><span class="num muted">' + me.bocal + ' / ' + V.meta.bocalMax + '</span></span></div>' +
      FF.dots(me.bocal, V.meta.bocalMax) + '<div class="muted" style="font-size:13px">' + (me.stopped ? 'Burn-out : votre ferme est à l\'arrêt cette saison.' : 'Encore ' + left + ' boule' + (left > 1 ? 's' : '') + ' avant le burn-out.') + '</div></section>';
  }

  function transferPanel() {
    var R = V.meta.transferReasons;
    var to = val('trTo') || 'animateur';
    var others = V.teams.filter(function (t) { return t.id !== me.id; });
    if (to !== 'animateur' && !others.some(function (t) { return t.id === to; })) to = 'animateur';
    var reasons = (to === 'animateur' ? R.animateur : R.ferme).map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('');
    var dest = '<option value="animateur"' + (to === 'animateur' ? ' selected' : '') + '>L\'animateur (taxe, achat…)</option>' +
      others.map(function (t) { return '<option value="' + esc(t.id) + '"' + (to === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
    var open = ['setup', 'season', 'closing', 'rearrange'].indexOf(V.phase) >= 0;
    return '<section class="panel" style="display:flex;flex-direction:column;gap:10px"><b>💸 Faire un virement</b>' +
      '<label for="trTo" class="muted" style="font-size:13px">Vers</label><select id="trTo">' + dest + '</select>' +
      '<label for="trReason" class="muted" style="font-size:13px">Motif</label><select id="trReason">' + reasons + '</select>' +
      '<label for="trAmount" class="muted" style="font-size:13px">Montant (EB)</label><input id="trAmount" inputmode="numeric" placeholder="Ex. 40">' +
      '<button class="btn primary" data-act="transfer"' + (open ? '' : ' disabled') + '>Envoyer le virement</button></section>';
  }

  function banque() {
    var ch = me.charges;
    var mv = me.ledger.length ? me.ledger.map(function (m) {
      return '<div class="mv"><div style="flex:1"><div>' + esc(m.label) + '</div><div class="muted" style="font-size:12px">Année ' + m.year + ' · ' + esc(V.meta.seasons[m.season].name) + '</div></div><div class="num ' + (m.amount > 0 ? 'pos' : 'neg') + '">' + (m.amount > 0 ? '+' : '−') + Math.abs(m.amount) + ' EB</div></div>';
    }).join('') : '<p class="muted" style="margin:0">Aucun mouvement pour le moment.</p>';
    return '<section class="t-bank"><div class="sub">💰 Compte en banque</div><div class="big">' + me.bank + ' <small>EB</small></div>' +
      '<div class="row" style="justify-content:space-between;margin-top:12px;border-top:1px solid rgba(255,255,255,.2);padding-top:10px;font-size:14px"><span class="sub">Charges estimées à la clôture</span><b class="num">' + ch.total + ' EB</b></div>' +
      '<div class="row" style="justify-content:space-between;font-size:14px"><span class="sub">Reste après charges</span><b class="num">' + (me.bank - ch.total) + ' EB</b></div></section>' +
      activeCollective() + transferPanel() +
      '<section class="panel"><b>Derniers mouvements</b><div style="margin-top:4px">' + mv + '</div></section>';
  }

  // Alea collectif : le village reunit un objectif commun avant l'echeance (argent, plats, jetons bruts ou boules).
  function dueName(c) { var st = V.meta.steps.filter(function (x) { return x.id === c.due; })[0]; return st ? st.name : ''; }
  function potSum(c) { return Object.keys(c.pot || {}).reduce(function (n, k) { return n + c.pot[k]; }, 0); }
  // Alea collectif en cours (ou regle cette saison) : reste accessible apres l'annonce, depuis la ferme et la banque.
  function activeCollective() {
    return V.phase === 'season' && V.card && V.card.collective ? collectivePanel(V.card) : '';
  }
  function collectivePanel(c) {
    var tot = potSum(c), left = Math.max(0, c.need - tot), pct = Math.min(100, Math.round(tot / c.need * 100));
    var bar = '<div class="bar" style="height:14px"><i style="width:' + pct + '%"></i></div><div class="row" style="justify-content:space-between"><b class="num">' + tot + ' / ' + c.need + '</b><span class="muted" style="font-size:13px">avant la fin de l\'étape « ' + esc(dueName(c)) + ' »</span></div>';
    var who = V.teams.filter(function (t) { return (c.pot || {})[t.id]; }).map(function (t) { return esc(t.name) + ' ' + c.pot[t.id]; }).join(' · ');
    var done = c.resolved !== null && c.resolved !== undefined;
    var g = c.goal, form = '';
    if (!done && left > 0 && !me.stopped) {
      var max = g.kind === 'eb' ? Math.min(left, me.bank) : g.kind === 'dish' ? Math.min(left, me.pantry[g.dish] || 0) : left;
      var label = g.kind === 'eb' ? 'Donner (EB)' : g.kind === 'dish' ? 'Offrir (plats)' : g.kind === 'raw' ? 'Je les ai remis à l\'animateur' : 'Je prends les boules';
      var hint = g.kind === 'dish' ? 'En stock : ' + (me.pantry[g.dish] || 0) : g.kind === 'raw' ? 'Remettez d\'abord les jetons à l\'animateur, puis déclarez-les ici.' : g.kind === 'boule' ? 'Volontaires : chaque boule prise compte pour l\'objectif.' : 'Banque : ' + me.bank + ' EB';
      form = '<div class="row"><input id="giveN" inputmode="numeric" placeholder="Quantité" style="width:110px"' + (max < 1 && g.kind !== 'raw' && g.kind !== 'boule' ? ' disabled' : '') + '><button class="btn primary" data-act="contribute">' + label + '</button></div><div class="muted" style="font-size:13px">' + hint + '</div>';
    }
    var res = !done ? '' : c.resolved ? '<div class="pill ok" style="align-self:flex-start">Objectif atteint</div><div>' + esc(c.winText) + '</div>' : '<div class="pill bad" style="align-self:flex-start">Objectif manqué</div><div>' + esc(c.loseText) + '</div>';
    return '<section class="panel stack" style="border-color:var(--pb)"><div class="row" style="justify-content:space-between"><b>🤝 Aléa collectif</b><span class="pill warn">Tout le village</span></div>' +
      '<div style="font-family:var(--f-display);font-size:42px;line-height:1;color:var(--sand);font-weight:700">' + esc(c.title) + '</div><div>' + esc(c.story) + '</div>' +
      '<div><b>Objectif commun : ' + esc(c.goalText) + '</b></div>' + bar + (who ? '<div class="muted" style="font-size:13px">' + who + '</div>' : '') + form + res +
      '<div class="muted" style="font-size:13px">Si le village y arrive : ' + esc(c.winText) + ' Sinon : ' + esc(c.loseText) + '</div></section>';
  }

  function alea() {
    var die = V.die ? '<div class="row panel soft" style="padding:10px 14px;gap:10px"><div style="width:40px;height:40px;border-radius:10px;background:var(--fg);color:var(--bg);display:grid;place-items:center;font-size:24px;font-weight:800">' + V.die + '</div><div><div class="muted" style="font-size:12px">Dé des activités</div><b>' + esc(V.dieLabel || '') + '</b></div></div>' : '';
    if (V.phase !== 'season' || !V.card) return '<section class="panel stack"><b>🎴 Carte aléa</b><p class="muted" style="margin:0">L\'animateur n\'a pas encore tiré la carte.</p></section>' + meteo() + die;
    var c = V.card, has = c.parade && me.equipment.indexOf(c.parade) >= 0;
    var par = c.parade ? (V.meta.catalogue.filter(function (x) { return x.id === c.parade; })[0] || {}).name : null;
    if (c.collective) return collectivePanel(c) + die;
    var neg = c.tone === 'neg';
    var btn = function (k, label, sub, dis) { return '<button class="btn ' + (me.choice === k ? 'primary' : '') + '" data-act="choice" data-choice="' + k + '"' + (dis ? ' disabled' : '') + '><span><b>' + (me.choice === k ? '✓ ' : '') + label + '</b><small>' + sub + '</small></span></button>'; };
    var choices = neg
      ? '<div class="choice">' + btn('subit', 'Subir l\'effet', 'On encaisse, on continue.') + btn('parade', 'Jouer la parade', par ? (has ? esc(par) + ' : vous l\'avez !' : esc(par) + ' : vous ne l\'avez pas') : 'Pas de parade pour cette carte', !has) + btn('boule', 'Éviter avec +1 boule', 'L\'effet est évité, le bocal se remplit.') + '</div>'
      : '<div class="muted" style="font-size:14px">Bonne nouvelle : rien à faire, profitez-en !</div>';
    return '<section class="panel stack" style="border-color:' + (neg ? 'var(--bad)' : 'var(--teal)') + '"><div class="row" style="justify-content:space-between"><b>🎴 Carte aléa</b><span class="pill ' + (neg ? 'bad' : 'ok') + '">' + (neg ? 'Négatif' : 'Positif') + '</span></div>' +
      '<div style="font-family:var(--f-display);font-size:42px;line-height:1;color:var(--sand);font-weight:700">' + esc(c.title) + '</div><div>' + esc(c.effect) + '</div>' + choices + '</section>' + die;
  }

  // Jetons a rapporter : tuiles x valeur de la grille (modifiee par la carte aleas, sauf si la ferme est protegee).
  function harvestPanel() {
    if (V.phase !== 'season' || !me.harvest || !me.harvest.length) return '';
    var rows = me.harvest.map(function (h) {
      var ch = h.perTile !== h.basePerTile;
      return '<div class="row" style="justify-content:space-between;flex-wrap:nowrap"><span style="display:flex;align-items:center;gap:8px"><i style="width:12px;height:12px;border-radius:50%;background:' + h.color + ';border:1px solid var(--line2);display:inline-block"></i>' + esc(h.name) + '</span>' +
        '<span class="num">' + h.tiles + ' tuile' + (h.tiles > 1 ? 's' : '') + ' × ' + (ch ? '<s class="muted">' + h.basePerTile + '</s> ' : '') + '<b>' + h.perTile + '</b> = <b style="font-size:20px;color:' + (ch ? (h.perTile < h.basePerTile ? 'var(--bad)' : 'var(--good)') : 'inherit') + '">' + h.tokens + '</b></span></div>';
    }).join('');
    var tot = me.harvest.reduce(function (n, h) { return n + h.tokens; }, 0);
    var prot = V.card && V.card.tone === 'neg' && me.exempt ? '<div class="muted" style="font-size:13px">Effet de « ' + esc(V.card.title) + ' » évité : valeurs de base.</div>' : '';
    var early = me.stopEarly ? '<div style="font-weight:700;color:var(--bad)">Canicule : arrêtez de récolter à ' + FF.fmt(me.stopEarly * 1000) + ' du chrono.</div>' : '';
    return '<section class="panel" style="display:flex;flex-direction:column;gap:6px"><div class="row" style="justify-content:space-between"><b>Jetons à rapporter cette saison</b><b class="num">' + tot + '</b></div>' + rows + prot + early + '</section>';
  }

  var TIER = { 1: 'simple', 2: 'mixte', 3: 'composé' };
  // Menu de la fete : les equipes se repartissent les plats, chacune assume les siens a la cloture.
  function fetePanel(compact) {
    var M = V.menu;
    if (!M || V.phase === 'end' || V.phase === 'lobby') return '';
    var mine = M.items.filter(function (i) { return i.team === me.id; }).length;
    var locked = !M.open;
    var allMine = mine >= M.perFarm;
    var rows = M.items.filter(function (i) { return !(compact && allMine) || i.team === me.id; }).map(function (i) {
      var right;
      if (!M.open && V.phase === 'closing' && V.closedYear) right = i.delivered ? '<b style="color:var(--good)">✓ livré</b>' : '<b style="color:var(--bad)">à livrer</b>';
      else if (!M.open) right = i.team === me.id ? '<span class="pill ok">À vous</span>' : '<span class="muted" style="font-size:13px">' + esc(i.teamName || '—') + '</span>';
      else if (i.team === me.id) right = '<button class="btn small" data-act="releaseDish" data-key="' + i.key + '">Rendre</button>';
      else if (i.team) right = '<span class="muted" style="font-size:13px">' + esc(i.teamName) + '</span>';
      else right = '<button class="btn small primary" data-act="claimDish" data-key="' + i.key + '"' + (mine >= M.perFarm || locked ? ' disabled' : '') + '>Je prends</button>';
      return '<div class="row" style="justify-content:space-between;flex-wrap:nowrap;padding:6px 0;border-top:1px solid var(--line);' + (i.team === me.id ? 'background:var(--warn-soft);margin:0 -8px;padding-left:8px;padding-right:8px;border-radius:8px' : '') + '"><div style="min-width:0"><b>' + esc(i.name) + '</b><div class="muted" style="font-size:13px">' + esc(TIER[i.tier]) + ' · ' + esc(i.needs) + (i.makers && i.makers.length ? ' · équipées : ' + esc(i.makers.join(', ')) : ' · aucune ferme équipée') + '</div></div>' + right + '</div>';
    }).join('');
    var status = mine >= M.perFarm ? '<span style="color:var(--good);font-weight:700">Vos ' + M.perFarm + ' plats sont pris.</span>' : '<span style="color:var(--bad);font-weight:700">Il vous reste ' + (M.perFarm - mine) + ' plat' + (M.perFarm - mine > 1 ? 's' : '') + ' à prendre.</span>';
    return '<section class="panel" style="display:flex;flex-direction:column;gap:4px;background:var(--surface-2)"><div class="row" style="justify-content:space-between"><b>Fête du Phoenix · année ' + V.year + '</b><span class="num muted">' + mine + ' / ' + M.perFarm + '</span></div>' +
      '<div style="font-size:14px">Répartissez-vous le menu entre fermes : chacune prend ' + M.perFarm + ' plat' + (M.perFarm > 1 ? 's' : '') + ' en début d\'année, puis les livre avant la clôture. Un plat manquant fait rater la fête et coûte une boule de plus à son responsable.</div>' + status + rows + '</section>';
  }

  // Transformation : l'equipe choisit les plats a fabriquer, l'animateur echange les jetons puis valide.
  function tokenList(o, names) {
    var parts = Object.keys(o || {}).map(function (k) { return o[k] + ' ' + (names[k] || k); });
    return parts.length ? parts.join(' + ') : '—';
  }
  function transfoPanel() {
    if (V.phase !== 'season' || V.step !== 2 || me.stopped) return '';
    var T = me.transfo, done = T && T.done, items = T ? T.items : {};
    var TN = { 1: 'Recettes simples · valeur ×', 2: 'Recettes mixtes · valeur ×', 3: 'Plats composés · valeur ×' };
    var KEY = ['', 'simple', 'mixed', 'composed'];
    var prodNames = {}; V.meta.products.forEach(function (p) { prodNames[p.id] = p.name.toLowerCase(); });
    var dishNames = {}; V.meta.dishes.forEach(function (d) { dishNames[d.id] = d.name.toLowerCase(); });
    var all = {}; for (var k in prodNames) all[k] = prodNames[k]; for (k in dishNames) all[k] = dishNames[k];
    var form = [1, 2, 3].map(function (tier) {
      return '<div style="margin-top:4px;font-weight:700">' + TN[tier] + V.meta.market.mult[KEY[tier]] + '</div>' + V.meta.dishes.filter(function (d) { return d.tier === tier; }).map(function (d) {
        return '<div class="row" style="justify-content:space-between;flex-wrap:nowrap"><label for="tr-' + d.id + '" style="flex:1"><b>' + esc(d.name) + '</b><div class="muted" style="font-size:12px">' + esc(d.needs) + ' · en stock : ' + (me.pantry[d.id] || 0) + '</div></label><input id="tr-' + d.id + '" inputmode="numeric" style="width:64px" placeholder="0" value="' + (items[d.id] || '') + '"' + (done ? ' disabled' : '') + '></div>';
      }).join('');
    }).join('');
    var recap = T && Object.keys(items).length ? '<div style="background:var(--surface-2);border-radius:10px;padding:8px 10px;font-size:14px"><div><b>À apporter à l\'animateur :</b> ' + esc(tokenList(T.receive, all)) + (Object.keys(T.use).length ? ' + vos plats : ' + esc(tokenList(T.use, all)) : '') + '</div><div><b>Vous recevez :</b> ' + esc(tokenList(T.give, all)) + '</div></div>' : '';
    var st = done ? '<div style="color:var(--good);font-weight:700">Validé : les plats sont dans votre stock.</div>' : T ? '<div style="font-weight:700;color:var(--warn)">Demande envoyée : apportez les jetons à l\'animateur.</div>' : '';
    return '<section class="panel" style="display:flex;flex-direction:column;gap:8px"><div class="row" style="justify-content:space-between"><b>Transformation</b><span class="num muted">max ' + me.recipeLimit + ' recette' + (me.recipeLimit > 1 ? 's' : '') + '</span></div>' +
      '<div class="muted" style="font-size:13px">Choisissez les plats à fabriquer. L\'app calcule les jetons à apporter à l\'animateur et ceux que vous recevez en échange. Un plat composé utilise des plats déjà fabriqués.</div>' + form + recap +
      '<button class="btn primary" data-act="requestTransfo"' + (done ? ' disabled' : '') + '>' + (T ? 'Modifier ma demande' : 'Envoyer ma demande') + '</button>' + st + '</section>';
  }

  // Stock : jetons bruts de la saison (apres recettes) et plats transformes.
  function stockPanel() {
    if (!me.stock) return '';
    var chips = [];
    V.meta.sell.forEach(function (x) {
      var n = x.kind === 'raw' ? me.stock.raw[x.id] : me.stock.dishes[x.id];
      if (n > 0) chips.push('<span class="pill" style="font-size:14px">' + (x.kind === 'raw' ? (FF.ICON[x.id] || '') + ' ' : '') + esc(x.name) + ' <b>' + n + '</b></span>');
    });
    return '<section class="panel stack"><b>📦 Mon stock</b>' + (chips.length ? '<div class="row" style="gap:6px">' + chips.join('') + '</div>' : '<div class="muted" style="font-size:14px">Rien en stock pour le moment.</div>') +
      '<div class="muted" style="font-size:12px">Jetons bruts : récolte de la saison moins les recettes. Les jetons non vendus ni transformés sont perdus en fin de saison.</div></section>';
  }

  // Marche : 1) placer les produits (supermarche garanti / etal risque) 2) roue 3) paiement par l'animateur.
  function marketPanel() {
    if (V.phase !== 'season' || V.step !== 3 || !me.sales) return '';
    var S = me.sales, Q = S.quote, M = V.meta.market;
    if (me.stopped) return '<section class="panel"><b>Marché</b><p class="muted" style="margin:6px 0 0">Votre ferme est à l\'arrêt cette saison.</p></section>';
    var locked = S.settled || !!me.wheel;
    var kinds = [['raw', 'Produits bruts'], [1, 'Plats simples'], [2, 'Plats mixtes'], [3, 'Plats composés']];
    var rows = kinds.map(function (k) {
      var list = V.meta.sell.filter(function (x) { return k[0] === 'raw' ? x.kind === 'raw' : x.tier === k[0]; });
      var head = '<tr><td colspan="3" class="muted" style="font-size:12px;padding-top:8px;text-transform:uppercase;letter-spacing:.06em">' + k[1] + '</td></tr>';
      return head + list.map(function (x) {
        var stock = x.kind === 'raw' ? me.stock.raw[x.id] : me.stock.dishes[x.id] || 0;
        var none = !(stock > 0);
        var cell = function (w, extraOff) { return '<td><input id="sale-' + w + '_' + x.id + '" inputmode="numeric" max="' + stock + '" style="width:56px" placeholder="0" value="' + (S[w + '_' + x.id] || '') + '"' + (locked || none || extraOff ? ' disabled' : '') + '></td>'; };
        return '<tr style="' + (none ? 'opacity:.4' : '') + '"><td><b>' + esc(x.name) + '</b><div class="muted" style="font-size:11px">stock : ' + stock + ' · ' + x.mult * M.superPrice + ' / ' + x.mult * M.directPrice + ' EB</div></td>' + cell('sup') + cell('dir', Q.directBlocked) + '</tr>';
      }).join('');
    }).join('');
    var grid = '<table style="width:100%"><thead><tr><th></th><th>Supermarché<div class="muted" style="font-size:11px;font-weight:400">garanti</div></th><th>Étal<div class="muted" style="font-size:11px;font-weight:400">max ' + Q.cap + ' · frais ' + M.stallFee + '</div></th></tr></thead><tbody>' + rows + '</tbody></table>';
    var wheel = me.wheel ? '<div style="font-size:22px;font-weight:800">' + esc(me.wheel.label) + '</div>' : '<div class="muted">La roue ne concerne que l\'étal.</div>';
    var canSpin = S.declared && !S.settled && Q.stallUnits > 0;
    var spin = Q.stallUnits > 0 || me.wheel ? '<button class="btn" data-act="spinWheel"' + (canSpin ? '' : ' disabled') + '>' + (me.wheel ? (me.freeSpin ? 'Relancer la roue (gratuit)' : 'Relancer la roue (+1 boule)') : 'Tourner la roue de l\'étal') + '</button>' : '';
    var est = 'Supermarché garanti : <b class="num">' + Q.safeTotal + ' EB</b>' + (Q.total == null ? (Q.stall ? ' <span class="muted">· étal jusqu\'à ' + Q.stall + ' EB selon la roue et le goût du moment, frais ' + Q.fee + '</span>' : '') : '<br>Total estimé : <b class="num">' + Q.total + ' EB</b> <span class="muted">(étal vendu : ' + Q.soldUnits + ' sur ' + Q.stallUnits + ', frais ' + Q.fee + ')</span>');
    var report = Q.report && Q.report.length ? '<div class="stack" style="gap:6px"><b>📣 Retour du marché</b>' + Q.report.map(function (l) { return '<div style="border-left:4px solid ' + (l.level === 'tout' || l.level === 'bien' ? 'var(--good)' : 'var(--bad)') + ';padding-left:10px">' + esc(l.text) + '</div>'; }).join('') + '</div>' : '';
    var status = S.settled ? '<div style="color:var(--good);font-weight:700">Payé : ' + (S.amount >= 0 ? '+' : '−') + Math.abs(S.amount) + ' EB. Bien joué !</div>' : me.wheel ? '<div style="font-weight:700;color:var(--warn)">Montrez vos produits à l\'animateur : il vérifie et paie.</div>' : S.declared ? '<div style="font-weight:700;color:var(--warn)">Placement validé : tournez la roue de l\'étal, ou attendez le paiement du supermarché.</div>' : '';
    var warn = Q.directBlocked ? '<div style="color:var(--bad);font-weight:700">Pas de vente directe cette saison.</div>' : '';
    var intro = '<div class="muted" style="font-size:13px">1. Placez vos produits (seuls ceux en stock sont ouverts). 2. Tournez la roue : elle dit quelle part de l\'étal se vend, et le goût du moment avantage ou pénalise certains produits. Les invendus sont perdus.</div>';
    return '<section class="panel" style="display:flex;flex-direction:column;gap:8px"><div class="row" style="justify-content:space-between"><b>Marché</b>' + wheel + '</div>' + intro + warn + grid +
      '<button class="btn primary" data-act="declareSales"' + (locked ? ' disabled' : '') + '>' + (S.declared ? 'Modifier le placement' : 'Valider le placement') + '</button>' + spin + '<div>' + est + '</div>' + report + status + '</section>';
  }

  // ---------- Ecran "Ferme" : seul ce qui sert a l'etape en cours ----------
  var STEP_HINT = [
    'Une carte tombe sur le village. Choisissez comment réagir.',
    'Un coureur par type de produit : rapportez les jetons de la grille.',
    'Fabriquez vos plats avec l\'animateur.',
    'Placez vos produits, puis tournez la roue de l\'étal.',
    'Vacances et matériel : détendez-vous et équipez la ferme.'
  ];

  function hero(icon, eyebrow, title, hint) {
    return '<section class="t-hero"><div class="eyebrow">' + esc(eyebrow) + '</div><h2>' + icon + ' ' + esc(title) + '</h2>' + (hint ? '<div class="muted">' + esc(hint) + '</div>' : '') + '</section>';
  }

  function readyCard() {
    return '<button class="btn ' + (me.ready ? 'good' : 'primary') + ' block" style="min-height:54px;font-size:16px" data-act="ready">' + (me.ready ? '✓ Prêts ! On attend les autres' : '👍 Nous sommes prêts pour la suite') + '</button>';
  }

  function farmCard() {
    var tiles = Object.keys(me.tilesByType).filter(function (k) { return me.tilesByType[k] > 0; }).map(function (k) { return '<span class="pill">' + (FF.ICON[k] || '') + ' ' + me.tilesByType[k] + ' · ' + esc(V.meta.tileNames[k]) + '</span>'; }).join(' ') || '<span class="muted">Aucune tuile</span>';
    var eq = me.equipment.length ? me.equipment.map(function (id) { return '<span class="pill">' + ((FF.ICON.equip || {})[id] || '') + ' ' + esc((V.meta.catalogue.filter(function (x) { return x.id === id; })[0] || {}).name || id) + '</span>'; }).join(' ') : '<span class="muted">Aucun matériel</span>';
    return '<details id="myfarm" class="panel"><summary>🏡 Ma ferme</summary><div class="stack" style="margin-top:8px"><div class="row" style="gap:6px">' + tiles + '</div><div class="row" style="gap:6px">' + eq + '</div></div></details>';
  }

  function collierPanel() {
    return '<section class="panel stack"><b>🐎 Coup de collier</b><div class="muted" style="font-size:14px">Chaque voyageur supplémentaire rapporte 2 jetons de plus, au prix d\'une boule de stress.</div>' +
      '<button class="btn" data-act="collier">Lancer le coup de collier (+1 boule)</button></section>';
  }

  function vacationPanel() {
    var opts = [1, 2, 3, 4, 5, 6].map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');
    return '<section class="panel stack"><b>🏖️ Vacances</b><div class="muted" style="font-size:14px">Chaque voyageur retire des boules de stress. ' + V.meta.vacationCost + ' EB par personne.</div>' +
      '<div class="row"><label for="vacN">Voyageurs</label><select id="vacN" style="width:80px">' + opts + '</select><button class="btn primary" style="flex:1" data-act="vacation">Envoyer en vacances</button></div></section>';
  }

  function buyHint() {
    var can = V.canExpand ? 'Matériel et agrandissements' : 'Matériel';
    return '<section class="panel soft row" style="justify-content:space-between"><span>🛍️ ' + can + ' : à la boutique</span><button class="btn small primary" data-tab="boutique">Ouvrir la boutique</button></section>';
  }

  function chargesCard() {
    var ch = me.charges, c = V.lastCharges;
    var rows = [['Taxes', ch.taxes], ['Eau', ch.eau], ['Nourriture', ch.nourriture], ['Électricité', ch.electricite]].map(function (r) { return '<div class="row" style="justify-content:space-between"><span>' + r[0] + '</span><b class="num">' + r[1] + ' EB</b></div>'; }).join('');
    var res = c ? (c.missing ? '<div class="pill bad">Il manquait ' + c.missing + ' EB : +' + c.boules + ' boule(s)</div>' : '<div class="pill ok">Charges payées</div>') : '<div class="muted" style="font-size:14px">Le comptable les paie quand l\'animateur les applique.</div>';
    return '<section class="panel stack"><b>🧾 Charges de l\'année</b>' + rows + '<hr class="hr"><div class="row" style="justify-content:space-between"><b>Total</b><b class="num">' + ch.total + ' EB</b></div>' + res + '</section>';
  }

  function ferme() {
    if (V.phase === 'end') return ended();
    if (V.phase === 'lobby') return hero('🚜', 'Bienvenue', 'On attend le départ', 'L\'animateur va lancer l\'installation. Gardez cet écran ouvert.') + farmCard();
    if (V.phase === 'setup' || V.phase === 'rearrange') {
      var setup = V.phase === 'setup';
      return hero(setup ? '🏡' : '🔧', setup ? 'Installation' : 'Réaménagement · avant l\'année ' + V.year, setup ? 'Montez votre ferme' : 'Adaptez votre ferme', 'Regardez le menu de la fête, répartissez les plats, puis achetez vos tuiles et votre matériel.') +
        meteo() + fetePanel() + buyHint() + readyCard() + farmCard();
    }
    if (V.phase === 'closing') {
      return hero('🎉', 'Clôture de l\'année ' + V.year, V.closedYear ? 'La Fête du Phoenix' : 'Le bilan de l\'année', V.closedYear ? 'Les plats sont livrés à l\'animateur.' : 'L\'animateur applique les charges, puis la fête commence.') +
        chargesCard() + fetePanel() + meteo() + farmCard();
    }
    var st = V.step, h = hero(FF.ICON.steps[st], 'Étape ' + (st + 1) + ' sur 5', V.meta.steps[st].name, STEP_HINT[st]);
    var col = st === 0 ? '' : activeCollective();
    if (me.stopped) return h + col + '<section class="panel warn"><b>😴 Burn-out</b><div>Votre ferme est à l\'arrêt cette saison : récupérez ! Les virements restent possibles.</div></section>' + bocalPanel() + farmCard();
    if (st === 0) return h + alea() + bocalPanel() + readyCard() + farmCard();
    if (st === 1) return h + col + harvestPanel() + collierPanel() + readyCard() + farmCard();
    if (st === 2) return h + col + stockPanel() + transfoPanel() + fetePanel(true) + readyCard() + farmCard();
    if (st === 3) return h + col + marketPanel() + readyCard() + farmCard();
    return h + col + meteo() + stockPanel() + bocalPanel() + vacationPanel() + buyHint() + fetePanel(true) + readyCard() + farmCard();
  }

  function shopItem(i) {
    var locked = i.kind === 'tile' && !V.canExpand;
    var can = !locked && V.canShop && i.price != null && me.bank >= i.price && !(V.phase === 'closing' && !V.closedYear);
    var label = i.owned || i.price == null ? 'Déjà acheté' : locked ? 'Fin d\'année' : 'Acheter';
    var ic = i.kind === 'tile' ? (FF.ICON[i.id.replace('tile_', '')] || '🏡') : ((FF.ICON.equip || {})[i.id] || '🧰');
    return '<div class="shop"><div style="font-size:28px" aria-hidden="true">' + ic + '</div><div style="flex:1;min-width:0"><b>' + esc(i.name) + '</b><div class="muted" style="font-size:13px">' + esc(i.effect) + '</div></div><div style="text-align:right"><div class="num" style="font-weight:800">' + (i.price == null ? '–' : i.price + ' EB') + '</div><button class="btn small ' + (can ? 'primary' : '') + '" data-act="buy" data-item="' + i.id + '"' + (can ? '' : ' disabled') + '>' + label + '</button></div></div>';
  }

  function boutique() {
    var tiles = me.shop.filter(function (i) { return i.kind === 'tile'; }), eq = me.shop.filter(function (i) { return i.kind !== 'tile'; });
    var tileNote = V.canExpand ? '<div class="muted" style="font-size:13px">Les agrandissements s\'achètent maintenant : plus tard, il faudra attendre la fin de l\'année.</div>' : '<div class="panel warn" style="padding:10px 14px">🔒 Les agrandissements s\'achètent seulement à l\'installation et en fin d\'année.</div>';
    var eqNote = V.canShop ? '' : '<div class="panel warn" style="padding:10px 14px">🔒 Le matériel s\'achète à l\'étape Achats.</div>';
    var undo = me.undo ? '<div class="panel row" data-undo="' + (Date.now() + me.undo.ms) + '" style="justify-content:space-between"><span>Achat : <b>' + esc(me.undo.name) + '</b></span><button class="btn small" data-act="undoBuy">↩ Annuler</button></div>' : '';
    return undo + '<div class="row" style="justify-content:space-between"><h2 style="font-size:40px">Boutique</h2><span class="pill num">💰 ' + me.bank + ' EB</span></div>' +
      '<div class="muted" style="font-size:14px">Seul le comptable valide un achat. Annoncez-le à l\'équipe avant de confirmer.</div>' +
      '<h3 style="font-size:30px;margin-top:6px">🏡 Agrandissements</h3>' + tileNote + tiles.map(shopItem).join('') +
      '<h3 style="font-size:30px;margin-top:6px">🧰 Matériel</h3>' + eqNote + eq.map(shopItem).join('');
  }

  function ended() {
    var s = V.stars;
    var stars = '<div class="stars" style="font-size:54px;text-align:center">' + '★'.repeat(s.count) + '<span class="muted">' + '☆'.repeat(3 - s.count) + '</span></div>';
    return hero('🏆', 'Fin de la partie', 'Le village a gagné ' + s.count + ' étoile' + (s.count > 1 ? 's' : ''), '') + '<section class="panel stack" style="text-align:center">' + stars +
      '<div>Ferme la plus riche : <b>' + esc(s.richest.join(', ')) + '</b></div><div>Trophée du Sage : <b>' + esc(s.sage.join(', ')) + '</b></div></section>';
  }

  var seenIn = null;
  function notifyIncoming(v) {
    var m = v.teams.filter(function (t) { return t.id === v.me; })[0];
    if (!m) return;
    var last = m.ledger[0] ? m.ledger[0].at + '|' + m.ledger[0].label : '';
    if (seenIn !== null && last !== seenIn && m.ledger[0] && m.ledger[0].amount > 0 && /^Virement de/.test(m.ledger[0].label)) FF.toast('+' + m.ledger[0].amount + ' EB · ' + m.ledger[0].label);
    seenIn = last;
  }

  // Vibration quand l'etape ou la phase change (si le telephone le permet).
  var lastPos = null;
  function buzzOnChange(v) {
    var pos = v.phase + '|' + v.year + '|' + v.season + '|' + v.step;
    if (lastPos !== null && pos !== lastPos) { try { if (navigator.vibrate) navigator.vibrate([180, 90, 180]); } catch (e) { /* ignore */ } }
    lastPos = pos;
  }

  // Prevision meteo : annoncee pendant les achats, pas toujours fiable.
  function meteo() {
    var f = V.forecast;
    if (!f) return '';
    return '<section class="panel row" style="gap:14px;flex-wrap:nowrap"><div style="font-size:44px;line-height:1" aria-hidden="true">' + f.icon + '</div><div style="min-width:0"><div class="muted" style="font-size:13px">Météo · ' + esc(f.seasonName.toLowerCase()) + (f.year !== V.year || V.phase !== 'season' ? ' de l\'année ' + f.year : '') + '</div><div style="font-weight:800;font-size:18px">' + esc(f.text) + '</div><div class="muted" style="font-size:13px">Les prévisions ne sont pas toujours fiables : à vous de juger si une parade vaut le coup.</div></div></section>';
  }

  function topBar() {
    var inSeason = V.phase === 'season';
    var badge = inSeason
      ? '<span class="t-season" style="background:' + V.seasonColor + '">' + FF.ICON.seasons[V.season] + ' ' + esc(V.seasonName) + ' · an ' + V.year + '</span>'
      : '<span class="t-season" style="background:var(--surface-2);color:var(--fg);border:1px solid var(--line)">' + esc(context()) + '</span>';
    var steps = inSeason ? '<div class="t-steps" aria-label="Étape ' + (V.step + 1) + ' sur 5">' + [0, 1, 2, 3, 4].map(function (i) { return '<i class="' + (i < V.step ? 'done' : i === V.step ? 'now' : '') + '"></i>'; }).join('') + '</div>' : '';
    var showClock = inSeason || V.phase === 'setup' || V.phase === 'rearrange';
    return '<header class="t-top"><div class="row" style="justify-content:space-between;flex-wrap:nowrap;align-items:flex-start;gap:10px"><div style="min-width:0"><h1 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(me.name) + '</h1>' + badge + '</div>' +
      (showClock ? '<div class="t-chrono" data-chrono><div class="l">Chrono</div><div class="v" data-clock>0:00</div></div>' : '') + '</div>' + steps +
      '<div class="row" style="justify-content:space-between;flex-wrap:nowrap"><span class="pill num">💰 ' + me.bank + ' EB</span><span class="row" style="gap:8px;flex-wrap:nowrap">' + FF.dots(me.bocal, V.meta.bocalMax).replace('class="dots"', 'class="dots" style="gap:3px"') + '<span class="pill lv-' + me.level + '">' + FF.ICON.level[me.level] + '</span></span></div></header>';
  }

  function render() {
    if (!V || !me) return;
    var body = tab === 'ferme' ? ferme() : tab === 'boutique' ? boutique() : banque();
    var navBtn = function (id, ic, label) { return '<button data-tab="' + id + '" class="' + (tab === id ? 'on' : '') + '"><span class="ic" aria-hidden="true">' + ic + '</span>' + label + '</button>'; };
    root.innerHTML = '<div class="t-wrap">' + topBar() + body + '</div><nav class="t-nav" aria-label="Navigation de l\'équipe">' + navBtn('ferme', '🏡', 'Ferme') + navBtn('boutique', '🛍️', 'Boutique') + navBtn('banque', '🏦', 'Banque') + '</nav>';
  }

  function tick() { if (!V) return; var u = root.querySelector('[data-undo]'); if (u && Date.now() > parseInt(u.getAttribute('data-undo'), 10)) u.remove(); var el = root.querySelector('[data-clock]'); if (el) { var ms = FF.remaining(V); el.textContent = FF.fmt(ms); var box = root.querySelector('[data-chrono]'); if (box) box.classList.toggle('low', V.timer.running && ms <= 10000); } }
  setInterval(tick, 250);
  root.addEventListener('change', function (e) { if (e.target.id === 'trTo') { var rs = document.getElementById('trReason'); if (rs) rs.innerHTML = ''; FF.keepInputs(root, render); } });

  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; location.hash = tab; window.scrollTo(0, 0); return render(); }
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var a = b.dataset.act;
    if (a === 'transfer') {
      var amt = parseInt(val('trAmount'), 10);
      if (!(amt > 0)) return FF.toast('Saisis un montant positif.');
      return conn.act('transfer', { to: val('trTo'), amount: amt, reason: val('trReason') }).then(function (r) {
        if (r && r.ok) { document.getElementById('trAmount').value = ''; FF.toast('Virement envoyé.'); }
      });
    }
    if (a === 'requestTransfo') {
      var tr = {};
      V.meta.dishes.forEach(function (d) { var n = parseInt(val('tr-' + d.id), 10); if (n > 0) tr[d.id] = n; });
      return conn.act('requestTransfo', { transfo: tr }).then(function (r) { if (r && r.ok) FF.toast('Demande envoyée.'); });
    }
    if (a === 'spinWheel') return conn.act('spinWheel');
    if (a === 'declareSales') {
      var sales = {};
      ['sup', 'dir'].forEach(function (w) { V.meta.sell.forEach(function (x) { var n = parseInt(val('sale-' + w + '_' + x.id), 10); sales[w + '_' + x.id] = n > 0 ? n : 0; }); });
      return conn.act('declareSales', { sales: sales }).then(function (r) { if (r && r.ok) FF.toast('Déclaration envoyée.'); });
    }
    if (a === 'claimDish') return conn.act('claimDish', { key: b.dataset.key });
    if (a === 'releaseDish') return conn.act('releaseDish', { key: b.dataset.key });
    if (a === 'buy') return conn.act('buy', { itemId: b.dataset.item });
    if (a === 'undoBuy') return conn.act('undoBuy').then(function (r) { if (r && r.ok) FF.toast('Achat annulé.'); });
    if (a === 'choice') return conn.act('setChoice', { choice: b.dataset.choice });
    if (a === 'contribute') { var gn = parseInt(val('giveN'), 10); if (!(gn > 0)) return FF.toast('Indique une quantité.'); return conn.act('contribute', { n: gn }).then(function (r) { if (r && r.ok) FF.toast('Merci pour le village !'); }); }
    if (a === 'collier') return conn.act('collier');
    if (a === 'vacation') return conn.act('vacation', { n: parseInt(val('vacN'), 10) });
    if (a === 'ready') return conn.act('setReady', { ready: !me.ready });
  });
  }
})();
