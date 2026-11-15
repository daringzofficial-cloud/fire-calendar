/* 3D-обзор: объёмная карта Казахстана. Высота столбца — число очагов за год на ячейке 0,25°
 * (MODIS-эквивалент). Сцена поднимается из плоской карты, затем проигрывает годы 2001–2025 по кругу.
 * Мышью или пальцем можно вращать. Рисуется на canvas 2D, без внешних библиотек. */
(function () {
  'use strict';
  var M = window.FIRE_MODEL, root = document.getElementById('hero3d');
  if (!root || !M) return;
  var RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var T = {
    ru: {
      title: 'Казахстан в 3D', sub: 'Высота столбца — очаги за год на участке 25 × 25 км. Потяните, чтобы повернуть.',
      norm: 'Норма', normSub: 'в среднем за {a}–{b}', fires: 'очагов за год', normFires: 'очагов в среднем за год',
      pause: 'Пауза', play: 'Смотреть по годам', low: 'мало', high: 'много', aria: 'Трёхмерная карта пожарной активности Казахстана по годам',
      cities: { astana: 'Астана', almaty: 'Алматы', shymkent: 'Шымкент', aktobe: 'Актобе', oskemen: 'Усть-Каменогорск', kostanay: 'Костанай' },
      locale: 'ru-RU'
    },
    en: {
      title: 'Kazakhstan in 3D', sub: 'Column height is detections per year on a 25 × 25 km cell. Drag to rotate.',
      norm: 'Normal', normSub: 'average for {a}–{b}', fires: 'detections in the year', normFires: 'detections in an average year',
      pause: 'Pause', play: 'Play years', low: 'few', high: 'many', aria: '3D map of fire activity in Kazakhstan by year',
      cities: { astana: 'Astana', almaty: 'Almaty', shymkent: 'Shymkent', aktobe: 'Aktobe', oskemen: 'Oskemen', kostanay: 'Kostanay' },
      locale: 'en-GB'
    }
  };
  var CITIES = [['astana', 51.17, 71.43], ['almaty', 43.24, 76.89], ['shymkent', 42.32, 69.59],
    ['aktobe', 50.28, 57.17], ['oskemen', 49.95, 82.61], ['kostanay', 53.21, 63.63]];
  function lang() { try { var v = localStorage.getItem('fc-lang'); if (v === 'ru' || v === 'en') return v; } catch (e) { /* нет хранилища */ } return 'ru'; }
  function fill(s, v) { return s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }); }

  /* ---------- данные: слой 0 = норма, слои 1..NY = годы ---------- */
  var nC = M.cells.length, nM = M.nM, Y0 = M.bY0, Y1 = M.bY1, NY = Y1 - Y0 + 1, L = NY + 1;
  var V = new Float32Array(L * nC), TOT = new Float64Array(L);
  for (var c = 0; c < nC; c++) {
    for (var i = M.cellStart[c]; i < M.cellStart[c + 1]; i++) {
      var m = M.rowM[i], y = M.y0 + Math.floor(m / 12);
      if (y < Y0 || y > Y1) continue;
      V[(y - Y0 + 1) * nC + c] += M.rowN[i] * M.factor[M.rowS[i] * nM + m];
    }
    var s = 0;
    for (var k = 1; k < L; k++) s += V[k * nC + c];
    V[c] = s / NY;
  }
  for (k = 0; k < L; k++) { var t = 0; for (c = 0; c < nC; c++) t += V[k * nC + c]; TOT[k] = t; }
  var sample = [];
  for (i = nC; i < V.length; i += 3) if (V[i] > 0) sample.push(V[i]);
  sample.sort(function (a, b) { return a - b; });
  var CAP = sample.length ? sample[Math.floor(sample.length * 0.985)] : 1;
  var HMAX = 2.6;
  var HL = new Float32Array(L * nC);
  for (i = 0; i < HL.length; i++) HL[i] = V[i] > 0 ? Math.min(1.15, Math.pow(V[i] / CAP, 0.72)) * HMAX : 0;
  // самые высокие ячейки каждого слоя: для свечения и искр
  var TOP = [];
  for (k = 0; k < L; k++) {
    var ids = [];
    for (c = 0; c < nC; c++) if (HL[k * nC + c] > HMAX * 0.45) ids.push(c);
    ids.sort(function (a, b) { return HL[k * nC + b] - HL[k * nC + a]; });
    TOP.push(ids.slice(0, 22));
  }

  /* ---------- геометрия ---------- */
  var KX = Math.cos(48 * Math.PI / 180), G = M.g, INS = G * 0.07;
  var X0 = new Float32Array(nC), X1 = new Float32Array(nC), Z0 = new Float32Array(nC), Z1 = new Float32Array(nC);
  for (c = 0; c < nC; c++) {
    var lat = M.cells[c][0], lon = M.cells[c][1];
    X0[c] = (lon + INS - 67) * KX; X1[c] = (lon + G - INS - 67) * KX;
    Z0[c] = lat + INS - 48.2; Z1[c] = lat + G - INS - 48.2;
  }

  /* ---------- палитра: от тёмной земли к раскалённому ---------- */
  var STOPS = [[0, [52, 38, 30]], [0.18, [126, 46, 26]], [0.42, [205, 82, 34]], [0.7, [246, 152, 58]], [0.9, [255, 214, 120]], [1, [255, 244, 214]]];
  var NP = 64, PT = [], PS1 = [], PS2 = [];
  function mix(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  function rgb(a, k) { return 'rgb(' + Math.round(a[0] * k) + ',' + Math.round(a[1] * k) + ',' + Math.round(a[2] * k) + ')'; }
  for (i = 0; i < NP; i++) {
    var f = i / (NP - 1), j = 1;
    while (j < STOPS.length - 1 && STOPS[j][0] < f) j++;
    var a = STOPS[j - 1], b = STOPS[j], col = mix(a[1], b[1], (f - a[0]) / (b[0] - a[0]));
    PT.push(rgb(col, 1)); PS1.push(rgb(col, 0.72)); PS2.push(rgb(col, 0.52));
  }
  var GROUND = '#1f3134', GROUND_HI = '#27403f';

  /* ---------- разметка ---------- */
  var Lx = T[lang()], nf = new Intl.NumberFormat(Lx.locale);
  root.innerHTML =
    '<canvas class="h3d-cv" role="img"></canvas>' +
    '<div class="h3d-head"><h2 id="h3dTitle"></h2><p class="h3d-sub"></p></div>' +
    '<div class="h3d-year"><span class="h3d-y"></span><span class="h3d-ysub"></span><span class="h3d-n"><b></b> <i></i></span></div>' +
    '<div class="h3d-legend"><span class="h3d-lo"></span><span class="h3d-bar"></span><span class="h3d-hi"></span></div>' +
    '<div class="h3d-ctrl"><button type="button" class="h3d-play" aria-pressed="true"><span class="h3d-ico"></span><span class="h3d-pl"></span></button>' +
    '<div class="h3d-track"><input type="range" class="h3d-range" min="0" max="' + NY + '" step="1" value="0">' +
    '<div class="h3d-ticks"><span class="h3d-t0"></span><span>' + Y0 + '</span><span>' + Y1 + '</span></div></div></div>';
  var cv = root.querySelector('.h3d-cv'), ctx = cv.getContext('2d');
  var elY = root.querySelector('.h3d-y'), elYs = root.querySelector('.h3d-ysub'), elN = root.querySelector('.h3d-n b'), elNl = root.querySelector('.h3d-n i');
  var btn = root.querySelector('.h3d-play'), range = root.querySelector('.h3d-range');

  function texts() {
    Lx = T[lang()]; nf = new Intl.NumberFormat(Lx.locale);
    root.querySelector('#h3dTitle').textContent = Lx.title;
    root.querySelector('.h3d-sub').textContent = Lx.sub;
    root.querySelector('.h3d-lo').textContent = Lx.low;
    root.querySelector('.h3d-hi').textContent = Lx.high;
    root.querySelector('.h3d-t0').textContent = Lx.norm;
    cv.setAttribute('aria-label', Lx.aria);
    setPlayUI();
    yearUI(true);
  }

  /* ---------- состояние ---------- */
  var W = 0, H = 0, DPR = 1, F = 1000, D = 40, CX = 0, CY = 0;
  var cur = new Float32Array(nC), from = new Float32Array(nC);
  var layer = 0, prevLayer = 0, tr = 1, trDur = 700, trStart = 0;
  var playing = !RM, nextAt = 0, intro = RM ? 1 : 0, introStart = 0;
  var yawBase = 0.32, pitchUser = 0.98, drag = null, lastInput = 0;
  var shownTotal = 0, lite = false, slowFrames = 0, visible = false, raf = 0;
  var embers = [];

  function size() {
    W = root.clientWidth;
    H = Math.round(Math.max(380, Math.min(640, W * 0.5)));
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    D = 38; F = Math.min(W * 1.02, H * 2.2); CX = W * (W > 760 ? 0.6 : 0.52); CY = H * 0.54;
    if (!raf) draw(performance.now());
  }

  function setLayer(k, dur) {
    k = Math.max(0, Math.min(NY, k));
    if (k === layer && tr >= 1) return;
    from.set(cur); prevLayer = layer; layer = k; tr = 0; trDur = dur || 700; trStart = performance.now();
    range.value = k;
    yearUI();
  }
  function yearUI(now) {
    if (layer === 0) { elY.textContent = Lx.norm; elYs.textContent = fill(Lx.normSub, { a: Y0, b: Y1 }); elNl.textContent = Lx.normFires; }
    else { elY.textContent = Y0 + layer - 1; elYs.textContent = ''; elNl.textContent = Lx.fires; }
    if (now) elN.textContent = nf.format(Math.round(TOT[layer]));
    elY.classList.remove('flip'); void elY.offsetWidth; elY.classList.add('flip');
  }
  function setPlayUI() {
    btn.setAttribute('aria-pressed', String(playing));
    btn.querySelector('.h3d-pl').textContent = playing ? Lx.pause : Lx.play;
    btn.classList.toggle('on', playing);
  }

  /* ---------- кадр ---------- */
  var order = new Uint16Array(nC), depth = new Float32Array(nC), pts = new Float32Array(16);
  for (c = 0; c < nC; c++) order[c] = c;
  function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

  function draw(now) {
    var t0 = performance.now();
    // вступление: плоская карта сверху поднимается в 3D
    if (intro < 1) {
      if (!introStart) introStart = now;
      intro = Math.min(1, (now - introStart) / 2600);
    }
    var ie = ease(intro);
    if (tr < 1) tr = Math.min(1, (now - trStart) / trDur);
    var te = ease(tr), base = layer * nC;
    for (var c = 0; c < nC; c++) cur[c] = (from[c] + (HL[base + c] - from[c]) * te);

    var sway = RM ? 0 : Math.sin(now * 0.00022) * 0.32;
    var yaw = (yawBase + sway) * ie, pitch = 1.52 + (pitchUser - 1.52) * ie, hk = ie;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var f = F * (0.86 + 0.14 * ie);

    function P(x, yv, z, o) {
      var xr = x * cy - z * sy, zr = x * sy + z * cy;
      var v = yv * cp + zr * sp, d = zr * cp - yv * sp, k = f / (D + d);
      pts[o] = CX + xr * k; pts[o + 1] = CY - v * k;
    }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // сетка широт и долгот на «земле»
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(120,190,185,0.10)';
    for (var lo = 50; lo <= 85; lo += 5) {
      ctx.beginPath();
      P((lo - 67) * KX, 0, 40 - 48.2, 0); ctx.moveTo(pts[0], pts[1]);
      P((lo - 67) * KX, 0, 56 - 48.2, 0); ctx.lineTo(pts[0], pts[1]); ctx.stroke();
    }
    for (var la = 42; la <= 56; la += 2) {
      ctx.beginPath();
      P((46 - 67) * KX, 0, la - 48.2, 0); ctx.moveTo(pts[0], pts[1]);
      P((88 - 67) * KX, 0, la - 48.2, 0); ctx.lineTo(pts[0], pts[1]); ctx.stroke();
    }

    // порядок отрисовки: дальние ячейки первыми
    for (c = 0; c < nC; c++) {
      var mx = (X0[c] + X1[c]) / 2, mz = (Z0[c] + Z1[c]) / 2;
      depth[c] = (mx * sy + mz * cy) * cp - cur[c] * hk * 0.5 * sp;
    }
    order.sort(function (a, b) { return depth[b] - depth[a]; });

    // какие боковые грани смотрят на зрителя
    var showS = cy > 0, showN = !showS, showW = sy > 0, showE = !showW;
    for (var n = 0; n < nC; n++) {
      c = order[n];
      var h = cur[c] * hk, x0 = X0[c], x1 = X1[c], z0 = Z0[c], z1 = Z1[c];
      if (h < 0.015) {
        if (lite) continue;
        P(x0, 0, z0, 0); P(x1, 0, z0, 2); P(x1, 0, z1, 4); P(x0, 0, z1, 6);
        ctx.fillStyle = GROUND;
        ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); ctx.lineTo(pts[4], pts[5]); ctx.lineTo(pts[6], pts[7]); ctx.fill();
        continue;
      }
      var ci = Math.min(NP - 1, Math.round(h / (HMAX * 1.15) * (NP - 1)));
      // верх: 0..6, низ: 8..14 (A B C D)
      P(x0, h, z0, 0); P(x1, h, z0, 2); P(x1, h, z1, 4); P(x0, h, z1, 6);
      if (!lite || h > 0.25) {
        P(x0, 0, z0, 8); P(x1, 0, z0, 10); P(x1, 0, z1, 12); P(x0, 0, z1, 14);
        ctx.fillStyle = PS1[ci];
        ctx.beginPath();
        if (showS) { ctx.moveTo(pts[8], pts[9]); ctx.lineTo(pts[10], pts[11]); ctx.lineTo(pts[2], pts[3]); ctx.lineTo(pts[0], pts[1]); }
        else { ctx.moveTo(pts[14], pts[15]); ctx.lineTo(pts[12], pts[13]); ctx.lineTo(pts[4], pts[5]); ctx.lineTo(pts[6], pts[7]); }
        ctx.fill();
        ctx.fillStyle = PS2[ci];
        ctx.beginPath();
        if (showW) { ctx.moveTo(pts[8], pts[9]); ctx.lineTo(pts[14], pts[15]); ctx.lineTo(pts[6], pts[7]); ctx.lineTo(pts[0], pts[1]); }
        else { ctx.moveTo(pts[10], pts[11]); ctx.lineTo(pts[12], pts[13]); ctx.lineTo(pts[4], pts[5]); ctx.lineTo(pts[2], pts[3]); }
        ctx.fill();
      }
      ctx.fillStyle = h < 0.06 ? GROUND_HI : PT[ci];
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); ctx.lineTo(pts[4], pts[5]); ctx.lineTo(pts[6], pts[7]); ctx.fill();
    }

    // свечение над самыми горячими участками и искры
    var hot = TOP[layer];
    ctx.globalCompositeOperation = 'lighter';
    for (n = 0; n < hot.length; n++) {
      c = hot[n];
      var hh = cur[c] * hk;
      if (hh < HMAX * 0.4) continue;
      P((X0[c] + X1[c]) / 2, hh, (Z0[c] + Z1[c]) / 2, 0);
      var r = 3 + hh * 2.6, flick = 0.75 + 0.25 * Math.sin(now * 0.006 + c);
      var g = ctx.createRadialGradient(pts[0], pts[1], 0, pts[0], pts[1], r * 2.2);
      g.addColorStop(0, 'rgba(255,190,100,' + (0.3 * flick * ie).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(pts[0] - r * 2.2, pts[1] - r * 2.2, r * 4.4, r * 4.4);
      if (!RM && !lite && Math.random() < 0.04 * ie && embers.length < 70) {
        embers.push({ x: pts[0] + (Math.random() - 0.5) * 6, y: pts[1], vx: (Math.random() - 0.5) * 0.25, vy: -0.35 - Math.random() * 0.6, life: 1, s: 1 + Math.random() * 1.6 });
      }
    }
    for (n = embers.length - 1; n >= 0; n--) {
      var e = embers[n];
      e.x += e.vx + Math.sin(now * 0.003 + n) * 0.15; e.y += e.vy; e.life -= 0.011;
      if (e.life <= 0) { embers.splice(n, 1); continue; }
      ctx.fillStyle = 'rgba(255,' + Math.round(150 + 80 * e.life) + ',90,' + (e.life * 0.9).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(e.x, e.y, e.s * e.life + 0.3, 0, 6.2832); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // города
    ctx.font = '12px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (n = 0; n < CITIES.length; n++) {
      var cc = CITIES[n], lift = 1.2 * ie;
      P((cc[2] - 67) * KX, 0, cc[1] - 48.2, 0); P((cc[2] - 67) * KX, HMAX * 0.55 * ie + lift, cc[1] - 48.2, 2);
      ctx.strokeStyle = 'rgba(232,239,237,0.35)'; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); ctx.stroke();
      ctx.fillStyle = '#e8efed'; ctx.beginPath(); ctx.arc(pts[2], pts[3], 2.5, 0, 6.2832); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(14,22,24,0.8)'; ctx.strokeText(Lx.cities[cc[0]], pts[2] + 6, pts[3]);
      ctx.fillStyle = '#e8efed'; ctx.fillText(Lx.cities[cc[0]], pts[2] + 6, pts[3]);
      ctx.lineWidth = 1;
    }

    // число очагов плавно догоняет выбранный год
    var target = TOT[layer];
    shownTotal += (target - shownTotal) * 0.12;
    if (Math.abs(target - shownTotal) < 1) shownTotal = target;
    elN.textContent = nf.format(Math.round(shownTotal * ie));

    // автопроигрывание годов по кругу
    if (playing && intro >= 1 && now >= nextAt) {
      var nxt = layer >= NY ? 0 : layer + 1;
      setLayer(nxt, 750);
      nextAt = now + (nxt === 0 ? 3200 : nxt === 1 ? 1700 : 1350);
    }

    // если кадры тяжёлые, упрощаем сцену
    var dt = performance.now() - t0;
    if (dt > 26) { if (++slowFrames > 20) lite = true; } else slowFrames = Math.max(0, slowFrames - 1);
  }

  function loop(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    draw(now);
    raf = requestAnimationFrame(loop);
  }
  function start() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop); }

  /* ---------- управление ---------- */
  btn.addEventListener('click', function () {
    playing = !playing; setPlayUI();
    if (playing) nextAt = performance.now() + 400;
    start();
  });
  range.addEventListener('input', function () {
    playing = false; setPlayUI();
    setLayer(+range.value, 450); start();
  });
  cv.addEventListener('pointerdown', function (e) {
    drag = { x: e.clientX, y: e.clientY, yaw: yawBase, pitch: pitchUser };
    cv.setPointerCapture(e.pointerId); cv.classList.add('grabbing');
  });
  cv.addEventListener('pointermove', function (e) {
    if (!drag) return;
    yawBase = drag.yaw + (e.clientX - drag.x) * 0.006;
    if (e.pointerType === 'mouse') pitchUser = Math.max(0.5, Math.min(1.42, drag.pitch - (e.clientY - drag.y) * 0.004));
    if (!raf) draw(performance.now());
  });
  function endDrag() { drag = null; cv.classList.remove('grabbing'); lastInput = performance.now(); }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('dblclick', function () { yawBase = 0.32; pitchUser = 0.98; });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      visible = es.some(function (x) { return x.isIntersecting; });
      if (visible) start();
    }, { threshold: 0.05 }).observe(root);
  } else { visible = true; }
  document.addEventListener('visibilitychange', start);
  window.addEventListener('resize', function () { size(); });
  document.addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('[data-lang]')) setTimeout(texts, 0);
  });

  size();
  texts();
  nextAt = performance.now() + 3600;
  visible = visible || root.getBoundingClientRect().top < window.innerHeight;
  if (RM) { tr = 1; cur.set(HL.subarray(0, nC)); draw(performance.now()); }
  start();
})();
