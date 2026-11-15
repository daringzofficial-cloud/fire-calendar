// Скачивает свежие очаги VIIRS NOAA-20 (NRT) из NASA FIRMS и сохраняет сводку
// за последние 10 дней в data/processed/recent.json. Запуск из корня проекта:
//   FIRMS_MAP_KEY=... node scripts/fetch_recent.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const KEY = process.env.FIRMS_MAP_KEY;
if (!KEY) { console.error('Не задана переменная FIRMS_MAP_KEY'); process.exit(1); }

const SOURCE = 'VIIRS_NOAA20_NRT';
const BBOX = '46,40,88,56';      // запад, юг, восток, север
const DAYS = 10, CHUNK = 5;      // окно в днях и размер одного запроса
const G = 0.25;                  // размер ячейки сайта, градусы
const STATIC_BIN = 0.05, STATIC_DAYS = 7; // точка, горящая 7 из 10 дней, считается стационарной

const grid = JSON.parse(readFileSync('data/processed/grid.json', 'utf8'));
const K = grid.meta.calibration.viirs_noaa20_to_modis;
const known = new Set(grid.cells.map(([a, b]) => a.toFixed(2) + '|' + b.toFixed(2)));

const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date(); today.setUTCHours(0, 0, 0, 0);
const dates = [];
for (let i = DAYS - 1; i >= 0; i--) dates.push(iso(new Date(today.getTime() - i * 864e5)));

async function get(url) {
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(url);
      const text = await r.text();
      if (r.ok && text.startsWith('latitude')) return text;
      throw new Error(`HTTP ${r.status}: ${text.slice(0, 120)}`);
    } catch (e) {
      if (a === 3) throw e;
      await new Promise((ok) => setTimeout(ok, 3000 * a));
    }
  }
}

const rows = [];
for (let i = 0; i < DAYS; i += CHUNK) {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEY}/${SOURCE}/${BBOX}/${CHUNK}/${dates[i]}`;
  const text = await get(url);
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const ix = (n) => head.indexOf(n);
  const [iLat, iLon, iDate, iTime, iConf, iFrp] =
    ['latitude', 'longitude', 'acq_date', 'acq_time', 'confidence', 'frp'].map(ix);
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    if (f[iConf].toLowerCase() === 'l') continue;          // низкая достоверность
    rows.push({ lat: +f[iLat], lon: +f[iLon], d: f[iDate], t: f[iTime], frp: +f[iFrp] || 0 });
  }
}

// стационарные источники: одна и та же точка почти каждый день
const seen = new Map();
for (const r of rows) {
  r.sk = Math.round(r.lat / STATIC_BIN) + '|' + Math.round(r.lon / STATIC_BIN);
  if (!seen.has(r.sk)) seen.set(r.sk, new Set());
  seen.get(r.sk).add(r.d);
}
let droppedStatic = 0, outside = 0;
const perDay = Object.fromEntries(dates.map((d) => [d, { d, n: 0, h: 0 }]));
const cells = new Map();
let latest = '';
for (const r of rows) {
  if (seen.get(r.sk).size >= STATIC_DAYS) { droppedStatic++; continue; }
  const la = Math.floor(r.lat / G + 1e-9) * G, lo = Math.floor(r.lon / G + 1e-9) * G;
  const key = la.toFixed(2) + '|' + lo.toFixed(2);
  if (!known.has(key)) { outside++; continue; }
  if (perDay[r.d]) perDay[r.d].n++;
  const c = cells.get(key) || [la, lo, 0, ''];
  c[2]++; if (r.d > c[3]) c[3] = r.d;
  cells.set(key, c);
  const stamp = r.d + ' ' + String(r.t).padStart(4, '0');
  if (stamp > latest) latest = stamp;
}
const days = dates.map((d) => ({ d, n: perDay[d].n, h: +(perDay[d].n * K).toFixed(1) }));

const out = {
  generated: new Date().toISOString(),
  source: 'VIIRS NOAA-20 NRT',
  k: K,
  window: { from: dates[0], to: dates[DAYS - 1] },
  latest_acq: latest,
  dropped_static: droppedStatic,
  outside_grid: outside,
  days,
  cells: [...cells.values()],
};
writeFileSync('data/processed/recent.json', JSON.stringify(out));
console.log(`Очагов: ${days.reduce((s, x) => s + x.n, 0)}, ячеек: ${cells.size}, ` +
  `стационарных убрано: ${droppedStatic}, вне сетки: ${outside}, последний снимок: ${latest || '—'}`);
