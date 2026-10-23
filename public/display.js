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
    onState: function (v) { V = v; render(); tick(); },
    onFatal: function (m) { stage.innerHTML = '<div class="d-big">' + esc(m) + '</div><a href="./" style="font-size:40px">Accueil</a>'; }
  });

  var CHOICE = { subit: 'Subit l\'effet', parade: 'Parade jouée', boule: '+1 boule' };

  // Frise du jeu : une route de 3 annees, 4 saisons chacune, la fete a la fin de chaque annee.
  var SCOL = ['#8FD36B', '#F2B63D', '#F08A4B', '#8EC5F0'];
  function timeline() {
    var cur = V.phase === 'season' ? (V.year - 1) * 4 + V.season : V.phase === 'closing' || V.phase === 'end' ? V.year * 4 - 1 : (V.year - 1) * 4 - 0.5;
    var h = '';
    for (var y = 1; y <= 3; y++) {
      var segs = '';
      for (var s = 0; s < 4; s++) {
        var i = (y - 1) * 4 + s;
        var st = V.phase === 'end' || i < cur ? 'done' : i === cur && V.phase === 'season' ? 'now' : '';
        segs += '<div class="tl-s ' + st + '" style="--c:' + SCOL[s] + '"><span class="e">' + FF.ICON.seasons[s] + '</span>' + (st === 'now' ? '<span class="n">' + esc(V.meta.seasons[s].name) + '</span>' : '') + '</div>';
      }
      var fete = V.fetes.filter(function (f) { return f.year === y; })[0];
      var fst = fete ? (fete.success ? 'ok' : 'ko') : V.year === y && V.phase === 'closing' ? 'now' : '';
      h += '<div class="tl-y' + (V.year === y ? ' cur' : '') + '"><div class="tl-lab">Année ' + y + '</div><div class="tl-track">' + segs + '<div class="tl-f ' + fst + '" title="Fête du Phoenix"><span>' + (fst === 'ok' ? '✓' : fst === 'ko' ? '✗' : '🎉') + '</span></div></div></div>';
    }
    return '<div class="tl">' + h + '</div>';
  }

  function head() {
    var inSeason = V.phase === 'season';
    var badge = inSeason
      ? '<span class="d-season" style="background:' + V.seasonColor + '">' + FF.ICON.seasons[V.season] + ' ' + esc(V.seasonName) + '</span>'
      : '<span class="d-season" style="background:linear-gradient(135deg,var(--pb),var(--pc))">🚜 Farming\'s Folies</span>';
    var steps = inSeason ? '<div class="d-steps">' + V.meta.steps.map(function (s, i) {
      return '<span class="' + (i === V.step ? 'on' : i < V.step ? 'done' : '') + '">' + FF.ICON.steps[i] + (i === V.step ? '<b>' + esc(s.name.split(' ')[0]) + '</b>' : '') + '</span>';
    }).join('') + '</div>' : '';
    return '<div class="d-head"><div style="display:flex;align-items:center;gap:24px">' + badge + '</div>' + steps + '</div>' + timeline();
  }

  function foot() {
    return '<div class="d-foot">' + V.teams.map(function (t) {
      var extra = '';
      if (V.phase === 'season' && V.step === 0 && V.card && V.card.tone === 'neg') extra = '<span class="d-tag">' + esc(CHOICE[t.choice] || 'Choisit…') + '</span>';
      else if (V.phase === 'season' && V.step === 3) extra = '<span class="d-tag">' + (t.paid ? '✓ vendu' : esc(t.wheel ? t.wheel.label : 'Roue…')) + '</span>';
      else if (t.ready) extra = '<span class="d-tag ok">✓ Prête</span>';
      if (t.stopped) extra = '<span class="d-tag bad">😴 À l\'arrêt</span>';
      var segs = ''; for (var i = 0; i < V.meta.bocalMax; i++) segs += '<i class="' + (i < t.bocal ? 'on ' + t.level : '') + '"></i>';
      return '<div class="d-team"><div class="d-team-top"><span class="nm">' + esc(t.name) + '</span><span class="lv" title="' + t.level + '">' + FF.ICON.level[t.level] + '</span></div>' +
        '<div class="meter" role="img" aria-label="' + t.bocal + ' boules sur ' + V.meta.bocalMax + '">' + segs + '</div>' + (extra ? '<div>' + extra + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function clockBlock(title, sub) {
    return '<section style="flex:1.5;display:flex;flex-direction:column;justify-content:center;gap:14px"><div class="d-big">' + esc(title) + '</div>' +
      (sub ? '<div style="font-size:32px;color:var(--muted)">' + esc(sub) + '</div>' : '') +
      '<div class="d-clock" data-clock>0:00</div><div class="bar" style="height:24px"><i data-bar style="width:100%;background:' + (V.phase === 'season' ? V.seasonColor : 'var(--amber)') + '"></i></div></section>';
  }

  // Grille "a rapporter par tuile" : la carte aleas modifie les valeurs, les fermes protegees gardent la valeur de base.
  function quotas() {
    var c = V.card, mods = (c && c.mods) || {};
    var rows = V.meta.products.map(function (p) {
      var base = V.quota[p.id], eff = V.quotaEff[p.id], ch = eff !== base;
      var val = ch ? '<s style="font-size:40px;opacity:.5;margin-right:14px">' + base + '</s><span style="color:' + (eff < base ? 'var(--flame)' : 'var(--mint)') + '">' + eff + '</span>' : String(base);
      return '<div class="d-q sm" style="padding:8px 24px;font-size:32px"><i style="background:' + p.color + '"></i><span>' + esc(p.name) + '</span><span class="v" style="font-size:52px">' + val + '</span></div>';
    }).join('');
    var safe = V.teams.filter(function (t) { return t.exempt; }).map(function (t) { return t.name; });
    var banner = c ? '<div class="d-q sm" style="background:' + (c.tone === 'neg' ? 'var(--flame)' : 'var(--mint)') + ';color:var(--ink);font-size:30px;padding:8px 24px;flex-direction:column;align-items:flex-start;gap:2px"><b>Aléa : ' + esc(c.title) + '</b><span style="font-weight:600;font-size:26px">' + esc(c.effect) + '</span></div>' : '';
    var stop = mods.stopEarlySec ? '<div style="font-size:28px;color:var(--flame);font-weight:700">Fermes touchées : stop à ' + FF.fmt(mods.stopEarlySec * 1000) + ' du chrono</div>' : '';
    var prot = safe.length && c && c.tone === 'neg' ? '<div style="font-size:26px;color:var(--mint);font-weight:700">Protégées (valeur de base) : ' + esc(safe.join(', ')) + '</div>' : '';
    return '<section style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:14px"><div style="font-size:30px;font-weight:700;color:var(--muted)">À rapporter par tuile <span style="font-weight:500;color:var(--muted);font-size:26px">· jetons = tuiles × valeur</span></div>' + rows +
      '' + banner + stop + prot + '</section>';
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
      return '<div class="d-q sm" style="padding:' + (big ? 8 : 10) + 'px 20px;gap:12px;font-size:' + (big ? 24 : 32) + 'px"><span style="flex:1;min-width:0"><b>' + esc(i.name) + '</b><span style="display:block;font-size:' + (big ? 19 : 22) + 'px;font-weight:500;color:var(--muted)">' + esc(TIER[i.tier]) + ' · ' + esc(i.needs) + '</span></span>' + done + who + '</div>';
    }).join('');
    return '<section style="flex:1.6;min-width:0;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:16px"><div style="font-size:30px;font-weight:700;color:var(--muted)">Menu de la Fête du Phoenix · année ' + V.year + ' <span style="font-weight:500;color:var(--muted);font-size:26px">· chaque ferme prend ' + M.perFarm + ' plat' + (M.perFarm > 1 ? 's' : '') + '</span></div>' +
      '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:14px">' + rows + '</div></section>';
  }

  // Rappel de la carte aleas pendant les etapes qu'elle concerne (bourse, marche).
  function cardBanner(id) {
    var c = V.card;
    if (!c || !c.when || c.when.indexOf(id) < 0) return '';
    return '<section style="flex:1 1 0"><div class="d-q sm" style="background:' + (c.tone === 'neg' ? 'var(--flame)' : 'var(--mint)') + ';color:var(--ink);font-size:36px;flex-direction:column;align-items:flex-start;gap:4px"><b>Aléa : ' + esc(c.title) + '</b><span style="font-weight:600;font-size:32px">' + esc(c.effect) + '</span></div></section>';
  }

  function list(items) {
    return '<section style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px">' + items.map(function (t) {
      return '<div class="d-q" style="font-size:34px"><span>' + esc(t) + '</span></div>';
    }).join('') + '</section>';
  }

  function main() {
    if (V.phase === 'setup') return clockBlock('Installation des fermes', 'Année 1 · répartissez la commande de la fête, puis achetez vos tuiles') + menuBoard();
    if (V.phase === 'rearrange') return clockBlock('Réaménagement', 'Année ' + V.year + ' · répartissez le menu de la fête') + menuBoard();
    if (V.phase === 'closing') {
      var f = V.fete;
      return '<section class="d-card"><div class="d-big">Clôture de l\'année ' + V.year + '</div>' +
        '<div style="font-size:46px;font-weight:700">' + (V.closedYear ? 'Charges payées.' : 'Bilan comptable : payez vos charges.') + '</div>' +
        '<div style="font-size:38px;color:var(--muted)">Fête du Phoenix : ' + f.perFarm + ' produits transformés par ferme' + (f.mixed ? ', dont ' + f.mixed + ' recette' + (f.mixed > 1 ? 's' : '') + ' mixte' + (f.mixed > 1 ? 's' : '') : '') + '</div>' +
        (V.feteDone ? '<div style="font-size:46px;font-weight:800;color:var(--mint)">' + (V.fetes[V.fetes.length - 1].success ? 'Fête réussie : −2 boules pour tous !' : 'Fête ratée : +1 boule pour tous, +1 pour les fermes dont un plat manque.') + '</div>' : '') + '</section>' + menuBoard();
    }
    if (V.phase === 'end') {
      var s = V.stars;
      var star = function (ok, label) { return '<div class="d-q" style="font-size:44px;opacity:' + (ok ? 1 : .55) + '"><span style="font-size:64px;color:var(--amber)">' + (ok ? '★' : '☆') + '</span><span>' + esc(label) + '</span></div>'; };
      return '<section style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px"><div class="d-big">Le village a gagné ' + s.count + ' étoile' + (s.count > 1 ? 's' : '') + '</div>' +
        star(s.s1, 'Aucune ferme au-dessus de 5 boules') + star(s.s2, 'Les trois fêtes du Phoenix réussies') + star(s.s3, 'Caisse du village : ' + s.totalBank + ' EB') +
        '<div style="font-size:44px">Ferme la plus riche : <b>' + esc(s.richest.join(', ')) + '</b> · Trophée du Sage : <b>' + esc(s.sage.join(', ')) + '</b></div></section>';
    }
    // saison
    var id = V.meta.steps[V.step].id;
    if (id === 'alea') {
      var c = V.card;
      var die = V.die ? '<div style="font-size:40px;color:var(--muted)">Dé des activités : <b style="color:var(--text)">' + V.die + '</b> · ' + esc(V.dieLabel) + '</div>' : '';
      if (!c) return '<section class="d-card"><div class="d-big">Aléa du ' + esc(V.seasonName.toLowerCase()) + '</div><div style="font-size:48px;color:var(--muted)">Le maire tire une carte…</div>' + die + '</section>';
      return '<section class="d-card"><span class="pill ' + (c.tone === 'neg' ? 'lv-Stressé' : 'lv-Zen') + '" style="font-size:36px;align-self:flex-start;padding:8px 32px">Carte aléa · ' + (c.tone === 'neg' ? 'Négatif' : 'Positif') + '</span>' +
        '<div style="font-size:120px;line-height:1;font-weight:800">' + esc(c.title) + '</div><div style="font-size:56px;font-weight:700;line-height:1.1">' + esc(c.effect) + '</div>' +
        '<div style="font-size:36px;color:var(--muted)">Parade : <b style="color:var(--text)">' + esc(c.parade ? (V.meta.catalogue.filter(function (x) { return x.id === c.parade; })[0] || {}).name : 'aucune') + '</b></div>' + die + '</section>';
    }
    if (id === 'recolte') return clockBlock('Récolte en relais', 'Un coureur par type de produit') + quotas();
    if (id === 'bourse') return clockBlock('Bourse du village', 'Fabriquez vos plats · échangez entre fermes') + menuBoard();
    if (id === 'marche') {
      var spun = V.teams.map(function (t) { return '<div class="d-q" style="font-size:38px"><span>' + esc(t.name) + '</span>' + (t.paid ? '<span style="color:var(--mint);font-size:36px">✓ vendu</span>' : '') + '<span class="v" style="font-size:60px;margin-left:' + (t.paid ? '24px' : 'auto') + '">' + esc(t.wheel ? t.wheel.label : '…') + '</span></div>'; }).join('');
      return clockBlock('Jour de marché', 'Supermarché : prix garanti · Étal : plus cher, la roue décide') + '<section style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px">' + spun + '</section>';
    }
    return clockBlock('Achats et vacances', 'Matériel de la ferme · Vacances 30 EB, −1 boule') + list(['Annoncez chaque achat à voix haute', 'Un voyageur ne court pas la saison suivante']);
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
        '<div style="display:flex;gap:20px;flex-wrap:wrap;justify-content:center">' + V.teams.map(function (t) { return '<span class="d-q" style="font-size:44px;padding:12px 32px">' + esc(t.name) + '</span>'; }).join('') + '</div></div>';
      drawQr();
      return;
    }
    var strip = V.phase === 'season' || V.phase === 'setup' ? '<div style="display:flex;gap:20px;align-items:stretch">' + (V.card && V.card.when && V.card.when.indexOf(V.meta.steps[V.step].id) >= 0 && V.meta.steps[V.step].id !== 'recolte' ? cardBanner(V.meta.steps[V.step].id) : '') + '</div>' : '';
    stage.innerHTML = head() + '<div class="d-main">' + main() + '</div>' + strip + (V.phase === 'end' ? '' : foot());
  }

  function tick() {
    if (!V) return;
    var ms = FF.remaining(V);
    var clock = stage.querySelector('[data-clock]');
    if (clock) { clock.textContent = FF.fmt(ms); clock.classList.toggle('low', V.timer.running && ms <= 10000); }
    var bar = stage.querySelector('[data-bar]');
    if (bar) bar.style.width = (V.timer.durationMs ? Math.round((ms / V.timer.durationMs) * 100) : 0) + '%';
  }
  setInterval(tick, 250);
})();
