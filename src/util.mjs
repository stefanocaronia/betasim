import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const readYaml = file => YAML.parse(fs.readFileSync(file, 'utf8'));
export const toYaml = data => YAML.stringify(data, { lineWidth: 0 });
export const ensureDir = dir => fs.mkdirSync(dir, { recursive: true });

/** Loads every .yaml/.yml file of a folder; the id is the `id` field or the file name. */
export function loadDir(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.ya?ml$/i.test(f))
    .sort()
    .map(f => {
      const file = path.join(dir, f);
      const doc = readYaml(file) || {};
      return { ...doc, id: String(doc.id ?? f.replace(/\.ya?ml$/i, '')), _file: file };
    });
}

const UNITS = { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 };

/** "4m25s", "1h30m", "2d", "250ms", "11:00" (m:ss) or "1:02:03" (h:mm:ss) -> milliseconds. */
export function parseDur(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const s = value.trim();
  let m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return m[3] != null ? ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 : ((+m[1]) * 60 + (+m[2])) * 1000;
  const re = /(\d+(?:\.\d+)?)\s*(ms|d|h|m|s)(?![a-z])/g;
  let total = 0, any = false, rest = s;
  while ((m = re.exec(s))) { any = true; total += (+m[1]) * UNITS[m[2]]; rest = rest.replace(m[0], ''); }
  return any && !rest.trim() ? total : NaN;
}

export function fmtDur(ms) {
  if (ms == null || !isFinite(ms)) return String(ms);
  const neg = ms < 0; ms = Math.abs(Math.round(ms));
  const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3), r = ms % 1e3;
  const parts = [];
  if (d) parts.push(d + 'd'); if (h) parts.push(h + 'h'); if (m) parts.push(m + 'm'); if (s) parts.push(s + 's');
  if (r && !d && !h) parts.push(r + 'ms');
  return (neg ? '-' : '') + (parts.join('') || '0s');
}

/** Small seeded PRNG (mulberry32): the same seed gives the same simulated testers. */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text) {
  let h = 2166136261;
  for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const pct = x => (x == null ? '—' : Math.round(x * 100) + '%');
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function stamp(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function matchesText(actual, expected) {
  if (expected == null) return true;
  return String(actual ?? '').toLowerCase().includes(String(expected).toLowerCase());
}
