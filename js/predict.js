/* Блок «Ожидаемая активность»: типичный диапазон очагов на 3 месяца вперёд для выбранной области.
 * Это не прогноз пожаров, а климатический диапазон по последним 10 годам. Для первого месяца
 * учитывается отклонение трёх последних месяцев. Точность проверяется на прошлых годах в браузере. */
(function () {
  'use strict';
  var C = window.FireCore, M = window.FIRE_MODEL, root = document.getElementById('predPanel');
  if (!root || !C || !M) return;
  var WIN = 10, SHRINK = 0.5, LAGS = [1, 2, 3];

  var T = {
    ru: {
      locale: 'ru-RU', title: 'Ожидаемая активность',
      hint: 'Типичный диапазон для выбранной области по последним {w} годам. Это не прогноз пожаров.',
      expected: 'ожидаемо {a}–{b}, центр {c}', sofar: 'уже набрано {x}', unit: 'очагов, MODIS-эквивалент',
      tooFew: 'В этой области слишком мало очагов для оценки. Выберите участок побольше.',
      adj: 'Для ближайшего месяца учтено отклонение трёх последних месяцев от нормы.',
      check: 'Проверка на прошлых годах (с 2008) для этой области: диапазон накрывал фактическое значение в {c1}% случаев на 1 месяц вперёд и в {c3}% на 3 месяца. Заявлено 80%, поэтому выходы за диапазон возможны.',
      noCheck: 'Для этой области проверка на прошлых годах недоступна.',
      range: 'Диапазон 10–90% по {w} годам'
    },
    en: {
      locale: 'en-GB', title: 'Expected activity',
      hint: 'Typical range for the selected area from the last {w} years. This is not a fire forecast.',
      expected: 'expected {a}–{b}, centre {c}', sofar: 'so far {x}', unit: 'detections, MODIS-equivalent',
      tooFew: 'Too few detections in this area for an estimate. Select a larger area.',
      adj: 'For the nearest month, the deviation of the last three months from normal is taken into account.',
      check: 'Backtest on past years (from 2008) for this area: the range contained the actual value {c1}% of the time one month ahead and {c3}% three months ahead. The stated level is 80%, so values outside the range are possible.',
      noCheck: 'A backtest on past years is not available for this area.',
      range: '10–90% range over {w} years'
    }
  };

  function lang() { try { var v = localStorage.getItem('fc-lang'); if (v === 'ru' || v === 'en') return v; } catch (e) { /* нет хранилища */ } return 'ru'; }
  function fill(s, v) { return s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }); }
  function ok(mi) { return mi >= 0 && mi < M.nM && M.hasData[mi] && !M.partial[mi]; }
  function q(a, p) {
    var s = a.slice().sort(function (x, y) { return x - y; }), i = (s.length - 1) * p, l = Math.floor(i), h = Math.ceil(i);
    return s[l] + (s[h] - s[l]) * (i - l);
  }
  function med(a) { return q(a, 0.5); }

  // значения того же календарного месяца за последние WIN лет, известные на месяц origin
  function same(H, mi, origin) {
    var v = [];
    for (var k = mi % 12; k <= origin; k += 12) if (k !== mi && k > mi - 12 * WIN - 1 && ok(k)) v.push(H[k]);
    return v;
  }
  function persist(H, origin) {
    var r = [];
    for (var j = origin; j > origin - 3; j--) {
      if (!ok(j)) continue;
      var v = same(H, j, j - 1);
      if (v.length >= 3) r.push(Math.log((H[j] + 1) / (med(v) + 1)));
    }
    return r.length ? r.reduce(function (s, x) { return s + x; }, 0) / r.length : 0;
  }
  function band(H, mi, origin, h) {
    var v = same(H, mi, origin);
    if (v.length < 5) return null;
    var f = h === 1 ? Math.exp(SHRINK * persist(H, origin)) : 1;
    var sc = function (x) { return Math.max(0, (x + 1) * f - 1); };
    return { c: sc(med(v)), lo: sc(q(v, 0.1)), hi: sc(q(v, 0.9)), n: v.length };
  }
  function backtest(H, h) {
    var n = 0, hit = 0;
    for (var mi = 96; mi <= M.lastComplete; mi++) {
      if (!ok(mi)) continue;
      var b = band(H, mi, mi - h, h);
      if (!b) continue;
      n++;
      if (H[mi] >= b.lo && H[mi] <= b.hi) hit++;
    }
    return n >= 30 ? Math.round(hit / n * 100) : null;
  }

  function render() {
    var cur = window.FIRE_CUR; if (!cur) return;
    var L = T[lang()], nf = new Intl.NumberFormat(L.locale), H = cur.agg.H, origin = M.lastComplete;
    var mf = new Intl.DateTimeFormat(L.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    var rows = '', any = false;
    LAGS.forEach(function (h) {
      var mi = origin + h, b = band(H, mi, origin, h);
      if (!b || b.hi < C.MIN_NORM) return;
      any = true;
      var y = M.y0 + Math.floor(mi / 12), top = Math.max(b.hi, mi < M.nM && M.hasData[mi] ? H[mi] : 0) * 1.15 || 1;
      var pct = function (x) { return (Math.min(x, top) / top * 100).toFixed(1); };
      var name = mf.format(new Date(Date.UTC(y, mi % 12, 1)));
      var sofar = mi < M.nM && M.hasData[mi] && M.partial[mi] && H[mi] > 0 ? H[mi] : null;
      rows += '<div class="pred-row"><div class="pred-name">' + name.charAt(0).toUpperCase() + name.slice(1) + '</div>' +
        '<div class="pred-track" role="img" aria-label="' + fill(L.expected, { a: nf.format(Math.round(b.lo)), b: nf.format(Math.round(b.hi)), c: nf.format(Math.round(b.c)) }) + '">' +
        '<span class="pred-band" style="left:' + pct(b.lo) + '%;width:' + (pct(b.hi) - pct(b.lo)).toFixed(1) + '%"></span>' +
        '<span class="pred-mid" style="left:' + pct(b.c) + '%"></span>' +
        (sofar != null ? '<span class="pred-now" style="left:' + pct(sofar) + '%"></span>' : '') + '</div>' +
        '<div class="pred-txt">' + fill(L.expected, { a: nf.format(Math.round(b.lo)), b: nf.format(Math.round(b.hi)), c: nf.format(Math.round(b.c)) }) +
        (sofar != null ? '<br><span class="pred-sofar">' + fill(L.sofar, { x: nf.format(Math.round(sofar)) }) + '</span>' : '') + '</div></div>';
    });
    var c1 = backtest(H, 1), c3 = backtest(H, 3);
    root.innerHTML = '<div class="panel-head"><h2 id="predTitle">' + L.title + '</h2><p class="hint">' + fill(L.hint, { w: WIN }) + '</p></div>' +
      (any ? '<p class="hint pred-unit">' + L.unit + '</p><div class="pred-rows">' + rows + '</div>' +
        '<p class="hint pred-note">' + L.adj + '</p>' +
        '<p class="hint pred-note">' + (c1 != null && c3 != null ? fill(L.check, { c1: c1, c3: c3 }) : L.noCheck) + '</p>'
        : '<p class="hint">' + L.tooFew + '</p>');
    root.hidden = false;
  }

  document.addEventListener('fire:update', render);
  document.addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('[data-lang]')) setTimeout(render, 0);
  });
  render();
})();
