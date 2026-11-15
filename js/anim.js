/* Анимации интерфейса. Работают поверх app.js и live.js и не меняют их логику:
 * блоки проявляются при прокрутке, карта «проявляется» волной, календарь раскрывается
 * диагональной волной, графики прорисовываются, числа набегают. Если в системе включено
 * уменьшение движения, всё показывается сразу. */
(function () {
  'use strict';
  var RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var docEl = document.documentElement;
  if (RM) { docEl.classList.add('no-anim'); return; }
  docEl.classList.add('anim');

  function $(id) { return document.getElementById(id); }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  /* ---------- появление блоков при прокрутке ---------- */
  var blocks = [];
  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.height > 0 && r.top < window.innerHeight * 0.88 && r.bottom > 0;
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
    each(document.querySelectorAll('main .panel, main .verdict'), function (el, i) {
      if (el.id === 'predPanel') return;            // у блока прогноза своя анимация
      el.style.setProperty('--bi', i % 3);
      blocks.push(el);
    });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { revealIn(e.target); io.unobserve(e.target); } });
      }, { threshold: 0.12 });
      blocks.forEach(function (el) { io.observe(el); });
    }
    window.addEventListener('scroll', scan, { passive: true });
    window.addEventListener('resize', scan);
    setTimeout(scan, 30);
  }

  /* ---------- числа ---------- */
  // находит в тексте первое число (с пробелами-разделителями) и прокручивает его от нуля
  var NUM = /(\d{1,3}(?:[\s  ]\d{3})+|\d+)([.,]\d+)?/;
  function countUp(el, dur) {
    if (!el || el.dataset.counting) return;
    var txt = el.textContent, m = txt.match(NUM);
    if (!m) return;
    var sep = (m[1].match(/[\s  ]/) || [' '])[0], dec = m[2] || '';
    var target = parseInt(m[1].replace(/[\s  ]/g, ''), 10);
    if (!(target > 9) || (target >= 1990 && target <= 2100)) return; // годы не крутим
    var pre = txt.slice(0, m.index), post = txt.slice(m.index + m[0].length);
    var fmt = function (v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, sep); };
    el.dataset.counting = '1';
    var t0 = performance.now(), D = dur || 1000;
    (function fr(t) {
      var p = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - p, 3);
      el.textContent = pre + fmt(Math.round(target * e)) + (p < 1 ? '' : dec) + post;
      if (p < 1) requestAnimationFrame(fr); else { el.textContent = txt; delete el.dataset.counting; }
    })(t0);
  }

  /* ---------- повтор анимации у перерисованного элемента ---------- */
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

  /* ---------- календарь: диагональная волна ---------- */
  function prepCalendar(box) {
    var svg = box.querySelector('svg');
    if (!svg) return;
    var x0 = null;
    each(svg.querySelectorAll('rect.cell, rect[fill="#f3f5f4"]'), function (r) {
      var col = Math.round((+r.getAttribute('x') - 56) / 58), row = Math.round((+r.getAttribute('y') - 24) / 28);
      var d = Math.min(row, 30) * 22 + col * 16;
      r.style.setProperty('--d', d + 'ms');
      r.classList.add('a-cell');
      var tx = r.nextElementSibling;
      if (tx && tx.tagName.toLowerCase() === 'text') { tx.style.setProperty('--d', d + 80 + 'ms'); tx.classList.add('a-fade'); }
      if (x0 === null || +r.getAttribute('x') > x0) x0 = +r.getAttribute('x');
    });
    // годовые полоски справа и строка нормы растут
    each(svg.querySelectorAll('rect:not(.cell):not([id]):not([fill="#f3f5f4"]):not([fill="#ffffff"])'), function (r, i) {
      var isNorm = +r.getAttribute('width') < 40 && +r.getAttribute('x') < 56 + 12 * 58;
      r.classList.add(isNorm ? 'a-grow-y' : 'a-grow-x');
      r.style.setProperty('--d', (isNorm ? 700 : 350) + i * 18 + 'ms');
    });
    // уголки NRT и линии смены датчика появляются после ячеек
    each(svg.querySelectorAll('path, line'), function (p) { p.classList.add('a-fade'); p.style.setProperty('--d', '850ms'); });
    replay(box, 'a-run');
  }

  /* ---------- график проверки: линии прорисовываются ---------- */
  function prepVal(box) {
    var svg = box.querySelector('svg');
    if (!svg) return;
    each(svg.querySelectorAll('path[fill="none"]'), function (p, i) {
      p.setAttribute('pathLength', '1');
      p.classList.add('a-draw');
      p.style.setProperty('--d', i * 250 + 'ms');
    });
    each(svg.querySelectorAll('circle, rect:not(.band)'), function (m, i) {
      m.classList.add('a-pop');
      m.style.setProperty('--d', 300 + i * 28 + 'ms');
    });
    replay(box, 'a-run');
  }

  /* ---------- блок «Последние дни» ---------- */
  function prepLive(panel) {
    var svg = panel.querySelector('.live-chart svg');
    if (svg) {
      each(svg.querySelectorAll('rect'), function (r, i) { r.classList.add('a-grow-y'); r.style.setProperty('--d', i * 60 + 'ms'); });
      // пунктир нормы не прорисовываем (у него свой штрих), а плавно проявляем
      each(svg.querySelectorAll('path'), function (p) { p.classList.add('a-fade'); p.style.setProperty('--d', '650ms'); });
    }
    if (panel.classList.contains('is-in')) { countUp(panel.querySelector('.live-num'), 1100); replay(panel, 'a-run'); }
  }

  /* ---------- вердикт ---------- */
  function prepVerdict() {
    var v = document.querySelector('.verdict');
    if (!v) return;
    each(v.querySelectorAll('#vFacts p'), function (p, i) { p.style.setProperty('--d', 120 + i * 90 + 'ms'); });
    replay(v, 'a-run');
  }

  /* ---------- «Как это посчитано» ---------- */
  function prepMethod(ul) {
    each(ul.children, function (li, i) { li.style.setProperty('--d', i * 70 + 'ms'); });
  }

  function init() {
    watchBlocks();
    var cal = $('calendar'), val = $('valChart'), live = $('livePanel'), method = $('method');
    if (cal) { prepCalendar(cal); onChange(cal, prepCalendar); }
    if (val) { prepVal(val); onChange(val, prepVal); }
    if (method) { prepMethod(method); onChange(method, prepMethod); }
    if (live) {
      onChange(live, prepLive);
      live.addEventListener('anim:in', function () { replay(live, 'a-run'); countUp(live.querySelector('.live-num'), 1100); });
    }
    var vh = $('vHead');
    if (vh) onChange(vh, prepVerdict);
    prepVerdict();
    var verdict = document.querySelector('.verdict');
    if (verdict) verdict.addEventListener('anim:in', function () { each(verdict.querySelectorAll('#vFacts p'), function (p) { countUp(p, 900); }); });

    // карта: проявление волной при загрузке
    var map = $('map');
    if (map) replay(map, 'a-sweep');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
