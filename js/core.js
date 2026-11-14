/* Расчётное ядро календаря пожарной активности.
 * Работает и в браузере (window.FireCore), и в Node (require) для проверок.
 * На входе: объект из data/processed/grid.json (см. scripts/aggregate.py).
 *
 * Согласованный ряд в MODIS-эквиваленте, по месяцам:
 *   до 2002-07 включительно   Terra x terra_only_to_modis
 *   2002-08 ... 2012-01       MODIS Terra + Aqua
 *   с 2012-02                 VIIRS S-NPP x viirs_snpp_to_modis
 *   после окончания S-NPP     VIIRS NOAA-20 x viirs_noaa20_to_modis
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FireCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_NORM = 2; // при норме ниже этого отклонение не считаем

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymKey(y, m) { return y + '-' + pad(m); } // m: 1..12
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  function build(grid) {
    var meta = grid.meta, cal = meta.calibration, sensors = meta.sensors;
    var sIdx = {};
    sensors.forEach(function (s, i) { sIdx[s] = i; });
    var y0 = +meta.months[0].slice(0, 4);
    var y1 = +meta.months[meta.months.length - 1].slice(0, 4);
    var nM = (y1 - y0 + 1) * 12;
    var first = meta.first_date, last = meta.last_date;
    var nrtFrom = meta.nrt_from_by_sensor || {};
    var dataEnd = Object.keys(last).map(function (k) { return last[k]; }).sort().pop();

    var SOURCES = {
      terra: { sensors: ['modis_terra'], k: cal.terra_only_to_modis },
      modis: { sensors: ['modis_terra', 'modis_aqua'], k: 1 },
      snpp: { sensors: ['viirs_snpp'], k: cal.viirs_snpp_to_modis },
      noaa20: { sensors: ['viirs_noaa20'], k: cal.viirs_noaa20_to_modis }
    };

    var source = new Array(nM);
    var partial = new Uint8Array(nM), nrt = new Uint8Array(nM), hasData = new Uint8Array(nM);
    var factor = new Float64Array(sensors.length * nM);
    var lastComplete = -1;

    for (var mi = 0; mi < nM; mi++) {
      var y = y0 + Math.floor(mi / 12), m = mi % 12 + 1;
      var key = ymKey(y, m), start = key + '-01', end = key + '-' + pad(daysIn(y, m));
      var src;
      if (key <= cal.terra_only_through) src = 'terra';
      else if (key <= cal.modis_through) src = 'modis';
      else if (last.viirs_snpp && end <= last.viirs_snpp) src = 'snpp';
      else if (cal.viirs_noaa20_to_modis && last.viirs_noaa20 && start <= last.viirs_noaa20) src = 'noaa20';
      else if (last.viirs_snpp && start <= last.viirs_snpp) src = 'snpp';
      else src = 'modis';
      source[mi] = src;
      var lead = SOURCES[src].sensors[0];
      var f = first[lead], l = last[lead];
      if (!f || end < f || start > l) continue; // данных нет
      hasData[mi] = 1;
      if (start < f || end > l) partial[mi] = 1;
      if (nrtFrom[lead] && key >= nrtFrom[lead]) nrt[mi] = 1;
      SOURCES[src].sensors.forEach(function (s) {
        if (s in sIdx) factor[sIdx[s] * nM + mi] = SOURCES[src].k;
      });
      if (!partial[mi]) lastComplete = mi;
    }

    // Базовый период нормы: все полные годы
    var bY0 = y0, bY1 = y1;
    for (var yy = y0; yy <= y1; yy++) {
      var ok = true;
      for (var k = 0; k < 12; k++) {
        var i0 = (yy - y0) * 12 + k;
        if (!hasData[i0] || partial[i0]) { ok = false; break; }
      }
      if (ok) { bY0 = yy; break; }
    }
    for (yy = y1; yy >= y0; yy--) {
      ok = true;
      for (k = 0; k < 12; k++) {
        i0 = (yy - y0) * 12 + k;
        if (!hasData[i0] || partial[i0]) { ok = false; break; }
      }
      if (ok) { bY1 = yy; break; }
    }

    // Строки: колонки массивов, отсортированы по ячейке
    var R = grid.rows, nR = R.c.length, nC = grid.cells.length;
    var monthMap = meta.months.map(function (s) {
      return (+s.slice(0, 4) - y0) * 12 + (+s.slice(5, 7) - 1);
    });
    var rowM = new Int32Array(nR), rowS = new Uint8Array(nR), rowN = new Float64Array(nR);
    var cellStart = new Int32Array(nC + 1);
    for (var i = 0; i < nR; i++) {
      rowM[i] = monthMap[R.m[i]]; rowS[i] = R.s[i]; rowN[i] = R.n[i];
      cellStart[R.c[i] + 1]++;
    }
    for (var c = 0; c < nC; c++) cellStart[c + 1] += cellStart[c];

    // Среднее число очагов в год на ячейку (MODIS-экв.) за базовый период
    var cellMean = new Float64Array(nC);
    var bStart = (bY0 - y0) * 12, bEnd = (bY1 - y0 + 1) * 12, nBY = bY1 - bY0 + 1;
    for (c = 0; c < nC; c++) {
      var sum = 0;
      for (i = cellStart[c]; i < cellStart[c + 1]; i++) {
        if (rowM[i] >= bStart && rowM[i] < bEnd) sum += rowN[i] * factor[rowS[i] * nM + rowM[i]];
      }
      cellMean[c] = sum / nBY;
    }

    return {
      meta: meta, cal: cal, sensors: sensors, sIdx: sIdx, cells: grid.cells, g: meta.grid_deg,
      y0: y0, y1: y1, nM: nM, bY0: bY0, bY1: bY1, dataEnd: dataEnd,
      source: source, sourceDefs: SOURCES, partial: partial, nrt: nrt, hasData: hasData,
      factor: factor, lastComplete: lastComplete,
      rowM: rowM, rowS: rowS, rowN: rowN, cellStart: cellStart, cellMean: cellMean
    };
  }

  /* bbox: {s, w, n, e} в градусах или null (вся страна). Возвращает индексы ячеек. */
  function select(model, bbox) {
    var out = [], cells = model.cells, eps = 1e-9;
    for (var c = 0; c < cells.length; c++) {
      if (!bbox) { out.push(c); continue; }
      var lat = cells[c][0], lon = cells[c][1];
      if (lat >= bbox.s - eps && lat < bbox.n - eps && lon >= bbox.w - eps && lon < bbox.e - eps) out.push(c);
    }
    return out;
  }

  /* Площадь выбранных ячеек, км2 */
  function area(model, ids) {
    var g = model.g, km = 111.32, a = 0;
    for (var i = 0; i < ids.length; i++) {
      var lat = model.cells[ids[i]][0] + g / 2;
      a += g * km * g * km * Math.cos(lat * Math.PI / 180);
    }
    return a;
  }

  /* Суммы по месяцам для набора ячеек: H (MODIS-экв.) и сырые счёты по датчикам */
  function aggregate(model, ids) {
    var nM = model.nM, H = new Float64Array(nM);
    var raw = model.sensors.map(function () { return new Float64Array(nM); });
    for (var j = 0; j < ids.length; j++) {
      var c = ids[j];
      for (var i = model.cellStart[c]; i < model.cellStart[c + 1]; i++) {
        var m = model.rowM[i], s = model.rowS[i], n = model.rowN[i];
        raw[s][m] += n;
        H[m] += n * model.factor[s * nM + m];
      }
    }
    return { H: H, raw: raw, nCells: ids.length };
  }

  /* Норма, отклонения, ранги, годовые итоги */
  function analyze(model, agg, b0, b1) {
    // b0..b1: годы нормы (по умолчанию все полные годы). Ранги считаются по всем годам.
    var y0 = model.y0, y1 = model.y1, nM = model.nM;
    var bY0 = b0 || model.bY0, bY1 = b1 || model.bY1;
    var H = agg.H, norm = new Float64Array(12), cm, y, mi;
    for (cm = 0; cm < 12; cm++) {
      var s = 0;
      for (y = bY0; y <= bY1; y++) s += H[(y - y0) * 12 + cm];
      norm[cm] = s / (bY1 - bY0 + 1);
    }
    var ratio = new Float64Array(nM).fill(NaN);
    var rank = new Int16Array(nM), rankOf = new Int16Array(12);
    for (cm = 0; cm < 12; cm++) {
      var list = [];
      for (y = model.bY0; y <= y1; y++) {
        mi = (y - y0) * 12 + cm;
        if (model.hasData[mi] && !model.partial[mi]) list.push(mi);
      }
      list.sort(function (a, b) { return H[b] - H[a]; });
      rankOf[cm] = list.length;
      for (var r = 0; r < list.length; r++) {
        rank[list[r]] = (r > 0 && H[list[r]] === H[list[r - 1]]) ? rank[list[r - 1]] : r + 1;
        if (norm[cm] >= MIN_NORM) ratio[list[r]] = H[list[r]] / norm[cm];
      }
    }
    var years = [], annualNorm = 0, peak = 0;
    for (cm = 0; cm < 12; cm++) { annualNorm += norm[cm]; if (norm[cm] > norm[peak]) peak = cm; }
    var top = null;
    for (y = model.bY0; y <= y1; y++) {
      var total = 0, nsum = 0, n = 0, lastCm = -1;
      for (cm = 0; cm < 12; cm++) {
        mi = (y - y0) * 12 + cm;
        if (model.hasData[mi] && !model.partial[mi]) { total += H[mi]; nsum += norm[cm]; n++; lastCm = cm; }
      }
      var yr = { year: y, total: total, norm: nsum, months: n, lastCm: lastCm, complete: n === 12,
        ratio: nsum >= MIN_NORM ? total / nsum : NaN };
      years.push(yr);
      if (yr.complete && (!top || total > top.total)) top = yr;
    }
    return { norm: norm, ratio: ratio, rank: rank, rankOf: rankOf, years: years,
      annualNorm: annualNorm, peakMonth: peak, topYear: top, minNorm: MIN_NORM, bY0: bY0, bY1: bY1 };
  }

  /* Проверка согласования в общем периоде MODIS и VIIRS S-NPP */
  function validation(model, agg) {
    var cal = model.cal, y0 = model.y0, raw = agg.raw, sI = model.sIdx;
    var a = cal.overlap_months[0], b = cal.overlap_months[1];
    var m0 = (+a.slice(0, 4) - y0) * 12 + (+a.slice(5, 7) - 1);
    var m1 = (+b.slice(0, 4) - y0) * 12 + (+b.slice(5, 7) - 1);
    var k = cal.viirs_snpp_to_modis, byYear = {}, xs = [], ys = [], sm = 0, sv = 0;
    for (var mi = m0; mi <= m1; mi++) {
      var mod = raw[sI.modis_terra][mi] + raw[sI.modis_aqua][mi];
      var vii = raw[sI.viirs_snpp][mi];
      var y = y0 + Math.floor(mi / 12);
      if (!byYear[y]) byYear[y] = { year: y, modis: 0, viirs: 0, months: 0 };
      byYear[y].modis += mod; byYear[y].viirs += vii * k; byYear[y].months++;
      xs.push(vii); ys.push(mod); sm += mod; sv += vii;
    }
    var n = xs.length, mx = sv / n, my = sm / n, sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my);
    }
    return {
      years: Object.keys(byYear).map(function (q) { return byYear[q]; }),
      ratio: sv > 0 ? sm / sv : NaN, corr: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN,
      kNational: k, from: a, to: b
    };
  }

  /* CSV того, что показано: месяцы выбранных лет для выбранной области */
  function toCSV(model, agg, an, yFrom, yTo, bbox) {
    var head = ['year', 'month', 'detections_modis_equivalent', 'source', 'norm_' + an.bY0 + '_' + an.bY1,
      'anomaly_ratio', 'anomaly_percent', 'rank_in_calendar_month', 'ranked_years',
      'raw_modis_terra', 'raw_modis_aqua', 'raw_viirs_snpp', 'raw_viirs_noaa20',
      'is_nrt', 'is_partial_month', 'bbox_south', 'bbox_west', 'bbox_north', 'bbox_east', 'cells'];
    var lines = [head.join(',')], sI = model.sIdx;
    var srcName = { terra: 'MODIS Terra x ' + model.cal.terra_only_to_modis, modis: 'MODIS Terra+Aqua',
      snpp: 'VIIRS S-NPP x ' + model.cal.viirs_snpp_to_modis, noaa20: 'VIIRS NOAA-20 x ' + model.cal.viirs_noaa20_to_modis };
    function rawOf(name, mi) {
      // пусто, если датчик в этом месяце ещё или уже не работал
      var f = model.meta.first_date[name], l = model.meta.last_date[name];
      var key = (model.y0 + Math.floor(mi / 12)) + '-' + pad(mi % 12 + 1);
      if (!(name in sI) || !f || key < f.slice(0, 7) || key > l.slice(0, 7)) return '';
      return agg.raw[sI[name]][mi];
    }
    for (var y = yFrom; y <= yTo; y++) {
      for (var cm = 0; cm < 12; cm++) {
        var mi = (y - model.y0) * 12 + cm;
        if (mi < 0 || mi >= model.nM || !model.hasData[mi]) continue;
        var r = an.ratio[mi];
        lines.push([y, cm + 1, agg.H[mi].toFixed(1), srcName[model.source[mi]], an.norm[cm].toFixed(1),
          isNaN(r) ? '' : r.toFixed(3), isNaN(r) ? '' : ((r - 1) * 100).toFixed(1),
          an.rank[mi] || '', an.rank[mi] ? an.rankOf[cm] : '',
          rawOf('modis_terra', mi), rawOf('modis_aqua', mi), rawOf('viirs_snpp', mi), rawOf('viirs_noaa20', mi),
          model.nrt[mi], model.partial[mi],
          bbox ? bbox.s : '', bbox ? bbox.w : '', bbox ? bbox.n : '', bbox ? bbox.e : '', agg.nCells].join(','));
      }
    }
    return lines.join('\r\n') + '\r\n';
  }

  return { build: build, select: select, area: area, aggregate: aggregate, analyze: analyze,
    validation: validation, toCSV: toCSV, MIN_NORM: MIN_NORM };
});
