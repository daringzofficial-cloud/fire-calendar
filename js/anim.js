/* Анимации интерфейса. Работают поверх app.js и live.js и не меняют их логику.
 * Один раз: блоки проявляются при прокрутке, календарь раскрывается волной, графики прорисовываются,
 * числа набегают. Постоянно двигается только «живое»: свежие очаги и текущий месяц.
 * При уменьшении движения в системе всё показывается сразу; в режиме «Меньше деталей» циклы выключены (CSS). */
(function () {
  'use strict';
  var RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var docEl = document.documentElement;
  function $(id) { return document.getElementById(id); }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  if (RM) { docEl.classList.add('no-anim'); }
  else docEl.classList.add('anim');

  /* ---------- появление блоков при прокрутке ---------- */
  var blocks = [];
  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.height > 0 && r.top < window.innerHeight * 0.9 && r.bottom > 0;
  }
  function revealIn(el) {
    if (el.classList.contains('is-in')) return;
    el.classList.add('is-in');
    el.dispatchEvent(new Event('anim:in'));
  }
  function scan() {
    blocks = blocks.filter(function (el) {
      if (inView(el)) { revealIn(el); return false; }
      return true;
    });
    if (!blocks.length) { window.removeEventListener('scroll', scan); window.removeEventListener('resize', scan); }
  }
  function watchBlocks() {
    each(document.querySelectorAll('main .panel, main .verdict'), function (el) {
      if (el.id === 'predPanel') return;            // у блока прогноза своё появление
      if (RM || el.classList.contains('map-panel')) { revealIn(el); return; }
      blocks.push(el);
    });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { revealIn(e.target); io.unobserve(e.target); } });
      }, { threshold: 0.1 });
      blocks.forEach(function (el) { io.observe(el); });
    }
    window.addEventListener('scroll', scan, { passive: true });
    window.addEventListener('resize', scan);
    setTimeout(scan, 30);
  }

  /* ---------- числа: первое число в тексте набегает от нуля ---------- */
  var NUM = /(\d{1,3}(?:[\s  ]\d{3})+|\d+)([.,]\d+)?/;
  function countUp(el, dur) {
    if (RM || !el || el.dataset.counting) return;
    var txt = el.textContent, m = txt.match(NUM);
    if (!m) return;
    var sep = (m[1].match(/[\s  ]/) || [' '])[0];
    var target = parseInt(m[1].replace(/[\s  ]/g, ''), 10);
    if (!(target > 9) || (target >= 1990 && target <= 2100)) return; // годы не крутим
    var pre = txt.slice(0, m.index), post = txt.slice(m.index + m[0].length), dec = m[2] || '';
    var fmt = function (v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, sep); };
    el.dataset.counting = '1';
    var t0 = performance.now(), D = dur || 900;
    (function fr(t) {
      var p = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - p, 3);
      el.textContent = pre + fmt(Math.round(target * e)) + (p < 1 ? '' : dec) + post;
      if (p < 1) requestAnimationFrame(fr); else { el.textContent = txt; delete el.dataset.counting; }
    })(t0);
  }

  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  function onChange(el, fn) {
    if (!el) return;
    new MutationObserver(function () { fn(el); }).observe(el, { childList: true });
  }

  /* ---------- календарь: волна по диагонали, рамка у последнего полного месяца ---------- */
  function prepCalendar(box) {
    var svg = box.querySelector('svg'), M = window.FIRE_MODEL;
    if (!svg) return;
    each(svg.querySelectorAll('rect.cell, rect[fill="#1f1b18"]'), function (r) {
      var col = Math.round((+r.getAttribute('x') - 56) / 58), row = Math.round((+r.getAttribute('y') - 24) / 28);
      var d = Math.min(row, 30) * 18 + col * 14;
      r.style.setProperty('--d', d + 'ms');
      r.classList.add('a-cell');
      var tx = r.nextElementSibling;
      if (tx && tx.tagName.toLowerCase() === 'text') { tx.style.setProperty('--d', d + 70 + 'ms'); tx.classList.add('a-fade'); }
    });
    each(svg.querySelectorAll('path, line'), function (p) { p.classList.add('a-fade'); p.style.setProperty('--d', '700ms'); });
    var cell = M && svg.querySelector('rect.cell[data-mi="' + M.lastComplete + '"]');
    if (cell) {
      var ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      ['x', 'y', 'width', 'height'].forEach(function (a) { ring.setAttribute(a, cell.getAttribute(a)); });
      ring.setAttribute('rx', '3'); ring.setAttribute('class', 'a-latest'); ring.setAttribute('pointer-events', 'none');
      svg.insertBefore(ring, svg.querySelector('#hoverRing') || null);
    }
    replay(box, 'a-run');
  }

  /* ---------- график проверки: линии прорисовываются ---------- */
  function prepVal(box) {
    var svg = box.querySelector('svg');
    if (!svg) return;
    each(svg.querySelectorAll('path[fill="none"]'), function (p, i) {
      p.setAttribute('pathLength', '1'); p.classList.add('a-draw'); p.style.setProperty('--d', i * 200 + 'ms');
    });
    each(svg.querySelectorAll('circle, rect:not(.band)'), function (m, i) {
      m.classList.add('a-pop'); m.style.setProperty('--d', 300 + i * 22 + 'ms');
    });
    replay(box, 'a-run');
  }

  /* ---------- «Последние дни» ---------- */
  function prepLive(panel) {
    var svg = panel.querySelector('.live-chart svg');
    if (svg) {
      var bars = svg.querySelectorAll('rect');
      each(bars, function (r, i) { r.classList.add('a-grow-y'); r.style.setProperty('--d', i * 50 + 'ms'); });
      if (bars.length) bars[bars.length - 1].classList.add('a-today');
      each(svg.querySelectorAll('path'), function (p) { p.classList.add('a-fade'); p.style.setProperty('--d', '550ms'); });
    }
    var hint = panel.querySelector('.panel-head .hint');
    if (hint && !hint.querySelector('.live-dot')) {
      var dot = document.createElement('span');
      dot.className = 'live-dot'; dot.setAttribute('aria-hidden', 'true');
      hint.insertBefore(dot, hint.firstChild);
    }
    if (panel.classList.contains('is-in')) { countUp(panel.querySelector('.live-num'), 1000); replay(panel, 'a-run'); }
  }
  // кольца от очагов последних суток
  function liveMap(hot) {
    var wrap = document.querySelector('.live-map'), cv = $('liveMap');
    if (!wrap || !cv || !hot) return;
    var layer = wrap.querySelector('.ping-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'ping-layer'; layer.setAttribute('aria-hidden', 'true');
      wrap.appendChild(layer);
    }
    layer.style.width = cv.style.width; layer.style.height = cv.style.height;
    layer.innerHTML = '';
    hot.slice(-30).forEach(function (p, i) {
      var s = document.createElement('span');
      s.style.left = p.x + 'px'; s.style.top = p.y + 'px';
      s.style.animationDelay = (i * 0.37 % 2.4).toFixed(2) + 's';
      layer.appendChild(s);
    });
  }

  function prepVerdict() {
    var v = document.querySelector('.verdict');
    if (!v) return;
    each(v.querySelectorAll('#vFacts p'), function (p, i) { p.style.setProperty('--d', 100 + i * 80 + 'ms'); });
    replay(v, 'a-run');
  }

  function init() {
    watchBlocks();
    var cal = $('calendar'), val = $('valChart'), live = $('livePanel'), vh = $('vHead');
    if (cal) { prepCalendar(cal); onChange(cal, prepCalendar); }
    if (val) { prepVal(val); onChange(val, prepVal); }
    document.addEventListener('live:map', function (e) { liveMap(e.detail); });
    if (window.FIRE_LIVE_HOT) liveMap(window.FIRE_LIVE_HOT);
    if (live) {
      if (live.children.length) prepLive(live);
      onChange(live, prepLive);
      live.addEventListener('anim:in', function () { replay(live, 'a-run'); countUp(live.querySelector('.live-num'), 1000); });
    }
    if (vh) onChange(vh, prepVerdict);
    prepVerdict();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
