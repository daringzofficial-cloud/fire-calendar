/* Блок «Ожидаемая активность»: типичный диапазон очагов на 3 месяца вперёд для выбранной области.
 * Это не прогноз пожаров, а диапазон по тем же месяцам за последние 10 лет. Для ближайшего месяца
 * центр сдвигается с учётом трёх последних месяцев. Точность проверяется на прошлых годах в браузере. */
(function () {
  'use strict';
  var C = window.FireCore, M = window.FIRE_MODEL, root = document.getElementById('predPanel');
  if (!root || !C || !M) return;
  var WIN = 10, SHRINK = 0.5, LAGS = [1, 2, 3];
  var RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var T = {
    ru: {
      locale: 'ru-RU', title: 'Ожидаемая активность',
      lead: 'Сколько очагов обычно бывает в ближайшие месяцы в выбранной области. Считаем по тем же месяцам за последние {w} лет. Это ориентир, а не прогноз пожаров.',
      typical: 'очагов в типичный месяц', usual: 'Обычно от {a} до {b}', now: 'сейчас уже {x}',
      chipIn: 'идёт, в пределах обычного', chipHi: 'идёт, выше обычного', chipAhead: 'через {h} мес.',
      lgBand: 'обычный диапазон (8 лет из 10)', lgMid: 'типичное значение', lgDot: 'отдельные годы, наведите для числа', lgNow: 'набрано в этом месяце',
      acc: 'Как часто диапазон оправдывался в прошлом (проверка с 2008 года)', acc1: 'на 1 месяц вперёд', acc3: 'на 3 месяца вперёд', goal: 'цель 80%',
      adj: 'Для ближайшего месяца центр сдвинут с учётом трёх последних месяцев. Числа в MODIS-эквиваленте.',
      tooFew: 'В этой области слишком мало очагов для оценки. Выберите участок побольше.'
    },
    en: {
      locale: 'en-GB', title: 'Expected activity',
      lead: 'How many detections the selected area usually has in the coming months, based on the same months over the last {w} years. A guide, not a fire forecast.',
      typical: 'detections in a typical month', usual: 'Usually {a} to {b}', now: 'so far {x}',
      chipIn: 'ongoing, within normal', chipHi: 'ongoing, above normal', chipAhead: 'in {h} mo',
      lgBand: 'usual range (8 years in 10)', lgMid: 'typical value', lgDot: 'single years, hover for value', lgNow: 'so far this month',
      acc: 'How often the range held in the past (backtest from 2008)', acc1: '1 month ahead', acc3: '3 months ahead', goal: 'target 80%',
      adj: 'For the nearest month the centre is adjusted for the last three months. Values are MODIS-equivalent.',
      tooFew: 'Too few detections in this area for an estimate. Select a larger area.'
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
  function nums(pts) { return pts.map(function (p) { return p.n; }); }

  // тот же календарный месяц за последние WIN лет, известный на месяц origin
  function same(H, mi, origin) {
    var v = [];
    for (var k = mi % 12; k <= origin; k += 12) {
      if (k !== mi && k > mi - 12 * WIN - 1 && ok(k)) v.push({ y: M.y0 + Math.floor(k / 12), n: H[k] });
    }
    return v;
  }
  function persist(H, origin) {
    var r = [];
    for (var j = origin; j > origin - 3; j--) {
      if (!ok(j)) continue;
      var v = nums(same(H, j, j - 1));
      if (v.length >= 3) r.push(Math.log((H[j] + 1) / (med(v) + 1)));
    }
    return r.length ? r.reduce(function (s, x) { return s + x; }, 0) / r.length : 0;
  }
  function band(H, mi, origin, h) {
    var pts = same(H, mi, origin);
    if (pts.length < 5) return null;
    var v = nums(pts), f = h === 1 ? Math.exp(SHRINK * persist(H, origin)) : 1;
    var sc = function (x) { return Math.max(0, (x + 1) * f - 1); };
    return { c: sc(med(v)), lo: sc(q(v, 0.1)), hi: sc(q(v, 0.9)), pts: pts };
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
  function compute(cur) {
    var H = cur.agg.H, o = M.lastComplete, cards = [];
    LAGS.forEach(function (h) {
      var mi = o + h, b = band(H, mi, o, h);
      if (!b || b.hi < C.MIN_NORM) return;
      var sofar = mi < M.nM && M.hasData[mi] && M.partial[mi] && H[mi] > 0 ? H[mi] : null;
      cards.push({ h: h, mi: mi, b: b, sofar: sofar });
    });
    return { cards: cards, c1: backtest(H, 1), c3: backtest(H, 3) };
  }

  /* ---------- разметка ---------- */
  var built = '', revealed = false, observing = false, nf = null;

  function head(L) {
    return '<div class="panel-head"><h2 id="predTitle">' + L.title + '</h2></div>' +
      '<p class="pred-lead">' + fill(L.lead, { w: WIN }) + '</p>';
  }
  function card(i, L) {
    return '<article class="pc" style="--ci:' + i + '">' +
      '<div class="pc-top"><h3 class="pc-month"></h3><span class="pc-chip"></span></div>' +
      '<p class="pc-big"><span class="pc-num" data-t="0">0</span><span class="pc-unit">' + L.typical + '</span></p>' +
      '<div class="pc-plot"><span class="pc-axis"></span><span class="pc-band"></span><span class="pc-dots"></span>' +
      '<span class="pc-mid"></span><span class="pc-now"><i></i></span></div>' +
      '<div class="pc-scale"><span>0</span><span class="pc-max"></span></div>' +
      '<p class="pc-range"></p></article>';
  }
  function meter(lbl, L) {
    return '<div class="pm"><span>' + lbl + '</span><span class="pm-track"><span class="pm-fill"></span>' +
      '<span class="pm-goal" data-l="' + L.goal + '"></span></span><b class="pm-val" data-t="0" data-s="%">0%</b></div>';
  }
  function skeleton(L, n) {
    var cards = '';
    for (var i = 0; i < n; i++) cards += card(i, L);
    return head(L) + '<div class="pred-cards">' + cards + '</div>' +
      '<ul class="pred-legend">' +
      '<li><span class="lg lg-band"></span>' + L.lgBand + '</li>' +
      '<li><span class="lg lg-mid"></span>' + L.lgMid + '</li>' +
      '<li><span class="lg lg-dot"></span>' + L.lgDot + '</li>' +
      '<li><span class="lg lg-now"></span>' + L.lgNow + '</li></ul>' +
      '<div class="pred-acc"><p class="pred-acc-t">' + L.acc + '</p>' + meter(L.acc1, L) + meter(L.acc3, L) + '</div>' +
      '<p class="hint pred-note">' + L.adj + '</p>';
  }

  /* ---------- анимация чисел ---------- */
  function tick(el) {
    var to = +el.dataset.t || 0, from = +el.dataset.v || 0, suf = el.dataset.s || '';
    el.dataset.v = to;
    if (RM || from === to) { el.textContent = nf.format(Math.round(to)) + suf; return; }
    var t0 = performance.now(), D = 1100;
    (function fr(t) {
      var p = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - p, 3);
      el.textContent = nf.format(Math.round(from + (to - from) * e)) + suf;
      if (p < 1) requestAnimationFrame(fr);
    })(t0);
  }
  function setNum(el, v) { el.dataset.t = v; if (revealed) tick(el); }

  function reveal() {
    if (revealed) return;
    revealed = true;
    root.classList.add('is-in');
    Array.prototype.forEach.call(root.querySelectorAll('[data-t]'), tick);
  }
  function watch() {
    if (observing) return;
    observing = true;
    if (RM || !('IntersectionObserver' in window)) { reveal(); return; }
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { reveal(); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(root);
    // запасная проверка по прокрутке
    function check() {
      var r = root.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.8 && r.bottom > 0) {
        reveal();
        window.removeEventListener('scroll', check);
        window.removeEventListener('resize', check);
      }
    }
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    setTimeout(check, 0);
  }

  /* ---------- заполнение ---------- */
  function apply(L, data) {
    var mf = new Intl.DateTimeFormat(L.locale, { month: 'long', timeZone: 'UTC' });
    var els = root.querySelectorAll('.pc');
    data.cards.forEach(function (d, i) {
      var el = els[i], b = d.b, vals = nums(b.pts);
      var top = Math.max(b.hi, Math.max.apply(null, vals), d.sofar || 0) * 1.06 || 1;
      var P = function (x) { return Math.max(0, Math.min(x, top)) / top * 100; };
      var lo = P(b.lo), hi = P(b.hi), mid = P(b.c);
      el.style.setProperty('--lo', lo.toFixed(2) + '%');
      el.style.setProperty('--hi', hi.toFixed(2) + '%');
      el.style.setProperty('--mid', mid.toFixed(2) + '%');
      el.style.setProperty('--org', (hi > lo ? (mid - lo) / (hi - lo) * 100 : 50).toFixed(1) + '%');
      el.style.setProperty('--now', (d.sofar != null ? P(d.sofar) : 0).toFixed(2) + '%');

      var y = M.y0 + Math.floor(d.mi / 12), name = mf.format(new Date(Date.UTC(y, d.mi % 12, 1)));
      el.querySelector('.pc-month').innerHTML = name.charAt(0).toUpperCase() + name.slice(1) + ' <span>' + y + '</span>';
      var chip = el.querySelector('.pc-chip'), isHi = d.sofar != null && d.sofar > b.hi;
      chip.textContent = d.sofar != null ? (isHi ? L.chipHi : L.chipIn) : fill(L.chipAhead, { h: d.h });
      chip.className = 'pc-chip' + (isHi ? ' hi' : d.sofar != null ? ' live' : '');
      setNum(el.querySelector('.pc-num'), Math.round(b.c));
      el.querySelector('.pc-max').textContent = nf.format(Math.round(top));
      el.querySelector('.pc-now').classList.toggle('off', d.sofar == null);
      el.querySelector('.pc-range').innerHTML = fill(L.usual, { a: nf.format(Math.round(b.lo)), b: nf.format(Math.round(b.hi)) }) +
        (d.sofar != null ? ', <b>' + fill(L.now, { x: nf.format(Math.round(d.sofar)) }) + '</b>' : '');

      // точки отдельных лет; близкие разводим по трём дорожкам
      var dw = el.querySelector('.pc-dots');
      while (dw.children.length < b.pts.length) { var s = document.createElement('span'); s.className = 'pc-dot'; dw.appendChild(s); }
      while (dw.children.length > b.pts.length) dw.removeChild(dw.lastChild);
      var order = b.pts.map(function (p, j) { return { j: j, x: P(p.n) }; }).sort(function (a, c) { return a.x - c.x; });
      var lanes = [-1e9, -1e9, -1e9], off = [0, -10, 10];
      order.forEach(function (o, k) {
        var ln = -1;
        for (var j = 0; j < 3; j++) if (o.x - lanes[j] >= 3.5) { ln = j; break; }
        if (ln < 0) ln = lanes.indexOf(Math.min.apply(null, lanes));
        lanes[ln] = o.x;
        var dot = dw.children[o.j], p = b.pts[o.j];
        dot.style.left = o.x.toFixed(2) + '%';
        dot.style.setProperty('--lane', off[ln] + 'px');
        dot.style.setProperty('--k', k);
        dot.setAttribute('data-tip', p.y + ': ' + nf.format(Math.round(p.n)));
      });
    });

    var acc = root.querySelector('.pred-acc'), ms = root.querySelectorAll('.pm');
    acc.hidden = data.c1 == null || data.c3 == null;
    [data.c1, data.c3].forEach(function (v, i) {
      if (v == null) return;
      ms[i].style.setProperty('--p', v + '%');
      setNum(ms[i].querySelector('.pm-val'), v);
    });
  }

  function render() {
    var cur = window.FIRE_CUR;
    if (!cur) return;
    var lg = lang(), L = T[lg];
    nf = new Intl.NumberFormat(L.locale);
    var data = compute(cur);
    if (!data.cards.length) {
      root.innerHTML = head(L) + '<p class="hint">' + L.tooFew + '</p>';
      built = '';
    } else {
      var key = lg + '|' + data.cards.length;
      if (key !== built) { root.innerHTML = skeleton(L, data.cards.length); built = key; }
      apply(L, data);
    }
    root.hidden = false;
    watch();
  }

  document.addEventListener('fire:update', render);
  document.addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('[data-lang]')) setTimeout(function () { built = ''; render(); }, 0);
  });
  render();
})();
