/* Главная карта: один canvas, два вида. 2D — плоская карта сверху, 3D — объёмные столбцы.
 * Цвет и высота = очаги за год на ячейке 0,25° (MODIS-эквивалент). Слой 0 — норма, дальше годы.
 * Область выбирается через app.js (FIRE_APP.setBbox). Режим «Меньше деталей» снижает нагрузку:
 * без искр, свечения и покачивания, ячейки 0,5° в 3D, не больше 30 кадров в секунду. */
(function () {
  'use strict';
  var M = window.FIRE_MODEL, APP = window.FIRE_APP, I18 = window.FireI18n, root = document.getElementById('mapview');
  if (!root || !M || !APP) return;
  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  function getS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setS(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* нет хранилища */ } }
  function lang() { return getS('fc-lang') === 'en' ? 'en' : 'ru'; }
  function fill(s, v) { return s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }); }
  var RM = mq('(prefers-reduced-motion: reduce)');

  var T = {
    ru: {
      locale: 'ru-RU', viewAria: 'Вид карты', lite: 'Меньше деталей',
      liteTip: 'Экономный режим: без искр и свечения, крупнее участки, меньше нагрузка на компьютер',
      norm: 'Норма', normSub: 'среднее за {a}–{b}',
      firesAll: 'очагов за год, вся страна', firesSel: 'очагов за год в выбранной области',
      normAll: 'очагов в среднем за год, вся страна', normSel: 'очагов в среднем за год в выбранной области',
      pause: 'Пауза', play: 'Смотреть по годам', yearAria: 'Год на карте',
      legend: 'Очагов за год на участке 25 × 25 км',
      tip2: 'Нажмите на карту, чтобы выбрать участок 1° × 1°, или обведите свой прямоугольник мышью.',
      tip3: 'Нажмите, чтобы выбрать участок 1° × 1°. Потяните, чтобы повернуть. Двойной клик вернёт ракурс.',
      aria: 'Карта Казахстана: число очагов по участкам. Область можно задать координатами ниже.'
    },
    en: {
      locale: 'en-GB', viewAria: 'Map view', lite: 'Low detail',
      liteTip: 'Saver mode: no sparks or glow, larger cells, less load on the computer',
      norm: 'Normal', normSub: 'average for {a}–{b}',
      firesAll: 'detections in the year, whole country', firesSel: 'detections in the year in the selected area',
      normAll: 'detections in an average year, whole country', normSel: 'detections in an average year in the selected area',
      pause: 'Pause', play: 'Play years', yearAria: 'Year on the map',
      legend: 'Detections per year on a 25 × 25 km cell',
      tip2: 'Click the map to select a 1° × 1° area, or drag a rectangle with the mouse.',
      tip3: 'Click to select a 1° × 1° area. Drag to rotate. Double-click resets the angle.',
      aria: 'Map of Kazakhstan: number of detections by cell. The area can also be set with coordinates below.'
    }
  };
  var CITIES = [['astana', 51.17, 71.43], ['almaty', 43.24, 76.89], ['aktobe', 50.28, 57.21], ['atyrau', 47.11, 51.92], ['oskemen', 49.95, 82.61],
    ['shymkent', 42.32, 69.6], ['karaganda', 49.8, 73.1], ['kostanay', 53.21, 63.63], ['kyzylorda', 44.85, 65.51]];

  /* ---------- данные: слой 0 = норма, слои 1..NY = годы ---------- */
  var nC = M.cells.length, nM = M.nM, Y0 = M.bY0, Y1 = M.bY1, NY = Y1 - Y0 + 1, L = NY + 1, GD = M.g;
  var V = new Float32Array(L * nC), c, i, k;
  for (c = 0; c < nC; c++) {
    for (i = M.cellStart[c]; i < M.cellStart[c + 1]; i++) {
      var m = M.rowM[i], y = M.y0 + Math.floor(m / 12);
      if (y < Y0 || y > Y1) continue;
      V[(y - Y0 + 1) * nC + c] += M.rowN[i] * M.factor[M.rowS[i] * nM + m];
    }
    var s = 0;
    for (k = 1; k < L; k++) s += V[k * nC + c];
    V[c] = s / NY;
  }
  var sample = [];
  for (i = nC; i < V.length; i += 3) if (V[i] > 0) sample.push(V[i]);
  sample.sort(function (a, b) { return a - b; });
  var CAP = sample.length ? sample[Math.floor(sample.length * 0.985)] : 1, HMAX = 2.6;
  function hOf(v) { return v > 0 ? Math.min(1.15, Math.pow(v / CAP, 0.72)) * HMAX : 0; }

  /* ---------- геометрия: полная сетка 0,25° и укрупнённая 0,5° ---------- */
  var KX = Math.cos(48 * Math.PI / 180), LON0 = 67, LAT0 = 48.2;
  function geom(step) {
    var idx = {}, groups = [];
    for (var c = 0; c < nC; c++) {
      var la = Math.floor(M.cells[c][0] / step + 1e-6) * step, lo = Math.floor(M.cells[c][1] / step + 1e-6) * step, key = la + '|' + lo;
      if (!(key in idx)) { idx[key] = groups.length; groups.push({ la: la, lo: lo, cells: [] }); }
      groups[idx[key]].cells.push(c);
    }
    var n = groups.length, g = {
      n: n, step: step, hx: step * KX / 2, hz: step / 2,
      xc: new Float32Array(n), zc: new Float32Array(n), la: new Float32Array(n), lo: new Float32Array(n),
      H: new Float32Array(L * n), cur: new Float32Array(n), from: new Float32Array(n),
      order: new Uint16Array(n), depth: new Float32Array(n), dim: new Uint8Array(n), top: []
    };
    for (var i = 0; i < n; i++) {
      var gr = groups[i];
      g.la[i] = gr.la; g.lo[i] = gr.lo; g.order[i] = i;
      g.xc[i] = (gr.lo + step / 2 - LON0) * KX; g.zc[i] = gr.la + step / 2 - LAT0;
      for (var k = 0; k < L; k++) {
        var sum = 0;
        for (var j = 0; j < gr.cells.length; j++) sum += V[k * nC + gr.cells[j]];
        g.H[k * n + i] = hOf(sum / gr.cells.length);
      }
    }
    for (k = 0; k < L; k++) {
      var ids = [];
      for (i = 0; i < n; i++) if (g.H[k * n + i] > HMAX * 0.45) ids.push(i);
      ids.sort(function (a, b) { return g.H[k * n + b] - g.H[k * n + a]; });
      g.top.push(ids.slice(0, 22));
    }
    return g;
  }
  var GF = geom(GD), GL = geom(GD * 2), GC = null;

  /* ---------- палитра: от остывшего угля к раскалённому ---------- */
  var STOPS = [[0, [62, 44, 35]], [0.15, [110, 42, 23]], [0.4, [184, 67, 31]], [0.68, [232, 132, 44]], [0.88, [246, 195, 92]], [1, [255, 240, 207]]];
  var BG = [27, 23, 20], NP = 64, PT = [], PS1 = [], PS2 = [], DT = [], DS1 = [], DS2 = [];
  function mix(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  function rgb(a, q) { return 'rgb(' + Math.round(a[0] * q) + ',' + Math.round(a[1] * q) + ',' + Math.round(a[2] * q) + ')'; }
  for (i = 0; i < NP; i++) {
    var f = i / (NP - 1), j = 1;
    while (j < STOPS.length - 1 && STOPS[j][0] < f) j++;
    var a = STOPS[j - 1], b = STOPS[j], col = mix(a[1], b[1], (f - a[0]) / (b[0] - a[0])), dm = mix(col, BG, 0.46);
    PT.push(rgb(col, 1)); PS1.push(rgb(col, 0.74)); PS2.push(rgb(col, 0.54));
    DT.push(rgb(dm, 1)); DS1.push(rgb(dm, 0.84)); DS2.push(rgb(dm, 0.7));
  }
  var GROUND = 'rgb(48,41,37)', GROUND_D = 'rgb(38,33,30)';

  /* ---------- разметка ---------- */
  root.innerHTML =
    '<div class="mv-stage"><canvas class="mv-cv" role="img"></canvas>' +
    '<div class="mv-bar"><div class="seg mv-seg" role="group">' +
    '<button type="button" data-v="0">2D</button><button type="button" data-v="1">3D</button></div>' +
    '<button type="button" class="mv-lite"><span class="mv-sw" aria-hidden="true"></span><span class="mv-lite-l"></span></button>' +
    '<div class="mv-legend"><span class="mv-lg-t"></span><span>0</span><span class="mv-ramp"></span><span class="mv-lg-max"></span></div></div></div>' +
    '<div class="mv-ctrl"><button type="button" class="mv-play"><span class="mv-ico" aria-hidden="true"></span><span class="mv-pl"></span></button>' +
    '<div class="mv-now"><span class="mv-y"></span><span class="mv-n"><b></b> <i></i></span></div>' +
    '<div class="mv-track"><input type="range" class="mv-range" min="0" max="' + NY + '" step="1" value="0">' +
    '<div class="mv-ticks"><span class="mv-t0"></span><span>' + Y1 + '</span></div></div></div>' +
    '<p class="mv-tip"></p>';
  function q(sel) { return root.querySelector(sel); }
  var stage = q('.mv-stage'), cv = q('.mv-cv'), ctx = cv.getContext('2d');
  var elY = q('.mv-y'), elN = q('.mv-n b'), elNl = q('.mv-n i'), btnPlay = q('.mv-play'), range = q('.mv-range'), btnLite = q('.mv-lite');
  var segBtns = root.querySelectorAll('.mv-seg button');

  /* ---------- состояние ---------- */
  var Lx = T[lang()], nf = new Intl.NumberFormat(Lx.locale);
  var W = 0, H = 0, DPR = 1, D = 38, HALF = Math.PI / 2, VDUR = 1300;
  var cam2 = { f: 1, cx: 0, cy: 0 }, cam3 = { f: 1, cx: 0, cy: 0 }, cam = { f: 1, cx: 0, cy: 0, yaw: 0, pitch: HALF };
  var view = getS('fc-view') === '2d' ? 0 : 1, vv = RM ? view : 0, vFrom = 0, vStart = performance.now() + 500;
  var layer = 0, tr = 1, trDur = 700, trStart = 0;
  var litePref = getS('fc-lite');
  var autoLite = RM || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory > 0 && navigator.deviceMemory <= 4) || (mq('(pointer: coarse)') && Math.min(screen.width, screen.height) < 800);
  var lite = litePref === '1' || (litePref === null && autoLite);
  var playing = !RM && !lite, timer = 0;
  var yawBase = 0.32, pitchUser = 0.98, ptr = null, preview = null, clickT = 0;
  var totals = new Float64Array(L), shown = 0, boxKey = 'x';
  var visible = false, raf = 0, dirty = true, cont = false, lastDraw = 0, slow = 0, embers = [];
  var pts = new Float32Array(16);

  function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

  function size() {
    W = stage.clientWidth;
    if (!W) return;
    H = Math.round(Math.max(300, Math.min(600, W * 0.6)));
    DPR = lite ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.height = H + 'px';
    var k2 = Math.min((W - 24) / 28.3, (H - 64) / 15.5);
    cam2.f = k2 * D; cam2.cx = W / 2 + 0.1 * k2; cam2.cy = H / 2 + 22 - 0.25 * k2;
    cam3.f = Math.min(W * (W < 520 ? 1.5 : 1.2), H * 2.05); cam3.cx = W * 0.54; cam3.cy = H * 0.56;
    kick();
  }

  /* ---------- область: приглушение и суммы ---------- */
  function inside(box, lat, lon) { return !box || (lat > box.s && lat < box.n && lon > box.w && lon < box.e); }
  function applyDim() {
    var box = preview || APP.state.bbox, G = GC;
    if (!G) return;
    for (var i = 0; i < G.n; i++) G.dim[i] = inside(box, G.la[i] + G.step / 2, G.lo[i] + G.step / 2) ? 0 : 1;
  }
  function calcTotals() {
    var box = APP.state.bbox;
    for (var k = 0; k < L; k++) {
      var t = 0;
      for (var c = 0; c < nC; c++) if (inside(box, M.cells[c][0] + GD / 2, M.cells[c][1] + GD / 2)) t += V[k * nC + c];
      totals[k] = t;
    }
  }

  /* ---------- подписи ---------- */
  function yearUI() {
    var sel = !!APP.state.bbox;
    if (layer === 0) { elY.textContent = Lx.norm; elNl.textContent = sel ? Lx.normSel : Lx.normAll; }
    else { elY.textContent = Y0 + layer - 1; elNl.textContent = sel ? Lx.firesSel : Lx.firesAll; }
    range.setAttribute('aria-valuetext', layer === 0 ? Lx.norm + ', ' + fill(Lx.normSub, { a: Y0, b: Y1 }) : String(Y0 + layer - 1));
  }
  function ui() {
    each(segBtns, function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-v') === view)); });
    btnLite.setAttribute('aria-pressed', String(lite));
    btnPlay.setAttribute('aria-pressed', String(playing));
    btnPlay.classList.toggle('on', playing);
    q('.mv-pl').textContent = playing ? Lx.pause : Lx.play;
    q('.mv-tip').textContent = view === 1 ? Lx.tip3 : Lx.tip2;
    cv.classList.toggle('v3', view === 1);
    document.documentElement.classList.toggle('lite', lite);
  }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function texts() {
    Lx = T[lang()]; nf = new Intl.NumberFormat(Lx.locale);
    q('.mv-seg').setAttribute('aria-label', Lx.viewAria);
    q('.mv-lite-l').textContent = Lx.lite;
    btnLite.title = Lx.liteTip;
    q('.mv-lg-t').textContent = Lx.legend;
    q('.mv-lg-max').textContent = '≥ ' + nf.format(Math.round(CAP));
    q('.mv-t0').textContent = Lx.norm + ' · ' + Y0;
    range.setAttribute('aria-label', Lx.yearAria);
    cv.setAttribute('aria-label', Lx.aria);
    ui(); yearUI(); shown = totals[layer]; elN.textContent = nf.format(Math.round(shown)); kick();
  }

  /* ---------- слой (год) ---------- */
  function setLayer(k, dur) {
    k = Math.max(0, Math.min(NY, k));
    if (k === layer) return;
    if (GC) GC.from.set(GC.cur);
    layer = k; tr = RM ? 1 : 0; trDur = dur || 700; trStart = performance.now();
    if (RM && GC) GC.cur.set(GC.H.subarray(layer * GC.n, (layer + 1) * GC.n));
    range.value = k; yearUI(); kick();
  }
  function schedule(delay) {
    clearTimeout(timer);
    if (!playing || !visible || document.hidden) return;
    timer = setTimeout(function () {
      var nxt = layer >= NY ? 0 : layer + 1;
      setLayer(nxt, 750);
      schedule(nxt === 0 ? 3200 : nxt === 1 ? 1700 : 1350);
    }, delay);
  }
  function setPlaying(on) { playing = on; ui(); schedule(500); }

  /* ---------- проекция ---------- */
  var cyw = 1, syw = 0, cpp = 0, spp = 1;
  function P(x, yv, z, o) {
    var xr = x * cyw - z * syw, zr = x * syw + z * cyw;
    var v = yv * cpp + zr * spp, d = zr * cpp - yv * spp, kk = cam.f / (D + d);
    pts[o] = cam.cx + xr * kk; pts[o + 1] = cam.cy - v * kk;
  }
  // точка экрана -> долгота и широта на «земле»
  function pick(sx, sy) {
    var qq = cam.cy - sy, den = spp * cam.f - qq * cpp;
    if (den <= 1e-6) return null;
    var zr = qq * D / den, kk = cam.f / (D + zr * cpp), xr = (sx - cam.cx) / kk;
    return { lon: (xr * cyw + zr * syw) / KX + LON0, lat: -xr * syw + zr * cyw + LAT0 };
  }

  /* ---------- кадр ---------- */
  function draw(now) {
    var t0 = performance.now(), i, n;
    if (vv !== view) {
      var p = Math.max(0, Math.min(1, (now - vStart) / VDUR));
      vv = p >= 1 ? view : vFrom + (view - vFrom) * ease(p);
    }
    var G = (lite && (view === 1 || vv > 0)) ? GL : GF;
    if (G !== GC) { GC = G; G.cur.set(G.H.subarray(layer * G.n, (layer + 1) * G.n)); tr = 1; applyDim(); }
    if (tr < 1) {
      tr = Math.min(1, (now - trStart) / trDur);
      var te = ease(tr), base = layer * G.n;
      for (i = 0; i < G.n; i++) G.cur[i] = G.from[i] + (G.H[base + i] - G.from[i]) * te;
    }
    var e = vv;
    cont = !lite && !RM && view === 1 && e > 0.02;
    var sway = cont ? Math.sin(now * 0.00022) * 0.3 : 0;
    cam.yaw = (yawBase + sway) * e; cam.pitch = HALF + (pitchUser - HALF) * e;
    cam.f = cam2.f + (cam3.f - cam2.f) * e; cam.cx = cam2.cx + (cam3.cx - cam2.cx) * e; cam.cy = cam2.cy + (cam3.cy - cam2.cy) * e;
    cyw = Math.cos(cam.yaw); syw = Math.sin(cam.yaw); cpp = Math.cos(cam.pitch); spp = Math.sin(cam.pitch);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // сетка широт и долгот
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(241,236,230,0.07)';
    ctx.font = '11px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = 'rgba(166,156,147,' + (0.9 * (1 - e)).toFixed(2) + ')';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    for (var lo = 50; lo <= 85; lo += 5) {
      ctx.beginPath();
      P((lo - LON0) * KX, 0, 40 - LAT0, 0); ctx.moveTo(pts[0], pts[1]);
      if (e < 0.5) ctx.fillText(lo + '°', pts[0] + 3, Math.min(H - 3, pts[1] - 2));
      P((lo - LON0) * KX, 0, 56 - LAT0, 0); ctx.lineTo(pts[0], pts[1]); ctx.stroke();
    }
    for (var la = 45; la <= 55; la += 5) {
      ctx.beginPath();
      P((46 - LON0) * KX, 0, la - LAT0, 0); ctx.moveTo(pts[0], pts[1]);
      if (e < 0.5) ctx.fillText(la + '°', Math.max(4, pts[0] + 3), pts[1] - 2);
      P((88 - LON0) * KX, 0, la - LAT0, 0); ctx.lineTo(pts[0], pts[1]); ctx.stroke();
    }

    var cur = G.cur, xc = G.xc, zc = G.zc, dim = G.dim, ci, h, d;
    if (e === 0) {
      // плоская карта: простые прямоугольники
      var kk = cam.f / D, rw = 2 * G.hx * kk + 0.6, rh = 2 * G.hz * kk + 0.6;
      for (i = 0; i < G.n; i++) {
        h = cur[i]; d = dim[i];
        if (h < 0.015) ctx.fillStyle = d ? GROUND_D : GROUND;
        else { ci = Math.min(NP - 1, Math.round(h / (HMAX * 1.15) * (NP - 1))); ctx.fillStyle = d ? DT[ci] : PT[ci]; }
        ctx.fillRect(cam.cx + (xc[i] - G.hx) * kk, cam.cy - (zc[i] + G.hz) * kk, rw, rh);
      }
    } else {
      var order = G.order, depth = G.depth, sh = 1 - 0.14 * e, hx = G.hx * sh, hz = G.hz * sh;
      for (i = 0; i < G.n; i++) depth[i] = (xc[i] * syw + zc[i] * cyw) * cpp - cur[i] * e * 0.5 * spp;
      order.sort(function (a, b) { return depth[b] - depth[a]; });
      var showS = cyw > 0, showW = syw > 0;
      for (n = 0; n < G.n; n++) {
        i = order[n]; h = cur[i] * e; d = dim[i];
        var x0 = xc[i] - hx, x1 = xc[i] + hx, z0 = zc[i] - hz, z1 = zc[i] + hz;
        if (h < 0.015) {
          P(x0, 0, z0, 0); P(x1, 0, z0, 2); P(x1, 0, z1, 4); P(x0, 0, z1, 6);
          ctx.fillStyle = cur[i] < 0.015 ? (d ? GROUND_D : GROUND) : (d ? DT : PT)[Math.min(NP - 1, Math.round(cur[i] / (HMAX * 1.15) * (NP - 1)))];
          ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); ctx.lineTo(pts[4], pts[5]); ctx.lineTo(pts[6], pts[7]); ctx.fill();
          continue;
        }
        ci = Math.min(NP - 1, Math.round(cur[i] / (HMAX * 1.15) * (NP - 1)));
        P(x0, h, z0, 0); P(x1, h, z0, 2); P(x1, h, z1, 4); P(x0, h, z1, 6);
        if (!lite || h > 0.2) {
          P(x0, 0, z0, 8); P(x1, 0, z0, 10); P(x1, 0, z1, 12); P(x0, 0, z1, 14);
          ctx.fillStyle = d ? DS1[ci] : PS1[ci];
          ctx.beginPath();
          if (showS) { ctx.moveTo(pts[8], pts[9]); ctx.lineTo(pts[10], pts[11]); ctx.lineTo(pts[2], pts[3]); ctx.lineTo(pts[0], pts[1]); }
          else { ctx.moveTo(pts[14], pts[15]); ctx.lineTo(pts[12], pts[13]); ctx.lineTo(pts[4], pts[5]); ctx.lineTo(pts[6], pts[7]); }
          ctx.fill();
          ctx.fillStyle = d ? DS2[ci] : PS2[ci];
          ctx.beginPath();
          if (showW) { ctx.moveTo(pts[8], pts[9]); ctx.lineTo(pts[14], pts[15]); ctx.lineTo(pts[6], pts[7]); ctx.lineTo(pts[0], pts[1]); }
          else { ctx.moveTo(pts[10], pts[11]); ctx.lineTo(pts[12], pts[13]); ctx.lineTo(pts[4], pts[5]); ctx.lineTo(pts[2], pts[3]); }
          ctx.fill();
        }
        ctx.fillStyle = d ? DT[ci] : PT[ci];
        ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); ctx.lineTo(pts[4], pts[5]); ctx.lineTo(pts[6], pts[7]); ctx.fill();
      }
    }

    // рамка выбранной области
    var box = preview || APP.state.bbox;
    if (box) {
      P((box.w - LON0) * KX, 0, box.s - LAT0, 0); P((box.e - LON0) * KX, 0, box.s - LAT0, 2);
      P((box.e - LON0) * KX, 0, box.n - LAT0, 4); P((box.w - LON0) * KX, 0, box.n - LAT0, 6);
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); ctx.lineTo(pts[4], pts[5]); ctx.lineTo(pts[6], pts[7]); ctx.closePath();
      ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(23,20,18,0.85)'; ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.lineWidth = 1;
    }

    // свечение и искры: только в полном режиме 3D
    if (cont && e > 0.5) {
      var hot = G.top[layer];
      ctx.globalCompositeOperation = 'lighter';
      for (n = 0; n < hot.length; n++) {
        i = hot[n];
        var hh = cur[i] * e;
        if (hh < HMAX * 0.4 || dim[i]) continue;
        P(xc[i], hh, zc[i], 0);
        var r = 3 + hh * 2.6, fl = 0.75 + 0.25 * Math.sin(now * 0.006 + i);
        var gr = ctx.createRadialGradient(pts[0], pts[1], 0, pts[0], pts[1], r * 2.2);
        gr.addColorStop(0, 'rgba(255,190,100,' + (0.28 * fl * e).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = gr; ctx.fillRect(pts[0] - r * 2.2, pts[1] - r * 2.2, r * 4.4, r * 4.4);
        if (Math.random() < 0.03 && embers.length < 50) {
          embers.push({ x: pts[0] + (Math.random() - 0.5) * 6, y: pts[1], vx: (Math.random() - 0.5) * 0.25, vy: -0.3 - Math.random() * 0.5, life: 1, s: 1 + Math.random() * 1.4 });
        }
      }
      for (n = embers.length - 1; n >= 0; n--) {
        var em = embers[n];
        em.x += em.vx + Math.sin(now * 0.003 + n) * 0.15; em.y += em.vy; em.life -= 0.012;
        if (em.life <= 0) { embers.splice(n, 1); continue; }
        ctx.fillStyle = 'rgba(255,' + Math.round(150 + 80 * em.life) + ',90,' + (em.life * 0.85).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(em.x, em.y, em.s * em.life + 0.3, 0, 6.2832); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    } else if (embers.length) embers.length = 0;

    // города
    var names = (I18 && I18[lang()] && I18[lang()].cities) || {};
    ctx.font = '12px "Segoe UI", system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (n = 0; n < (W < 520 ? 5 : CITIES.length); n++) {
      var cc = CITIES[n], cx0 = (cc[2] - LON0) * KX, cz0 = cc[1] - LAT0;
      P(cx0, 0, cz0, 0); P(cx0, (HMAX * 0.5 + 1.1) * e, cz0, 2);
      if (e > 0) { ctx.strokeStyle = 'rgba(241,236,230,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); ctx.stroke(); }
      ctx.fillStyle = '#f1ece6'; ctx.beginPath(); ctx.arc(pts[2], pts[3], 2.5, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(23,20,18,0.9)'; ctx.lineWidth = 1; ctx.stroke();
      var right = pts[2] > W - 110, tx = pts[2] + (right ? -7 : 7), nm = names[cc[0]] || '';
      ctx.textAlign = right ? 'right' : 'left';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(23,20,18,0.85)'; ctx.strokeText(nm, tx, pts[3]);
      ctx.fillStyle = '#f1ece6'; ctx.fillText(nm, tx, pts[3]); ctx.lineWidth = 1;
    }

    // число очагов догоняет выбранный год
    var target = totals[layer];
    if (RM) shown = target; else { shown += (target - shown) * 0.16; if (Math.abs(target - shown) < 1) shown = target; }
    elN.textContent = nf.format(Math.round(shown));

    // если кадры тяжёлые и человек сам не выбирал режим, включаем экономный
    if (cont && litePref === null) {
      if (performance.now() - t0 > 24) { if (++slow > 25) setLite(true, false); } else if (slow > 0) slow--;
    }
  }

  function busy() { return vv !== view || tr < 1 || cont || shown !== totals[layer] || dirty; }
  function loop(now) {
    raf = 0;
    if (!visible || document.hidden || !W) return;
    if (lite && now - lastDraw < 33) { raf = requestAnimationFrame(loop); return; }
    lastDraw = now; dirty = false;
    draw(now);
    if (busy()) raf = requestAnimationFrame(loop);
  }
  function kick() { dirty = true; if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop); }

  /* ---------- переключатели ---------- */
  function setView(v) {
    if (v === view) return;
    vFrom = vv; view = v; vStart = performance.now();
    if (RM) vv = view;
    setS('fc-view', v ? '3d' : '2d');
    preview = null; applyDim(); ui(); kick();
  }
  function setLite(on, manual) {
    lite = on;
    if (manual) { litePref = on ? '1' : '0'; setS('fc-lite', litePref); }
    if (on && playing && !manual) { playing = false; clearTimeout(timer); }
    ui(); size(); kick();
  }
  each(segBtns, function (b) { b.addEventListener('click', function () { setView(+b.getAttribute('data-v')); }); });
  btnLite.addEventListener('click', function () { setLite(!lite, true); });
  btnPlay.addEventListener('click', function () { setPlaying(!playing); });
  range.addEventListener('input', function () { if (playing) { playing = false; clearTimeout(timer); ui(); } setLayer(+range.value, 450); });

  /* ---------- мышь и касания ---------- */
  function pos(ev) { var r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function boxAt(x, y) {
    var g = pick(x, y), B = APP.MAPB;
    if (!g || g.lon < B.w || g.lon > B.e || g.lat < B.s || g.lat > B.n) return null;
    var lon = Math.round(g.lon / GD) * GD, lat = Math.round(g.lat / GD) * GD;
    return APP.snapBox(lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5);
  }
  function choose(box) {
    if (playing) { playing = false; clearTimeout(timer); ui(); }
    APP.setBbox(box);
  }
  cv.addEventListener('pointerdown', function (ev) {
    if (ev.button) return;
    var p = pos(ev);
    ptr = { x0: p.x, y0: p.y, x: p.x, y: p.y, moved: false, type: ev.pointerType, yaw: yawBase, pitch: pitchUser, rot: view === 1 };
    try { cv.setPointerCapture(ev.pointerId); } catch (err) { /* не критично */ }
    if (ptr.rot) cv.classList.add('grabbing');
  });
  cv.addEventListener('pointermove', function (ev) {
    if (!ptr) return;
    var p = pos(ev);
    ptr.x = p.x; ptr.y = p.y;
    if (!ptr.moved && Math.abs(p.x - ptr.x0) + Math.abs(p.y - ptr.y0) > 6) ptr.moved = true;
    if (!ptr.moved) return;
    if (ptr.rot) {
      yawBase = ptr.yaw + (p.x - ptr.x0) * 0.006;
      if (ptr.type === 'mouse') pitchUser = Math.max(0.5, Math.min(1.42, ptr.pitch - (p.y - ptr.y0) * 0.004));
      kick();
    } else if (ptr.type !== 'touch') {
      var a = pick(ptr.x0, ptr.y0), b = pick(p.x, p.y);
      preview = a && b ? APP.snapBox(a.lon, a.lat, b.lon, b.lat) : null;
      applyDim(); kick();
    }
  });
  function up() {
    if (!ptr) return;
    var pt = ptr; ptr = null;
    cv.classList.remove('grabbing');
    if (!pt.moved) {
      var box = boxAt(pt.x0, pt.y0);
      if (!box) return;
      clearTimeout(clickT);
      if (view === 1) clickT = setTimeout(function () { choose(box); }, 240); else choose(box);
    } else if (!pt.rot && pt.type !== 'touch') {
      var b = preview; preview = null;
      if (b) choose(b); else { applyDim(); kick(); }
    }
  }
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', function () { ptr = null; preview = null; cv.classList.remove('grabbing'); applyDim(); kick(); });
  cv.addEventListener('dblclick', function () {
    if (view !== 1) return;
    clearTimeout(clickT); yawBase = 0.32; pitchUser = 0.98; kick();
  });

  /* ---------- события страницы ---------- */
  function onUpdate() {
    var b = APP.state.bbox, key = b ? [b.s, b.w, b.n, b.e].join(',') : '';
    if (key !== boxKey) { boxKey = key; calcTotals(); }
    applyDim(); yearUI(); kick();
  }
  document.addEventListener('fire:update', onUpdate);
  document.addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('[data-lang]')) setTimeout(texts, 0);
  });
  function seen(v) { visible = v; if (v) { kick(); schedule(1200); } else clearTimeout(timer); }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { seen(es.some(function (x) { return x.isIntersecting; })); }, { threshold: 0.05 }).observe(root);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { kick(); schedule(1200); } else clearTimeout(timer); });
  var rt = 0;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(size, 80); });

  calcTotals(); boxKey = '';
  texts();
  size();
  visible = root.getBoundingClientRect().top < window.innerHeight;
  kick();
  schedule(4200);
})();
