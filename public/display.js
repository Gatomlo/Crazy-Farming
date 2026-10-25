(function () {
  var esc = FF.esc;
  var code = (FF.qs.get('s') || '').toUpperCase();
  var stage = document.getElementById('stage');
  var V = null;

  // La scene fait 1920x1080 et s'adapte a tout ecran (projecteur, TV, portable).
  function fit() {
    var k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = 'scale(' + k + ')';
    stage.style.left = Math.max(0, (window.innerWidth - 1920 * k) / 2) + 'px';
    stage.style.top = Math.max(0, (window.innerHeight - 1080 * k) / 2) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  if (!code) { stage.innerHTML = '<div class="d-big">Code de session manquant</div><a href="./" style="font-size:40px">Accueil</a>'; return; }

  FF.connect({
    role: 'display', code: code,
    onState: function (v) { V = v; render(); tick(); syncFx(); watchFete(); scheduleWheel(); },
    onFatal: function (m) { stage.innerHTML = '<div class="d-big">' + esc(m) + '</div><a href="./" style="font-size:40px">Accueil</a>'; }
  });

  // Effets de carte : tirage anime quand la carte apparait (ou change, nouveau tirage) en cours de partie ; ambiance (meteo, feu, fete...) pendant l'alea et la recolte.
  var fxKey;
  function syncFx() {
    if (!window.FFX) return;
    var c = V && V.phase === 'season' && V.step <= 1 && V.card ? V.card : null;
    var key = c ? V.year + '-' + V.season + '-' + c.id : null;
    if (key === fxKey) return;
    var firstState = fxKey === undefined;
    fxKey = key;
    if (!c) { FFX.set(null); return; }
    if (firstState || V.step !== 0) { FFX.set(c.fx || null); return; }
    stage.style.visibility = 'hidden';
    FFX.reveal(c, { seasonOf: V.seasonOf, onFlip: function () { stage.style.visibility = ''; FFX.set(c.fx || null); }, onDone: function () { stage.style.visibility = ''; } });
  }

  // Animation de la fete : quand le resultat de la fete de l'annee tombe.
  var lastFetes = null;
  function watchFete() {
    var n = V.fetes ? V.fetes.length : 0;
    if (lastFetes !== null && n > lastFetes && window.FFX) {
      var f = V.fetes[n - 1];
      FFX.fete(f.success, { text: f.success ? 'Le Phoenix renaît de ses cendres : −2 stress pour toutes les fermes !' : 'Plats manquants : +' + V.meta.fete.fail + ' stress pour tout le village, et davantage pour les fermes concernées.' });
    }
    lastFetes = n;
  }

  // Touche C : mode fort contraste (fond noir, textes agrandis) pour les salles claires ou les projecteurs faibles.
  try { if (localStorage.getItem('ff_hc') === '1') document.body.classList.add('hc'); } catch (e) { /* stockage indisponible */ }
  window.addEventListener('keydown', function (e) {
    if ((e.key !== 'c' && e.key !== 'C') || e.ctrlKey || e.metaKey || e.altKey) return;
    var on = document.body.classList.toggle('hc');
    try { localStorage.setItem('ff_hc', on ? '1' : '0'); } catch (err) { /* stockage indisponible */ }
    FF.toast(on ? 'Fort contraste activé (touche C pour revenir)' : 'Fort contraste coupé');
  });

  // Touche F : coupe ou remet les effets visuels.
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'f' && e.key !== 'F') return;
    if (e.ctrlKey || e.metaKey || e.altKey || !window.FFX) return;
    var on = FFX.toggle();
    fxKey = undefined; syncFx();
    FF.toast(on ? 'Effets visuels activés' : 'Effets visuels coupés (touche F pour les remettre)');
  });

  // Le résultat de la roue n'apparaît ici qu'une fois l'animation terminée sur le mobile de la ferme.
  var WHEEL_MS = 6200, wheelTimer = null;
  function wheelShown(t) { return !!t.wheel && FF.age(V, t.wheel.at) >= WHEEL_MS; }
  function scheduleWheel() {
    clearTimeout(wheelTimer);
    var wait = Infinity;
    V.teams.forEach(function (t) { if (t.wheel && t.wheel.at && !wheelShown(t)) wait = Math.min(wait, WHEEL_MS - FF.age(V, t.wheel.at)); });
    if (wait < Infinity) wheelTimer = setTimeout(function () { render(); tick(); }, wait + 60);
  }

  var CHOICE = { subit: 'Subit l\'effet', parade: 'Parade jouée', boule: '+1 stress' };

  function head() {
    var inSeason = V.phase === 'season';
    var badge = inSeason
      ? '<span class="d-season" style="background:' + V.seasonColor + '">' + FF.ICON.seasons[V.season] + ' ' + esc(V.seasonName) + '</span>'
      : '<span class="d-season" style="background:linear-gradient(135deg,var(--pb),var(--pc))">🚜 Farming\'s Folies</span>';
    var steps = inSeason ? '<div class="d-steps"><b>' + esc(V.meta.steps[V.step].name.split(' ')[0]) + '</b>' + V.meta.steps.map(function (s, i) {
      return '<i class="' + (i === V.step ? 'on' : i < V.step ? 'done' : '') + '"></i>';
    }).join('') + '</div>' : '';
    var yr = V.phase === 'lobby' ? '' : '<span class="d-year">Année ' + V.year + ' sur ' + V.years + '</span>';
    var f = V.forecast;
    var meteo = f ? '<div class="d-meteo"><span class="ic">' + f.icon + '</span><span><small>Météo · ' + esc(f.seasonName.toLowerCase()) + (f.year !== V.year ? ' · année ' + f.year : '') + '</small>' + esc(f.text) + '</span></div>' : '';
    return '<div class="d-head"><div style="display:flex;align-items:center;gap:28px">' + badge + yr + '</div>' + (meteo || steps) + '</div>';
  }

  function foot() {
    return '<div class="d-foot">' + V.teams.map(function (t) {
      var extra = '';
      if (V.phase === 'season' && V.step === 0 && V.card && V.card.tone === 'neg') extra = '<span class="d-tag">' + esc(CHOICE[t.choice] || 'Choisit…') + '</span>';
      else if (V.phase === 'season' && V.step === 3) extra = '<span class="d-tag">' + (t.paid ? '✓ vendu' : t.wheel ? (wheelShown(t) ? esc(t.wheel.label) : '🎡 La roue tourne…') : 'Roue…') + '</span>';
      else if (t.ready) extra = '<span class="d-tag ok">✓ Prête</span>';
      if (t.stopped) extra = '<span class="d-tag bad">😴 À l\'arrêt</span>';
      var segs = ''; for (var i = 0; i < V.meta.bocalMax; i++) segs += '<i class="' + (i < t.bocal ? 'on ' + t.level : '') + '"></i>';
      return '<div class="d-team"><div class="d-team-top"><span class="nm">' + esc(t.name) + '</span><span class="lv" title="' + t.level + '">' + FF.ICON.level[t.level] + '</span></div>' +
        '<div class="meter" role="img" aria-label="' + t.bocal + ' points de stress sur ' + V.meta.bocalMax + '">' + segs + '</div>' + (extra ? '<div>' + extra + '</div>' : '') + '</div>';
    }).join('') + '</div>' + (V.villageGoal ? '<div class="d-village"><span>Caisse du village</span><b>' + V.villageBank + ' EB</b><i><u style="width:' + Math.min(100, Math.round(V.villageBank / V.villageGoal * 100)) + '%"></u></i><span>objectif ' + V.villageGoal + ' EB</span></div>' : '');
  }

  function clockBlock(title, sub) {
    return '<section style="flex:1.5;display:flex;flex-direction:column;justify-content:center;gap:14px"><div class="d-big">' + esc(title) + '</div>' +
      (sub ? '<div style="font-size:32px;color:var(--muted)">' + esc(sub) + '</div>' : '') +
      '<div class="d-clock" data-clock>0:00</div><div class="bar" style="height:24px"><i data-bar style="width:100%;background:' + (V.phase === 'season' ? V.seasonColor : 'var(--amber)') + '"></i></div></section>';
  }

  // Recolte : pas de chrono general, un decompte par produit (seulement ceux que au moins une ferme produit).
  // La saison et la carte aleas modifient la duree ; les fermes protegees gardent la duree de base.
  function quotas() {
    var c = V.card;
    var owned = V.meta.products.filter(function (p) { return V.ownedProducts.indexOf(p.id) >= 0; });
    var txt = function (n) { return n ? FF.fmt(n * 1000) : '—'; };
    var rows = owned.map(function (p) {
      var base = V.runBase[p.id], eff = V.runEff[p.id], ch = eff !== base, per = V.perTripEff[p.id];
      var was = ch ? '<s style="font-size:30px;opacity:.5;margin-right:12px">' + txt(base) + '</s>' : '';
      var tag = per > 1 ? '<span style="font-size:28px;color:var(--mint);font-weight:700">' + per + ' jetons par trajet</span>' : '';
      var none = !eff ? '<span style="font-size:28px;color:var(--flame);font-weight:700">' + (base ? 'Non récoltable' : 'Rien à récolter') + '</span>' : '';
      return '<div class="d-q" data-prow style="padding:8px 28px;gap:24px"><i style="background:' + p.color + ';width:30px;height:30px"></i><span style="font-size:46px;font-weight:800;flex:1">' + esc(p.name) + '</span>' + was + tag + none + '<span class="pclock pc-idle" data-pclock data-pid="' + p.id + '" data-run="' + eff + '">' + txt(eff) + '</span></div>';
    }).join('');
    var safe = V.teams.filter(function (t) { return t.exempt; }).map(function (t) { return t.name; });
    var banner = c ? '<div class="d-q sm" style="background:' + (c.collective ? 'var(--amber)' : c.tone === 'neg' ? 'var(--flame)' : 'var(--mint)') + ';color:var(--ink);font-size:30px;padding:8px 24px;flex-direction:column;align-items:flex-start;gap:2px"><b>Aléa : ' + esc(c.title) + '</b><span style="font-weight:600;font-size:26px">' + esc(cardText(c)) + '</span></div>' : '';
    var stop = V.stopEarlySec ? '<div style="font-size:28px;color:var(--flame);font-weight:700">Fermes touchées : stop ' + FF.fmt(V.stopEarlySec * 1000) + ' avant la fin de leur course</div>' : '';
    var runners = V.teams.filter(function (t) { return t.bonusSec > 0; }).map(function (t) { return esc(t.name) + ' +' + t.bonusSec + ' s'; });
    var bonus = runners.length ? '<div style="font-size:28px;color:var(--mint);font-weight:700">⏱️ Temps bonus : ' + runners.join(' · ') + '</div>' : '';
    var prot = safe.length && c && c.tone === 'neg' ? '<div style="font-size:26px;color:var(--mint);font-weight:700">Protégées (course normale) : ' + esc(safe.join(', ')) + '</div>' : '';
    // Chronos différenciés (fermes protégées, tracteur, coup de collier) : un décompte par ferme pour savoir qui a encore le droit de courir
    var board = FF.runsDiffer(V) ? '<div style="font-size:30px;font-weight:800;margin-top:6px">⏱️ Qui peut encore courir ? <span style="font-weight:600;color:var(--muted);font-size:26px">Les temps diffèrent selon les fermes : suivez le vôtre.</span></div>' + FF.runBoard(V) : '';
    return '<section style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:10px"><div class="d-big" style="font-size:56px">Récolte en relais</div><div style="font-size:28px;color:var(--muted)">Un coureur par tuile · un jeton par trajet · chaque produit s\'arrête à son STOP</div>' + (board ? '' : rows) +
      board + banner + stop + (board ? '' : bonus + prot) + '</section>';
  }

  // Commande de la Fete du Phoenix : connue des le debut de l'annee pour pouvoir produire en consequence.
  function feteBanner() {
    var f = V.fete, M = V.menu;
    if (!f || !M) return '';
    var free = M.items.filter(function (i) { return !i.team; }).length;
    return '<section style="flex:1 1 0"><div class="d-q sm" style="background:var(--amber);color:var(--ink);font-size:34px;padding:8px 24px;gap:16px"><b>Fête du Phoenix · année ' + V.year + '</b><span style="font-weight:600;font-size:30px">' + M.items.length + ' plats, ' + M.perFarm + ' par ferme · ' + (free ? free + ' à répartir entre vous' : 'tout est réparti') + '</span></div></section>';
  }

  var TIER = { 1: 'simple', 2: 'mixte', 3: 'composé' };
  // Menu de la fete : qui s'occupe de quoi (plats pris / a prendre / livres).
  function menuBoard() {
    var M = V.menu;
    if (!M) return '';
    var n = M.items.length, cols = n > 12 ? 3 : n > 4 ? 2 : 1, big = cols > 1;
    var rows = M.items.map(function (i) {
      var who = i.team ? '<span class="pill" style="font-size:' + (big ? 21 : 26) + 'px;background:var(--panel);border:2px solid var(--mint);color:var(--text)">' + esc(i.teamName) + '</span>' : '<span class="pill" style="font-size:' + (big ? 21 : 26) + 'px;background:var(--amber);color:var(--ink)">À prendre</span>';
      var done = V.phase === 'closing' && V.closedYear ? (i.delivered ? '<b style="color:var(--mint)">✓</b>' : '<b style="color:var(--flame)">✗</b>') : '';
      return '<div class="d-q sm" style="padding:' + (big ? 8 : 10) + 'px 20px;gap:12px;font-size:' + (big ? 24 : 32) + 'px"><span style="flex:1;min-width:0"><b>' + esc(i.name) + '</b><span style="display:block;font-size:' + (big ? 19 : 22) + 'px;font-weight:500;color:var(--muted)">' + esc(i.needs) + '</span></span>' + done + who + '</div>';
    }).join('');
    return '<section style="flex:1.6;min-width:0;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:16px"><div style="font-size:30px;font-weight:700;color:var(--muted)">Menu de la Fête du Phoenix · année ' + V.year + ' <span style="font-weight:500;color:var(--muted);font-size:26px">· chaque ferme prend ' + M.perFarm + ' plat' + (M.perFarm > 1 ? 's' : '') + '</span></div>' +
      '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:14px">' + rows + '</div></section>';
  }

  // Defi de saison (facultatif) et resultat de la saison precedente.
  function challengeLine() {
    var out = '';
    if (V.challenge) out += '<div style="font-size:40px;font-weight:700;color:var(--amber)">🎯 ' + esc(V.challenge.title) + ' <span style="font-size:30px;font-weight:600;color:var(--muted)">· ' + esc(V.challenge.text) + '</span></div>';
    var l = V.lastChallenge;
    if (l && V.step === 0 && !(l.year === V.year && l.season === V.season)) out += '<div style="font-size:30px;color:var(--muted)">Défi de la saison dernière : ' + (l.winners.length ? '<b style="color:var(--mint)">' + esc(l.winners.join(', ')) + '</b> ' + (l.winners.length > 1 ? 'ont réussi' : 'a réussi') + ' (−1 stress)' : 'aucune ferme n\'a réussi') + '</div>';
    return out;
  }

  // Bilan de la saison pendant l'etape Achats : les chiffres du village et leur evolution depuis la saison precedente.
  function recapPanel() {
    var r = V.recap, p = V.prevRecap;
    var delta = function (v, prev) {
      if (!p || !prev) return '';
      var d = Math.round((v - prev) / prev * 100);
      return '<span style="font-size:30px;font-weight:700;color:' + (d >= 0 ? 'var(--mint)' : 'var(--flame)') + '">' + (d >= 0 ? '▲ +' : '▼ ') + d + ' %</span>';
    };
    var tile = function (icon, label, val, d) {
      return '<div class="d-q" style="flex-direction:column;align-items:flex-start;gap:4px;padding:14px 26px;background:var(--surface);border-radius:24px;flex:1 1 40%"><span style="font-size:28px;color:var(--muted)">' + icon + ' ' + esc(label) + '</span><span style="font-size:76px;font-weight:800;line-height:1">' + val + '</span>' + d + '</div>';
    };
    var stress = V.teams.length ? Math.round(V.teams.reduce(function (n, t) { return n + t.bocal; }, 0) / V.teams.length * 10) / 10 : 0;
    var comment = !p ? 'Première saison : voilà le point de départ du village.' : r.tokens >= p.tokens ? 'La récolte du village est en hausse : bravo aux coureurs !' : 'La récolte baisse par rapport à la saison dernière : que s\'est-il passé ?';
    return '<section style="flex:1.4;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:14px"><div style="font-size:32px;font-weight:800;color:var(--muted)">Bilan de la saison · ' + esc(V.seasonName.toLowerCase()) + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:14px">' + tile('🧺', 'Jetons récoltés', r.tokens, delta(r.tokens, p && p.tokens)) + tile('🍽️', 'Plats fabriqués', r.dishes, delta(r.dishes, p && p.dishes)) +
      tile('💰', 'EB aux ventes', r.income, delta(r.income, p && p.income)) + tile('🫙', 'Stress moyen', stress, '') + '</div>' +
      '<div style="font-size:30px;color:var(--muted)">' + esc(comment) + '</div></section>';
  }

  // Rappel de la carte aleas pendant les etapes qu'elle concerne (bourse, marche).
  function cardText(c) { return c.collective ? (c.resolved === false ? c.loseText : c.resolved === true ? c.winText : 'Objectif : ' + c.goalText) : c.effect; }
  function cardBanner(id) {
    var c = V.card;
    if (!c || !c.when || c.when.indexOf(id) < 0) return '';
    return '<section style="flex:1 1 0"><div class="d-q sm" style="background:' + (c.collective ? 'var(--amber)' : c.tone === 'neg' ? 'var(--flame)' : 'var(--mint)') + ';color:var(--ink);font-size:36px;flex-direction:column;align-items:flex-start;gap:4px"><b>Aléa : ' + esc(c.title) + '</b><span style="font-weight:600;font-size:32px">' + esc(cardText(c)) + '</span></div></section>';
  }

  function list(items) {
    return '<section style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px">' + items.map(function (t) {
      return '<div class="d-q" style="font-size:34px"><span>' + esc(t) + '</span></div>';
    }).join('') + '</section>';
  }

  // Alea collectif : objectif commun, jauge et dons de chaque ferme.
  function collectiveScreen(c) {
    var tot = Object.keys(c.pot || {}).reduce(function (n, k) { return n + c.pot[k]; }, 0), pct = Math.min(100, Math.round(tot / c.need * 100));
    var done = c.resolved !== null && c.resolved !== undefined;
    var due = (V.meta.steps.filter(function (x) { return x.id === c.due; })[0] || {}).name || '';
    var who = V.teams.map(function (t) { var n = (c.pot || {})[t.id] || 0; return '<span class="d-tag' + (n ? ' ok' : '') + '">' + esc(t.name) + ' · ' + n + '</span>'; }).join('');
    var res = done ? '<div style="font-size:50px;font-weight:800;color:' + (c.resolved ? 'var(--mint)' : 'var(--flame)') + '">' + (c.resolved ? '✓ Objectif atteint · ' + esc(c.winText) : '✗ Objectif manqué · ' + esc(c.loseText)) + '</div>' :
      '<div style="font-size:34px;color:var(--muted)">Si le village y arrive : ' + esc(c.winText) + '<br>Sinon : ' + esc(c.loseText) + '</div>';
    return '<section class="d-card pop">' + (c.icon ? '<div class="d-icon" aria-hidden="true">' + c.icon + '</div>' : '') + '<span class="pill" style="font-size:36px;align-self:flex-start;padding:8px 32px;background:var(--amber);color:var(--ink)">🤝 Aléa collectif · tout le village</span>' +
      '<div style="font-size:110px;line-height:1;font-weight:800">' + esc(c.title) + '</div><div style="font-size:44px;font-weight:600;line-height:1.15">' + esc(c.story) + '</div>' +
      '<div style="font-size:52px;font-weight:800">Objectif : ' + esc(c.goalText) + ' <span style="font-size:32px;font-weight:600;color:var(--muted)">avant la fin de « ' + esc(due) + ' »</span></div>' +
      '<div class="bar" style="height:28px;flex:none"><i style="width:' + pct + '%;background:var(--pc)"></i></div><div style="font-size:48px;font-weight:800">' + tot + ' / ' + c.need + '</div><div style="display:flex;gap:16px;flex-wrap:wrap">' + who + '</div>' + res + '</section>';
  }

  // Jauge de l'alea collectif : reste visible a toutes les etapes de la saison (sauf sur l'ecran de l'alea, qui l'affiche deja en grand).
  function collectiveStrip() {
    var c = V.card;
    if (V.phase !== 'season' || !c || !c.collective || V.meta.steps[V.step].id === 'alea') return '';
    var tot = Object.keys(c.pot || {}).reduce(function (n, k) { return n + c.pot[k]; }, 0), pct = Math.min(100, Math.round(tot / c.need * 100));
    var done = c.resolved !== null && c.resolved !== undefined;
    var due = (V.meta.steps.filter(function (x) { return x.id === c.due; })[0] || {}).name || '';
    var state = done ? '<span style="color:' + (c.resolved ? 'var(--mint)' : 'var(--flame)') + ';font-weight:800">' + (c.resolved ? '✓ Objectif atteint' : '✗ Objectif manqué') + '</span>' : '<span class="muted">avant la fin de « ' + esc(due) + ' »</span>';
    return '<div class="d-collect"><span class="t">🤝 ' + esc(c.title) + '</span><span class="g">' + esc(c.goalText) + '</span><i><u style="width:' + pct + '%;background:' + (done && !c.resolved ? 'var(--flame)' : done ? 'var(--mint)' : 'var(--pc)') + '"></u></i><b>' + tot + ' / ' + c.need + '</b>' + state + '</div>';
  }

  function main() {
    if (V.phase === 'setup') return clockBlock('Installation des fermes', 'Année 1 · répartissez la commande de la fête, puis achetez vos tuiles') + menuBoard();
    if (V.phase === 'rearrange') return clockBlock('Réaménagement', 'Année ' + V.year + ' · répartissez le menu de la fête') + menuBoard();
    if (V.phase === 'closing') {
      var f = V.fete;
      return '<section class="d-card"><div class="d-big">Clôture de l\'année ' + V.year + '</div>' +
        '<div style="font-size:46px;font-weight:700">' + (V.closedYear ? 'Charges payées.' : 'Bilan comptable : payez vos charges.') + '</div>' +
        '<div style="font-size:38px;color:var(--muted)">Fête du Phoenix : ' + f.perFarm + ' produits transformés par ferme' + (f.mixed ? ', dont ' + f.mixed + ' recette' + (f.mixed > 1 ? 's' : '') + ' mixte' + (f.mixed > 1 ? 's' : '') : '') + '</div>' +
        (V.feteDone ? '<div style="font-size:46px;font-weight:800;color:var(--mint)">' + (V.fetes[V.fetes.length - 1].success ? 'Fête réussie : −2 stress pour tous !' : 'Fête ratée : +' + V.meta.fete.fail + ' stress pour tous, et jusqu\'à +' + V.meta.fete.cap + ' pour les fermes dont un plat manque.') + '</div>' : '') + '</section>' + menuBoard();
    }
    if (V.phase === 'end') {
      var s = V.stars;
      var star = function (ok, label) { return '<div class="d-q" style="font-size:44px;opacity:' + (ok ? 1 : .55) + '"><span style="font-size:64px;color:var(--amber)">' + (ok ? '★' : '☆') + '</span><span>' + esc(label) + '</span></div>'; };
      return '<section style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px"><div class="d-big">Le village a gagné ' + s.count + ' étoile' + (s.count > 1 ? 's' : '') + '</div>' +
        star(s.s1, 'Aucune ferme au-dessus de ' + s.peakMax + ' points de stress') + star(s.s2, s.years === 2 ? 'Les deux fêtes du Phoenix réussies' : 'Les trois fêtes du Phoenix réussies') + star(s.s3, 'Caisse du village : ' + s.totalBank + ' EB') +
        '<div style="font-size:44px">Ferme la plus riche : <b>' + esc(s.richest.join(', ')) + '</b> · Trophée du Sage : <b>' + esc(s.sage.join(', ')) + '</b></div></section>';
    }
    // saison
    var id = V.meta.steps[V.step].id;
    if (id === 'alea') {
      var c = V.card;
      var acts = V.teams.filter(function (t) { return t.acts && t.acts.length; });
      var die = acts.length ? '<div style="font-size:34px;color:var(--muted)">🎲 Dés des activités : ' + acts.map(function (t) { return '<b style="color:var(--text)">' + esc(t.name) + '</b> ' + t.acts.map(function (a) { return a.icon + (a.roll ? '<b style="color:' + (a.roll === 1 ? 'var(--flame)' : 'var(--mint)') + '">' + a.roll + '</b>' : '…'); }).join(' '); }).join(' · ') + '</div>' : '';
      if (!c) return '<section class="d-card"><div class="d-big">Aléa ' + esc(V.seasonOf) + '</div><div style="font-size:48px;color:var(--muted)">Le maire du village tire une carte…</div>' + die + '</section>';
      if (c.collective) return collectiveScreen(c) ;
      var parName = c.parade ? (V.meta.catalogue.filter(function (x) { return x.id === c.parade; })[0] || {}).name : '';
      return '<section class="d-card pop">' + (c.icon ? '<div class="d-icon" aria-hidden="true">' + c.icon + '</div>' : '') + '<span class="pill ' + (c.tone === 'neg' ? 'lv-Stressé' : 'lv-Zen') + '" style="font-size:36px;align-self:flex-start;padding:8px 32px">Carte aléa · ' + (c.tone === 'neg' ? 'Négatif' : 'Positif') + '</span>' +
        '<div style="font-size:120px;line-height:1;font-weight:800">' + esc(c.title) + '</div><div style="font-size:56px;font-weight:700;line-height:1.1">' + esc(c.effect) + '</div>' +
        (c.tone === 'neg' ? '<div class="d-parade">' + (c.parade ? '🛡️ Parade : <b>' + esc(parName) + '</b>' : 'Pas de parade') + '</div>' : '') + challengeLine() + die + '</section>';
    }
    if (id === 'recolte') return quotas();
    if (id === 'bourse') return clockBlock('Bourse du village', 'Encodez votre récolte · fabriquez vos plats · échangez · ce qui n\'est pas transformé sera perdu') + menuBoard();
    if (id === 'marche') {
      var spun = V.teams.map(function (t) { return '<div class="d-mk"><div class="d-mk-top"><b>' + esc(t.name) + '</b>' + (t.paid ? '<span class="d-tag ok">✓ vendu</span>' : '') + '<span class="d-tag">' + (t.wheel ? (wheelShown(t) ? esc(t.wheel.label) : '🎡 La roue tourne…') : 'Roue…') + '</span></div>' + (t.marketNote && wheelShown(t) ? '<div class="d-note pop">📣 ' + esc(t.marketNote) + '</div>' : '') + '</div>'; }).join('');
      return clockBlock('Jour de marché', 'Supermarché : prix garanti · Étal : plus cher, la roue décide · Matières ni vendues ni transformées : perdues') + '<section style="flex:1.3;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:14px">' + spun + '</section>';
    }
    return clockBlock('Achats et vacances', 'Matériel de la ferme · Vacances 30 EB, −1 stress') + (V.recap ? recapPanel() : list(['Annoncez chaque achat à voix haute', 'Un voyageur ne court pas la saison suivante']));
  }

  // Presentation du jeu : diapositives pilotees depuis la console du maire du village.
  function tutoSlide() {
    var T = V.tuto;
    return '<section class="tuto pop" style="flex:1"><div class="t-ic" aria-hidden="true">' + T.icon + '</div><h2>' + esc(T.title) + '</h2><ul>' + T.points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' +
      '<div class="t-dots">' + T.titles.map(function (_, i) { return '<i class="' + (i === T.index ? 'on' : '') + '"></i>'; }).join('') + '</div></section>';
  }

  // Objectifs de la partie, réaffichés à la demande du maire du village.
  function goalsScreen() {
    var g = V.goals;
    if (!g) return '';
    var stars = g.stars.map(function (s) {
      var col = s.lost ? 'var(--flame)' : s.ok ? 'var(--mint)' : 'var(--amber)';
      return '<div class="d-q" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px 28px;border-left:12px solid ' + col + ';background:var(--surface);border-radius:20px"><span style="font-size:44px;font-weight:800">' + esc(s.title) + '</span><span style="font-size:34px;font-weight:600">' + esc(s.text) + '</span><span style="font-size:28px;color:' + col + '">' + esc(s.detail) + '</span></div>';
    }).join('');
    var years = g.perYear.map(function (y) {
      var f = y.fete === 'success' ? '<b style="color:var(--mint)">✓ fête réussie</b>' : y.fete === 'fail' ? '<b style="color:var(--flame)">✗ fête ratée</b>' : y.fete === 'todo' ? '<span style="color:var(--muted)">fête à venir</span>' : '';
      return '<div style="flex:1;background:' + (y.current ? 'var(--surface-2)' : 'transparent') + ';border:2px solid ' + (y.current ? 'var(--amber)' : 'var(--line)') + ';border-radius:20px;padding:14px 20px;font-size:28px;display:flex;flex-direction:column;gap:4px"><b style="font-size:38px">Année ' + y.year + '</b>' + f + '<span>🎉 ' + esc(y.dishes || '') + '</span><span>💰 repère de caisse : ' + y.bankMilestone + ' EB</span></div>';
    }).join('');
    return '<div style="position:absolute;inset:0;z-index:10;background:rgba(20,14,10,.97);padding:56px 96px;display:flex;flex-direction:column;gap:22px"><div style="font-size:72px;font-weight:800">🎯 Les objectifs du village</div>' + stars + '<div style="display:flex;gap:20px">' + years + '</div></div>';
  }

  function joinUrl() { return location.origin + FF.BASE + '/team?s=' + V.code; }
  function drawQr() {
    var el = document.getElementById('joinQr');
    if (!el || typeof QRCode === 'undefined') return;
    try { new QRCode(el, { text: joinUrl(), width: 360, height: 360, correctLevel: QRCode.CorrectLevel.M }); } catch (e) { el.textContent = ''; }
  }

  function render() {
    if (!V) return;
    if (V.phase === 'lobby') {
      stage.innerHTML = '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:32px;text-align:center">' +
        '<div style="font-size:120px;font-weight:800;line-height:1">Farming\'s Folies</div><div style="font-size:56px;color:var(--muted)">Bienvenue au village du Phoenix</div>' +
        '<div style="font-size:44px;color:var(--muted)">Scannez pour rejoindre la partie</div><div id="joinQr" style="background:#fff;padding:20px;border-radius:24px;line-height:0"></div><div style="font-size:30px;color:var(--muted);word-break:break-all">' + esc(joinUrl()) + '</div>' +
        '<div style="display:flex;gap:20px;flex-wrap:wrap;justify-content:center">' + V.teams.map(function (t) { return '<span class="d-q" style="font-size:38px;padding:12px 32px;background:var(--surface);' + (t.taken ? '' : 'opacity:.55') + '">' + (t.taken ? '✓ ' : '') + esc(t.name) + '</span>'; }).join('') + '</div></div>';
      drawQr();
      if (V.tuto) stage.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;z-index:5;background:var(--bg);padding:56px 96px;display:flex">' + tutoSlide() + '</div>');
      if (V.showGoals) stage.insertAdjacentHTML('beforeend', goalsScreen());
      return;
    }
    var strip = V.phase === 'season' || V.phase === 'setup' ? '<div style="display:flex;gap:20px;align-items:stretch">' + (V.card && V.card.when && V.card.when.indexOf(V.meta.steps[V.step].id) >= 0 && V.meta.steps[V.step].id !== 'recolte' ? cardBanner(V.meta.steps[V.step].id) : '') + '</div>' : '';
    stage.innerHTML = head() + '<div class="d-main">' + main() + '</div>' + strip + collectiveStrip() + (V.phase === 'end' ? '' : foot());
    if (V.tuto) stage.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;z-index:9;background:var(--bg);padding:56px 96px;display:flex">' + tutoSlide() + '</div>');
    if (V.showGoals) stage.insertAdjacentHTML('beforeend', goalsScreen());
    if (V.showQr) {
      stage.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;z-index:10;background:rgba(20,14,10,.94);display:flex;flex-direction:column;justify-content:center;align-items:center;gap:32px;text-align:center">' +
        '<div style="font-size:64px;font-weight:800">Scannez pour rejoindre la partie</div><div id="joinQr" style="background:#fff;padding:20px;border-radius:24px;line-height:0"></div><div style="font-size:30px;color:var(--muted);word-break:break-all">' + esc(joinUrl()) + '</div></div>');
      drawQr();
    }
  }

  // Bip a 10 s, puis chaque seconde de 3 a 0 (le navigateur exige un clic initial sur la page pour le son).
  var audio = null, lastBeep = null;
  function beep(freq, len) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      var o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = freq; g.gain.value = 0.15; o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + len);
    } catch (e) { /* pas de son */ }
  }
  function beepFor(sec) {
    if (sec === null) { lastBeep = null; return; }
    if (sec === lastBeep) return;
    lastBeep = sec;
    if (sec === 10) beep(660, 0.25);
    else if (sec <= 3 && sec >= 1) beep(880, 0.2);
    else if (sec === 0) beep(440, 0.7);
  }
  ['click', 'keydown'].forEach(function (ev) { window.addEventListener(ev, function () { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) { /* ignore */ } }); });

  var stopBeeped = {};
  function tick() {
    if (!V) return;
    var ms = FF.remaining(V);
    stage.querySelectorAll('[data-pclock]').forEach(function (el) {
      FF.paintProd(el, V, false);
      var key = V.year + '.' + V.season + '.' + el.getAttribute('data-pid');
      if (el.hasAttribute('data-nobeep')) return;
      if (/pc-stop/.test(el.className)) { if (!stopBeeped[key]) { stopBeeped[key] = true; beep(520, 0.6); } } else stopBeeped[key] = false;
    });
    var clock = stage.querySelector('[data-clock]');
    if (clock) { clock.textContent = FF.fmt(ms); clock.classList.toggle('low', V.timer.running && ms <= 10000); }
    var alert = !!(clock && V.timer.running && ms <= 10000);
    stage.classList.toggle('alert', alert);
    beepFor(alert ? Math.ceil(ms / 1000) : null);
    var bar = stage.querySelector('[data-bar]');
    if (bar) bar.style.width = (V.timer.durationMs ? Math.round((ms / V.timer.durationMs) * 100) : 0) + '%';
  }
  setInterval(tick, 250);
})();
