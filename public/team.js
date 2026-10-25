(function () {
  var esc = FF.esc;
  var code = (FF.qs.get('s') || '').toUpperCase();
  var token = FF.qs.get('t');
  var root = document.getElementById('app');
  var V = null, me = null;
  var tab = (location.hash || '#accueil').slice(1);
  if (['accueil', 'ferme', 'boutique', 'banque'].indexOf(tab) < 0) tab = 'accueil';

  var stored = null;
  try { stored = JSON.parse(localStorage.getItem('ff-team') || 'null'); } catch (e) { /* ignore */ }
  if (!token && !FF.qs.get('g') && stored && (!code || stored.code === code)) { code = stored.code; token = stored.token; }
  if (!code) { root.innerHTML = '<p style="padding:16px">Lien incomplet. Demande le lien de la partie au maire du village.</p>'; return; }
  if (!token) { guestScreen(); } else { boot(); }

  // Ecran de connexion unique : on choisit une ferme libre proposée par le maire du village, puis on la nomme comme on veut.
  // Une ferme ne peut être prise que par une équipe : la reconnexion se fait ensuite avec le lien gardé dans le téléphone.
  function guestScreen() {
    var G = null, busy = false, picked = null;
    var gc = FF.connect({
      role: 'guest', code: code,
      onState: function (v) { G = v; draw(); },
      onFatal: function (m) { root.innerHTML = '<p style="padding:16px">' + esc(m) + '</p>'; }
    });
    function enter(r) {
      busy = false;
      if (!r || !r.ok || !r.token) { draw(); return; }
      try { localStorage.setItem('ff-team', JSON.stringify({ code: code, token: r.token })); } catch (e) { /* ignore */ }
      token = r.token; gc.socket.disconnect(); root.innerHTML = '<p style="padding:16px">Connexion…</p>'; boot();
    }
    function draw() {
      if (!G) return;
      var keep = document.getElementById('gName');
      var typed = keep ? keep.value : null;
      var free = G.teams.filter(function (t) { return !t.taken; });
      if (picked && !free.some(function (t) { return t.id === picked.id; })) picked = null;
      var head = '<div style="text-align:center"><div style="font-family:\'Amatic SC\',cursive;font-size:44px;line-height:1">Farming\'s Folies</div><div class="muted">Partie ' + esc(code) + '</div></div>';
      var body;
      if (picked) {
        body = '<section class="panel" style="display:flex;flex-direction:column;gap:10px"><h2 style="font-size:24px">🚜 ' + esc(picked.name) + '</h2>' +
          '<p class="muted" style="margin:0">Cette ferme est à vous. Vous pouvez lui donner le nom que vous voulez (vous pourrez le changer plus tard dans l\'onglet Ferme).</p>' +
          '<label for="gName" class="muted" style="font-size:13px">Nom de votre ferme</label><input id="gName" maxlength="40" autocomplete="off" value="' + esc(typed === null ? picked.name : typed) + '">' +
          '<button class="btn primary" data-claim="1"' + (busy ? ' disabled' : '') + '>Prendre cette ferme</button><button class="btn" data-back="1">← Choisir une autre ferme</button></section>';
      } else {
        var list = G.teams.map(function (t) {
          return t.taken ? '<div class="btn" style="justify-content:flex-start;text-align:left;min-height:52px;opacity:.5;display:flex;align-items:center;cursor:default">🔒 ' + esc(t.name) + ' · déjà prise</div>'
            : '<button class="btn" style="justify-content:flex-start;text-align:left;min-height:52px" data-pick="' + esc(t.id) + '">🚜 ' + esc(t.name) + '</button>';
        }).join('');
        body = '<section class="panel" style="display:flex;flex-direction:column;gap:8px"><h2 style="font-size:22px">🔑 Choisissez votre ferme</h2>' +
          '<p class="muted" style="margin:0;font-size:14px">Le maire du village a préparé les fermes. Chaque ferme ne peut être prise que par une équipe.</p>' +
          (list || '<p class="muted" style="margin:0">Aucune ferme pour le moment : le maire du village n\'en a pas encore créé.</p>') +
          (G.teams.length && !free.length ? '<p class="muted" style="margin:0;font-size:14px">Toutes les fermes sont prises. Si votre équipe a déjà la sienne, rouvrez le lien depuis son téléphone ; sinon demandez au maire du village de la libérer.</p>' : '') + '</section>';
      }
      root.innerHTML = '<div style="padding:24px 16px;display:flex;flex-direction:column;gap:16px;max-width:460px;margin:0 auto">' + head + body + '</div>';
      if (picked && keep === null) { var inp = document.getElementById('gName'); if (inp) inp.select(); }
    }
    root.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b || busy) return;
      if (b.dataset.pick) { picked = G.teams.filter(function (t) { return t.id === b.dataset.pick; })[0] || null; draw(); }
      else if (b.dataset.back) { picked = null; draw(); }
      else if (b.dataset.claim && picked) { busy = true; gc.act('claimTeam', { teamId: picked.id, name: (document.getElementById('gName') || {}).value || '' }).then(enter); }
    });
    root.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'gName') { var b = root.querySelector('[data-claim]'); if (b) b.click(); } });
  }

  function boot() {
  try { localStorage.setItem('ff-team', JSON.stringify({ code: code, token: token })); } catch (e) { /* ignore */ }
  var cart = [];
  try { cart = JSON.parse(sessionStorage.getItem('ff-cart-' + code) || '[]'); } catch (e) { cart = []; }
  function saveCart() { try { sessionStorage.setItem('ff-cart-' + code, JSON.stringify(cart)); } catch (e) { /* ignore */ } }
  var feeAsk = null; // placement en attente de confirmation du paiement des frais d'emplacement
  var colOpen = false, lastWheelN = null, lastFetes = null, seenRolls = {};
  var conn = FF.connect({
    role: 'team', code: code, token: token,
    onState: function (v) { notifyIncoming(v); buzzOnChange(v); V = v; me = v.teams.filter(function (t) { return t.id === v.me; })[0]; FF.keepInputs(root, render); tick(); watchEvents(); scheduleReveal(); },
    onFatal: function (m) { root.innerHTML = '<p style="padding:16px">' + esc(m) + '</p>'; }
  });

  var PHASE = { lobby: 'En attente du départ', setup: 'Installation', closing: 'Clôture de l\'année', rearrange: 'Réaménagement', end: 'Partie terminée' };
  var TABS = ['accueil', 'ferme', 'boutique', 'banque'];

  function context() {
    if (V.phase === 'season') return 'Année ' + V.year + ' · ' + V.seasonName + ' · ' + V.meta.steps[V.step].name;
    return PHASE[V.phase] + (V.phase === 'closing' || V.phase === 'rearrange' ? ' · année ' + V.year : '');
  }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function icon(id) { return FF.ICON[id] || ''; }
  function catName(id) { return (V.meta.catalogue.filter(function (x) { return x.id === id; })[0] || {}).name || id; }

  // ---------- Bocal de stress ----------
  function bocalPanel() {
    var left = V.meta.bocalMax - me.bocal;
    return '<section class="panel" style="display:flex;flex-direction:column;gap:8px"><div class="row" style="justify-content:space-between"><b>🫙 Bocal de stress</b><span class="row" style="gap:8px"><span class="pill lv-' + me.level + '">' + me.level + '</span><span class="num muted">' + me.bocal + ' / ' + V.meta.bocalMax + '</span></span></div>' +
      FF.dots(me.bocal, V.meta.bocalMax) + '<div class="muted" style="font-size:13px">' + (me.stopped ? 'Burn-out : votre ferme est à l\'arrêt cette saison.' : 'Encore ' + plural(left, 'point de stress', 'points de stress') + ' avant le burn-out.') + '</div></section>';
  }

  // ---------- Banque ----------
  function transferPanel() {
    var R = V.meta.transferReasons;
    var to = val('trTo') || 'animateur';
    var others = V.teams.filter(function (t) { return t.id !== me.id; });
    var va = V.villageAccount && V.villageAccount.open ? V.villageAccount : null;
    if (to === 'village' && !va) to = 'animateur';
    if (to !== 'animateur' && to !== 'village' && !others.some(function (t) { return t.id === to; })) to = 'animateur';
    var list = to === 'animateur' ? R.animateur : to === 'village' ? R.village : R.ferme;
    var reasons = list.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('');
    var dest = (va ? '<option value="village"' + (to === 'village' ? ' selected' : '') + '>🏛️ Compte du village · ' + esc(va.title) + '</option>' : '') +
      '<option value="animateur"' + (to === 'animateur' ? ' selected' : '') + '>Le maire du village (taxe, achat…)</option>' +
      others.map(function (t) { return '<option value="' + esc(t.id) + '"' + (to === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
    var open = ['setup', 'season', 'closing', 'rearrange'].indexOf(V.phase) >= 0;
    return '<section class="panel" style="display:flex;flex-direction:column;gap:10px"><b>💸 Faire un virement</b>' +
      '<label for="trTo" class="muted" style="font-size:13px">Vers</label><select id="trTo">' + dest + '</select>' +
      '<label for="trReason" class="muted" style="font-size:13px">Motif</label><select id="trReason">' + reasons + '</select>' +
      '<label for="trAmount" class="muted" style="font-size:13px">Montant (EB)</label><input id="trAmount" inputmode="numeric" placeholder="Ex. 40">' +
      '<button class="btn primary" data-act="transfer"' + (open ? '' : ' disabled') + '>Envoyer le virement</button></section>';
  }

  // Compte du village : la cagnotte de l'aléa collectif en argent.
  function villagePanel() {
    var va = V.villageAccount;
    if (!va) return '';
    var pct = Math.min(100, Math.round(va.pot / va.need * 100));
    return '<section class="panel stack" style="border-color:var(--pb)"><div class="row" style="justify-content:space-between"><b>🏛️ Compte du village</b><span class="pill ' + (va.open ? 'warn' : va.resolved === false ? 'bad' : 'ok') + '">' + (va.open ? 'Ouvert' : 'Objectif atteint') + '</span></div>' +
      '<div class="muted" style="font-size:14px">Aléa « ' + esc(va.title) + ' » : toutes les fermes versent sur ce compte, d\'où qu\'elles soient.</div>' +
      '<div class="bar" style="height:14px"><i style="width:' + pct + '%"></i></div><div class="row" style="justify-content:space-between"><b class="num">' + va.pot + ' / ' + va.need + ' EB</b><span class="muted" style="font-size:13px">' + (va.open ? 'Choisissez « Compte du village » dans le virement ci-dessous.' : '') + '</span></div></section>';
  }

  function banque() {
    var ch = me.charges;
    var mv = me.ledger.length ? me.ledger.map(function (m) {
      return '<div class="mv"><div style="flex:1"><div>' + esc(m.label) + '</div><div class="muted" style="font-size:12px">Année ' + m.year + ' · ' + esc(V.meta.seasons[m.season].name) + '</div></div><div class="num ' + (m.amount > 0 ? 'pos' : 'neg') + '">' + (m.amount > 0 ? '+' : '−') + Math.abs(m.amount) + ' EB</div></div>';
    }).join('') : '<p class="muted" style="margin:0">Aucun mouvement pour le moment.</p>';
    return '<section class="t-bank"><div class="sub">💰 Compte en banque</div><div class="big">' + me.bank + ' <small>EB</small></div>' +
      '<div class="row" style="justify-content:space-between;margin-top:12px;border-top:1px solid rgba(255,255,255,.2);padding-top:10px;font-size:14px"><span class="sub">Charges estimées à la clôture</span><b class="num">' + ch.total + ' EB</b></div>' +
      '<div class="row" style="justify-content:space-between;font-size:14px"><span class="sub">Reste après charges</span><b class="num">' + (me.bank - ch.total) + ' EB</b></div></section>' +
      villagePanel() + transferPanel() +
      '<section class="panel"><b>Derniers mouvements</b><div style="margin-top:4px">' + mv + '</div></section>';
  }

  // ---------- Aléa collectif : bandeau tout en haut, détail dans une fenêtre ----------
  function dueName(c) { var st = V.meta.steps.filter(function (x) { return x.id === c.due; })[0]; return st ? st.name : ''; }
  function potSum(c) { return Object.keys(c.pot || {}).reduce(function (n, k) { return n + c.pot[k]; }, 0); }
  // La carte n'est révélée sur les mobiles qu'une fois l'animation du projecteur terminée.
  var REVEAL_MS = 6500;
  function cardPending() { return V.phase === 'season' && V.step === 0 && !!V.card && FF.age(V, V.card.at) < REVEAL_MS; }
  var revealTimer = null;
  function scheduleReveal() {
    clearTimeout(revealTimer);
    if (cardPending()) revealTimer = setTimeout(function () { FF.keepInputs(root, render); try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) { /* ignore */ } }, REVEAL_MS - FF.age(V, V.card.at) + 80);
  }
  function colState() {
    if (V.phase !== 'season' || !V.card || !V.card.collective || cardPending()) return null;
    var c = V.card, tot = potSum(c), done = c.resolved !== null && c.resolved !== undefined;
    return { c: c, tot: tot, done: done, reached: tot >= c.need, openable: !done && tot < c.need };
  }
  // Tant que l'objectif n'est pas atteint, le bandeau ouvre le détail ; une fois atteint (ou réglé), il change de couleur et ne s'ouvre plus.
  function colBanner() {
    if (V.phase !== 'season' || !V.card) return '';
    if (cardPending()) return '<div class="col-banner closed"><span class="cb-ic" aria-hidden="true">🎴</span><span class="cb-tx"><b>Le maire du village tire une carte…</b><small>Regardez l\'écran de projection</small></span></div>';
    var k = colState();
    if (!k) return cardBanner();
    var c = k.c, cls = k.done ? (c.resolved ? 'ok' : 'bad') : k.reached ? 'ok' : '';
    var right = k.done ? (c.resolved ? '✓ Atteint' : '✗ Manqué') : k.reached ? '✓ Atteint' : 'Ouvrir ›';
    var inner = '<span class="cb-ic" aria-hidden="true">' + (c.icon || '🤝') + '</span><span class="cb-tx"><b>Aléa collectif · ' + esc(c.title) + '</b><small>' + esc(c.goalText) + ' · ' + k.tot + ' / ' + c.need + (k.openable ? ' · avant la fin de « ' + esc(dueName(c)) + ' »' : '') + '</small></span><span class="cb-go">' + right + '</span>';
    return k.openable ? '<button class="col-banner ' + cls + '" data-act="openCol" aria-label="Ouvrir le détail de l\'aléa collectif">' + inner + '</button>' : '<div class="col-banner ' + cls + ' closed">' + inner + '</div>';
  }
  // Carte aléa normale : même bandeau en haut, il ouvre la carte et le choix de la ferme.
  function cardBanner() {
    var c = V.card, neg = c.tone === 'neg';
    var lab = { subit: 'Effet subi', parade: 'Parade jouée', boule: '+1 stress' }[me.choice];
    var chosen = neg && me.choice;
    var cls = neg ? (chosen ? 'neg done' : 'neg') : 'ok';
    var right = neg ? (chosen ? '✓ ' + lab : 'Choisir ›') : 'Voir ›';
    return '<button class="col-banner ' + cls + '" data-act="openCol" aria-label="Ouvrir la carte aléa"><span class="cb-ic" aria-hidden="true">' + (c.icon || '🎴') + '</span><span class="cb-tx"><b>Aléa · ' + esc(c.title) + '</b><small>' + (neg ? (chosen ? 'Choix fait, définitif' : 'Négatif : un choix à faire') : 'Positif : rien à faire') + '</small></span><span class="cb-go">' + right + '</span></button>';
  }
  function feeModal() {
    if (!feeAsk) return '';
    var fee = V.meta.market.stallFee, ok = me.bank >= fee;
    return '<div class="help-modal" role="dialog" aria-modal="true" aria-label="Frais d\'emplacement"><div class="help-box"><div class="eyebrow">Marché · étal</div><h2 style="font-size:36px;margin:2px 0 8px">🏷️ Frais d\'emplacement</h2>' +
      '<p style="margin:0 0 10px;line-height:1.45">Vous posez <b>' + plural(feeAsk.n, 'produit', 'produits') + '</b> à l\'étal. Une place sur le marché coûte <b>' + fee + ' EB</b>, payés au maire du village avec un virement automatique depuis votre banque (' + me.bank + ' EB).</p>' +
      (ok ? '' : '<p style="margin:0 0 10px;color:var(--bad);font-weight:700">Solde insuffisant : reposez moins de produits à l\'étal ou utilisez le supermarché.</p>') +
      '<div class="row" style="flex-wrap:nowrap"><button class="btn block" data-act="feeCancel">Annuler et refaire le placement</button><button class="btn primary block" data-act="feePay"' + (ok ? '' : ' disabled') + '>Payer ' + fee + ' EB</button></div></div></div>';
  }
  function colModal() {
    var k = colState();
    if (colOpen && !k && V.phase === 'season' && V.card && !cardPending()) {
      return '<div class="help-modal" data-colbg="1" style="align-items:flex-start;overflow:auto"><div class="help-box" style="padding:0;background:transparent;box-shadow:none;max-width:520px">' + alea() + '<button class="btn block" style="margin-top:8px" data-act="closeCol">Fermer</button></div></div>';
    }
    if (!colOpen || !k || !k.openable) { colOpen = false; return ''; }
    return '<div class="help-modal" data-colbg="1" style="align-items:flex-start;overflow:auto"><div class="help-box" style="padding:0;background:transparent;box-shadow:none;max-width:520px">' + collectivePanel(k.c) + '<button class="btn block" style="margin-top:8px" data-act="closeCol">Fermer</button></div></div>';
  }
  function collectivePanel(c) {
    var tot = potSum(c), left = Math.max(0, c.need - tot), pct = Math.min(100, Math.round(tot / c.need * 100));
    var bar = '<div class="bar" style="height:14px"><i style="width:' + pct + '%"></i></div><div class="row" style="justify-content:space-between"><b class="num">' + tot + ' / ' + c.need + '</b><span class="muted" style="font-size:13px">avant la fin de l\'étape « ' + esc(dueName(c)) + ' »</span></div>';
    var who = V.teams.filter(function (t) { return (c.pot || {})[t.id]; }).map(function (t) { return esc(t.name) + ' ' + c.pot[t.id]; }).join(' · ');
    var done = c.resolved !== null && c.resolved !== undefined;
    var g = c.goal, form = '';
    if (!done && left > 0 && !me.stopped) {
      var max = g.kind === 'eb' ? Math.min(left, me.bank) : g.kind === 'dish' ? Math.min(left, me.pantry[g.dish] || 0) : left;
      var label = g.kind === 'eb' ? 'Donner (EB)' : g.kind === 'dish' ? 'Offrir (plats)' : g.kind === 'raw' ? 'Je les ai remis au maire du village' : 'Je prends le stress';
      var hint = g.kind === 'dish' ? 'En stock : ' + (me.pantry[g.dish] || 0) : g.kind === 'raw' ? 'Remettez d\'abord les jetons au maire du village, puis déclarez-les ici.' : g.kind === 'boule' ? 'Volontaires : chaque point de stress pris compte pour l\'objectif.' : 'Banque : ' + me.bank + ' EB. Vous pouvez aussi virer sur le compte du village (onglet Banque).';
      form = '<div class="row"><input id="giveN" inputmode="numeric" placeholder="Quantité" style="width:110px"' + (max < 1 && g.kind !== 'raw' && g.kind !== 'boule' ? ' disabled' : '') + '><button class="btn primary" data-act="contribute">' + label + '</button></div><div class="muted" style="font-size:13px">' + hint + '</div>';
    }
    var res = !done ? '' : c.resolved ? '<div class="pill ok" style="align-self:flex-start">Objectif atteint</div><div>' + esc(c.winText) + '</div>' : '<div class="pill bad" style="align-self:flex-start">Objectif manqué</div><div>' + esc(c.loseText) + '</div>';
    return '<section class="panel stack" style="border-color:var(--pb)"><div class="row" style="justify-content:space-between"><b>🤝 Aléa collectif</b><span class="pill warn">Tout le village</span></div>' +
      '<div style="font-family:var(--f-display);font-size:42px;line-height:1;color:var(--sand);font-weight:700">' + (c.icon ? '<span aria-hidden="true" style="margin-right:8px">' + c.icon + '</span>' : '') + esc(c.title) + '</div><div>' + esc(c.story) + '</div>' +
      '<div><b>Objectif commun : ' + esc(c.goalText) + '</b></div>' + bar + (who ? '<div class="muted" style="font-size:13px">' + who + '</div>' : '') + form + res +
      '<div class="muted" style="font-size:13px">Si le village y arrive : ' + esc(c.winText) + ' Sinon : ' + esc(c.loseText) + '</div></section>';
  }

  // ---------- Aléa et activités ----------
  function alea() {
    if (V.phase !== 'season' || !V.card) return '<section class="panel stack"><b>🎴 Carte aléa</b><p class="muted" style="margin:0">Le maire du village n\'a pas encore tiré la carte.</p></section>' + meteo();
    var c = V.card, has = c.parade && me.equipment.indexOf(c.parade) >= 0;
    var par = c.parade ? catName(c.parade) : null;
    if (c.collective) return aleaSummary();
    var neg = c.tone === 'neg';
    var btn = function (k, label, sub, dis) { return '<button class="btn ' + (me.choice === k ? 'primary' : '') + '" data-act="choice" data-choice="' + k + '"' + (dis || me.choice ? ' disabled' : '') + '><span><b>' + (me.choice === k ? '✓ ' : '') + label + '</b><small>' + sub + '</small></span></button>'; };
    var choices = neg
      ? '<div class="choice">' + btn('subit', 'Subir l\'effet', 'On encaisse, on continue.') + btn('parade', 'Jouer la parade', par ? (has ? esc(par) + ' : vous l\'avez !' : esc(par) + ' : vous ne l\'avez pas') : 'Pas de parade pour cette carte', !has) + btn('boule', 'Éviter avec +1 stress', 'L\'effet est évité, le bocal se remplit.') + '</div><div class="muted" style="font-size:13px">' + (me.choice ? '🔒 Votre choix est définitif.' : 'Attention : le choix est définitif.') + '</div>'
      : '<div class="muted" style="font-size:14px">Bonne nouvelle : rien à faire, profitez-en !</div>';
    return '<section class="panel stack" style="border-color:' + (neg ? 'var(--bad)' : 'var(--teal)') + '"><div class="row" style="justify-content:space-between"><b>🎴 Carte aléa</b><span class="pill ' + (neg ? 'bad' : 'ok') + '">' + (neg ? 'Négatif' : 'Positif') + '</span></div>' +
      '<div style="font-family:var(--f-display);font-size:42px;line-height:1;color:var(--sand);font-weight:700">' + esc(c.title) + '</div><div>' + esc(c.effect) + '</div>' + choices + '</section>';
  }

  // Sur l'Accueil : un rappel court ; la carte et le choix sont dans le bandeau tout en haut.
  function aleaSummary() {
    var c = V.card;
    if (!c) return alea();
    if (cardPending()) return '<section class="panel soft" style="padding:12px 16px"><b>🎴 Le maire du village tire une carte…</b><div class="muted" style="font-size:14px">Regardez l\'écran de projection : la carte s\'affichera ici ensuite.</div></section>';
    var hint = c.collective ? 'Aléa collectif : aucun choix individuel. Le détail et les dons sont dans le bandeau tout en haut de l\'écran.' : c.tone === 'neg' ? 'Touchez le bandeau en haut pour choisir : subir, parade ou +1 stress.' : 'Bonne nouvelle : rien à faire. Le bandeau en haut garde la carte à portée de main.';
    return '<section class="panel soft" style="padding:12px 16px"><b>' + (c.icon || '🎴') + ' ' + esc(c.title) + '</b><div style="font-size:14px">' + esc(c.collective ? c.story : c.effect) + '</div><div class="muted" style="font-size:13px">' + hint + '</div></section>';
  }

  // Niveau de stress de la saison : annoncé à l'étape Aléa.
  function stressPanel() {
    var st = me.stress;
    if (!st) return '';
    var col = st.level === 'Zen' ? 'var(--teal)' : st.level === 'Agité' ? 'var(--pb)' : 'var(--bad)';
    var gage = st.gage ? '<div class="stack" style="gap:4px;background:var(--surface-2);border-radius:12px;padding:10px 12px"><div class="eyebrow">' + (st.level === 'Zen' ? '🎁 Privilège de la saison' : '🎭 Gage de la saison') + '</div><div style="font-size:16px;font-weight:700">' + esc(st.gage) + '</div>' +
      (st.gageDone ? '<div style="color:var(--good);font-weight:700">✓ Fait</div>' : '<div class="muted" style="font-size:12px">Le maire du village vérifie et valide.</div>') + '</div>' : '';
    return '<section class="panel stack" style="border-left:6px solid ' + col + '"><div class="row" style="justify-content:space-between"><b>' + st.icon + ' ' + esc(st.title) + '</b><span class="pill lv-' + st.level + '">' + st.level + ' · ' + st.points + ' / ' + st.max + '</span></div>' +
      '<div style="font-size:14px">' + esc(st.text) + '</div>' + gage + '</section>';
  }

  // Activités complémentaires : un dé par activité et par saison (1 = rien, 2 à 6 = effet plus ou moins fort).
  function activityExplain(open) {
    var rows = V.meta.activities.map(function (a) {
      return '<div class="stack" style="gap:2px;padding:8px 0;border-top:1px solid var(--line)"><b>' + a.icon + ' ' + esc(a.name) + ' · ' + a.price + ' EB</b><span style="font-size:14px">' + esc(a.short + ' ' + a.how) + '</span>' +
        '<span class="muted" style="font-size:13px">Dé : ' + [1, 2, 3, 4, 5, 6].map(function (d, i) { return '<b>' + d + '</b> ' + (i === 0 ? 'rien' : a.effects[i]); }).join(' · ') + '</span></div>';
    }).join('');
    return '<details id="actHelp" class="panel"' + (open ? ' open' : '') + '><summary>ℹ️ Comment marchent les activités complémentaires ?</summary><div class="stack" style="margin-top:8px;font-size:15px;line-height:1.45">' +
      '<p style="margin:0">Une activité s\'achète une fois à l\'installation ou en fin d\'année, à la boutique. Vous pouvez en acheter plusieurs, <b>différentes</b>. Elle compte comme une tuile pour les taxes (20 EB par an).</p>' +
      '<p style="margin:0"><b>Chaque saison, vous lancez un dé par activité</b> (à l\'étape Aléa). <b>Sur 1, l\'activité ne fonctionne pas du tout</b> (1 chance sur 6). De 2 à 6, plus le dé est haut, plus l\'effet est fort.</p>' + rows + '</div></details>';
  }
  function activitiesPanel() {
    if (V.phase !== 'season' || !me.activities.length || me.stopped) return '';
    var rows = me.activities.map(function (id) {
      var a = V.meta.activities.filter(function (x) { return x.id === id; })[0]; if (!a) return '';
      var roll = me.actRolls[id], key = V.year + '.' + V.season + '.' + id, fresh = roll && !seenRolls[key];
      if (roll) seenRolls[key] = true;
      var die = roll ? '<div class="die' + (fresh ? ' die-roll' : '') + (roll === 1 ? ' die-fail' : '') + '" aria-label="Résultat du dé : ' + roll + '">' + roll + '</div>' :
        '<button class="btn primary" data-act="rollActivity" data-activity="' + id + '">🎲 Lancer le dé</button>';
      var txt = roll ? '<div style="font-size:14px;' + (roll === 1 ? 'color:var(--bad);font-weight:700' : 'color:var(--good);font-weight:700') + '">' + esc(a.effects[roll - 1]) + '</div>' : '<div class="muted" style="font-size:13px">' + esc(a.short) + ' Sur 1 : rien. De 2 à 6 : de plus en plus fort.</div>';
      return '<div class="row" style="flex-wrap:nowrap;justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)"><div style="min-width:0"><b>' + a.icon + ' ' + esc(a.name) + '</b>' + txt + '</div>' + die + '</div>';
    }).join('');
    return '<section class="panel stack"><b>🎲 Mes activités complémentaires</b>' + rows + '</section>';
  }

  // ---------- Récolte ----------
  function runInfo(h) {
    if (!h.runSec) return '<b style="color:var(--bad)">' + (h.baseRunSec ? 'Course trop courte : non récoltable cette saison' : 'Rien à récolter cette saison') + '</b>';
    var changed = h.runSec !== h.baseRunSec, col = changed ? (h.runSec < h.baseRunSec ? 'var(--bad)' : 'var(--good)') : 'inherit';
    var when = h.overSec ? 'jusqu\'à ' + FF.fmt(h.overSec * 1000) + ' après la fin du chrono' : h.stopAt ? 'stop quand le chrono affiche ' + FF.fmt(h.stopAt * 1000) : 'jusqu\'à la fin du chrono';
    return h.runners + ' coureur' + (h.runners > 1 ? 's' : '') + ' · <b style="color:' + col + '">' + FF.fmt(h.runSec * 1000) + '</b>' + (changed ? ' <s>' + FF.fmt(h.baseRunSec * 1000) + '</s>' : '') + ' · ' + when + (h.perTrip > 1 ? ' · <b style="color:var(--good)">' + h.perTrip + ' jetons par trajet</b>' : '');
  }
  function bonusLine(h) {
    var b = h.bonus || {}, parts = [];
    if (b.pedago) parts.push('+' + b.pedago + ' ferme pédagogique');
    return parts.length ? '<div style="font-size:12px;color:var(--good);font-weight:700">Jetons bonus ajoutés à l\'encodage : ' + parts.join(' · ') + '</div>' : '';
  }
  function harvestPanel() {
    if (V.phase !== 'season' || !me.harvest || !me.harvest.length) return '';
    var open = V.step <= 2 && !me.transfo;
    var declared = me.harvest.every(function (h) { return h.brought !== null; });
    var rows = me.harvest.map(function (h) {
      var input = open ? '<span class="stepper"><button class="btn" data-act="hvStep" data-product="' + h.id + '" data-delta="-1" aria-label="Un jeton de moins ' + esc(h.name) + '">−</button><input id="hv-' + h.id + '" inputmode="numeric" placeholder="0" value="' + (h.brought !== null ? h.brought : '') + '"><button class="btn" data-act="hvStep" data-product="' + h.id + '" data-delta="1" aria-label="Un jeton de plus ' + esc(h.name) + '">+</button></span>' : '<b class="num">' + (h.value || 0) + '</b>';
      var clock = V.step === 1 ? '<span class="pclock pc-idle" data-pclock data-pid="' + h.id + '" data-run="' + h.runSec + '" aria-live="off">' + (h.runSec ? FF.fmt(h.runSec * 1000) : '—') + '</span>' : '';
      return '<div data-prow style="display:flex;flex-direction:column;gap:6px;padding:8px;margin:0 -8px"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><span style="display:flex;align-items:center;gap:8px"><i style="width:14px;height:14px;border-radius:50%;background:' + h.color + ';border:1px solid var(--line2);display:inline-block"></i><b style="font-size:18px">' + esc(h.name) + '</b></span>' + clock + '</div>' +
        '<div class="row" style="justify-content:space-between;flex-wrap:nowrap;align-items:flex-end"><span class="muted" style="font-size:12px">' + runInfo(h) + '</span><span class="row" style="gap:8px;flex-wrap:nowrap">' + input + '</span></div>' + (declared || V.step > 1 ? bonusLine(h) : '') + '</div>';
    }).join('');
    var tot = me.harvest.reduce(function (n, h) { return n + (h.brought !== null ? h.value : 0); }, 0);
    var baskets = me.equipment.filter(function (e) { return e === 'panier'; }).length, carry = me.equipment.indexOf('brouette') >= 0 ? '<div style="font-size:13px;color:var(--good);font-weight:700">' + icon('brouette') + ' Brouette : tous vos coureurs peuvent prendre 2 jetons par trajet.</div>' : baskets ? '<div style="font-size:13px;color:var(--good);font-weight:700">🧺 ' + plural(baskets, 'coureur peut', 'coureurs peuvent') + ' prendre 2 jetons par trajet (panier de récolte).</div>' : '';
    var prot = V.card && V.card.tone === 'neg' && me.exempt ? '<div class="muted" style="font-size:13px">Effet de « ' + esc(V.card.title) + ' » évité : course normale.</div>' : '';
    var early = me.stopEarly ? '<div style="font-weight:700;color:var(--bad)">' + esc(V.card.title) + ' : la récolte s\'arrête ' + me.stopEarly + ' s avant la fin du chrono.</div>' : '';
    var bonus = me.bonusSec ? '<div style="font-weight:700;color:var(--good)">⏱️ Bonus : vos coureurs courent ' + me.bonusSec + ' s de plus.</div>' : '';
    var btn = open ? '<button class="btn primary" data-act="declareHarvest">' + (declared ? 'Modifier la récolte' : 'Encoder ma récolte') + '</button>' : '';
    var hint = declared ? '<div class="muted" style="font-size:13px">Récolte encodée : ' + tot + ' ressource' + (tot > 1 ? 's' : '') + ' en stock (bonus compris). Ce qui n\'est ni transformé ni vendu est perdu en fin de saison.</div>' : '<div class="muted" style="font-size:13px">Comptez les jetons au fil de la course avec + et −, puis appuyez sur « Encoder ma récolte » : un jeton = une ressource en stock.</div>';
    return '<section class="panel" style="display:flex;flex-direction:column;gap:8px"><div class="row" style="justify-content:space-between"><b>🧺 Ma récolte</b><b class="num">' + tot + ' en stock</b></div>' + rows + carry + prot + early + bonus + btn + hint + '</section>';
  }

  // ---------- Fête du Phoenix ----------
  var TIER = { 1: 'simple', 2: 'mixte', 3: 'composé' };
  function fetePanel(compact) {
    var M = V.menu;
    if (!M || V.phase === 'end' || V.phase === 'lobby') return '';
    var mine = M.items.filter(function (i) { return i.team === me.id; }).length;
    var locked = !M.open;
    var allMine = mine >= M.perFarm;
    var feteDay = V.phase === 'closing' && V.closedYear && !V.feteDone;
    var rows = M.items.filter(function (i) { return !(compact && allMine) || i.team === me.id; }).map(function (i) {
      var right;
      if (!M.open && V.phase === 'closing' && V.closedYear) {
        if (i.team === me.id && !V.feteDone) {
          var have = me.pantry[i.dish] || 0;
          right = i.delivered ? '<span class="stack" style="gap:4px;align-items:flex-end"><b style="color:var(--good)">✓ livré</b>' + (i.viaStock ? '<button class="btn small" data-act="undeliver" data-key="' + i.key + '">Reprendre</button>' : '') + '</span>'
            : '<span class="stack" style="gap:2px;align-items:flex-end"><button class="btn small primary" data-act="deliver" data-key="' + i.key + '"' + (have ? '' : ' disabled') + '>Livrer ce plat</button><span class="muted" style="font-size:11px">' + (have ? 'En stock : ' + have : 'Pas en stock') + '</span></span>';
        } else right = i.delivered ? '<b style="color:var(--good)">✓ livré</b>' : '<b style="color:var(--bad)">à livrer</b>';
      }
      else if (!M.open) right = i.team === me.id ? '<span class="pill ok">À vous</span>' : '<span class="muted" style="font-size:13px">' + esc(i.teamName || '—') + '</span>';
      else if (i.team === me.id) right = '<button class="btn small" data-act="releaseDish" data-key="' + i.key + '">Rendre</button>';
      else if (i.team) right = '<span class="muted" style="font-size:13px">' + esc(i.teamName) + '</span>';
      else right = '<button class="btn small primary" data-act="claimDish" data-key="' + i.key + '"' + (mine >= M.perFarm || locked ? ' disabled' : '') + '>Je prends</button>';
      return '<div class="row" style="justify-content:space-between;flex-wrap:nowrap;padding:6px 0;border-top:1px solid var(--line);' + (i.team === me.id ? 'background:var(--warn-soft);margin:0 -8px;padding-left:8px;padding-right:8px;border-radius:8px' : '') + '"><div style="min-width:0"><b>' + esc(i.name) + '</b><div class="muted" style="font-size:13px">' + esc(TIER[i.tier]) + ' · ' + esc(i.needs) + (i.makers && i.makers.length ? ' · équipées : ' + esc(i.makers.join(', ')) : ' · aucune ferme équipée') + '</div></div>' + right + '</div>';
    }).join('');
    var status = mine >= M.perFarm ? '<span style="color:var(--good);font-weight:700">Vos ' + M.perFarm + ' plats sont pris.</span>' : '<span style="color:var(--bad);font-weight:700">Il vous reste ' + (M.perFarm - mine) + ' plat' + (M.perFarm - mine > 1 ? 's' : '') + ' à prendre.</span>';
    var intro = feteDay ? 'C\'est le jour de la fête : livrez vous-mêmes vos plats depuis votre stock. Un plat manquant fait rater la fête.' : 'Répartissez-vous le menu entre fermes : chacune prend ' + M.perFarm + ' plat' + (M.perFarm > 1 ? 's' : '') + ' en début d\'année, puis les livre le jour de la fête. Un plat manquant fait rater la fête (+' + V.meta.fete.fail + ' stress pour tout le village) et coûte jusqu\'à +' + V.meta.fete.cap + ' stress à son responsable.';
    return '<section class="panel" style="display:flex;flex-direction:column;gap:4px;background:var(--surface-2)"><div class="row" style="justify-content:space-between"><b>🎉 Fête du Phoenix · année ' + V.year + '</b><span class="num muted">' + mine + ' / ' + M.perFarm + '</span></div>' +
      '<div style="font-size:14px">' + intro + '</div>' + (V.phase === 'closing' ? '' : status) + rows + '</section>';
  }

  // ---------- Transformation ----------
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
    // matières disponibles : stock brut + ce que la demande déjà envoyée réserve ; la quantité saisie dans chaque case compte au fur et à mesure
    var avail = {}; V.meta.products.forEach(function (p) { avail[p.id] = (me.stock.raw[p.id] || 0) + (T && T.receive ? (T.receive[p.id] || 0) : 0); });
    var typed = function (id) { var el = document.getElementById('tr-' + id); if (el) { var n = parseInt(el.value, 10); return n > 0 ? n : 0; } return items[id] || 0; };
    var dishById = {}; V.meta.dishes.forEach(function (d) { dishById[d.id] = d; });
    var maxOf = function (d) {
      var used = {}, cnt = 0, fab = {};
      V.meta.dishes.forEach(function (o) { var n = o.id === d.id ? 0 : typed(o.id); cnt += n; fab[o.id] = typed(o.id); if (n) Object.keys(o.req).forEach(function (r) { used[r] = (used[r] || 0) + o.req[r] * n; }); });
      var m = Math.max(0, me.recipeLimit - cnt), why = cnt >= me.recipeLimit ? 'Limite de recettes atteinte (' + me.recipeLimit + ')' : '';
      Object.keys(d.req).forEach(function (r) {
        var have = dishById[r] ? (me.pantry[r] || 0) + (r === d.id ? 0 : fab[r] || 0) : avail[r] || 0;
        var left = have - (used[r] || 0), can = Math.floor(left / d.req[r]);
        if (can < m) { m = Math.max(0, can); if (can <= 0) why = 'Il vous manque ' + Math.max(1, d.req[r] - Math.max(0, left)) + ' ' + (all[r] || r); }
      });
      return { max: m, why: why };
    };
    var form = [1, 2, 3].map(function (tier) {
      return '<div style="margin-top:4px;font-weight:700">' + TN[tier] + V.meta.market.mult[KEY[tier]] + '</div>' + V.meta.dishes.filter(function (d) { return d.tier === tier; }).map(function (d) {
        var mx = maxOf(d), cur = typed(d.id), off = !done && mx.max <= 0 && !cur;
        var ing = off ? '<div style="font-size:12px;color:var(--bad);font-weight:600">✗ ' + esc(mx.why) + '</div>' : '<div style="font-size:12px;color:var(--good);font-weight:600">✓ Ingrédients disponibles · jusqu\'à ' + (cur + mx.max) + '</div>';
        return '<div class="row" style="justify-content:space-between;flex-wrap:nowrap;' + (off ? 'opacity:.45' : '') + '"><label for="tr-' + d.id + '" style="flex:1"><b>' + esc(d.name) + '</b><div class="muted" style="font-size:12px">Recette : ' + esc(d.needs) + '</div>' + ing + '<div class="muted" style="font-size:12px">Plats déjà fabriqués (stock) : <b>' + (me.pantry[d.id] || 0) + '</b></div></label><input id="tr-' + d.id + '" inputmode="numeric" style="width:64px" placeholder="0" value="' + (items[d.id] || '') + '"' + (done || off ? ' disabled' : '') + '></div>';
      }).join('');
    }).join('');
    var recap = T && Object.keys(items).length ? '<div style="background:var(--surface-2);border-radius:10px;padding:8px 10px;font-size:14px"><div><b>À apporter au maire du village :</b> ' + esc(tokenList(T.receive, all)) + (Object.keys(T.use).length ? ' + vos plats : ' + esc(tokenList(T.use, all)) : '') + '</div><div><b>Vous recevez :</b> ' + esc(tokenList(T.give, all)) + '</div></div>' : '';
    var st = done ? '<div style="color:var(--good);font-weight:700">Validé : les plats sont dans votre stock.</div>' : T ? '<div style="font-weight:700;color:var(--warn)">Demande envoyée : apportez les jetons au maire du village.</div>' : '';
    return '<section class="panel" style="display:flex;flex-direction:column;gap:8px"><div class="row" style="justify-content:space-between"><b>🍳 Transformation</b><span class="num muted">max ' + me.recipeLimit + ' recette' + (me.recipeLimit > 1 ? 's' : '') + '' + '</span></div>' +
      '<div class="muted" style="font-size:13px">Choisissez les plats à fabriquer. Les plats dont il manque des ingrédients sont grisés. L\'app calcule les jetons à apporter au maire du village et ceux que vous recevez en échange. Un plat composé utilise des plats déjà fabriqués.</div>' + form + recap +
      '<button class="btn primary" data-act="requestTransfo"' + (done ? ' disabled' : '') + '>' + (T ? 'Modifier ma demande' : 'Envoyer ma demande') + '</button>' + st + '</section>';
  }

  // ---------- Stock (onglet Ferme, toujours visible) ----------
  function stockPanel() {
    var chips = [];
    V.meta.sell.forEach(function (x) {
      var n = x.kind === 'raw' ? me.stock.raw[x.id] : me.stock.dishes[x.id];
      if (n > 0) chips.push('<span class="pill" style="font-size:14px">' + (x.kind === 'raw' ? icon(x.id) + ' ' : '🍽️ ') + esc(x.name) + ' <b>' + n + '</b></span>');
    });
    var raw = V.meta.sell.filter(function (x) { return x.kind === 'raw'; }).reduce(function (n, x) { return n + (me.stock.raw[x.id] || 0); }, 0);
    var dishes = V.meta.sell.filter(function (x) { return x.kind === 'dish'; }).reduce(function (n, x) { return n + (me.stock.dishes[x.id] || 0); }, 0);
    return '<section class="panel stack"><div class="row" style="justify-content:space-between"><b>📦 Mon stock</b><span class="muted num" style="font-size:13px">' + plural(raw, 'jeton brut', 'jetons bruts') + ' · ' + plural(dishes, 'plat', 'plats') + '</span></div>' +
      (chips.length ? '<div class="row" style="gap:6px">' + chips.join('') + '</div>' : '<div class="muted" style="font-size:14px">Rien en stock pour le moment.</div>') +
      '<div class="muted" style="font-size:12px">Jetons bruts : récolte encodée (bonus compris) moins les recettes et les échanges. Les matières non transformées ni vendues sont perdues en fin de saison. Les plats restent en stock d\'une saison à l\'autre.</div></section>';
  }

  // ---------- Bourse ----------
  function tradePanel() {
    if (V.phase !== 'season' || V.step !== 2) return '';
    var name = function (id) { var t = V.teams.filter(function (x) { return x.id === id; })[0]; return t ? t.name : '?'; };
    var list = function (a) { return a.map(function (i) { return i.n + ' × ' + esc(i.name.toLowerCase()); }).join(', '); };
    // phrase vue par la ferme `me` : ce qu'elle donne, ce qu'elle reçoit, le prix
    var phrase = function (tr) {
      var iAmFrom = tr.from === me.id;
      var give = iAmFrom ? tr.items : tr.want, get = iAmFrom ? tr.want : tr.items;
      var pay = tr.price ? (((tr.payer === 'from') === iAmFrom) ? ' et vous <b>payez ' + tr.price + ' EB</b>' : ' et vous <b>recevez ' + tr.price + ' EB</b>') : '';
      return 'vous donnez <b>' + (give.length ? list(give) : 'rien') + '</b>, vous recevez <b>' + (get.length ? list(get) : 'rien') + '</b>' + pay;
    };
    var pending = (V.trades || []).filter(function (x) { return x.status === 'pending'; });
    var incoming = pending.filter(function (x) { return x.to === me.id; }).map(function (tr) {
      return '<div class="panel soft stack" style="padding:10px 14px"><div><b>' + esc(name(tr.from)) + '</b> propose : ' + phrase(tr) + '.</div><div class="row"><button class="btn primary small" data-act="respondTrade" data-trade="' + tr.id + '" data-accept="1">Accepter</button><button class="btn small" data-act="respondTrade" data-trade="' + tr.id + '">Refuser</button></div></div>';
    }).join('');
    var outgoing = pending.filter(function (x) { return x.from === me.id; }).map(function (tr) {
      return '<div class="row" style="justify-content:space-between"><span class="muted" style="font-size:14px">En attente de ' + esc(name(tr.to)) + ' : ' + phrase(tr) + '.</span><button class="btn small" data-act="cancelTrade" data-trade="' + tr.id + '">Annuler</button></div>';
    }).join('');
    var done = (V.trades || []).filter(function (x) { return x.status === 'done'; }).slice(-3).reverse().map(function (tr) {
      return '<div class="muted" style="font-size:13px">✓ ' + esc(name(tr.from)) + ' ↔ ' + esc(name(tr.to)) + ' : ' + (tr.items.length ? list(tr.items) : 'rien') + ' contre ' + (tr.want.length ? list(tr.want) : 'rien') + (tr.price ? ' + ' + tr.price + ' EB' : '') + '</div>';
    }).join('');
    var others = V.teams.filter(function (x) { return x.id !== me.id; });
    var mine = V.meta.sell.filter(function (x) { return (x.kind === 'raw' ? me.stock.raw[x.id] : me.stock.dishes[x.id] || 0) > 0; });
    var none = '<option value="">— rien —</option>';
    var form = !others.length ? '' :
      '<div class="stack" style="gap:8px"><select id="trdTo" aria-label="Ferme destinataire">' + others.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      '<div class="row" style="flex-wrap:nowrap"><span style="width:84px;font-weight:700">Je donne</span><select id="trdGive" aria-label="Produit donné" style="flex:1;min-width:0">' + none + mine.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + ' (' + (x.kind === 'raw' ? me.stock.raw[x.id] : me.stock.dishes[x.id]) + ')</option>'; }).join('') + '</select><input id="trdGiveN" inputmode="numeric" placeholder="Qté" style="width:64px"></div>' +
      '<div class="row" style="flex-wrap:nowrap"><span style="width:84px;font-weight:700">Je demande</span><select id="trdWant" aria-label="Produit demandé" style="flex:1;min-width:0">' + none + V.meta.sell.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('') + '</select><input id="trdWantN" inputmode="numeric" placeholder="Qté" style="width:64px"></div>' +
      '<div class="row" style="flex-wrap:nowrap"><span style="width:84px;font-weight:700">+ EB</span><input id="trdPrice" inputmode="numeric" placeholder="Prix (facultatif)" style="flex:1;min-width:0"><select id="trdPayer" aria-label="Qui paie" style="width:128px"><option value="to">payé par eux</option><option value="from">payé par moi</option></select></div>' +
      '<button class="btn primary" data-act="offerTrade">Proposer l\'échange</button></div>';
    return '<section class="panel stack"><b>🔁 Bourse : échanger avec une autre ferme</b>' + incoming + form + outgoing + done +
      '<div class="muted" style="font-size:12px">Échangez des produits contre des produits, contre des EB, ou les deux. Le destinataire doit accepter. Faites ensuite passer les jetons de main en main : l\'application suit le stock et l\'argent. Rien en échange : c\'est un don.</div></section>';
  }

  // ---------- Marché ----------
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
    var spin = Q.stallUnits > 0 || me.wheel ? '<button class="btn" data-act="spinWheel"' + (canSpin ? '' : ' disabled') + '>🎡 ' + (me.wheel ? (me.freeSpin ? 'Relancer la roue (gratuit)' : 'Relancer la roue (+1 stress)') : 'Tourner la roue de l\'étal') + '</button>' : '';
    var est = 'Supermarché garanti : <b class="num">' + Q.safeTotal + ' EB</b>' + (Q.income ? ' · gîte <b class="num">+' + Q.income + ' EB</b>' : '') + (Q.total == null ? (Q.stall ? ' <span class="muted">· étal jusqu\'à ' + Q.stall + ' EB selon la roue' + (Q.feePaid ? ', frais d\'emplacement déjà payés' : ', frais d\'emplacement ' + Q.fee + ' EB') + '</span>' : '') : '<br>Total estimé : <b class="num">' + Q.total + ' EB</b> <span class="muted">(étal vendu : ' + Q.soldUnits + ' sur ' + Q.stallUnits + (Q.feePaid ? ', frais d\'emplacement déjà payés' : ', frais ' + Q.fee) + ')</span>');
    var acts = (Q.activities || []).map(function (a) {
      return '<div style="font-size:13px"><b>' + a.icon + ' ' + esc(a.name) + '</b> : ' + (a.roll ? (a.n ? '<span style="color:var(--good);font-weight:700">dé ' + a.roll + ' · ' + (V.meta.activities.filter(function (x) { return x.id === a.id; })[0].effects[a.roll - 1]) + (a.gain && a.id !== 'gite' ? ' (+' + a.gain + ' EB)' : '') + '</span>' : '<span style="color:var(--bad);font-weight:700">dé 1 · ne fonctionne pas</span>') : '<span class="muted">dé pas encore lancé (onglet Accueil, étape Aléa)</span>') + '</div>';
    }).join('');
    var detail = Q.total != null && Q.lines.some(function (l) { return l.dir > 0; }) ? '<div class="stack" style="gap:2px"><b>🧮 Détail de l\'étal</b>' + Q.lines.filter(function (l) { return l.dir > 0; }).map(function (l) {
      return '<div class="row" style="justify-content:space-between;flex-wrap:nowrap;font-size:14px"><span>' + esc(l.name) + '' + ' : <b>' + l.soldUnits + '</b> vendu' + (l.soldUnits > 1 ? 's' : '') + ' sur ' + l.dir + ' × ' + l.unitDir + ' EB</span><b class="num">' + l.revenue + ' EB</b></div>';
    }).join('') + '<div class="row" style="justify-content:space-between;font-size:14px"><span>Frais d\'emplacement' + (Q.feePaid ? ' (déjà payés au placement)' : '') + '</span><b class="num">' + (Q.feePaid ? '0' : '−' + Q.fee) + ' EB</b></div></div>' : '';
    var report = Q.report && Q.report.length ? '<div class="stack" style="gap:6px"><b>📣 Retour du marché</b>' + Q.report.map(function (l) { return '<div style="border-left:4px solid ' + (l.level === 'tout' || l.level === 'bien' ? 'var(--good)' : 'var(--bad)') + ';padding-left:10px">' + esc(l.text) + '</div>'; }).join('') + '</div>' : '';
    var status = S.settled ? '<div style="color:var(--good);font-weight:700">Payé : ' + (S.amount >= 0 ? '+' : '−') + Math.abs(S.amount) + ' EB. Bien joué !</div>' : me.wheel ? '<div style="font-weight:700;color:var(--warn)">Montrez vos produits au maire du village : il vérifie et paie.</div>' : S.declared ? '<div style="font-weight:700;color:var(--warn)">Placement validé : tournez la roue de l\'étal, ou attendez le paiement du supermarché.</div>' : '';
    var warn = Q.directBlocked ? '<div style="color:var(--bad);font-weight:700">Pas de vente directe cette saison.</div>' : '';
    var intro = '<div class="muted" style="font-size:13px">1. Placez vos produits (seuls ceux en stock sont ouverts). 2. Tournez la roue : elle dit quelle part de l\'étal se vend. Les invendus sont perdus. <b>Poser des produits à l\'étal coûte ' + M.stallFee + ' EB de frais d\'emplacement</b>, payés au maire du village quand vous validez le placement. Tout vendre retire 1 stress ; ne rien vendre en ajoute 1.</div>';
    var legend = '<details id="wheelHelp"><summary>🎡 Que peut donner la roue ?</summary><div style="margin-top:8px">' + FF.wheelLegend(V.meta.wheel) + '</div></details>';
    return '<section class="panel" style="display:flex;flex-direction:column;gap:8px"><div class="row" style="justify-content:space-between"><b>Marché</b>' + wheel + '</div>' + intro + warn + grid +
      '<button class="btn primary" data-act="declareSales"' + (locked ? ' disabled' : '') + '>' + (S.declared ? 'Modifier le placement' : 'Valider le placement') + '</button>' + spin + legend + '<div>' + est + '</div>' + detail + acts + report + status + '</section>';
  }

  // ---------- Accueil : seulement ce qu'il y a à faire ----------
  var STEP_HINT = [
    'Une carte tombe sur le village. Choisissez comment réagir.',
    'Un coureur par tuile, un jeton par trajet : chaque produit a sa durée de course. Encodez ce que vous rapportez.',
    'Encodez votre récolte, puis fabriquez vos plats. Les jetons non transformés ni vendus seront perdus.',
    'Placez vos produits, puis tournez la roue de l\'étal. Ce qui n\'est ni transformé ni vendu est perdu.',
    'Remplissez votre panier à la boutique : matériel et vacances.'
  ];

  function hero(icon, eyebrow, title, hint) {
    return '<section class="t-hero"><div class="eyebrow">' + esc(eyebrow) + '</div><h2>' + icon + ' ' + esc(title) + '</h2>' + (hint ? '<div class="muted">' + esc(hint) + '</div>' : '') + '</section>';
  }
  function readyCard() {
    return '<button class="btn ' + (me.ready ? 'good' : 'primary') + ' block" style="min-height:54px;font-size:16px" data-act="ready">' + (me.ready ? '✓ Prêts ! On attend les autres' : '👍 Nous sommes prêts pour la suite') + '</button>';
  }
  function collierPanel() {
    return '<section class="panel stack"><b>🐎 Coup de collier</b><div class="muted" style="font-size:14px">' + V.meta.collierSec + ' secondes de course en plus après la fin du chrono, au prix de 1 point de stress. Une fois par saison.</div>' +
      '<button class="btn" data-act="collier">Lancer le coup de collier (+1 stress)</button></section>';
  }
  function buyHint(text) {
    var n = cart.length;
    return '<section class="panel soft row" style="justify-content:space-between"><span>🛍️ ' + esc(text) + '</span><button class="btn small primary" data-tab="boutique">' + (n ? 'Panier (' + n + ')' : 'Ouvrir la boutique') + '</button></section>';
  }
  function chargesCard() {
    var ch = me.charges, c = V.lastCharges;
    var rows = [['Taxes', ch.taxes], ['Eau', ch.eau], ['Nourriture', ch.nourriture], ['Électricité', ch.electricite]].map(function (r) { return '<div class="row" style="justify-content:space-between"><span>' + r[0] + '</span><b class="num">' + r[1] + ' EB</b></div>'; }).join('');
    var res = c ? (c.missing ? '<div class="pill bad">Il manquait ' + c.missing + ' EB : +' + c.boules + ' stress</div>' : '<div class="pill ok">Charges payées</div>') : '<div class="muted" style="font-size:14px">Le comptable les paie quand le maire du village les applique.</div>';
    return '<section class="panel stack"><b>🧾 Charges de l\'année ' + V.year + '</b>' + rows + '<hr class="hr"><div class="row" style="justify-content:space-between"><b>Total</b><b class="num">' + ch.total + ' EB</b></div>' + res + '</section>';
  }

  // "A faire maintenant" : ce qu'on attend de la ferme à cette étape, coché au fil de l'avancement.
  function todoItems() {
    var items = [];
    var item = function (text, done, optional) { items.push({ text: text, done: !!done, optional: !!optional }); };
    var harvested = me.harvest && me.harvest.length && me.harvest.every(function (h) { return h.brought !== null; });
    var acts = me.activities.length ? me.activities.every(function (id) { return me.actRolls[id]; }) : null;
    if (V.phase === 'setup' || V.phase === 'rearrange') {
      var M = V.menu, mine = M ? M.items.filter(function (i) { return i.team === me.id; }).length : 0;
      if (M) item('Prendre vos ' + M.perFarm + ' plats de la fête (' + mine + ' / ' + M.perFarm + ')', mine >= M.perFarm);
      item('Acheter tuiles, activités et matériel à la boutique', false, true);
      item('Appuyer sur « Prêts » pour passer à la suite', me.ready);
      return items;
    }
    if (V.phase === 'closing') {
      var mi = V.menu ? V.menu.items.filter(function (i) { return i.team === me.id; }) : [];
      item('Le maire du village applique les charges', V.closedYear);
      if (mi.length) item('Livrer vos plats de la fête (' + mi.filter(function (i) { return i.delivered; }).length + ' / ' + mi.length + ')', V.closedYear && mi.every(function (i) { return i.delivered; }));
      return items;
    }
    var st = V.step;
    if (st === 0) {
      var c = V.card;
      if (!c || cardPending()) item('Le maire du village tire une carte…', false);
      else if (c.collective) item('Aléa collectif : donnez au pot commun si vous le voulez (bandeau en haut)', false, true);
      else if (c.tone === 'neg') item('Choisir (bandeau en haut) : subir, jouer sa parade ou ajouter 1 stress', !!me.choice);
      else item('Bonne nouvelle : rien à faire', true);
      if (acts !== null) item('Lancer le dé de chaque activité complémentaire', acts);
    } else if (st === 1) {
      item('Courir et compter vos jetons avec + et −', harvested);
      item('Encoder votre récolte', harvested);
    } else if (st === 2) {
      if (me.harvest && me.harvest.length) item('Encoder votre récolte', harvested);
      item('Demander vos recettes', !!me.transfo, true);
      item('Échanger à la bourse', false, true);
    } else if (st === 3) {
      var S = me.sales || {};
      item('Placer vos produits (grande distribution ou étal)', !!S.declared);
      item('Tourner la roue de l\'étal', !!me.wheel, true);
      item('Vente réglée par le maire du village', !!S.settled);
      if (V.challenge) item('Défi zéro perte : plus aucune matière brute en fin de saison', !!me.challengeOk, true);
    } else {
      item('Remplir et valider votre panier (matériel, vacances)', false, true);
      if (V.challenge) item('Défi zéro perte : ' + (me.challengeOk ? 'réussi, −1 stress à la fin de la saison' : 'vendez ou transformez le reste de votre stock'), !!me.challengeOk, true);
    }
    item('Appuyer sur « Prêts » pour passer à la suite', me.ready);
    return items;
  }
  function todoPanel() {
    var rows = todoItems().map(function (it) {
      return '<li style="display:flex;gap:10px;align-items:flex-start;padding:4px 0' + (it.done ? ';opacity:.6' : '') + '"><span aria-hidden="true" style="font-size:20px;line-height:1.1">' + (it.done ? '✅' : '⬜') + '</span><span' + (it.done ? ' style="text-decoration:line-through"' : '') + '>' + esc(it.text) + (it.optional ? ' <span class="muted" style="font-size:12px">(facultatif)</span>' : '') + '</span></li>';
    }).join('');
    var help = V.phase === 'season' ? '<button class="btn small" data-act="help" data-step="' + V.step + '" aria-label="Aide sur cette étape">?</button>' : '';
    return '<section class="panel" style="padding:12px 16px"><div class="row" style="justify-content:space-between"><b>À faire maintenant</b>' + help + '</div><ul style="list-style:none;margin:6px 0 0;padding:0">' + rows + '</ul></section>';
  }
  function challengePanel() {
    var parts = '';
    if (V.challenge) parts += '<section class="panel" style="border-color:var(--amber)"><b>🎯 ' + esc(V.challenge.title) + '</b><div class="muted" style="font-size:14px">' + esc(V.challenge.text) + '</div></section>';
    var l = V.lastChallenge;
    if (l && V.step === 0 && !(l.year === V.year && l.season === V.season)) parts += '<section class="panel" style="padding:10px 14px"><div class="muted" style="font-size:13px">Défi de la saison dernière : ' + (l.winners.length ? '<b>' + esc(l.winners.join(', ')) + '</b> ont réussi (−1 stress)' : 'aucune ferme n\'a réussi') + '.</div></section>';
    return parts;
  }

  function accueil() {
    if (V.phase === 'end') return ended();
    if (V.phase === 'lobby') return hero('🚜', 'Bienvenue', 'On attend le départ', 'Le maire du village va lancer l\'installation. Gardez cet écran ouvert.') + welcomePanel();
    if (V.phase === 'setup' || V.phase === 'rearrange') {
      var setup = V.phase === 'setup';
      return hero(setup ? '🏡' : '🔧', setup ? 'Installation' : 'Réaménagement · avant l\'année ' + V.year, setup ? 'Montez votre ferme' : 'Adaptez votre ferme', 'Répartissez les plats de la fête, puis achetez vos tuiles, activités et matériel.') +
        todoPanel() + meteo() + fetePanel() + buyHint('Tuiles, activités et matériel : à la boutique') + readyCard();
    }
    if (V.phase === 'closing') {
      return hero('🎉', 'Clôture de l\'année ' + V.year, V.closedYear ? 'La Fête du Phoenix' : 'Le bilan de l\'année', V.closedYear ? 'Livrez vos plats depuis votre stock.' : 'Le maire du village applique les charges, puis la fête commence.') +
        todoPanel() + chargesCard() + fetePanel() + meteo();
    }
    var st = V.step, h = hero(FF.ICON.steps[st], 'Étape ' + (st + 1) + ' sur 5', V.meta.steps[st].name, STEP_HINT[st]);
    if (me.stopped) return h + '<section class="panel warn"><b>😴 Burn-out</b><div>Votre ferme est à l\'arrêt cette saison : récupérez ! Les virements et les achats restent possibles.</div></section>';
    h += todoPanel() + challengePanel();
    if (st === 0) return h + stressPanel() + aleaSummary() + activitiesPanel() + readyCard();
    if (st === 1) return h + harvestPanel() + collierPanel() + readyCard();
    var pendingHarvest = me.harvest && me.harvest.length && !me.harvest.every(function (x) { return x.brought !== null; });
    if (st === 2) return h + (pendingHarvest ? '<section class="panel warn"><b>⚠️ Récolte pas encore encodée</b><div style="font-size:14px">Encodez-la maintenant : sans elle, vous n\'avez rien à transformer ni à vendre.</div></section>' + harvestPanel() : '') + tradePanel() + transfoPanel() + readyCard();
    if (st === 3) return h + marketPanel() + readyCard();
    return h + meteo() + buyHint('Matériel et vacances : à la boutique') + readyCard();
  }

  function welcomePanel() {
    var card = function (id, ic, title, body, open) {
      return '<details id="' + id + '" class="panel"' + (open ? ' open' : '') + '><summary><b>' + ic + ' ' + title + '</b></summary><div class="stack" style="margin-top:8px;font-size:15px;line-height:1.45">' + body + '</div></details>';
    };
    var roles = '<p style="margin:0">Chaque joueur a un badge, qui <b>change d\'un cran chaque année</b> : tout le monde essaie tous les métiers.</p><ul style="margin:0;padding-left:18px">' +
      ['<b>Fermier en chef</b> : décide pour la ferme', '<b>Comptable</b> : valide les achats et les virements', '<b>Négociateur</b> : échange à la bourse et au marché', '<b>Gardien du bocal</b> : surveille le stress et annonce le coup de collier', '<b>Chef de relais</b> : organise les coureurs', '<b>Éclaireur</b> : lit la météo et les cartes'].map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
    var farm = '<p style="margin:0">Votre ferme a des <b>tuiles</b> de production (lait, œufs, viande, fruits et légumes). <b>Une tuile = un coureur</b> : sans joueur pour courir, une tuile de plus ne sert à rien. L\'onglet <b>Ferme</b> montre vos tuiles, votre matériel, votre stock et les objectifs de la partie.</p>';
    var tabs = '<ul style="margin:0;padding-left:18px"><li><b>Accueil</b> : ce qu\'il y a à faire maintenant</li><li><b>Ferme</b> : composition, stock, objectifs, charges</li><li><b>Boutique</b> : panier d\'achats, vacances, activités</li><li><b>Banque</b> : virements et compte du village</li></ul>';
    var play = '<p style="margin:0">On joue ensemble : le village gagne jusqu\'à <b>3 étoiles</b> (peu de stress, fêtes du Phoenix réussies, caisse du village bien remplie). Chaque saison a 5 étapes :</p><ol style="margin:0;padding-left:20px">' +
      V.meta.steps.map(function (s) { return '<li><b>' + esc(s.name) + '</b></li>'; }).join('') + '</ol><p style="margin:0">Le bouton « ? » de chaque étape explique la règle.</p>';
    var gloss = '<dl style="margin:0">' + [['Jeton', 'ce que rapporte un coureur à chaque trajet : 1 jeton = 1 ressource'], ['Ressource', 'lait, œufs, viande ou fruits et légumes en stock'], ['EB', 'l\'argent de la ferme'], ['Stress', 'chaque point remplit le bocal (' + V.meta.bocalMax + ' = burn-out)'], ['Parade', 'matériel qui protège d\'un aléa'], ['Aléa', 'la carte de la saison : météo, animaux, marché…'], ['Maire du village', 'celui qui anime la partie : il tire les cartes, échange vos jetons et paie vos ventes']].map(function (g) { return '<dt style="font-weight:700;margin-top:6px">' + g[0] + '</dt><dd style="margin:0 0 0 0" class="muted">' + g[1] + '</dd>'; }).join('') + '</dl>';
    return card('wRole', '🎭', 'Ton rôle', roles, true) + card('wFarm', '🏡', 'Ta ferme', farm) + card('wTabs', '🧭', 'Les 4 onglets', tabs) + card('wPlay', '📋', 'Comment on joue', play) + card('wGloss', '📖', 'Petit glossaire', gloss);
  }

  // ---------- Onglet Ferme : composition, stock, objectifs, charges ----------
  function farmComposition() {
    var tiles = Object.keys(me.tilesByType).filter(function (k) { return me.tilesByType[k] > 0 && k !== 'activite'; }).map(function (k) { return '<div class="row" style="justify-content:space-between"><span>' + icon(k) + ' ' + esc(V.meta.tileNames[k]) + '</span><b class="num">× ' + me.tilesByType[k] + '</b></div>'; }).join('') || '<span class="muted">Aucune tuile</span>';
    var counts = {};
    me.equipment.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    var eq = Object.keys(counts).map(function (id) { return '<div class="row" style="justify-content:space-between"><span>' + ((FF.ICON.equip || {})[id] || '🧰') + ' ' + esc(catName(id)) + '</span><b class="num">× ' + counts[id] + '</b></div>'; }).join('') || '<span class="muted">Aucun matériel</span>';
    var acts = me.activities.length ? me.activities.map(function (id) {
      var a = V.meta.activities.filter(function (x) { return x.id === id; })[0];
      var roll = me.actRolls[id];
      return '<div class="row" style="justify-content:space-between"><span>' + a.icon + ' ' + esc(a.name) + '</span><span class="pill' + (roll === 1 ? ' bad' : roll ? ' ok' : '') + '">' + (V.phase === 'season' ? (roll ? 'dé ' + roll : 'dé à lancer') : 'dé chaque saison') + '</span></div>';
    }).join('') : '<span class="muted">Aucune activité complémentaire</span>';
    var tot = Object.keys(me.tilesByType).reduce(function (n, k) { return n + me.tilesByType[k]; }, 0);
    return '<section class="panel stack"><b>🏡 Ma ferme</b><div class="eyebrow">Tuiles · ' + tot + ' au total (' + plural(['lait', 'oeuf', 'viande', 'fl'].reduce(function (n, k) { return n + (me.tilesByType[k] || 0); }, 0), 'coureur possible', 'coureurs possibles') + ')</div>' + tiles +
      '<div class="eyebrow" style="margin-top:6px">Activités complémentaires</div>' + acts + '<div class="eyebrow" style="margin-top:6px">Matériel</div>' + eq + '</section>';
  }
  function goalsPanel() {
    var g = V.goals;
    if (!g) return '';
    var stars = g.stars.map(function (s) {
      var cls = s.lost ? 'bad' : s.ok ? 'ok' : 'warn';
      return '<div class="stack" style="gap:2px;padding:8px 0;border-top:1px solid var(--line)"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b>' + esc(s.title) + '</b><span class="pill ' + cls + '">' + (s.lost ? 'Perdue' : s.ok ? 'En bonne voie' : 'À conquérir') + '</span></div><div style="font-size:14px">' + esc(s.text) + '</div><div class="muted" style="font-size:13px">' + esc(s.detail) + '</div></div>';
    }).join('');
    var years = g.perYear.map(function (y) {
      var fete = y.fete === 'success' ? '<span class="pill ok">Fête réussie</span>' : y.fete === 'fail' ? '<span class="pill bad">Fête ratée</span>' : y.fete === 'todo' ? '<span class="pill">Fête à venir</span>' : '<span class="pill">Pas de fête</span>';
      return '<div class="stack" style="gap:2px;padding:8px;margin:0 -8px;border-radius:10px;' + (y.current ? 'background:var(--warn-soft)' : '') + '"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b>Année ' + y.year + (y.current ? ' · en cours' : '') + '</b>' + fete + '</div>' +
        '<div style="font-size:13px">' + (y.dishes ? '🎉 Commande de la fête : ' + esc(y.dishes) + '. ' : '') + '🫙 ' + esc(y.stress) + '. 💰 Repère de caisse : ' + y.bankMilestone + ' EB.</div></div>';
    }).join('');
    return '<section class="panel stack"><b>🎯 Objectifs de la partie</b><div class="muted" style="font-size:13px">Le village gagne ensemble : jusqu\'à 3 étoiles.</div>' + stars + '<div class="eyebrow" style="margin-top:6px">Année par année</div>' + years + '</section>';
  }
  function chargesSection() {
    var ch = me.charges;
    var hist = me.chargesHistory.length ? me.chargesHistory.map(function (c) {
      return '<div class="row" style="justify-content:space-between;flex-wrap:nowrap"><span>Année ' + c.year + '<span class="muted" style="font-size:12px"> · taxes ' + c.taxes + ', eau ' + c.eau + ', nourriture ' + c.nourriture + ', électricité ' + c.electricite + '</span></span><b class="num">' + c.total + ' EB' + (c.missing ? ' <span style="color:var(--bad)">(manque ' + c.missing + ')</span>' : '') + '</b></div>';
    }).join('') : '<div class="muted" style="font-size:13px">Aucune année clôturée pour le moment.</div>';
    var cur = V.phase === 'closing' && V.closedYear ? '' : '<div class="row" style="justify-content:space-between"><span><b>Année ' + V.year + '</b> (estimation)</span><b class="num">' + ch.total + ' EB</b></div><div class="muted" style="font-size:12px">Taxes ' + ch.taxes + ' · eau ' + ch.eau + ' · nourriture ' + ch.nourriture + ' · électricité ' + ch.electricite + '. Payées à la clôture de l\'année.</div>';
    return '<section class="panel stack"><b>🧾 Mes charges</b>' + cur + '<div class="eyebrow" style="margin-top:4px">Années payées</div>' + hist + '</section>';
  }
  function renamePanel() {
    return '<details id="renameBox" class="panel"><summary>✏️ Renommer ma ferme</summary><div class="row" style="margin-top:8px;flex-wrap:nowrap"><input id="newFarmName" maxlength="40" value="' + esc(me.name) + '" style="flex:1;min-width:0" aria-label="Nom de la ferme"><button class="btn primary" data-act="rename">Renommer</button></div></details>';
  }
  function ferme() {
    return '<h2 style="font-size:40px">Ma ferme</h2>' + stockPanel() + farmComposition() + renamePanel() + activityExplain(false) + goalsPanel() + (V.menu && V.phase !== 'lobby' && V.phase !== 'end' && V.phase !== 'closing' ? fetePanel(true) : '') + chargesSection();
  }

  // ---------- Boutique : panier ----------
  function shopById(id) { return me.shop.filter(function (x) { return x.id === id; })[0]; }
  function shopIcon(i) {
    if (i.kind === 'tile') return icon(i.id.replace('tile_', '')) || '🏡';
    if (i.kind === 'activity') return (FF.ICON.act || {})[i.id.replace('act_', '')] || '🎪';
    return (FF.ICON.equip || {})[i.id] || '🧰';
  }
  function inCart(id) { return cart.filter(function (x) { return x === id; }).length; }
  function cartQuote() {
    var tiles = Object.assign({}, me.tilesByType), lines = [], total = 0;
    cart.forEach(function (id) {
      var it = shopById(id); if (!it) return;
      var price = it.price;
      if (it.kind === 'tile' && id !== 'tile_atelier') { var tk = id.replace('tile_', ''); price = (tiles[tk] || 0) > 0 ? V.meta.tilePrice.owned : V.meta.tilePrice.new; tiles[tk] = (tiles[tk] || 0) + 1; }
      lines.push({ id: id, name: it.name, price: price, icon: shopIcon(it) }); total += price;
    });
    return { lines: lines, total: total };
  }
  function canAdd(i) {
    if (i.kind === 'tile' || i.kind === 'activity') { if (!V.canExpand) return false; }
    else if (i.kind === 'service') { if (!(V.phase === 'season' && V.step === 4)) return false; }
    else if (!V.canShop) return false;
    if (V.phase === 'closing' && !V.closedYear) return false;
    if (i.price == null) return false;
    if (!i.multi && inCart(i.id)) return false;
    if (i.kind === 'service' && inCart(i.id) >= i.max) return false;
    return true;
  }
  function shopRow(i) {
    var q = inCart(i.id), can = canAdd(i);
    var isTile = i.kind === 'tile';
    var label = i.owned ? 'Déjà acheté' : q && !i.multi ? 'Dans le panier' : !can ? 'Indisponible' : isTile && i.count > 0 ? 'Agrandir' : 'Ajouter';
    var own = isTile && i.count > 0 ? '<span class="pill ok" style="font-size:11px">Dans la ferme : ×' + i.count + '</span> ' : i.count > 0 && i.multi ? '<span class="pill ok" style="font-size:11px">Déjà : ×' + i.count + '</span> ' : i.owned ? '<span class="pill ok" style="font-size:11px">✓ Déjà acheté</span> ' : '';
    var inc = q ? '<span class="pill warn" style="font-size:11px">Panier : ×' + q + '</span>' : '';
    return '<div class="shop"><div style="font-size:28px;min-width:34px;text-align:center" aria-hidden="true">' + shopIcon(i) + '</div><div style="flex:1;min-width:0"><b>' + esc(i.name) + '</b><div class="muted" style="font-size:13px">' + esc(i.effect) + '</div>' + (isTile && i.id !== 'tile_atelier' ? '<div style="font-size:12px;font-weight:700;color:' + (i.count > 0 ? 'var(--good)' : 'var(--warn)') + '">' + (i.count > 0 ? 'Moins cher : vous avez déjà ce type' : 'Nouveau type : plus cher') + '</div>' : '') + '<div>' + own + inc + '</div></div>' +
      '<div style="text-align:right"><div class="num" style="font-weight:800">' + (i.price == null ? '–' : i.price + ' EB' + (i.kind === 'service' ? ' / pers.' : '')) + '</div><button class="btn small ' + (can ? 'primary' : '') + '" data-act="cartAdd" data-item="' + i.id + '"' + (can ? '' : ' disabled') + '>' + label + '</button></div></div>';
  }
  // Rappel de ce que la ferme a déjà acheté.
  function ownedRecap() {
    var counts = {};
    me.equipment.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    var parts = Object.keys(counts).map(function (id) { return '<span class="pill">' + ((FF.ICON.equip || {})[id] || '🧰') + ' ' + esc(catName(id)) + (counts[id] > 1 ? ' ×' + counts[id] : '') + '</span>'; });
    me.activities.forEach(function (id) { var a = V.meta.activities.filter(function (x) { return x.id === id; })[0]; parts.push('<span class="pill">' + a.icon + ' ' + esc(a.name) + '</span>'); });
    var last = me.purchases.slice(-5).reverse().map(function (p) {
      return '<div class="row" style="justify-content:space-between;flex-wrap:nowrap;font-size:13px"><span>' + esc(p.name) + ' <span class="muted">· année ' + p.year + (p.phase === 'season' ? ', ' + esc(V.meta.seasons[p.season].name.toLowerCase()) : '') + '</span></span><b class="num">' + p.price + ' EB</b></div>';
    }).join('');
    return '<section class="panel stack"><b>✅ Déjà acheté</b>' + (parts.length ? '<div class="row" style="gap:6px">' + parts.join('') + '</div>' : '<div class="muted" style="font-size:14px">Aucun matériel ni activité pour le moment.</div>') +
      (last ? '<div class="eyebrow">Derniers achats</div>' + last : '') + '</section>';
  }
  function cartPanel() {
    var q = cartQuote();
    if (!q.lines.length) return '<section class="panel soft" style="padding:12px 16px"><b>🛒 Mon panier</b><div class="muted" style="font-size:14px">Vide. Ajoutez des articles, puis validez le panier : rien n\'est payé avant.</div></section>';
    var ok = q.total <= me.bank;
    var lines = q.lines.map(function (l, i) { return '<div class="row" style="justify-content:space-between;flex-wrap:nowrap"><span>' + l.icon + ' ' + esc(l.name) + '</span><span class="row" style="gap:8px;flex-wrap:nowrap"><b class="num">' + l.price + ' EB</b><button class="btn small" data-act="cartRemove" data-index="' + i + '" aria-label="Retirer ' + esc(l.name) + ' du panier">✕</button></span></div>'; }).join('');
    return '<section class="panel stack" style="border-color:var(--pb)"><div class="row" style="justify-content:space-between"><b>🛒 Mon panier (' + q.lines.length + ')</b><button class="btn small" data-act="cartClear">Vider</button></div>' + lines +
      '<hr class="hr"><div class="row" style="justify-content:space-between"><b>Total</b><b class="num" style="font-size:20px;' + (ok ? '' : 'color:var(--bad)') + '">' + q.total + ' EB</b></div>' +
      '<div class="muted" style="font-size:13px">Banque : ' + me.bank + ' EB · après achat : ' + (me.bank - q.total) + ' EB.' + (ok ? '' : ' <b style="color:var(--bad)">Solde insuffisant.</b>') + ' Seul le comptable valide : annoncez-le à l\'équipe.</div>' +
      '<button class="btn primary block" style="min-height:52px" data-act="cartBuy"' + (ok ? '' : ' disabled') + '>Valider le panier · ' + q.total + ' EB</button></section>';
  }
  function boutique() {
    var undo = me.undo ? '<div class="panel row" data-undo="' + (Date.now() + me.undo.ms) + '" style="justify-content:space-between"><span>✅ Achat validé : <b>' + esc(me.undo.name) + '</b></span><button class="btn small" data-act="undoBuy">↩ Annuler</button></div>' : '';
    var svc = me.shop.filter(function (i) { return i.kind === 'service'; }), eq = me.shop.filter(function (i) { return i.kind === 'equipment'; });
    var tiles = me.shop.filter(function (i) { return i.kind === 'tile'; }), acts = me.shop.filter(function (i) { return i.kind === 'activity'; });
    var vacOpen = V.phase === 'season' && V.step === 4;
    var svcNote = '<div class="muted" style="font-size:13px">Chaque voyageur retire 1 point de stress, mais ne court pas la saison suivante. Au plus autant de voyageurs que de stress (' + me.bocal + ' pour vous).</div>';
    var eqNote = V.canShop ? '' : '<div class="panel warn" style="padding:10px 14px">🔒 Le matériel s\'achète en fin de saison (étape Achats), à l\'installation ou en fin d\'année.</div>';
    var expand = V.canExpand ? '<h3 style="font-size:30px;margin-top:6px">🏡 Agrandissements et activités</h3><div class="muted" style="font-size:13px">Achetables maintenant seulement : le prochain moment sera la fin de l\'année.</div><div class="panel soft" style="padding:10px 14px;font-size:14px">💡 Une tuile d\'un type que vous avez déjà coûte <b>' + V.meta.tilePrice.owned + ' EB</b> au lieu de <b>' + V.meta.tilePrice.new + ' EB</b> pour un nouveau type : <b>agrandir</b> coûte moins cher que se diversifier.</div>' + tiles.map(shopRow).join('') + '<div class="eyebrow" style="margin-top:6px">Activités complémentaires</div>' + activityExplain(false) + acts.map(shopRow).join('') : '';
    return undo + '<div class="row" style="justify-content:space-between"><h2 style="font-size:40px">Boutique</h2><span class="pill num">💰 ' + me.bank + ' EB</span></div>' +
      cartPanel() + ownedRecap() +
      (vacOpen ? '<h3 style="font-size:30px;margin-top:6px">🏖️ Vacances</h3>' + svcNote + svc.map(shopRow).join('') : '') +
      '<h3 style="font-size:30px;margin-top:6px">🧰 Matériel</h3>' + eqNote + eq.map(shopRow).join('') + expand;
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

  var lastPos = null;
  function buzzOnChange(v) {
    var pos = v.phase + '|' + v.year + '|' + v.season + '|' + v.step;
    if (lastPos !== null && pos !== lastPos) { try { if (navigator.vibrate) navigator.vibrate([180, 90, 180]); } catch (e) { /* ignore */ } }
    lastPos = pos;
  }

  // Événements à animer : la roue du marché tourne, la fête réussit ou échoue.
  function watchEvents() {
    if (me.wheel && me.wheel.n) {
      if (lastWheelN !== null && me.wheel.n !== lastWheelN && V.meta.wheel) FF.showWheel(V.meta.wheel, me.wheel, { title: 'La roue tourne…' });
      lastWheelN = me.wheel.n;
    } else if (lastWheelN === null) lastWheelN = 0;
    var nf = V.fetes ? V.fetes.length : 0;
    if (lastFetes !== null && nf > lastFetes) feteAnimation(V.fetes[nf - 1].success);
    lastFetes = nf;
  }
  function feteAnimation(ok) {
    var old = document.getElementById('feteOv'); if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'feteOv'; el.className = 'fete-ov ' + (ok ? 'win' : 'lose'); el.setAttribute('role', 'dialog');
    var pieces = '', set = ok ? ['🎉', '🎊', '✨', '🔥', '🥳'] : ['💧', '🌧️', '💧', '🥀'];
    for (var i = 0; i < 28; i++) pieces += '<span class="fp" style="left:' + Math.round(Math.random() * 96) + '%;animation-delay:' + (Math.random() * 1.6).toFixed(2) + 's;animation-duration:' + (2.4 + Math.random() * 2).toFixed(2) + 's;font-size:' + (22 + Math.round(Math.random() * 22)) + 'px">' + set[i % set.length] + '</span>';
    el.innerHTML = pieces + '<div class="fete-box"><div class="fete-big">' + (ok ? '🔥' : '🥀') + '</div><h2>' + (ok ? 'Fête du Phoenix réussie !' : 'Fête du Phoenix ratée…') + '</h2><p>' + (ok ? 'Le Phoenix renaît de ses cendres : −2 stress pour toutes les fermes.' : '+' + V.meta.fete.fail + ' stress pour tout le village, et davantage pour les fermes dont un plat manquait.') + '</p><button class="btn primary block" data-fete-close="1">Continuer</button></div>';
    el.addEventListener('click', function (e) { if (e.target.closest('[data-fete-close]') || e.target === el) el.remove(); });
    document.body.appendChild(el);
    try { if (navigator.vibrate) navigator.vibrate(ok ? [150, 80, 150, 80, 300] : [500]); } catch (e) { /* ignore */ }
    setTimeout(function () { if (el.parentNode) el.remove(); }, 9000);
  }

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
    var showClock = (inSeason && V.step !== 1) || V.phase === 'setup' || V.phase === 'rearrange';
    return '<header class="t-top"><div class="row" style="justify-content:space-between;flex-wrap:nowrap;align-items:flex-start;gap:10px"><div style="min-width:0"><h1 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(me.name) + '</h1>' + badge + '</div>' +
      (showClock ? '<div class="t-chrono" data-chrono><div class="l">Chrono</div><div class="v" data-clock>0:00</div></div>' : '') + '</div>' + steps +
      '<div class="row" style="justify-content:space-between;flex-wrap:nowrap"><span class="pill num">💰 ' + me.bank + ' EB</span><span class="row" style="gap:8px;flex-wrap:nowrap">' + FF.dots(me.bocal, V.meta.bocalMax).replace('class="dots"', 'class="dots" style="gap:3px"') + '<span class="pill lv-' + me.level + '">' + FF.ICON.level[me.level] + '</span></span></div>' + colBanner() + '</header>';
  }

  function render() {
    if (!V || !me) return;
    if (tab === 'boutique') { cart = cart.filter(function (id) { return shopById(id); }); }
    var body = tab === 'accueil' ? accueil() : tab === 'ferme' ? ferme() : tab === 'boutique' ? boutique() : banque();
    var navBtn = function (id, ic, label, n) { return '<button data-tab="' + id + '" class="' + (tab === id ? 'on' : '') + '"><span class="ic" aria-hidden="true">' + ic + (n ? '<i class="nav-badge">' + n + '</i>' : '') + '</span>' + label + '</button>'; };
    root.innerHTML = '<div class="t-wrap">' + topBar() + body + '</div><nav class="t-nav" aria-label="Navigation de l\'équipe">' + navBtn('accueil', '🏠', 'Accueil') + navBtn('ferme', '🏡', 'Ferme') + navBtn('boutique', '🛍️', 'Boutique', cart.length) + navBtn('banque', '🏦', 'Banque') + '</nav>' + colModal() + feeModal();
  }

  function tick() { if (!V) return; root.querySelectorAll('[data-pclock]').forEach(function (el) { FF.paintProd(el, V, true); }); var u = root.querySelector('[data-undo]'); if (u && Date.now() > parseInt(u.getAttribute('data-undo'), 10)) u.remove(); var el = root.querySelector('[data-clock]'); if (el) { var ms = FF.remaining(V); el.textContent = FF.fmt(ms); var box = root.querySelector('[data-chrono]'); if (box) box.classList.toggle('low', V.timer.running && ms <= 10000); } }
  setInterval(tick, 250);
  root.addEventListener('change', function (e) { if (e.target.id === 'trTo') { var rs = document.getElementById('trReason'); if (rs) rs.innerHTML = ''; FF.keepInputs(root, render); } });
  root.addEventListener('input', function (e) { if (e.target.id && e.target.id.indexOf('tr-') === 0 && e.target.id !== 'trTo') FF.keepInputs(root, render); });

  root.addEventListener('click', function (e) {
    var bg = e.target.closest('[data-colbg]');
    if (bg && e.target === bg) { colOpen = false; return render(); }
    var t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; location.hash = tab; window.scrollTo(0, 0); return render(); }
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var a = b.dataset.act;
    if (a === 'openCol') { colOpen = true; return render(); }
    if (a === 'closeCol') { colOpen = false; return render(); }
    if (a === 'cartAdd') { var it = shopById(b.dataset.item); if (it && canAdd(it)) { cart.push(it.id); saveCart(); FF.toast(it.name + ' ajouté au panier (' + cart.length + ').'); render(); } return; }
    if (a === 'cartRemove') { cart.splice(parseInt(b.dataset.index, 10), 1); saveCart(); return render(); }
    if (a === 'cartClear') { cart = []; saveCart(); return render(); }
    if (a === 'cartBuy') {
      var items = cart.slice(), total = cartQuote().total;
      return conn.act('buyCart', { items: items }).then(function (r) { if (r && r.ok) { cart = []; saveCart(); FF.toast('Panier validé : ' + items.length + ' article' + (items.length > 1 ? 's' : '') + ', ' + total + ' EB.'); render(); } });
    }
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
      var sales = {}, stallN = 0;
      ['sup', 'dir'].forEach(function (w) { V.meta.sell.forEach(function (x) { var n = parseInt(val('sale-' + w + '_' + x.id), 10); sales[w + '_' + x.id] = n > 0 ? n : 0; if (w === 'dir' && n > 0) stallN += n; }); });
      // des produits à l'étal : rappel des frais d'emplacement, à payer avant que le placement soit validé
      if (stallN > 0 && !me.sales.feePaid) { feeAsk = { sales: sales, n: stallN }; return render(); }
      return conn.act('declareSales', { sales: sales, payFee: true }).then(function (r) { if (r && r.ok) FF.toast('Déclaration envoyée.'); });
    }
    if (a === 'feeCancel') { feeAsk = null; return render(); }
    if (a === 'feePay') {
      var ask = feeAsk; feeAsk = null;
      return conn.act('declareSales', { sales: ask.sales, payFee: true }).then(function (r) { if (r && r.ok) FF.toast('Frais payés (' + V.meta.market.stallFee + ' EB) : placement validé.'); render(); });
    }
    if (a === 'claimDish') return conn.act('claimDish', { key: b.dataset.key });
    if (a === 'releaseDish') return conn.act('releaseDish', { key: b.dataset.key });
    if (a === 'deliver') return conn.act('deliverDish', { key: b.dataset.key, delivered: true });
    if (a === 'undeliver') return conn.act('deliverDish', { key: b.dataset.key, delivered: false });
    if (a === 'undoBuy') return conn.act('undoBuy').then(function (r) { if (r && r.ok) FF.toast('Achat annulé.'); });
    if (a === 'choice') { colOpen = false; return conn.act('setChoice', { choice: b.dataset.choice }); }
    if (a === 'rollActivity') return conn.act('rollActivity', { activity: b.dataset.activity });
    if (a === 'contribute') { var gn = parseInt(val('giveN'), 10); if (!(gn > 0)) return FF.toast('Indique une quantité.'); return conn.act('contribute', { n: gn }).then(function (r) { if (r && r.ok) FF.toast('Merci pour le village !'); }); }
    if (a === 'offerTrade') {
      var give = {}, want = {}, gn2 = parseInt(val('trdGiveN'), 10), wn = parseInt(val('trdWantN'), 10), tp = parseInt(val('trdPrice'), 10);
      if (val('trdGive') && gn2 > 0) give[val('trdGive')] = gn2;
      if (val('trdWant') && wn > 0) want[val('trdWant')] = wn;
      if (!Object.keys(give).length && !Object.keys(want).length) return FF.toast('Choisis un produit à donner ou à demander, avec une quantité.');
      return conn.act('offerTrade', { to: val('trdTo'), items: give, want: want, price: tp > 0 ? tp : 0, payer: val('trdPayer') }).then(function (r) { if (r && r.ok) { FF.toast('Offre envoyée.'); ['trdGiveN', 'trdWantN', 'trdPrice'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; }); } });
    }
    if (a === 'respondTrade') return conn.act('respondTrade', { tradeId: b.dataset.trade, accept: !!b.dataset.accept });
    if (a === 'cancelTrade') return conn.act('cancelTrade', { tradeId: b.dataset.trade });
    if (a === 'collier') return conn.act('collier');
    if (a === 'help') return FF.showHelp(parseInt(b.dataset.step, 10));
    if (a === 'hvStep') { // compteur : on compte les jetons au fil de la course, puis on encode
      var hv = document.getElementById('hv-' + b.dataset.product);
      if (hv) hv.value = Math.max(0, (parseInt(hv.value, 10) || 0) + parseInt(b.dataset.delta, 10));
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) { /* pas de vibration */ } }
      return;
    }
    if (a === 'declareHarvest') {
      var hv2 = {};
      me.harvest.forEach(function (h) { var n = parseInt(val('hv-' + h.id), 10); hv2[h.id] = n > 0 ? n : 0; });
      return conn.act('declareHarvest', { tokens: hv2 }).then(function (r) { if (r && r.ok) FF.toast('Récolte encodée.'); });
    }
    if (a === 'rename') return conn.act('renameTeam', { name: val('newFarmName') }).then(function (r) { if (r && r.ok) FF.toast('Ferme renommée.'); });
    if (a === 'ready') return conn.act('setReady', { ready: !me.ready });
  });
  }
})();
