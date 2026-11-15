// Генерирует фон с горизонталями (изолиниями) для сайта: css/contours.svg
const fs = require('fs');
const W = 1600, H = 1000, NX = 128, NY = 80, sx = W / NX, sy = H / NY;
let seed = 7;
function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
// value noise на решётке
function makeNoise(n) {
  const g = []; for (let i = 0; i <= n; i++) { g.push([]); for (let j = 0; j <= n; j++) g[i].push(rnd()); }
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    x = x * n; y = y * n;
    const i = Math.min(n - 1, Math.floor(x)), j = Math.min(n - 1, Math.floor(y)), fx = s(x - i), fy = s(y - j);
    const a = g[i][j] + (g[i + 1][j] - g[i][j]) * fx, b = g[i][j + 1] + (g[i + 1][j + 1] - g[i][j + 1]) * fx;
    return a + (b - a) * fy;
  };
}
const n1 = makeNoise(4), n2 = makeNoise(9), n3 = makeNoise(19);
const F = [];
for (let i = 0; i <= NX; i++) {
  F.push([]);
  for (let j = 0; j <= NY; j++) {
    const u = i / NX, v = j / NY;
    F[i].push(n1(u, v) * 0.62 + n2(u, v) * 0.27 + n3(u, v) * 0.11);
  }
}
let lo = 1, hi = 0;
F.forEach((r) => r.forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); }));
const LEVELS = 20, segs = { minor: [], major: [] };
for (let L = 1; L < LEVELS; L++) {
  const t = lo + (hi - lo) * L / LEVELS, out = L % 4 === 0 ? segs.major : segs.minor;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    const a = F[i][j], b = F[i + 1][j], c = F[i + 1][j + 1], d = F[i][j + 1];
    const pts = [];
    const e = (p, q, x0, y0, x1, y1) => { if ((p < t) !== (q < t)) { const k = (t - p) / (q - p); pts.push([(x0 + (x1 - x0) * k) * sx, (y0 + (y1 - y0) * k) * sy]); } };
    e(a, b, i, j, i + 1, j); e(b, c, i + 1, j, i + 1, j + 1); e(c, d, i + 1, j + 1, i, j + 1); e(d, a, i, j + 1, i, j);
    for (let k = 0; k + 1 < pts.length; k += 2) out.push(pts[k], pts[k + 1]);
  }
}
const r = (v) => Math.round(v);
function path(list) { let s = ''; for (let k = 0; k < list.length; k += 2) s += 'M' + r(list[k][0]) + ' ' + r(list[k][1]) + 'L' + r(list[k + 1][0]) + ' ' + r(list[k + 1][1]); return s; }
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice">' +
  '<path d="' + path(segs.minor) + '" fill="none" stroke="#1d1c1a" stroke-opacity=".07" stroke-width="1"/>' +
  '<path d="' + path(segs.major) + '" fill="none" stroke="#1d1c1a" stroke-opacity=".12" stroke-width="1.4"/></svg>';
fs.writeFileSync('C:/Users/Admin/fire-calendar/css/contours.svg', svg);
console.log('segments', segs.minor.length / 2 + segs.major.length / 2, 'bytes', svg.length);
