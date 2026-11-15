/* Блок «Последние дни»: свежие очаги VIIRS NOAA-20 (NRT) из data/processed/recent.json.
 * Файл обновляет GitHub Actions (.github/workflows/recent.yml). Норму берём из модели сайта. */
(function () {
  'use strict';
  var C = window.FireCore, M = window.FIRE_MODEL, root = document.getElementById('livePanel');
  if (!root || !C || !M) return;

  var T = {
    ru: {
      locale: 'ru-RU', title: 'Последние дни', updated: 'Обновлено {t} UTC',
      week: 'очагов за 7 дней', vs: 'к норме этих дней', normTxt: 'норма {n}',
      noNorm: 'сравнение недоступно', none: 'За последние 10 дней очагов не найдено.',
      chartTitle: 'По дням, MODIS-эквивалент', normLbl: 'норма', todayLbl: 'день не закончен',
      mapLbl: 'Очаги за 10 дней на ячейках {g}°; тёмные: за последние сутки',
      chartAria: 'Очаги по дням за последние 10 дней', mapAria: 'Карта свежих очагов',
      note: 'Данные VIIRS NOAA-20 в режиме NRT, приведены к MODIS-эквиваленту (×{k}). Они предварительные: часть точек может не быть пожаром. Это наблюдение, а не прогноз.',
      loadFail: 'Свежие данные пока недоступны.'
    },
    en: {
      locale: 'en-GB', title: 'Latest days', updated: 'Updated {t} UTC',
      week: 'detections in 7 days', vs: 'vs normal for these days', normTxt: 'normal {n}',
      noNorm: 'no comparison available', none: 'No detections in the last 10 days.',
      chartTitle: 'By day, MODIS-equivalent', normLbl: 'normal', todayLbl: 'day not finished',
      mapLbl: 'Detections in 10 days on {g}° cells; dark: last 24 hours',
      chartAria: 'Detections per day over the last 10 days', mapAria: 'Map of recent detections',
      note: 'VIIRS NOAA-20 near-real-time data, scaled to MODIS-equivalent (×{k}). Data are preliminary: some points may not be fires. This is an observation, not a forecast.',
      loadFail: 'Recent data is not available yet.'
    }
  };

  var data = null, norm = null, lang = 'ru';

  function curLang() {
    try { var v = localStorage.getItem('fc-lang'); if (v === 'ru' || v === 'en') return v; } catch (e) { /* нет хранилища */ }
    return 'ru';
  }
  function fill(s, v) { return s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function dailyNorm(d) {
    var y = +d.slice(0, 4), m = +d.slice(5, 7);
    return norm[m - 1] / new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  function render() {
    lang = curLang();
    var L = T[lang], nf = new Intl.NumberFormat(L.locale);
    var dm = new Intl.DateTimeFormat(L.locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    var dt = new Intl.DateTimeFormat(L.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    var days = data.days, last = days.length - 1;
    var total = days.reduce(function (s, x) { return s + x.n; }, 0);

    var h7 = 0, n7 = 0;
    // 7 законченных дней, без сегодняшнего
    for (var i = last - 7; i < last; i++) { h7 += days[i].h; n7 += dailyNorm(days[i].d); }
    var ratio = n7 >= C.MIN_NORM ? h7 / n7 : NaN;
    var pctTxt = isNaN(ratio) ? L.noNorm :
      (ratio >= 1 ? '+' : '−') + nf.format(Math.round(Math.abs(ratio - 1) * 100)) + '% ' + L.vs;

    var ymax = 1;
    days.forEach(function (x) { ymax = Math.max(ymax, x.h, dailyNorm(x.d)); });
    ymax *= 1.15;
    var W = 560, H = 170, ml = 8, mr = 8, mt = 14, mb = 26, bw = (W - ml - mr) / days.length;
    function Y(v) { return mt + (1 - v / ymax) * (H - mt - mb); }
    var bars = '', line = '';
    days.forEach(function (x, j) {
      var y = Y(x.h), x0 = ml + j * bw + bw * 0.14, w = bw * 0.72, today = j === last;
      bars += '<rect x="' + x0.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) +
        '" height="' + Math.max(0, H - mb - y).toFixed(1) + '" rx="2" fill="var(--accent)"' +
        (today ? ' fill-opacity=".35"' : '') + '><title>' + esc(dm.format(new Date(x.d + 'T00:00:00Z')) + ': ' +
        nf.format(Math.round(x.h)) + (today ? ' (' + L.todayLbl + ')' : '')) + '</title></rect>';
      line += (j ? 'L' : 'M') + (ml + (j + 0.5) * bw).toFixed(1) + ' ' + Y(dailyNorm(x.d)).toFixed(1);
    });
    var lbl = function (j, anchor) {
      return '<text x="' + (ml + (j + 0.5) * bw).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor +
        '" font-size="12" fill="var(--ink-3)">' + esc(dm.format(new Date(days[j].d + 'T00:00:00Z'))) + '</text>';
    };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(L.chartAria) +
      '" style="width:100%;height:auto;display:block">' +
      '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + (H - mb) + '" y2="' + (H - mb) + '" stroke="var(--line)"/>' +
      bars + '<path d="' + line + '" fill="none" stroke="var(--ink-2)" stroke-width="1.5" stroke-dasharray="4 3"/>' +
      lbl(0, 'start') + lbl(last, 'end') +
      '<text x="' + (W - mr) + '" y="10" text-anchor="end" font-size="12" fill="var(--ink-2)">- - ' + esc(L.normLbl) + '</text></svg>';

    var upd = fill(L.updated, { t: dt.format(new Date(data.generated)) });
    root.innerHTML =
      '<div class="panel-head"><h2 id="liveTitle">' + esc(L.title) + '</h2><p class="hint">' + esc(upd) + '</p></div>' +
      (total === 0 ? '<p class="hint">' + esc(L.none) + '</p>' :
      '<div class="live-grid">' +
        '<div class="live-stat"><p class="live-num">' + nf.format(Math.round(h7)) + '</p>' +
        '<p class="live-lbl">' + esc(L.week) + '</p><p class="live-cmp">' + esc(pctTxt) + '</p>' +
        '<p class="live-lbl">' + esc(fill(L.normTxt, { n: nf.format(Math.round(n7)) })) + '</p></div>' +
        '<div class="live-chart"><p class="live-cap">' + esc(L.chartTitle) + '</p>' + svg + '</div>' +
        '<div class="live-map"><canvas id="liveMap" role="img" aria-label="' + esc(L.mapAria) + '"></canvas>' +
        '<p class="hint">' + esc(fill(L.mapLbl, { g: M.g })) + '</p></div></div>') +
      '<p class="hint live-note">' + esc(fill(L.note, { k: String(data.k).replace('.', lang === 'ru' ? ',' : '.') })) + '</p>';
    root.hidden = false;
    drawMap();
  }

  function drawMap() {
    var cv = document.getElementById('liveMap');
    if (!cv) return;
    var s = 40, n = 56, w = 46, e = 88, k = Math.cos(48 * Math.PI / 180);
    var cw = cv.parentNode.clientWidth || 400, ch = Math.round(cw * (n - s) / ((e - w) * k));
    var r = window.devicePixelRatio || 1;
    cv.width = cw * r; cv.height = ch * r; cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    var g = cv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0);
    var X = function (lon) { return (lon - w) / (e - w) * cw; }, Yy = function (lat) { return (n - lat) / (n - s) * ch; };
    g.fillStyle = '#e3e9e7';
    M.cells.forEach(function (c) {
      g.fillRect(X(c[1]), Yy(c[0] + M.g), Math.ceil(M.g / (e - w) * cw) + 0.5, Math.ceil(M.g / (n - s) * ch) + 0.5);
    });
    var newest = data.days[data.days.length - 1].d, prev = data.days[data.days.length - 2].d;
    var hot = [];
    data.cells.slice().sort(function (a, b) { return a[3] < b[3] ? -1 : 1; }).forEach(function (c) {
      var fresh = c[3] === newest || c[3] === prev;
      if (fresh) hot.push({ x: X(c[1] + M.g / 2), y: Yy(c[0] + M.g / 2) });
      g.beginPath();
      g.arc(X(c[1] + M.g / 2), Yy(c[0] + M.g / 2), Math.min(7, 2.5 + Math.sqrt(c[2]) * 1.2), 0, 6.2832);
      g.fillStyle = fresh ? 'rgba(163,42,28,.9)' : 'rgba(163,42,28,.4)';
      g.fill();
    });
    // точки за последние сутки отдаём модулю анимаций (пульсация поверх карты)
    window.FIRE_LIVE_HOT = hot;
    document.dispatchEvent(new CustomEvent('live:map', { detail: hot }));
  }

  function init() {
    var ids = C.select(M, null), an = C.analyze(M, C.aggregate(M, ids));
    norm = an.norm;
    fetch('data/processed/recent.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { data = j; render(); })
      .catch(function () { /* блок остаётся скрытым, если файла нет */ });
  }

  document.addEventListener('click', function (ev) {
    if (data && ev.target.closest && ev.target.closest('[data-lang]')) setTimeout(render, 0);
  });
  var rt = null;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (data) drawMap(); }, 100); });
  init();
})();
