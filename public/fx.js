// Effets visuels de l'ecran projecteur : tirage de carte (dos -> face) et ambiance animee liee a la carte (meteo, feu, fete...).
// Canvas plein ecran, sans dependance ni image. Respecte "reduire les animations".
(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cv = null, ctx = null, W = 1920, H = 1080, S = 1, raf = 0, kind = null, parts = [], pre = null, last = 0, T = 0, flash = 0, bolt = null, nextBolt = 0;
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };

  function ensure() {
    if (cv) return;
    cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:4';
    document.body.appendChild(cv);
    ctx = cv.getContext('2d');
    size(); window.addEventListener('resize', size);
  }
  function size() {
    if (!cv) return;
    cv.width = window.innerWidth; cv.height = window.innerHeight;
    S = cv.width / 1920; H = cv.height / S;
  }

  // ---------- Particules ----------
  function fall(o) { // pluie, grele, neige : trajectoire inclinee, reapparition en haut
    var p = { x: rnd(-300, W), y: rnd(-H, H), vy: rnd(o.vy[0], o.vy[1]), r: rnd(o.r[0], o.r[1]), ph: rnd(0, 6.28) };
    p.vx = o.vx !== undefined ? o.vx + rnd(-o.vxs || 0, o.vxs || 0) : p.vy * (o.slope || 0);
    return p;
  }
  var KINDS = {
    rain: function (heavy) {
      return { n: heavy ? 320 : 170, make: function () { return fall({ vy: [1300, 1900], r: [1.2, 2.2], slope: 0.16 }); },
        draw: function (p) { ctx.strokeStyle = 'rgba(175,205,255,' + (heavy ? .42 : .34) + ')'; ctx.lineWidth = p.r; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * .028, p.y - p.vy * .028); ctx.stroke(); },
        pre: heavy ? function () { fill('rgba(8,14,40,.30)'); lightning(); } : function () { fill('rgba(20,40,80,.12)'); } };
    },
    hail: function () {
      return { n: 110, make: function () { return fall({ vy: [1500, 2200], r: [4, 9], slope: 0.12 }); },
        draw: function (p) { ctx.fillStyle = 'rgba(245,250,255,.88)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(p.x - p.r * .3, p.y - p.r * .3, p.r * .35, 0, 6.28); ctx.fill(); },
        pre: function () { fill('rgba(30,45,70,.20)'); } };
    },
    snow: function (storm) {
      return { n: storm ? 420 : 170,
        make: function () { var p = fall(storm ? { vy: [260, 520], r: [2, 6], vx: -800, vxs: 220 } : { vy: [60, 170], r: [2.5, 7], vx: 0, vxs: 30 }); return p; },
        step: function (p, dt) { p.x += (p.vx + (storm ? 0 : Math.sin(T * 1.2 + p.ph) * 40)) * dt; p.y += p.vy * dt; if (p.y > H + 10 || p.x < -60 || p.x > W + 60) { p.y = -10; p.x = storm ? rnd(0, W + 900) : rnd(0, W); } },
        draw: function (p) { ctx.fillStyle = 'rgba(255,255,255,' + (storm ? .85 : .8) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); },
        pre: storm ? function () { fill('rgba(225,240,255,' + (.14 + .05 * Math.sin(T * 2.5)) + ')'); } : function () { fill('rgba(160,200,240,.08)'); } };
    },
    frost: function () {
      return { n: 70, make: function () { return fall({ vy: [20, 70], r: [4, 10], vx: 0, vxs: 15 }); },
        step: function (p, dt) { p.x += Math.sin(T + p.ph) * 14 * dt; p.y += p.vy * dt; if (p.y > H + 20) { p.y = -20; p.x = rnd(0, W); } },
        draw: function (p) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(T * .6 + p.ph); ctx.fillStyle = 'rgba(205,235,255,.75)'; ctx.fillRect(-p.r, -p.r * .25, p.r * 2, p.r * .5); ctx.fillRect(-p.r * .25, -p.r, p.r * .5, p.r * 2); ctx.restore(); },
        pre: function () { vignette('rgba(170,220,255,' + (.42 + .06 * Math.sin(T * 1.5)) + ')', 'rgba(170,220,255,0)'); } };
    },
    heat: function (dust) {
      return { n: dust ? 90 : 40, make: function () { return { x: rnd(0, W), y: rnd(0, H), vy: dust ? rnd(-10, 10) : -rnd(40, 110), vx: dust ? rnd(80, 260) : rnd(-15, 15), r: dust ? rnd(1.5, 4) : rnd(2, 5), ph: rnd(0, 6.28) }; },
        step: function (p, dt) { p.x += p.vx * dt + Math.sin(T * 2 + p.ph) * 10 * dt; p.y += p.vy * dt; if (p.y < -10) p.y = H + 10; if (p.x > W + 10) p.x = -10; },
        draw: function (p) { ctx.fillStyle = dust ? 'rgba(190,150,95,.55)' : 'rgba(255,200,90,.5)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); },
        pre: function () {
          var g = ctx.createRadialGradient(W * .88, 80, 20, W * .88, 80, 1100);
          g.addColorStop(0, dust ? 'rgba(255,205,120,.38)' : 'rgba(255,215,90,' + (.55 + .08 * Math.sin(T * 2)) + ')'); g.addColorStop(1, 'rgba(255,140,40,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
          fill(dust ? 'rgba(160,110,50,.12)' : 'rgba(255,120,30,.10)');
          ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 3;
          for (var i = 0; i < 12; i++) { ctx.beginPath(); for (var x = 0; x <= W; x += 40) { var y = H * (.35 + i * .05) + Math.sin(x * .012 + T * 2.2 + i) * 9; if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); }
        } };
    },
    fog: function (rise) {
      return { n: rise ? 16 : 16, make: function () { return { x: rnd(-200, W), y: rise ? rnd(H * .4, H + 100) : rnd(H * .1, H), r: rise ? rnd(90, 190) : rnd(280, 560), vx: rise ? rnd(-10, 10) : rnd(25, 70), vy: rise ? -rnd(30, 70) : 0, a: rnd(.08, .16) }; },
        step: function (p, dt) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.x - p.r > W) p.x = -p.r; if (p.y + p.r < 0) { p.y = H + p.r; p.x = rnd(0, W); } },
        draw: function (p) { var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); g.addColorStop(0, 'rgba(235,240,245,' + p.a + ')'); g.addColorStop(1, 'rgba(235,240,245,0)'); ctx.fillStyle = g; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); },
        pre: function () { fill(rise ? 'rgba(255,170,60,.06)' : 'rgba(150,165,175,.14)'); } };
    },
    night: function () {
      return { n: 110, make: function () { return { x: rnd(0, W), y: rnd(0, H * .75), r: rnd(1, 3.2), ph: rnd(0, 6.28), s: rnd(1, 3) }; },
        draw: function (p) { ctx.fillStyle = 'rgba(255,250,220,' + (.35 + .55 * (Math.sin(T * p.s + p.ph) + 1) / 2) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); },
        pre: function () { fill('rgba(6,10,36,.42)'); var g = ctx.createRadialGradient(300, 170, 10, 300, 170, 380); g.addColorStop(0, 'rgba(255,245,200,.85)'); g.addColorStop(.25, 'rgba(255,245,200,.35)'); g.addColorStop(1, 'rgba(255,245,200,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 800, 600); } };
    },
    confetti: function () {
      var cols = ['#ff5d73', '#ffd23f', '#3bd1a5', '#4da3ff', '#c78bff', '#ff9a3c'];
      return { n: 150, make: function () { return { x: rnd(0, W), y: rnd(-H, H), vy: rnd(140, 320), w: rnd(9, 18), h: rnd(5, 10), rot: rnd(0, 6.28), vr: rnd(-6, 6), ph: rnd(0, 6.28), c: pick(cols) }; },
        step: function (p, dt) { p.y += p.vy * dt; p.x += Math.sin(T * 1.6 + p.ph) * 60 * dt; p.rot += p.vr * dt; if (p.y > H + 20) { p.y = -20; p.x = rnd(0, W); } },
        draw: function (p) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); } };
    },
    leaves: function (palette, small) {
      var cols = { green: ['#7cc65a', '#a5d96b', '#5fae48'], autumn: ['#e0701f', '#f2b63d', '#c0432b', '#b8862d'], petals: ['#ffc2d6', '#ffa6c2', '#fff0f5'] }[palette];
      return { n: palette === 'petals' ? 70 : 48, make: function () { return { x: rnd(-200, W), y: rnd(-H, H), vy: rnd(70, 190), vx: rnd(40, 150), l: small ? rnd(7, 12) : rnd(13, 24), rot: rnd(0, 6.28), vr: rnd(-2.5, 2.5), ph: rnd(0, 6.28), c: pick(cols) }; },
        step: function (p, dt) { p.x += (p.vx + Math.sin(T * 1.5 + p.ph) * 70) * dt; p.y += p.vy * dt; p.rot += p.vr * dt; if (p.y > H + 30 || p.x > W + 40) { p.y = -30; p.x = rnd(-300, W); } },
        draw: function (p) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(0, 0, p.l, p.l * .5, 0, 0, 6.28); ctx.fill(); ctx.restore(); } };
    },
    sparkle: function (cold) {
      return { n: 80, make: function () { return { x: rnd(0, W), y: rnd(0, H), vy: -rnd(8, 40), r: rnd(6, 20), ph: rnd(0, 6.28), s: rnd(1.5, 4) }; },
        step: function (p, dt) { p.y += p.vy * dt; if (p.y < -20) { p.y = H + 20; p.x = rnd(0, W); } },
        draw: function (p) { var a = Math.max(0, Math.sin(T * p.s + p.ph)); if (a < .05) return; ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = a; ctx.fillStyle = cold ? '#eaf6ff' : '#ffe58a'; ctx.beginPath(); for (var i = 0; i < 4; i++) { var ang = i * Math.PI / 2; ctx.lineTo(Math.cos(ang) * p.r, Math.sin(ang) * p.r); ctx.lineTo(Math.cos(ang + Math.PI / 4) * p.r * .22, Math.sin(ang + Math.PI / 4) * p.r * .22); } ctx.closePath(); ctx.fill(); ctx.restore(); },
        pre: function () { fill(cold ? 'rgba(200,225,255,.05)' : 'rgba(255,225,130,.06)'); } };
    },
    embers: function () {
      return { n: 110, make: function () { return { x: rnd(0, W), y: rnd(0, H), vy: -rnd(70, 230), r: rnd(2, 5.5), ph: rnd(0, 6.28), c: pick(['#ff8a2a', '#ffb347', '#ff5a1f', '#ffd36e']) }; },
        step: function (p, dt) { p.y += p.vy * dt; p.x += Math.sin(T * 3 + p.ph) * 50 * dt; if (p.y < -10) { p.y = H + 10; p.x = rnd(0, W); } },
        draw: function (p) { ctx.globalAlpha = Math.max(0, Math.min(1, p.y / H + .15)) * (.6 + .4 * Math.sin(T * 9 + p.ph)); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); ctx.globalAlpha = 1; },
        pre: function () { var g = ctx.createLinearGradient(0, H, 0, H * .35); g.addColorStop(0, 'rgba(255,70,20,' + (.42 + .08 * Math.sin(T * 7)) + ')'); g.addColorStop(1, 'rgba(255,70,20,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); } };
    },
    hearts: function () {
      return { n: 26, make: function () { return { x: rnd(0, W), y: rnd(0, H), vy: -rnd(40, 110), s: rnd(26, 58), ph: rnd(0, 6.28), e: pick(['💗', '💕', '🐣', '💛']) }; },
        step: function (p, dt) { p.y += p.vy * dt; p.x += Math.sin(T * 1.4 + p.ph) * 30 * dt; if (p.y < -60) { p.y = H + 60; p.x = rnd(0, W); } },
        draw: function (p) { ctx.globalAlpha = .85; ctx.font = p.s + 'px serif'; ctx.fillText(p.e, p.x, p.y); ctx.globalAlpha = 1; } };
    }
  };
  var ALIAS = {
    rain: function () { return KINDS.rain(false); }, storm: function () { return KINDS.rain(true); }, hail: function () { return KINDS.hail(); },
    snow: function () { return KINDS.snow(false); }, blizzard: function () { return KINDS.snow(true); }, frost: function () { return KINDS.frost(); },
    heat: function () { return KINDS.heat(false); }, dust: function () { return KINDS.heat(true); }, fog: function () { return KINDS.fog(false); }, steam: function () { return KINDS.fog(true); },
    night: function () { return KINDS.night(); }, confetti: function () { return KINDS.confetti(); }, leaves: function () { return KINDS.leaves('green'); },
    'leaves-autumn': function () { return KINDS.leaves('autumn'); }, petals: function () { return KINDS.leaves('petals', true); },
    sparkle: function () { return KINDS.sparkle(false); }, 'sparkle-cold': function () { return KINDS.sparkle(true); }, embers: function () { return KINDS.embers(); }, hearts: function () { return KINDS.hearts(); }
  };

  function fill(c) { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); }
  function vignette(edge, mid) { var g = ctx.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, W * .62); g.addColorStop(0, mid); g.addColorStop(1, edge); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  function lightning() {
    if (T > nextBolt) { flash = 1; nextBolt = T + rnd(2.2, 5.5); var x = rnd(300, W - 300), y = 0; bolt = [[x, y]]; while (y < H * .7) { x += rnd(-60, 60); y += rnd(40, 90); bolt.push([x, y]); } }
    if (flash > 0.02) {
      fill('rgba(255,255,255,' + (flash * .45) + ')');
      if (bolt && flash > .5) { ctx.strokeStyle = 'rgba(255,255,255,' + flash + ')'; ctx.lineWidth = 6; ctx.beginPath(); bolt.forEach(function (b, i) { if (i) ctx.lineTo(b[0], b[1]); else ctx.moveTo(b[0], b[1]); }); ctx.stroke(); }
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min(.05, (now - last) / 1000 || 0); last = now; T += dt; flash = Math.max(0, flash - dt * 3);
    ctx.setTransform(S, 0, 0, S, 0, 0); ctx.clearRect(0, 0, W, H);
    if (pre) pre();
    for (var i = 0; i < parts.length; i++) { var p = parts[i]; if (spec.step) spec.step(p, dt); else { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > H + 40 || p.x > W + 80) { p.y = -40; p.x = rnd(-300, W); } } spec.draw(p); }
  }
  var spec = null;

  // Lance (ou remplace) l'ambiance : null pour l'arreter.
  function set(name) {
    if (name === kind) return;
    kind = name;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!name || reduce || !ALIAS[name]) { if (ctx) ctx.clearRect(0, 0, cv.width, cv.height); return; }
    ensure();
    spec = ALIAS[name](); pre = spec.pre || null; parts = [];
    for (var i = 0; i < spec.n; i++) parts.push(spec.make());
    T = 0; nextBolt = 1; flash = 0; last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ---------- Tirage de la carte ----------
  var css = '.rv{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:rgba(12,9,7,.93);animation:rvIn .35s ease both;cursor:pointer}' +
    '.rv.out{animation:rvOut .6s ease forwards}' +
    '.rv-card{position:relative;height:78vh;aspect-ratio:.7;perspective:1800px}' +
    '.rv-in{position:absolute;inset:0;transform-style:preserve-3d;animation:rvFlip 3.2s cubic-bezier(.3,.7,.2,1) both}' +
    '.rv-face{position:absolute;inset:0;border-radius:4vh;backface-visibility:hidden;-webkit-backface-visibility:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:4vh 3vh;gap:2vh;box-shadow:0 3vh 8vh rgba(0,0,0,.6);border:.6vh solid rgba(255,255,255,.35)}' +
    '.rv-back{background:repeating-linear-gradient(45deg,rgba(255,255,255,.07) 0 2vh,transparent 2vh 4vh),linear-gradient(145deg,#3b2a1c,#7a4b1f 55%,#c8741d);color:#fff4e0}' +
    '.rv-back .big{font-size:20vh;line-height:1;animation:rvPulse 1s ease-in-out infinite}' +
    '.rv-back b{font:700 6vh/1 "Amatic SC",cursive;letter-spacing:.06em}' +
    '.rv-front{transform:rotateY(180deg);color:#1f1a17}' +
    '.rv-front .ico{font-size:22vh;line-height:1;animation:rvBob 2.4s ease-in-out infinite}' +
    '.rv-front h2{font:800 6.4vh/1.05 Figtree,system-ui,sans-serif;margin:0}' +
    '.rv-front p{font:600 3vh/1.25 Figtree,system-ui,sans-serif;margin:0}' +
    '.rv-front .tag{font:700 2.4vh Figtree,system-ui,sans-serif;background:rgba(0,0,0,.18);padding:.8vh 2.4vh;border-radius:99px}' +
    '.rv-burst{position:absolute;inset:-30%;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.95),rgba(255,230,140,.5) 35%,transparent 65%);opacity:0;animation:rvBurst 3.2s ease-out both;pointer-events:none}' +
    '@keyframes rvIn{from{opacity:0}to{opacity:1}}@keyframes rvOut{to{opacity:0}}' +
    '@keyframes rvPulse{50%{transform:scale(1.12)}}@keyframes rvBob{50%{transform:translateY(-1.6vh) rotate(4deg)}}' +
    '@keyframes rvBurst{0%,60%{opacity:0;transform:scale(.4)}66%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.4)}}' +
    '@keyframes rvFlip{0%{transform:translateY(110vh) rotateZ(-10deg)}20%{transform:translateY(0) rotateZ(0)}27%{transform:rotateZ(3deg)}33%{transform:rotateZ(-3deg)}39%{transform:rotateZ(2deg)}45%{transform:rotateZ(0) rotateY(0)}68%{transform:rotateY(180deg) scale(1.08)}100%{transform:rotateY(180deg) scale(1)}}' +
    '@media (prefers-reduced-motion:reduce){.rv-in,.rv-burst,.rv-back .big,.rv-front .ico{animation:none}.rv-in{transform:rotateY(180deg)}}';
  var styled = false;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // opts : { seasonName, tone('neg'|'pos'|'col'), onFlip, onDone } ; card : { icon, title, effect/story, parade }
  function reveal(card, opts) {
    opts = opts || {};
    if (reduce) { if (opts.onFlip) opts.onFlip(); if (opts.onDone) opts.onDone(); return; }
    if (!styled) { var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); styled = true; }
    var bg = card.collective ? 'linear-gradient(160deg,#ffd36e,#f2b63d)' : card.tone === 'neg' ? 'linear-gradient(160deg,#ff9a6b,#e0701f)' : 'linear-gradient(160deg,#b7f0c8,#5fd08c)';
    var tag = card.collective ? '🤝 Aléa collectif' : card.tone === 'neg' ? 'Carte aléa · Négatif' : 'Carte aléa · Positif';
    var text = card.collective ? card.story : card.effect;
    var el = document.createElement('div');
    el.className = 'rv'; el.setAttribute('role', 'presentation');
    el.innerHTML = '<div class="rv-card"><div class="rv-in">' +
      '<div class="rv-face rv-back"><div class="big">🚜</div><b>Aléa du ' + esc((opts.seasonName || '').toLowerCase()) + '</b><span>Le maire tire une carte…</span></div>' +
      '<div class="rv-face rv-front" style="background:' + bg + '"><span class="tag">' + esc(tag) + '</span><div class="ico">' + (card.icon || '🎴') + '</div><h2>' + esc(card.title) + '</h2><p>' + esc(text || '') + '</p></div>' +
      '</div><div class="rv-burst"></div></div>';
    document.body.appendChild(el);
    var done = false, timers = [];
    function finish() {
      if (done) return; done = true; timers.forEach(clearTimeout);
      if (opts.onFlip && !flipped) { flipped = true; opts.onFlip(); }
      el.classList.add('out');
      setTimeout(function () { el.remove(); if (opts.onDone) opts.onDone(); }, 600);
    }
    var flipped = false;
    timers.push(setTimeout(function () { flipped = true; if (opts.onFlip) opts.onFlip(); }, 2150));
    timers.push(setTimeout(finish, 5400));
    el.addEventListener('click', finish);
  }

  window.FFX = { set: set, reveal: reveal, kinds: Object.keys(ALIAS) };
})();
