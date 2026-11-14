/* Интерфейс календаря пожарной активности. Расчёты лежат в core.js, тексты в i18n.js. */
(function () {
  'use strict';
  var C = window.FireCore, I = window.FireI18n;
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var INK = '#17211f', INK2 = '#47544f', INK3 = '#6f7b77', LINE = '#d3dad7', NEUTRAL = '#8b9794';
  var FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
  // Величина: один оттенок, от светлого к тёмному. Отклонение: синий и красный вокруг серой середины.
  var SEQ = ['#fdebd3', '#fbd3a4', '#f7b46b', '#ef9140', '#de6d22', '#bb4f14', '#8f380e'];
  var DIV = ['#184f95', '#3987e5', '#9ec5f4', '#e9e8e4', '#f4b3a6', '#de5a45', '#9a2a1a'];
  var DIV_EDGES = [0.4, 0.67, 0.9, 1.1, 1.5, 2.5];
  var DIV_LABELS = ['< −60%', '−60…−33%', '−33…−10%', null, '+10…+50%', '+50…+150%', '> +150%'];
  var MAP_EDGES = [1, 3, 7, 12, 20, 40];
  var MAP_LABELS = ['< 1', '1–3', '3–7', '7–12', '12–20', '20–40', '40+'];
  var SERIES = { modis: '#2a78d6', viirs: '#e0762a' };

  function loadLang() {
    try { var v = localStorage.getItem('fc-lang'); if (v === 'ru' || v === 'en') return v; } catch (e) { /* хранилище недоступно */ }
    return 'ru';
  }
  var state = { lang: loadLang(), view: 'anomaly', bbox: null, yFrom: 0, yTo: 0, base: 'all', pin: 0, hover: -1 };

  function t(key, vars) {
    var s = I[state.lang][key];
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? vars[k] : m; });
  }

  if (!window.FIRE_GRID || !C) {
    $('fatal').hidden = false;
    $('fatal').textContent = t('noData');
    $('app').hidden = true;
    return;
  }

  var M = C.build(window.FIRE_GRID);
  var cur = {};
  state.yFrom = M.bY0; state.yTo = M.y1; state.pin = M.lastComplete;

  /* ---------- форматирование ---------- */
  var nf, nf1, nf2, nf3, mLong, mShort, dFmt;
  function setLocale() {
    var loc = I[state.lang].locale;
    nf = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
    nf1 = new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    nf2 = new Intl.NumberFormat(loc, { maximumFractionDigits: 2 });
    nf3 = new Intl.NumberFormat(loc, { maximumFractionDigits: 3 });
    var ml = new Intl.DateTimeFormat(loc, { month: 'long', timeZone: 'UTC' });
    var ms = new Intl.DateTimeFormat(loc, { month: 'short', timeZone: 'UTC' });
    mLong = []; mShort = [];
    for (var cm = 0; cm < 12; cm++) {
      var d = new Date(Date.UTC(2021, cm, 15));
      mLong.push(ml.format(d));
      mShort.push(ms.format(d).replace('.', ''));
    }
    dFmt = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmt(n) { return nf.format(Math.round(n)); }
  function fmtDate(s) { return dFmt.format(new Date(s + 'T00:00:00Z')); }
  function compact(n) {
    n = Math.round(n);
    if (n < 1000) return String(n);
    var s = n < 9950 ? (n / 1000).toFixed(1) : String(Math.round(n / 1000));
    return state.lang === 'ru' ? s.replace('.', ',') + 'к' : s + 'k';
  }
  function pct(r) {
    if (r >= 10) return '×' + Math.round(r);
    var p = Math.round((r - 1) * 100);
    return (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p) + '%';
  }
  function bin(v, edges) {
    for (var i = 0; i < edges.length; i++) if (v < edges[i]) return i;
    return edges.length;
  }
  function textOn(hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? INK : '#ffffff';
  }
  function yearOf(mi) { return M.y0 + Math.floor(mi / 12); }
  function lastDateOf(mi) { return M.meta.last_date[M.sourceDefs[M.source[mi]].sensors[0]]; }
  function srcLabel(mi) {
    var src = M.source[mi], k = M.sourceDefs[src].k;
    var key = { terra: 'srcTerra', modis: 'srcModis', snpp: 'srcSnpp', noaa20: 'srcNoaa20' }[src];
    return t(key, { k: nf3.format(k) });
  }

  /* ---------- расчёт ---------- */
  function baseYears() {
    if (state.base === 'recent') return [M.bY1 - 9, M.bY1];
    if (state.base === 'viirs') return [Math.max(M.bY0, 2012), M.bY1];
    return [M.bY0, M.bY1];
  }
  function recompute() {
    cur.ids = C.select(M, state.bbox);
    cur.agg = C.aggregate(M, cur.ids);
    var b = baseYears();
    cur.an = C.analyze(M, cur.agg, b[0], b[1]);
    cur.val = C.validation(M, cur.agg);
    cur.area = C.area(M, cur.ids);
  }

  /* ---------- легенды ---------- */
  function scaleHTML(title, colors, labels) {
    var h = '<span class="lg-title">' + esc(title) + '</span><span class="scale">';
    for (var i = 0; i < colors.length; i++) {
      h += '<span class="step"><i class="sw" style="background:' + colors[i] + '"></i><span>' + esc(labels[i]) + '</span></span>';
    }
    return h + '</span>';
  }
  function keyHTML(svgInner, label) {
    return '<span class="key"><svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">' + svgInner + '</svg>' + esc(label) + '</span>';
  }

  /* ---------- карта ---------- */
  var MAPB = { w: 46, e: 88, s: 40, n: 56 }, KX = Math.cos(48 * Math.PI / 180);
  var CITIES = [['astana', 51.17, 71.43], ['almaty', 43.24, 76.89], ['shymkent', 42.32, 69.6], ['aktobe', 50.28, 57.21],
    ['karaganda', 49.8, 73.1], ['atyrau', 47.11, 51.92], ['aktau', 43.65, 51.17], ['oral', 51.23, 51.37],
    ['kostanay', 53.21, 63.63], ['pavlodar', 52.29, 76.97], ['oskemen', 49.95, 82.61], ['kyzylorda', 44.85, 65.51],
    ['petropavl', 54.87, 69.14], ['zhezkazgan', 47.8, 67.71]];
  var cv = $('map'), ctx = cv.getContext('2d'), mapW = 0, mapH = 0, dpr = 1, drag = null;

  function sizeMap() {
    mapW = cv.parentElement.clientWidth;
    mapH = Math.round(mapW * (MAPB.n - MAPB.s) / ((MAPB.e - MAPB.w) * KX));
    dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(mapW * dpr); cv.height = Math.round(mapH * dpr);
    cv.style.height = mapH + 'px';
  }
  function px(lon) { return (lon - MAPB.w) / (MAPB.e - MAPB.w) * mapW; }
  function py(lat) { return (MAPB.n - lat) / (MAPB.n - MAPB.s) * mapH; }
  function snapBox(lonA, latA, lonB, latB) {
    var g = M.g;
    var w = Math.max(MAPB.w, Math.floor(Math.min(lonA, lonB) / g) * g), e = Math.min(MAPB.e, Math.ceil(Math.max(lonA, lonB) / g) * g);
    var s = Math.max(MAPB.s, Math.floor(Math.min(latA, latB) / g) * g), n = Math.min(MAPB.n, Math.ceil(Math.max(latA, latB) / g) * g);
    return (e > w && n > s) ? { s: s, w: w, n: n, e: e } : null;
  }
  function drawMap(preview) {
    var box = preview || state.bbox, g = M.g, eps = 1e-9, i, x, y;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, mapW, mapH);
    ctx.fillStyle = '#f6f8f7'; ctx.fillRect(0, 0, mapW, mapH);

    var cw = px(MAPB.w + g) + 0.5, chh = py(MAPB.n - g) + 0.5;
    for (i = 0; i < M.cells.length; i++) {
      var lat = M.cells[i][0], lon = M.cells[i][1];
      var inside = !box || (lat >= box.s - eps && lat < box.n - eps && lon >= box.w - eps && lon < box.e - eps);
      ctx.globalAlpha = inside ? 1 : 0.22;
      ctx.fillStyle = SEQ[bin(M.cellMean[i], MAP_EDGES)];
      ctx.fillRect(px(lon), py(lat + g), cw, chh);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(23,33,31,0.13)'; ctx.lineWidth = 1; ctx.fillStyle = INK3; ctx.font = '11px ' + FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    for (var lo = 50; lo <= 85; lo += 5) {
      x = Math.round(px(lo)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mapH); ctx.stroke();
      ctx.fillText(lo + '°', x + 3, mapH - 3);
    }
    for (var la = 45; la <= 55; la += 5) {
      y = Math.round(py(la)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mapW, y); ctx.stroke();
      ctx.fillText(la + '°', 4, y - 2);
    }

    if (box) {
      x = px(box.w); y = py(box.n);
      var w = px(box.e) - x, h = py(box.s) - y;
      ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.strokeRect(x, y, w, h);
      ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.strokeRect(x, y, w, h);
    }

    var names = I[state.lang].cities;
    ctx.font = '12px ' + FONT; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (i = 0; i < CITIES.length; i++) {
      x = px(CITIES[i][2]); y = py(CITIES[i][1]);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = INK; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      var right = x > mapW - 90;
      ctx.textAlign = right ? 'right' : 'left';
      var tx = x + (right ? -7 : 7);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.strokeText(names[CITIES[i][0]], tx, y);
      ctx.fillStyle = INK; ctx.fillText(names[CITIES[i][0]], tx, y);
    }
  }
  function evPos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function dragBox() {
    var lonA = MAPB.w + drag.x0 / mapW * (MAPB.e - MAPB.w), lonB = MAPB.w + drag.x1 / mapW * (MAPB.e - MAPB.w);
    var latA = MAPB.n - drag.y0 / mapH * (MAPB.n - MAPB.s), latB = MAPB.n - drag.y1 / mapH * (MAPB.n - MAPB.s);
    return snapBox(lonA, latA, lonB, latB);
  }
  cv.addEventListener('pointerdown', function (e) {
    if (e.button) return;
    var p = evPos(e);
    drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    e.preventDefault();
  });
  cv.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var p = evPos(e);
    drag.x1 = Math.max(0, Math.min(mapW, p.x)); drag.y1 = Math.max(0, Math.min(mapH, p.y));
    drawMap(dragBox());
  });
  function endDrag() {
    if (!drag) return;
    var dx = Math.abs(drag.x1 - drag.x0), dy = Math.abs(drag.y1 - drag.y0), box = dragBox();
    if (dx <= 5 && dy <= 5) {
      // простое нажатие: участок 1 x 1 градус вокруг точки
      var lon = MAPB.w + drag.x0 / mapW * (MAPB.e - MAPB.w), lat = MAPB.n - drag.y0 / mapH * (MAPB.n - MAPB.s);
      lon = Math.round(lon / M.g) * M.g; lat = Math.round(lat / M.g) * M.g;
      box = snapBox(lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5);
    }
    drag = null;
    if (box) setBbox(box); else drawMap();
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  function setBbox(box) {
    state.bbox = box;
    $('bS').value = box ? box.s : ''; $('bN').value = box ? box.n : '';
    $('bW').value = box ? box.w : ''; $('bE').value = box ? box.e : '';
    $('bboxError').hidden = true;
    update();
  }
  $('bboxForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var s = parseFloat($('bS').value), n = parseFloat($('bN').value), w = parseFloat($('bW').value), ea = parseFloat($('bE').value);
    var box = (isFinite(s) && isFinite(n) && isFinite(w) && isFinite(ea) && s < n && w < ea) ? snapBox(w, s, ea, n) : null;
    if (!box) { $('bboxError').textContent = t('bboxError'); $('bboxError').hidden = false; return; }
    setBbox(box);
  });
  $('resetBtn').addEventListener('click', function () { setBbox(null); });

  function renderRegion() {
    $('mapLegend').innerHTML = scaleHTML(t('mapLegend', { g: nf2.format(M.g), b0: M.bY0, b1: M.bY1 }), SEQ, MAP_LABELS);
    var b = state.bbox, a = fmt(cur.area / 1000);
    $('regionInfo').textContent = !cur.ids.length ? '' : b
      ? t('regionBox', { s: nf2.format(b.s), n: nf2.format(b.n), w: nf2.format(b.w), e: nf2.format(b.e), cells: fmt(cur.ids.length), area: a })
      : t('regionAll', { cells: fmt(cur.ids.length), area: a });
  }

  /* ---------- вывод о последнем месяце ---------- */
  function renderVerdict() {
    var head = $('vHead'), facts = $('vFacts');
    $('vWhere').textContent = cur.ids.length ? t('vWhere') : '';
    if (!cur.ids.length) { head.textContent = t('regionEmpty'); facts.innerHTML = ''; return; }
    var mi = M.lastComplete, cm = mi % 12, y = yearOf(mi);
    var H = cur.agg.H[mi], norm = cur.an.norm[cm], r = cur.an.ratio[mi];
    var month = cap(mLong[cm]) + ' ' + y, text, color;
    if (isNaN(r)) { text = t('vLow', { month: month }); color = '#c9d0cd'; }
    else {
      color = DIV[bin(r, DIV_EDGES)];
      if (r >= 3) text = t('vTimes', { month: month, x: nf1.format(r) });
      else if (r >= 1.1) text = t('vAbove', { month: month, p: Math.round((r - 1) * 100) });
      else if (r < 0.9) text = t('vBelow', { month: month, p: Math.round((1 - r) * 100) });
      else text = t('vNear', { month: month });
    }
    head.innerHTML = '<span class="chip" style="background:' + color + '"></span>' + esc(text);

    var ps = [];
    ps.push(isNaN(r) ? t('vFactsLow', { n: fmt(H), min: C.MIN_NORM })
      : t('vFacts', { n: fmt(H), norm: fmt(norm), y0: M.bY0, rank: cur.an.rank[mi], of: cur.an.rankOf[cm] }));
    var yr = cur.an.years[y - M.bY0];
    if (yr && yr.months > 1 && !isNaN(yr.ratio)) {
      ps.push(t('vYtd', { month: mLong[yr.lastCm], year: y, n: fmt(yr.total), dev: pct(yr.ratio) }));
    }
    var pk = cur.an.peakMonth;
    if (cur.an.annualNorm >= C.MIN_NORM) {
      ps.push(t('vPeak', { month: mLong[pk], n: fmt(cur.an.norm[pk]), share: Math.round(cur.an.norm[pk] / cur.an.annualNorm * 100) }));
    }
    var nx = mi + 1;
    if (nx < M.nM && M.hasData[nx] && M.partial[nx]) {
      ps.push(t('vPartial', { month: cap(mLong[nx % 12]), year: yearOf(nx), date: fmtDate(lastDateOf(nx)), n: fmt(cur.agg.H[nx]) }));
    }
    facts.innerHTML = ps.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
  }

  /* ---------- календарь ---------- */
  var CAL = { L: 56, cw: 58, ch: 28, gap: 2, top: 24, barMax: 84, rightGap: 16, labelW: 124, normH: 54 };

  function calendarSVG(forExport) {
    var anomaly = state.view === 'anomaly', years = [], y, cm, mi, i;
    for (y = state.yTo; y >= state.yFrom; y--) years.push(y);
    var head = forExport ? 62 : 0, foot = forExport ? 28 : 0;
    var x0R = CAL.L + 12 * CAL.cw + CAL.rightGap;
    var W = x0R + CAL.barMax + CAL.labelW;
    var rowsTop = head + CAL.top;
    var normTop = rowsTop + years.length * CAL.ch + 12;
    var Hh = normTop + CAL.normH + 6 + foot;
    var w = CAL.cw - CAL.gap, h = CAL.ch - CAL.gap;
    var H = cur.agg.H, an = cur.an;

    // шкала для режима "число очагов": корень, верх на 98-м процентиле показанных месяцев
    var vals = [], maxTotal = 1, anyPartial = false;
    for (i = 0; i < years.length; i++) {
      for (cm = 0; cm < 12; cm++) {
        mi = (years[i] - M.y0) * 12 + cm;
        if (M.hasData[mi] && !M.partial[mi]) vals.push(H[mi]);
      }
      var yrr = an.years[years[i] - M.bY0];
      if (yrr) { maxTotal = Math.max(maxTotal, yrr.total); if (!yrr.complete) anyPartial = true; }
    }
    vals.sort(function (a, b) { return a - b; });
    var seqMax = Math.max(1, vals.length ? vals[Math.floor(0.98 * (vals.length - 1))] : 1);
    cur.seqEdges = [];
    for (i = 1; i < SEQ.length; i++) cur.seqEdges.push(seqMax * Math.pow(i / SEQ.length, 2));

    var o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + Hh + '" width="' + W + '" height="' + Hh +
      '" font-family=\'' + FONT + '\' font-size="12" style="font-variant-numeric:tabular-nums">'];
    if (forExport) {
      var b = state.bbox;
      var where = b ? t('exportBox', { s: nf2.format(b.s), n: nf2.format(b.n), w: nf2.format(b.w), e: nf2.format(b.e) }) : t('exportAll');
      o.push('<rect width="' + W + '" height="' + Hh + '" fill="#ffffff"/>');
      o.push('<text x="' + CAL.L + '" y="26" font-size="18" font-weight="600" fill="' + INK + '">' + esc(t('exportTitle')) + '</text>');
      o.push('<text x="' + CAL.L + '" y="46" font-size="13" fill="' + INK2 + '">' + esc(where + '. ' +
        (anomaly ? t('viewAnomaly') : t('viewCount')) + '. ' + t('dNorm', { a: an.bY0, b: an.bY1 }) + '.') + '</text>');
      o.push('<text x="' + CAL.L + '" y="' + (Hh - 9) + '" font-size="11" fill="' + INK3 + '">NASA FIRMS: MODIS C6.1, VIIRS 375 m C2</text>');
    }
    for (cm = 0; cm < 12; cm++) {
      o.push('<text x="' + (CAL.L + cm * CAL.cw + w / 2) + '" y="' + (rowsTop - 8) + '" text-anchor="middle" fill="' + INK2 + '">' + esc(cap(mShort[cm])) + '</text>');
    }
    o.push('<text x="' + x0R + '" y="' + (rowsTop - 8) + '" fill="' + INK2 + '">' + esc(t('yearCol')) + '</text>');

    for (i = 0; i < years.length; i++) {
      y = years[i];
      var yy = rowsTop + i * CAL.ch;
      o.push('<text x="' + (CAL.L - 10) + '" y="' + (yy + h / 2 + 4.5) + '" text-anchor="end" font-size="13" fill="' + INK + '">' + y + '</text>');
      for (cm = 0; cm < 12; cm++) {
        mi = (y - M.y0) * 12 + cm;
        var x = CAL.L + cm * CAL.cw;
        if (!M.hasData[mi]) { o.push('<rect x="' + x + '" y="' + yy + '" width="' + w + '" height="' + h + '" rx="2" fill="#f3f5f4"/>'); continue; }
        var r = an.ratio[mi], fill, label, tfill, extra = '';
        var tip = cap(mLong[cm]) + ' ' + y + ': ' + fmt(H[mi]);
        if (M.partial[mi]) {
          fill = '#ffffff'; label = compact(H[mi]); tfill = INK2;
          extra = ' stroke="' + INK3 + '" stroke-dasharray="3 2"';
          tip += ' (' + t('partialNote') + ')';
        } else if (anomaly) {
          if (isNaN(r)) { fill = '#f1f3f2'; label = compact(H[mi]); tfill = INK3; }
          else { fill = DIV[bin(r, DIV_EDGES)]; label = pct(r); tfill = textOn(fill); tip += ', ' + pct(r); }
        } else {
          fill = SEQ[H[mi] <= 0 ? 0 : bin(H[mi], cur.seqEdges)]; label = compact(H[mi]); tfill = textOn(fill);
        }
        o.push('<rect class="cell" data-mi="' + mi + '" x="' + x + '" y="' + yy + '" width="' + w + '" height="' + h + '" rx="2" fill="' + fill + '"' + extra + '><title>' + esc(tip) + '</title></rect>');
        o.push('<text x="' + (x + w / 2) + '" y="' + (yy + h / 2 + 4) + '" text-anchor="middle" font-size="11.5" fill="' + tfill + '" pointer-events="none">' + esc(label) + '</text>');
        if (M.nrt[mi]) {
          o.push('<path d="M' + (x + w - 7) + ' ' + yy + 'h7v7z" fill="' + (tfill === '#ffffff' ? '#ffffff' : INK) + '" fill-opacity="0.75" pointer-events="none"/>');
        }
        if (cm > 0 && M.hasData[mi - 1] && M.source[mi] !== M.source[mi - 1]) {
          o.push('<line x1="' + (x - 1) + '" y1="' + (yy - 2) + '" x2="' + (x - 1) + '" y2="' + (yy + h + 2) + '" stroke="' + INK + '" stroke-width="2.5" pointer-events="none"/>');
        }
      }
      var yr = an.years[y - M.bY0];
      if (yr && yr.months > 0) {
        var bw = Math.max(2, yr.total / maxTotal * CAL.barMax);
        var bfill = !anomaly ? SEQ[3] : isNaN(yr.ratio) ? NEUTRAL : DIV[bin(yr.ratio, DIV_EDGES)];
        o.push('<rect x="' + x0R + '" y="' + (yy + 5) + '" width="' + bw.toFixed(1) + '" height="' + (h - 10) + '" rx="2" fill="' + bfill + '"/>');
        var lab = fmt(yr.total) + (anomaly && !isNaN(yr.ratio) ? '  ' + pct(yr.ratio) : '') + (yr.complete ? '' : ' *');
        o.push('<text x="' + (x0R + bw + 6).toFixed(1) + '" y="' + (yy + h / 2 + 4) + '" font-size="11.5" fill="' + INK2 + '" xml:space="preserve">' + esc(lab) + '</text>');
      }
    }

    // строка нормы: сезонный ход
    var base = normTop + CAL.normH, maxN = 0;
    for (cm = 0; cm < 12; cm++) maxN = Math.max(maxN, an.norm[cm]);
    o.push('<text x="' + (CAL.L - 10) + '" y="' + (base - 4) + '" text-anchor="end" fill="' + INK2 + '">' + esc(t('normRow')) + '</text>');
    o.push('<line x1="' + CAL.L + '" y1="' + (base + 0.5) + '" x2="' + (CAL.L + 12 * CAL.cw - CAL.gap) + '" y2="' + (base + 0.5) + '" stroke="' + LINE + '"/>');
    for (cm = 0; cm < 12; cm++) {
      var bh = maxN > 0 ? an.norm[cm] / maxN * (CAL.normH - 18) : 0;
      var bx = CAL.L + cm * CAL.cw + 12;
      if (bh > 0.5) o.push('<rect x="' + bx + '" y="' + (base - bh).toFixed(1) + '" width="' + (w - 24) + '" height="' + bh.toFixed(1) + '" rx="2" fill="' + NEUTRAL + '"/>');
      o.push('<text x="' + (CAL.L + cm * CAL.cw + w / 2) + '" y="' + (base - bh - 4).toFixed(1) + '" text-anchor="middle" font-size="11" fill="' + INK2 + '">' + esc(compact(an.norm[cm])) + '</text>');
    }
    if (anyPartial) o.push('<text x="' + x0R + '" y="' + (base - 4) + '" font-size="11.5" fill="' + INK3 + '">* ' + esc(t('partialNote')) + '</text>');

    if (!forExport) {
      o.push('<rect id="hoverRing" width="' + w + '" height="' + h + '" rx="2" fill="none" stroke="' + INK + '" stroke-width="1.5" pointer-events="none" visibility="hidden"/>');
      o.push('<rect id="pinRing" width="' + (w + 2) + '" height="' + (h + 2) + '" rx="3" fill="none" stroke="' + INK + '" stroke-width="2.5" pointer-events="none" visibility="hidden"/>');
    }
    o.push('</svg>');
    return { svg: o.join(''), w: W, h: Hh };
  }

  function moveRing(id, mi, pad) {
    var el = document.getElementById(id);
    if (!el) return;
    var y = yearOf(mi);
    if (mi < 0 || y > state.yTo || y < state.yFrom) { el.setAttribute('visibility', 'hidden'); return; }
    el.setAttribute('x', CAL.L + (mi % 12) * CAL.cw - pad);
    el.setAttribute('y', CAL.top + (state.yTo - y) * CAL.ch - pad);
    el.setAttribute('visibility', 'visible');
  }

  function renderCalendar() {
    var cal = $('calendar');
    if (!cur.ids.length) { cal.innerHTML = ''; $('calLegend').innerHTML = ''; return; }
    cal.innerHTML = calendarSVG(false).svg;
    moveRing('pinRing', state.pin, 1);

    var anomaly = state.view === 'anomaly', h;
    if (anomaly) {
      var labels = DIV_LABELS.map(function (l) { return l || t('legNear'); });
      h = scaleHTML(t('legAnom'), DIV, labels);
    } else {
      var e = cur.seqEdges, ls = ['< ' + compact(e[0])];
      for (var i = 1; i < e.length; i++) ls.push(compact(e[i - 1]) + '–' + compact(e[i]));
      ls.push('≥ ' + compact(e[e.length - 1]));
      h = scaleHTML(t('legCount'), SEQ, ls);
    }
    h += keyHTML('<rect x="1" y="2" width="20" height="12" rx="2" fill="#fff" stroke="' + INK3 + '" stroke-dasharray="3 2"/>', t('legPartial'));
    h += keyHTML('<rect x="1" y="2" width="20" height="12" rx="2" fill="#e9e8e4"/><path d="M14 2h7v7z" fill="' + INK + '" fill-opacity="0.75"/>', t('legNrt'));
    h += keyHTML('<rect x="1" y="2" width="9" height="12" rx="2" fill="#e9e8e4"/><rect x="12" y="2" width="9" height="12" rx="2" fill="#e9e8e4"/><line x1="11" y1="0" x2="11" y2="16" stroke="' + INK + '" stroke-width="2.5"/>', t('legSeam'));
    if (anomaly) h += keyHTML('<rect x="1" y="2" width="20" height="12" rx="2" fill="#f1f3f2"/><text x="11" y="12" text-anchor="middle" font-size="9" fill="' + INK3 + '">3</text>', t('legLow'));
    $('calLegend').innerHTML = h;
  }

  function miOf(el) {
    var v = el && el.getAttribute ? el.getAttribute('data-mi') : null;
    return v === null ? null : +v;
  }
  var calEl = $('calendar');
  calEl.addEventListener('mouseover', function (e) {
    var mi = miOf(e.target);
    if (mi === null || mi === state.hover) return;
    state.hover = mi; moveRing('hoverRing', mi, 0); renderDetail();
  });
  calEl.addEventListener('mouseleave', function () {
    state.hover = -1; moveRing('hoverRing', -1, 0); renderDetail();
  });
  calEl.addEventListener('click', function (e) {
    var mi = miOf(e.target);
    if (mi === null) return;
    state.pin = mi; moveRing('pinRing', mi, 1); renderDetail();
  });
  calEl.addEventListener('keydown', function (e) {
    var d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 12, ArrowDown: -12 }[e.key];
    if (!d) return;
    e.preventDefault();
    var lo = (state.yFrom - M.y0) * 12, hi = (state.yTo - M.y0) * 12 + 11;
    var n = Math.max(lo, Math.min(hi, state.pin + d));
    state.pin = n; state.hover = -1; moveRing('hoverRing', -1, 0); moveRing('pinRing', n, 1); renderDetail();
  });

  /* ---------- карточка месяца ---------- */
  function renderDetail() {
    var el = $('detail');
    if (!cur.ids.length) { el.innerHTML = ''; return; }
    var mi = state.hover >= 0 ? state.hover : state.pin, cm = mi % 12, y = yearOf(mi);
    var h = '<h3>' + esc(cap(mLong[cm]) + ' ' + y) + '</h3>';
    if (!M.hasData[mi]) { el.innerHTML = h + '<p class="note">' + esc(t('dNone')) + '</p>'; return; }
    var H = cur.agg.H[mi], an = cur.an, r = an.ratio[mi];
    function row(k, v) { return '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'; }
    h += '<div class="big">' + esc(fmt(H)) + '</div><div class="big-label">' + esc(t('dValue')) + '</div><dl>';
    h += row(t('dNorm', { a: an.bY0, b: an.bY1 }), esc(fmt(an.norm[cm])));
    if (!M.partial[mi] && !isNaN(r)) {
      h += row(t('dDev'), '<i style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:' +
        DIV[bin(r, DIV_EDGES)] + '"></i>' + esc(pct(r)));
    }
    if (an.rank[mi]) h += row(t('dRank'), esc(t('dRankVal', { rank: an.rank[mi], of: an.rankOf[cm] })));
    h += row(t('dSource'), esc(srcLabel(mi))) + '</dl>';

    var key = y + '-' + (cm < 9 ? '0' : '') + (cm + 1), rows = '';
    M.sensors.forEach(function (s, si) {
      var f = M.meta.first_date[s], l = M.meta.last_date[s];
      if (!f || key < f.slice(0, 7) || key > l.slice(0, 7)) return;
      rows += row(I[state.lang].sensors[s] || s, esc(fmt(cur.agg.raw[si][mi])));
    });
    if (rows) h += '<p class="raw-title">' + esc(t('dRaw')) + '</p><dl>' + rows + '</dl>';
    if (M.partial[mi]) h += '<p class="note">' + esc(t('dPartial', { date: fmtDate(lastDateOf(mi)) })) + '</p>';
    else if (isNaN(r)) h += '<p class="note">' + esc(t('dLow', { min: C.MIN_NORM })) + '</p>';
    if (M.nrt[mi]) h += '<p class="note">' + esc(t('dNrt')) + '</p>';
    el.innerHTML = h + '<p class="tip">' + esc(t('dHint')) + '</p>';
  }

  /* ---------- проверка согласования ---------- */
  function niceMax(v) {
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), m = v / p;
    var steps = [1, 2, 4, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (m <= steps[i]) return steps[i] * p;
    return 10 * p;
  }
  function valSummary() {
    var v = cur.val;
    return t('valSummary', { r: nf3.format(v.ratio), k: nf3.format(v.kNational), c: nf2.format(v.corr) });
  }
  function renderValidation() {
    var v = cur.val, k = nf3.format(v.kNational), chart = $('valChart'), read = $('valRead');
    var ys = v.years.filter(function (q) { return q.months >= 11; });
    var sum = 0, vmax = 0;
    ys.forEach(function (q) { sum += q.modis; vmax = Math.max(vmax, q.modis, q.viirs); });
    if (!cur.ids.length || sum < 50 || isNaN(v.corr)) {
      chart.innerHTML = ''; $('valLegend').innerHTML = ''; read.textContent = t('valEmpty'); return;
    }
    $('valLegend').innerHTML =
      keyHTML('<line x1="0" y1="8" x2="22" y2="8" stroke="' + SERIES.modis + '" stroke-width="2"/><circle cx="11" cy="8" r="4" fill="' + SERIES.modis + '" stroke="#fff" stroke-width="1.5"/>', t('valModis')) +
      keyHTML('<line x1="0" y1="8" x2="22" y2="8" stroke="' + SERIES.viirs + '" stroke-width="2"/><rect x="7.5" y="4.5" width="7" height="7" fill="#fff" stroke="' + SERIES.viirs + '" stroke-width="2"/>', t('valViirs', { k: k }));

    var W = 620, Hh = 250, ml = 58, mr = 12, mt = 12, mb = 28, n = ys.length;
    var ymax = niceMax(vmax), bw = (W - ml - mr) / n;
    function X(i) { return ml + (i + 0.5) * bw; }
    function Y(val) { return mt + (1 - val / ymax) * (Hh - mt - mb); }
    var o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="' + esc(t('valAria')) +
      '" font-family=\'' + FONT + '\' font-size="11.5" style="font-variant-numeric:tabular-nums">'];
    [0, 0.5, 1].forEach(function (f) {
      var yy = Math.round(Y(ymax * f)) + 0.5;
      o.push('<line x1="' + ml + '" y1="' + yy + '" x2="' + (W - mr) + '" y2="' + yy + '" stroke="' + (f === 0 ? '#aab4b1' : '#e6eae9') + '"/>');
      o.push('<text x="' + (ml - 8) + '" y="' + (yy + 4) + '" text-anchor="end" fill="' + INK3 + '">' + esc(fmt(ymax * f)) + '</text>');
    });
    var pm = '', pv = '';
    ys.forEach(function (q, i) {
      o.push('<text x="' + X(i).toFixed(1) + '" y="' + (Hh - 9) + '" text-anchor="middle" fill="' + INK3 + '">' + q.year + '</text>');
      pm += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(q.modis).toFixed(1);
      pv += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(q.viirs).toFixed(1);
    });
    o.push('<line id="valGuide" y1="' + mt + '" y2="' + (Hh - mb) + '" stroke="' + INK3 + '" stroke-dasharray="3 3" visibility="hidden"/>');
    o.push('<path d="' + pm + '" fill="none" stroke="' + SERIES.modis + '" stroke-width="2" stroke-linejoin="round"/>');
    o.push('<path d="' + pv + '" fill="none" stroke="' + SERIES.viirs + '" stroke-width="2" stroke-linejoin="round"/>');
    ys.forEach(function (q, i) {
      o.push('<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(q.modis).toFixed(1) + '" r="4" fill="' + SERIES.modis + '" stroke="#fff" stroke-width="1.5"/>');
      o.push('<rect x="' + (X(i) - 3.5).toFixed(1) + '" y="' + (Y(q.viirs) - 3.5).toFixed(1) + '" width="7" height="7" fill="#fff" stroke="' + SERIES.viirs + '" stroke-width="2"/>');
    });
    ys.forEach(function (q, i) {
      o.push('<rect class="band" data-i="' + i + '" x="' + (ml + i * bw).toFixed(1) + '" y="' + mt + '" width="' + bw.toFixed(1) + '" height="' + (Hh - mt - mb) + '" fill="transparent"/>');
    });
    o.push('</svg>');
    chart.innerHTML = o.join('');
    read.textContent = valSummary();

    var guide = document.getElementById('valGuide');
    chart.onmouseover = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-i');
      if (a === null || a === undefined) return;
      var q = ys[+a];
      guide.setAttribute('x1', X(+a)); guide.setAttribute('x2', X(+a)); guide.setAttribute('visibility', 'visible');
      read.textContent = t('valYear', { y: q.year, m: fmt(q.modis), k: k, v: fmt(q.viirs), d: q.modis > 0 ? pct(q.viirs / q.modis) : '—' });
    };
    chart.onmouseleave = function () { guide.setAttribute('visibility', 'hidden'); read.textContent = valSummary(); };
  }

  /* ---------- как посчитано ---------- */
  function renderMethod() {
    var m = M.meta, c = M.cal;
    var ry = Object.keys(c.ratio_by_year).map(function (k) { return c.ratio_by_year[k]; });
    var nrtStart = Object.keys(m.nrt_from_by_sensor).map(function (k) { return m.nrt_from_by_sensor[k]; }).sort()[0];
    var vars = {
      t0: fmtDate(m.first_date.modis_terra), a0: fmtDate(m.first_date.modis_aqua),
      s0: fmtDate(m.first_date.viirs_snpp), n0: fmtDate(m.first_date.viirs_noaa20), end: fmtDate(M.dataEnd),
      g: nf2.format(M.g), conf: m.filters.min_conf_modis, cells: m.static_cells, dropped: fmt(m.dropped_static),
      kT: nf2.format(c.terra_only_to_modis), kS: nf3.format(c.viirs_snpp_to_modis), kN: nf3.format(c.viirs_noaa20_to_modis),
      sEnd: fmtDate(m.last_date.viirs_snpp),
      o0: mLong[+c.overlap_months[0].slice(5) - 1] + ' ' + c.overlap_months[0].slice(0, 4),
      o1: mLong[+c.overlap_months[1].slice(5) - 1] + ' ' + c.overlap_months[1].slice(0, 4),
      on: c.overlap_months[2], corr: nf2.format(c.monthly_correlation),
      rmin: nf2.format(Math.min.apply(null, ry)), rmax: nf2.format(Math.max.apply(null, ry)),
      min: C.MIN_NORM, nrt: nrtStart ? fmtDate(nrtStart + '-01') : '—'
    };
    $('method').innerHTML = I[state.lang].method.map(function (s) {
      return '<li>' + esc(s.replace(/\{(\w+)\}/g, function (q, k) { return k in vars ? vars[k] : q; })) + '</li>';
    }).join('');
  }

  /* ---------- выгрузка ---------- */
  function download(blob, name) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function fileStem() {
    var b = state.bbox;
    return 'fire-calendar_' + (b ? [b.s, b.w, b.n, b.e].join('_') : 'KZ') + '_' + state.yFrom + '-' + state.yTo;
  }
  $('csvBtn').addEventListener('click', function () {
    if (!cur.ids.length) return;
    var csv = C.toCSV(M, cur.agg, cur.an, state.yFrom, state.yTo, state.bbox);
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), fileStem() + '.csv');
  });
  $('pngBtn').addEventListener('click', function () {
    if (!cur.ids.length) return;
    var r = calendarSVG(true), img = new Image();
    var url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = r.w * 2; c.height = r.h * 2;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(function (b) { if (b) download(b, fileStem() + '_' + state.view + '.png'); }, 'image/png');
    };
    img.src = url;
  });

  /* ---------- управление ---------- */
  function fillSelects() {
    var yf = $('yFrom'), yt = $('yTo'), h = '';
    for (var y = M.bY0; y <= M.y1; y++) h += '<option value="' + y + '">' + y + '</option>';
    yf.innerHTML = h; yt.innerHTML = h;
    yf.value = state.yFrom; yt.value = state.yTo;
  }
  function fillBase() {
    var b = $('base');
    b.innerHTML = '<option value="all">' + esc(t('baseAll', { a: M.bY0, b: M.bY1 })) + '</option>' +
      '<option value="recent">' + esc(t('baseRecent', { a: M.bY1 - 9, b: M.bY1 })) + '</option>' +
      '<option value="viirs">' + esc(t('baseViirs', { a: Math.max(M.bY0, 2012), b: M.bY1 })) + '</option>';
    b.value = state.base;
  }
  function onYears() {
    var a = +$('yFrom').value, b = +$('yTo').value;
    if (a > b) { var x = a; a = b; b = x; $('yFrom').value = a; $('yTo').value = b; }
    state.yFrom = a; state.yTo = b;
    renderCalendar();
  }
  $('yFrom').addEventListener('change', onYears);
  $('yTo').addEventListener('change', onYears);
  $('base').addEventListener('change', function () { state.base = this.value; update(); });
  $('viewSeg').addEventListener('click', function (e) {
    var v = e.target.getAttribute('data-view');
    if (!v || v === state.view) return;
    state.view = v;
    this.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === v)); });
    renderCalendar();
  });
  document.querySelectorAll('[data-lang]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.lang = b.getAttribute('data-lang');
      try { localStorage.setItem('fc-lang', state.lang); } catch (e) { /* хранилище недоступно */ }
      setLocale(); applyStatic(); renderAll();
    });
  });

  function applyStatic() {
    document.documentElement.lang = state.lang;
    document.title = t('docTitle');
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $('subtitle').textContent = t('subtitle', { y0: M.bY0, y1: M.y1 });
    document.querySelectorAll('[data-lang]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === state.lang));
    });
    cv.setAttribute('aria-label', t('mapAria'));
    calEl.setAttribute('aria-label', t('calAria'));
    fillBase();
  }
  function renderAll() {
    drawMap(); renderRegion(); renderVerdict(); renderCalendar(); renderDetail(); renderValidation(); renderMethod();
  }
  function update() { recompute(); renderAll(); }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { sizeMap(); drawMap(); }, 80);
  });

  setLocale(); fillSelects(); applyStatic(); sizeMap(); update();
})();
