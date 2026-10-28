import fs from 'node:fs';
import path from 'node:path';
import { readYaml } from './util.mjs';
import { scoreSegments } from './segments.mjs';
import { REASONS } from './usability/model.mjs';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pc = x => (x == null ? '—' : Math.round(x * 100) + '%');

/** The page head of betasim's pages: fonts, colours (light and dark), the shared styles. */
export const pageHead = title => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{--bg:#F2F5F4;--surface:#FFFFFF;--ink:#14201D;--muted:#5A6A66;--line:#D6DFDC;--accent:#0B7A71;--good:#1F8A55;--warn:#B7791F;--bad:#C2412D;
  --display:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;--body:"IBM Plex Sans",ui-sans-serif,system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0E1412;--surface:#16201D;--ink:#E3ECE9;--muted:#97A8A3;--line:#283531;--accent:#37BFB1;--good:#45C184;--warn:#E0A43C;--bad:#EE6B55;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0E1412;--surface:#16201D;--ink:#E3ECE9;--muted:#97A8A3;--line:#283531;--accent:#37BFB1;--good:#45C184;--warn:#E0A43C;--bad:#EE6B55;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--body)}
.wrap{max-width:1180px;margin:0 auto;padding-inline:20px;padding-block:28px 56px;display:grid;gap:36px}
h1,h2,h3{font-family:var(--display);font-weight:600;text-wrap:balance;margin:0}
h1{font-size:30px;letter-spacing:-.01em}h2{font-size:20px}h3{font-size:15px}
.num,code,.big,.pill .v,td{font-variant-numeric:tabular-nums}
code{font:500 12px/1.4 var(--mono);color:var(--muted)}
.top{display:flex;flex-wrap:wrap;gap:16px 32px;align-items:end;justify-content:space-between}
.run{margin:4px 0 0;color:var(--muted);font-size:13px}
.counts{display:flex;flex-wrap:wrap;gap:8px}
.pill{display:grid;gap:2px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);min-width:110px}
.pill .k{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.pill .v{font:500 15px/1.2 var(--mono);white-space:nowrap}
.pill.ok{box-shadow:inset 3px 0 0 var(--good)}.pill.warn{box-shadow:inset 3px 0 0 var(--warn)}.pill.bad{box-shadow:inset 3px 0 0 var(--bad)}
section{display:grid;gap:14px}
.lede{margin:0;color:var(--muted);max-width:68ch}
.targets{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:12px}
.target{display:grid;gap:6px;align-content:start;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.target header{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.target .w{color:var(--accent);font-size:11px;letter-spacing:.1em}
.target .kind{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.target.floor{background:color-mix(in srgb,var(--accent) 5%,var(--surface))}
.score{display:flex;align-items:baseline;gap:10px}
.big{font:500 30px/1 var(--mono)}
.goal{color:var(--muted);font-size:13px}
.target.ok .big{color:var(--good)}.target.miss .big{color:var(--bad)}
.status,.who{margin:0;font-size:13px}.who{color:var(--muted)}
.spark{width:168px;height:40px;display:block}
.sp-base{stroke:var(--line);stroke-width:1}
.sp-line{fill:none;stroke:var(--accent);stroke-width:1.8;stroke-linejoin:round}
.sp-area{fill:var(--accent);opacity:.12}
.sp-end{fill:var(--accent)}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
table{border-collapse:collapse;width:100%}
.heat th,.heat td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:center;font-size:13px}
.heat thead th{position:sticky;top:0;background:var(--surface);font-weight:500;vertical-align:bottom}
.heat thead th span{display:block;font-size:12px}.heat thead th small{color:var(--muted);font:12px var(--mono)}
.heat tbody th{text-align:left;font-weight:500;white-space:nowrap;position:sticky;left:0;background:var(--surface)}
.heat td{font:500 13px var(--mono);min-width:44px}
.h5{background:color-mix(in srgb,var(--good) 30%,var(--surface))}
.h4{background:color-mix(in srgb,var(--good) 14%,var(--surface))}
.h3{background:color-mix(in srgb,var(--warn) 24%,var(--surface))}
.h2{background:color-mix(in srgb,var(--bad) 26%,var(--surface))}
.h1{background:color-mix(in srgb,var(--bad) 48%,var(--surface))}
.h0{background:transparent}
.avg{border-left:2px solid var(--line)}
.crit{font-style:normal;color:var(--bad);font-weight:600}
.na{color:var(--muted);text-align:left}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--muted)}
.legend span{display:inline-flex;gap:6px;align-items:center}.legend i{width:14px;height:14px;border-radius:3px;border:1px solid var(--line);display:inline-block}
.filters{display:flex;flex-wrap:wrap;gap:8px}
.filters button{font:500 13px var(--body);padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}
.filters button[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.filters button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.flist{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.f{padding:12px 14px 12px 16px;border:1px solid var(--line);border-radius:10px;background:var(--surface);display:grid;gap:4px;box-shadow:inset 4px 0 0 var(--muted)}
.f.sev-B{box-shadow:inset 4px 0 0 var(--bad)}.f.sev-A{box-shadow:inset 4px 0 0 var(--warn)}.f.sev-P{box-shadow:inset 4px 0 0 var(--line)}
.fh{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
.sev{font:600 12px var(--mono);width:22px;height:22px;border-radius:6px;display:grid;place-items:center;background:var(--bg)}
.sev-B .sev{color:var(--bad)}.sev-A .sev{color:var(--warn)}
.seg{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.ft{margin:0;font-weight:500}.fe{margin:0;font-size:13px;color:var(--muted)}.fs{margin:0;font-size:13px}
.fs::before{content:"Proposal: ";color:var(--accent);font-weight:600}
.trend{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.trend>div{padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);display:grid;gap:6px}
.last{margin:0;font-size:13px;color:var(--muted)}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
.plain th,.plain td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;font-size:13px;vertical-align:top}
.plain th{font-weight:500}.plain .num{text-align:right;font-family:var(--mono);white-space:nowrap}
.plain tr.fail td:first-child,.plain tr.fail th{color:var(--bad)}
.plain tr.err td{color:var(--muted);font-size:12px}
.foot{color:var(--muted);font-size:13px;max-width:72ch;margin:0}
.muted{color:var(--muted);font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.dchip{font:500 12px var(--mono);padding:2px 8px;border-radius:999px;border:1px solid var(--line)}
.dchip.up{color:var(--ink);border-color:var(--good)}.dchip.down{color:var(--ink);border-color:var(--bad)}
.badge{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line)}
.badge.pref{background:var(--accent);border-color:var(--accent);color:var(--surface)}
.badge.lose{color:var(--muted);text-decoration:line-through}
.badge.goal{border-color:var(--good);color:var(--good)}
.rem td,.rem th{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:14px}
.rem .num{text-align:right;font:500 15px var(--mono);white-space:nowrap}
.pairs{margin:0;padding-left:18px;display:grid;gap:6px;font-size:14px}
.agents{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.agent{padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--surface);display:grid;gap:8px;align-content:start}
.agent header{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.agent p{margin:0;font-size:14px;max-width:70ch}
.opts{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}
.opts li{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:6px 8px;border-radius:8px}
.opts li.pref{background:color-mix(in srgb,var(--accent) 10%,var(--surface))}
.opts .chips{grid-column:1 / -1;margin:0}
.opts .num{font:500 14px var(--mono)}
.pair.collide::marker{color:var(--bad)}.pair.synergy::marker{color:var(--good)}
.areas{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.area{padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);display:grid;gap:8px;align-content:start}
.feat{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.feat li{display:grid;grid-template-columns:12px 1fr;column-gap:8px;align-items:baseline;font-size:13px}
.feat li code{grid-column:2;font-size:11px}
.feat .dot{width:8px;height:8px;border-radius:50%;background:var(--line);display:inline-block}
.st-ok .dot{background:var(--good)}.st-failing .dot{background:var(--bad)}.st-missing{color:var(--muted)}
.tabs{position:sticky;top:0;z-index:2;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;padding-block:8px;background:var(--bg);border-bottom:1px solid var(--line)}
.tabs::-webkit-scrollbar{display:none}
.tabs a{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 12px;border-radius:8px;color:var(--muted);font:500 14px var(--body);text-decoration:none}
.tabs a:hover{color:var(--ink);background:var(--surface)}
.tabs a[aria-current="page"]{color:var(--ink);background:var(--surface);box-shadow:inset 0 -2px 0 var(--accent)}
.tabs a:focus-visible,.person:focus-visible,.heat th a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tabs .n{font:500 12px var(--mono);color:var(--muted)}
html.js section.tab{display:none}
html.js section.tab.on{display:grid}
a{color:var(--accent)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.chart,.box{margin:0;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--surface);display:grid;gap:8px;align-content:start}
.box p{margin:0;font-size:14px}
.chart figcaption{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 12px}
.lc{width:100%;height:auto;display:block}
.lc .grid{stroke:var(--line);stroke-width:1}
.lc .ax{fill:var(--muted);font:11px var(--mono)}
.lc .ln{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.lc .pt{stroke:var(--surface);stroke-width:2}
.lc .hit{fill:transparent;stroke:none}
.lc .c-accent{stroke:var(--accent)}.lc .pt.c-accent{fill:var(--accent)}
.lc .c-bad{stroke:var(--bad)}.lc .pt.c-bad{fill:var(--bad)}
.lc .c-warn{stroke:var(--warn)}.lc .pt.c-warn{fill:var(--warn)}
.lc .pt{stroke:var(--surface)}
.legend .lg{width:14px;height:3px;border:0;border-radius:2px}.legend .lg.c-bad{background:var(--bad)}.legend .lg.c-warn{background:var(--warn)}
p.legend{margin:0}
.tlist{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:14px}
.tlist .ok{color:var(--good)}.tlist .miss{color:var(--bad)}.tlist .num{font-family:var(--mono)}
.heat th a{color:inherit;text-decoration:none;display:block}.heat th a:hover span{text-decoration:underline}
.persons{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.person{padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--surface);display:grid;gap:10px;align-content:start;scroll-margin-top:72px}
.person:target{border-color:var(--accent)}
.person header{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.person .kind{font:500 12px var(--mono);color:var(--accent);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.person p{margin:0;font-size:14px}
.person .chips{margin:0}
.meters{display:grid;gap:6px}
.meter{display:grid;grid-template-columns:130px 1fr 18px;align-items:center;gap:10px;font-size:13px}
.meter .bar{height:6px;border-radius:3px;background:color-mix(in srgb,var(--line) 70%,var(--surface))}
.meter .bar i{display:block;height:100%;border-radius:3px;background:var(--accent)}
.meter .num{font:500 13px var(--mono);text-align:right}
.hardest{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:13px}
.hardest li{display:grid;grid-template-columns:40px 1fr;gap:10px;align-items:baseline}
.hardest .cell{font:500 13px var(--mono);text-align:center;border-radius:6px;padding:2px 0}
.cap{font-size:15px}
@media (max-width:520px){h1{font-size:24px}.pill{min-width:0;flex:1 1 40%}.meter{grid-template-columns:110px 1fr 18px}.lc .ax{font-size:20px}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style>
`;

/** Frequency-weighted success over every task and persona: one number to follow from run to run. */
export function overallScore(usability, tasks) {
  const byTask = Object.fromEntries(tasks.map(t => [t.id, t]));
  let num = 0, den = 0;
  for (const [tid, u] of Object.entries(usability || {})) {
    if (!u.measurable) continue;
    const rows = Object.values(u.personas); if (!rows.length) continue;
    const w = byTask[tid]?.frequency ?? 1;
    num += w * rows.reduce((a, r) => a + r.success, 0) / rows.length; den += w;
  }
  return den ? num / den : null;
}

/** The previous runs kept in report/history, oldest first, each reduced to the numbers of the trend. */
export function readHistory(reportDir, tasks, segments) {
  const dir = path.join(reportDir, 'history');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map(name => {
    try {
      const results = JSON.parse(fs.readFileSync(path.join(dir, name, 'results.json'), 'utf8'));
      const findings = fs.existsSync(path.join(dir, name, 'findings.yaml')) ? readYaml(path.join(dir, name, 'findings.yaml')) || [] : [];
      return trendPoint(name, results, findings, tasks, segments);
    } catch { return null; }
  }).filter(Boolean);
}

export function trendPoint(name, results, findings, tasks, segments) {
  const count = s => findings.filter(f => f.severity === s).length;
  const segs = Object.fromEntries(scoreSegments(results.usability, tasks, segments).map(s => [s.id, s.score]));
  return { name, date: results.meta?.date, overall: overallScore(results.usability, tasks), B: count('B'), A: count('A'), P: count('P'), segs };
}

function spark(values, { min = 0, max = 1, w = 168, h = 40, pct = true } = {}) {
  const pts = values.map((v, i) => [v, i]).filter(([v]) => v != null);
  if (!pts.length) return '<span class="none">—</span>';
  const lo = Math.min(min, ...pts.map(([v]) => v)), hi = Math.max(max, ...pts.map(([v]) => v));
  const pad = 4, n = Math.max(1, values.length - 1);
  const x = i => pad + (w - 2 * pad) * (values.length === 1 ? 1 : i / n);
  const y = v => h - pad - (h - 2 * pad) * ((v - lo) / ((hi - lo) || 1));
  const line = pts.map(([v, i]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const [lv, li] = pts[pts.length - 1];
  const area = pts.length > 1 ? `<polygon class="sp-area" points="${x(pts[0][1]).toFixed(1)},${h - pad} ${line} ${x(li).toFixed(1)},${h - pad}"/>` : '';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="trend: last value ${pct ? pc(lv) : lv}">`
    + `<line class="sp-base" x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}"/>${area}`
    + (pts.length > 1 ? `<polyline class="sp-line" points="${line}"/>` : '')
    + `<circle class="sp-end" cx="${x(li).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="3.2"/></svg>`;
}

const heat = s => (s == null ? 'h0' : s >= 0.97 ? 'h5' : s >= 0.93 ? 'h4' : s >= 0.85 ? 'h3' : s >= 0.7 ? 'h2' : 'h1');

/** A line chart of the runs, one line per series, with the values on hover; the y axis from min to max. */
function lineChart(runs, series, { min = 0, max = 1, pct = true } = {}) {
  if (runs.length < 2) return '<p class="muted">The trend appears from the second run: runs are kept in report/history.</p>';
  const w = 560, h = 180, left = 60, right = 12, top = 12, bottom = 26;
  const fmt = v => (v == null ? '—' : pct ? pc(v) : String(v));
  const n = runs.length;
  const x = i => left + (w - left - right) * (n === 1 ? 1 : i / (n - 1));
  const y = v => top + (h - top - bottom) * (1 - (v - min) / ((max - min) || 1));
  const ticks = [min, (min + max) / 2, max];
  const grid = ticks.map(t => `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="ax" x="${left - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${fmt(pct ? t : Math.round(t))}</text>`).join('');
  const day = r => String(r.date || '').slice(0, 5);
  const xs = `<text class="ax" x="${x(0).toFixed(1)}" y="${h - 6}" text-anchor="${n === 1 ? 'end' : 'start'}">${esc(day(runs[0]))}</text>${n > 1 ? `<text class="ax" x="${x(n - 1).toFixed(1)}" y="${h - 6}" text-anchor="end">${esc(day(runs[n - 1]))}</text>` : ''}`;
  const lines = series.map(s => {
    const pts = runs.map((r, i) => [i, s.key(r)]).filter(([, v]) => v != null);
    const path = pts.length > 1 ? `<polyline class="ln ${s.cls}" points="${pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>` : '';
    const dots = pts.map(([i, v]) => `<g><circle class="pt ${s.cls}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4"/><circle class="hit" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="12"><title>${esc(`${s.name}: ${fmt(v)} · ${runs[i].date || ''}`)}</title></circle></g>`).join('');
    return path + dots;
  }).join('');
  const last = runs[n - 1];
  return `<svg class="lc" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(series.map(s => `${s.name}: ${fmt(s.key(last))} in the last of ${n} runs`).join('; '))}">${grid}${xs}${lines}</svg>`;
}

// the abilities of a persona, as the model reads them: [label, value, top of the scale]
const SCALES = [['Practice with apps', 'tech', 5], ['Reading', 'reading', 5], ['Exploring menus', 'explore', 5], ['Patience', 'patience', 5], ['Hurry', 'hurry', 5]];
const SIGHT = { none: 'sees well', presbyopia: 'presbyopia', low: 'low vision', blind: 'screen reader' };
const HANDS = { fine: 'steady hands', normal: 'normal hands', busy: 'hands busy', unsteady: 'unsteady hands' };

/** One persona: who they are, their abilities, the targets they belong to, and the tasks where they struggle most. */
function personaCard(p, { usability, segScores, cfg }) {
  const meters = [...SCALES, ...(cfg.uiLanguage === 'en' ? [['English', 'english', 5]] : [])].filter(([, k]) => p[k] != null)
    .map(([label, k, top]) => `<div class="meter"><span>${label}</span><span class="bar" aria-hidden="true"><i style="width:${Math.round(100 * p[k] / top)}%"></i></span><span class="num">${p[k]}</span></div>`).join('');
  const chips = [p.vision && SIGHT[p.vision], p.motor && HANDS[p.motor], p.keyboard && 'keyboard only'].filter(Boolean).map(c => `<span class="badge">${esc(c)}</span>`).join('');
  const inTargets = segScores.filter(s => s.personas.includes(p.id)).map(s => `<span class="seg">${esc(s.name)}</span>`).join('');
  const tasks = Object.entries(usability || {}).filter(([, u]) => u.measurable && u.personas[p.id]).map(([tid, u]) => {
    const r = u.personas[p.id];
    const stop = Object.entries(r.stops).sort((a, b) => b[1] - a[1])[0];
    const step = stop ? u.steps[stop[0]] : null;
    const why = stop ? REASONS[r.steps[stop[0]]?.reason]?.label : null;
    return { tid, success: r.success, where: step ? `stops at step ${step.step}, "${step.name || ''}"${why ? `: ${why}` : ''}` : '' };
  }).sort((a, b) => a.success - b.success);
  const avg = tasks.length ? tasks.reduce((a, t) => a + t.success, 0) / tasks.length : null;
  const worst = tasks.slice(0, 5).map(t => `<li><span class="${heat(t.success)} cell">${Math.round(t.success * 100)}</span><span><b>${esc(t.tid)}</b>${t.where ? ` <span class="muted">· ${esc(t.where)}</span>` : ''}</span></li>`).join('');
  return `<article class="person" id="persona-${esc(p.id)}" tabindex="-1">
      <header><h3>${esc(p.name || p.id)}${p.age != null ? ` <span class="muted">${p.age}</span>` : ''}</h3>${p.profile ? `<span class="kind" title="the betasim profile it starts from">${esc(p.profile)}</span>` : ''}</header>
      ${p.summary ? `<p class="muted">${esc(p.summary)}</p>` : ''}
      <div class="chips">${chips}</div>
      <div class="meters">${meters}</div>
      ${inTargets ? `<div class="chips">${inTargets}</div>` : ''}
      ${tasks.length ? `<p class="status">${pc(avg)} on average over ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}${tasks.length > 5 ? '; the five hardest' : ''}:</p><ol class="hardest">${worst}</ol>` : '<p class="muted">No task measured for this persona.</p>'}
    </article>`;
}

export function renderDashboard({ cfg, results, findings, tasks, personas, segments, history, current }) {
  const m = results.meta;
  const engineOk = results.engine.filter(r => r.ok).length, flowsOk = results.flows.filter(r => r.ok).length;
  const count = s => findings.filter(f => f.severity === s).length;
  const runs = [...history, current];
  const segScores = scoreSegments(results.usability, tasks, segments);
  const byPersona = Object.fromEntries(personas.map(p => [p.id, p]));
  const U = Object.entries(results.usability || {});
  const usedPersonas = personas.filter(p => U.some(([, u]) => u.measurable && u.personas[p.id]));

  const pills = [
    ['Engine', `${engineOk}/${results.engine.length}`, engineOk === results.engine.length ? 'ok' : 'bad'],
    ['Flows', `${flowsOk}/${results.flows.length}`, flowsOk === results.flows.length ? 'ok' : 'bad'],
    ['Weighted success', pc(current.overall), current.overall >= 0.95 ? 'ok' : current.overall >= 0.9 ? 'warn' : 'bad'],
    ['Findings', `B ${count('B')} · A ${count('A')} · P ${count('P')}`, count('B') ? 'bad' : count('A') ? 'warn' : 'ok'],
  ].map(([k, v, s]) => `<div class="pill ${s}"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('');

  const who = id => byPersona[id]?.name || id;
  const floorCard = s => `<article class="target floor ${s.ok ? 'ok' : 'miss'}">
      <header><h3>${esc(s.name)}</h3><span class="kind">floor</span></header>
      <div class="score"><span class="big">${pc(s.worstPair?.success)}</span><span class="goal">lowest · floor ${pc(s.floor)}</span></div>
      <p class="status">${s.ok ? 'Nobody below the floor' : `${s.breaks.length} below the floor: ${s.breaks.slice(0, 3).map(b => `${esc(who(b.persona))} on <b>${esc(b.task)}</b> ${pc(b.success)}`).join(', ')}`}</p>
      <p class="who">${s.personas.map(id => esc(who(id))).join(', ')}</p>
    </article>`;
  const targetCards = segScores.map(s => s.kind === 'floor' ? floorCard(s) : `<article class="target ${s.ok ? 'ok' : 'miss'}">
      <header><h3>${esc(s.name)}</h3><span class="w" title="weight in the plan">${'●'.repeat(s.weight)}${'○'.repeat(Math.max(0, 3 - s.weight))}</span></header>
      <div class="score"><span class="big">${pc(s.score)}</span><span class="goal">goal ${pc(s.goal.success)}</span></div>
      <p class="status">${s.ok ? 'Reached' : 'Below the goal'}${s.worst ? ` · worst task: <b>${esc(s.worst[0])}</b> ${pc(s.worst[1])}` : ''}</p>
      ${s.goal.critical != null && s.criticalMin != null ? `<p class="status">Critical tasks: worst persona ${pc(s.criticalMin)}, goal ${pc(s.goal.critical)}</p>` : ''}
      <p class="who">${s.personas.map(id => esc(byPersona[id]?.name || id)).join(', ')}</p>
      ${spark(runs.map(r => r.segs?.[s.id] ?? null), { min: 0.7 })}
    </article>`).join('');

  const head = usedPersonas.map(p => `<th scope="col" title="${esc(p.summary || '')}"><a href="#persona-${esc(p.id)}"><span>${esc(p.name || p.id)}</span><small>${p.age ?? ''}</small></a></th>`).join('');
  const rows = U.map(([tid, u]) => {
    const t = tasks.find(x => x.id === tid) || {};
    if (!u.measurable) return `<tr><th scope="row" title="${esc(t.goal || '')}">${esc(tid)}</th><td colspan="${usedPersonas.length + 1}" class="na">not measurable: ${esc(u.reason)}</td></tr>`;
    const vals = Object.values(u.personas).map(r => r.success);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const cells = usedPersonas.map(p => {
      const r = u.personas[p.id];
      if (!r) return '<td class="h0"></td>';
      const stop = Object.entries(r.stops).sort((a, b) => b[1] - a[1])[0];
      const why = stop ? ` · stops at step ${u.steps[stop[0]]?.step} (${u.steps[stop[0]]?.name || ''})` : '';
      return `<td class="${heat(r.success)}" title="${esc(`${p.name}: ${pc(r.success)} · median ${r.medianT ?? '—'} s${why}`)}">${Math.round(r.success * 100)}</td>`;
    }).join('');
    return { avg, html: `<tr><th scope="row" title="${esc(t.goal || '')}">${esc(tid)}${t.critical ? ' <i class="crit" title="critical">!</i>' : ''}</th>${cells}<td class="avg ${heat(avg)}">${Math.round(avg * 100)}</td></tr>` };
  }).sort((a, b) => (a.avg ?? -1) - (b.avg ?? -1)).map(r => r.html || r).join('');

  const segName = Object.fromEntries(segScores.map(s => [s.id, s.name]));
  const items = findings.map(f => `<li class="f sev-${f.severity}" data-sev="${f.severity}">
      <div class="fh"><span class="sev">${f.severity}</span><code>${esc(f.id)}</code>${(f.segments || []).map(s => `<span class="seg">${esc(segName[s] || s)}</span>`).join('')}</div>
      <p class="ft">${esc(f.title)}</p>
      ${(f.evidence || []).map(e => `<p class="fe">${esc(e)}</p>`).join('')}
      ${f.suggestion ? `<p class="fs">${esc(f.suggestion)}</p>` : ''}
      ${f.screenshot ? `<p class="fe">screenshot: <code>${esc(f.screenshot)}</code></p>` : ''}
    </li>`).join('');

  const flowRows = results.flows.map(r => `<tr class="${r.ok ? '' : 'fail'}"><td>${r.ok ? '✓' : '✗'}</td><th scope="row">${esc(r.name)}</th><td class="num">${r.taps}${r.inputs ? ` + ${r.inputs}` : ''}</td><td class="num">${r.ms} ms</td></tr>${r.ok ? '' : `<tr class="err"><td></td><td colspan="3">${esc(r.error)}</td></tr>`}`).join('');
  const engineRows = results.engine.map(r => `<tr class="${r.ok ? '' : 'fail'}"><td>${r.ok ? '✓' : '✗'}</td><th scope="row">${esc(r.name)}</th></tr>${r.ok ? '' : `<tr class="err"><td></td><td>${esc(r.error || r.diffs.join(' · '))}</td></tr>`}`).join('');

  const segN = Object.fromEntries(segScores.map(s => [s.id, s.name]));
  const pt = x => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;
  const pairs = results.remedyPairs || [];
  const chipsOf = o => Object.entries(o.perSegment || {}).filter(([, d]) => Math.abs(d) >= 0.0005).sort((a, b) => b[1] - a[1])
    .map(([id, d]) => `<span class="dchip ${d >= 0 ? 'up' : 'down'}">${esc(segN[id] || id)} ${pt(d)}</span>`).join('');
  const remedyRows = (results.remedies || []).filter(r => !r.negligible).map(r => {
    const clash = pairs.filter(p => p.kind === 'collide' && (p.a === r.id || p.b === r.id));
    const lost = clash.some(p => p.preferred !== r.id);
    const opts = (r.options || []).map(o => {
      const pref = o.variant === r.preferred;
      const goal = o.reachesGoal?.length ? `<span class="badge goal">brings above the goal: ${esc(o.reachesGoal.map(id => segN[id] || id).join(', '))}</span>` : '';
      const time = Math.abs(o.timeDelta || 0) >= 0.1 ? `<span class="dchip ${o.timeDelta < 0 ? 'up' : 'down'}">time ${o.timeDelta > 0 ? '+' : '−'}${Math.abs(o.timeDelta).toFixed(1)} s</span>` : '';
      return `<li class="${pref ? 'pref' : ''}"><span class="opt">${pref ? '<span class="badge pref">preferred</span> ' : ''}${esc(o.label)}</span><span class="num">${pt(o.gain)}</span><div class="chips">${chipsOf(o)}${time}${goal}</div></li>`;
    }).join('');
    return `<tr><th scope="row"><code>${r.id}</code></th><td><b>"${esc(r.name)}"</b> <span class="muted">· ${esc(r.screen)} · ${esc(r.findings.join(', '))}</span>${lost ? ' <span class="badge lose">clashes: dropped</span>' : ''}<ul class="opts">${opts}</ul></td></tr>`;
  }).join('');
  const minor = (results.remedies || []).filter(r => r.negligible);
  const pairsHtml = pairs.map(p => `<li class="pair ${p.kind}">${p.kind === 'collide'
    ? `<b>${p.a}</b> and <b>${p.b}</b> clash: together ${pt(p.together)} points, less than the better of the two alone. Preferred <b>${p.preferred}</b>, the one that helps the targets most.`
    : p.kind === 'synergy' ? `<b>${p.a}</b> and <b>${p.b}</b> together give more than the sum: ${pt(p.together)} points.`
    : `<b>${p.a}</b> and <b>${p.b}</b> get in each other's way: together ${pt(p.together)} points.`}</li>`).join('');
  const cov = results.coverage;
  const covHtml = cov ? [...new Set(cov.rows.map(r => r.area || '—'))].map(a => `<div class="area"><h3>${esc(a)}</h3><ul class="feat">${cov.rows.filter(r => (r.area || '—') === a)
    .map(r => `<li class="st-${r.status.replace(' ', '-')}"><span class="dot" aria-hidden="true"></span><span>${esc(r.name)}</span>${r.flows.length || r.cases.length ? `<code>${esc([...r.flows, ...r.cases].slice(0, 2).join(', '))}${r.flows.length + r.cases.length > 2 ? '…' : ''}</code>` : '<code>no flow</code>'}</li>`).join('')}</ul></div>`).join('') : '';
  const charts = `<div class="charts">
      <figure class="chart"><figcaption><h2 class="cap">Weighted success</h2><span class="muted">${pc(current.overall)} in this run · ${runs.length} ${runs.length === 1 ? 'run' : 'runs'}</span></figcaption>
        ${lineChart(runs, [{ key: r => r.overall, cls: 'c-accent', name: 'Weighted success' }], { min: Math.min(0.7, ...runs.map(r => r.overall ?? 1)), max: 1 })}</figure>
      <figure class="chart"><figcaption><h2 class="cap">B and A findings</h2><span class="muted">B ${count('B')} · A ${count('A')} in this run</span></figcaption>
        ${lineChart(runs, [{ key: r => r.B, cls: 'c-bad', name: 'B' }, { key: r => r.A, cls: 'c-warn', name: 'A' }], { min: 0, max: Math.max(1, ...runs.flatMap(r => [r.B, r.A])), pct: false })}
        ${runs.length > 1 ? '<p class="legend"><span><i class="lg c-bad"></i>B, blocks</span><span><i class="lg c-warn"></i>A, hurts</span></p>' : ''}</figure>
    </div>`;
  const worstFindings = findings.filter(f => f.severity !== 'P').slice(0, 5).map(f => `<li class="f sev-${f.severity}"><div class="fh"><span class="sev">${f.severity}</span><code>${esc(f.id)}</code></div><p class="ft">${esc(f.title)}</p></li>`).join('');
  const targetList = segScores.map(s => `<li><span class="${s.ok ? 'ok' : 'miss'}">${s.ok ? '✓' : '✗'}</span> <b>${esc(s.name)}</b> <span class="num">${pc(s.kind === 'floor' ? s.worstPair?.success : s.score)}</span> <span class="muted">${s.kind === 'floor' ? `lowest, floor ${pc(s.floor)}` : `goal ${pc(s.goal.success)}`}</span></li>`).join('');
  const people = [...usedPersonas, ...personas.filter(p => !usedPersonas.includes(p))].map(p => personaCard(p, { usability: results.usability, segScores, cfg })).join('');
  const agents = results.agents || [];
  const tabs = [
    ['overview', 'Overview'], ['targets', 'Targets', segScores.length], ['map', 'Tasks', U.length], ['findings', 'Findings', findings.length],
    ['remedies', 'Remedies', (results.remedies || []).filter(r => !r.negligible).length], ['coverage', 'Coverage'], ['flows', 'Flows', results.flows.length],
    ['personas', 'Personas', personas.length], ...(agents.length ? [['llm', 'LLM testers', agents.length]] : []),
  ].map(([id, label, n]) => `<a href="#${id}" data-tab="${id}">${label}${n != null ? ` <span class="n">${n}</span>` : ''}</a>`).join('');

  return `${pageHead(`${cfg.name} betasim`)}<script>document.documentElement.classList.add('js')</script><main class="wrap">
  <header class="top">
    <div><h1>${esc(cfg.name)}</h1><p class="run">betasim · run of ${esc(m.date)} · ${m.runs} trials per persona-task pair · seed ${m.seed} · ${Math.round(m.seconds)} s</p></div>
    <div class="counts">${pills}</div>
  </header>
  <nav class="tabs" aria-label="Sections">${tabs}</nav>
  <section id="overview" class="tab">
    ${charts}
    <div class="two">
      <div class="box"><h2>Targets</h2>${targetList ? `<ul class="tlist">${targetList}</ul>` : '<p class="muted">No targets in betasim.yaml.</p>'}<p><a href="#targets">The targets in detail</a></p></div>
      <div class="box"><h2>The worst findings</h2>${worstFindings ? `<ol class="flist">${worstFindings}</ol>` : '<p class="muted">No B or A findings in this run.</p>'}<p><a href="#findings">All ${findings.length} findings</a></p></div>
    </div>
  </section>
  <section id="targets" class="tab">
    <h2>Targets</h2>
    <p class="lede">The audiences of the plan. Market targets have a weight and a goal: their members' success on the tasks meant for them, weighted by how often the tasks happen. Floors have a threshold that is never traded for gains: nobody below it, on any task meant for them.</p>
    <div class="targets">${targetCards || '<p class="lede">No targets in betasim.yaml.</p>'}</div>
  </section>
  <section id="map" class="tab">
    <h2>Tasks and personas</h2>
    <p class="lede">Each persona's success on each task, in percent, hardest task first. Hover a cell to see where that persona stops; a name opens the persona.</p>
    <div class="scroll"><table class="heat"><thead><tr><th scope="col"></th>${head}<th scope="col">average</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="legend"><span><i class="h5"></i>97% and over</span><span><i class="h4"></i>93–96</span><span><i class="h3"></i>85–92</span><span><i class="h2"></i>70–84</span><span><i class="h1"></i>under 70</span><span><i class="h0"></i>outside the task's audience</span></div>
  </section>
  <section id="findings" class="tab">
    <h2>Findings</h2>
    <div class="filters" role="group" aria-label="Severity">
      <button type="button" id="f-all" data-f="all" aria-pressed="true">All ${findings.length}</button>
      <button type="button" id="f-B" data-f="B" aria-pressed="false">B ${count('B')}</button>
      <button type="button" id="f-A" data-f="A" aria-pressed="false">A ${count('A')}</button>
      <button type="button" id="f-P" data-f="P" aria-pressed="false">P ${count('P')}</button>
    </div>
    <ol class="flist" id="all-findings">${items || '<li class="f"><p class="ft">Nothing to look at in this run.</p></li>'}</ol>
  </section>
  <section id="remedies" class="tab">
    <h2>Simulated remedies</h2>
    <p class="lede">For each problem, the possible fixes applied to the measured paths, including the other flows through the same screen, and tried again by every persona. The number is the change in the targets' weighted success, in points; the preferred fix is the one that helps the targets most. The preferred fixes of different problems on one screen are then tried together: they clash when together they give less than the better one alone.</p>
    ${remedyRows ? `<div class="scroll"><table class="rem"><tbody>${remedyRows}</tbody></table></div>` : '<p class="lede">No remedies to simulate in this run.</p>'}
    ${minor.length ? `<p class="muted">Negligible effect on the targets: ${minor.map(r => `${r.id} "${esc(r.name)}"`).join(', ')}.</p>` : ''}
    ${pairsHtml ? `<ul class="pairs">${pairsHtml}</ul>` : '<p class="muted">No clash between the preferred fixes of problems on the same screen.</p>'}
  </section>
  <section id="coverage" class="tab">
    <h2>Coverage</h2>
    <p class="lede">${cov ? `The plain check, the same for everyone: ${cov.covered} of ${cov.total} features go through at least one flow that clicks them. Green: tried and working; red: the flow breaks; grey: no flow tries it yet.` : 'Coverage is computed when all flows run and the project has a features.yaml.'}</p>
    ${covHtml ? `<div class="areas">${covHtml}</div>` : ''}
  </section>
  <section id="flows" class="tab">
    <h2>Flows and engine</h2>
    <div class="two">
      <div class="scroll"><table class="plain"><thead><tr><th></th><th scope="col">Flow</th><th scope="col" class="num">taps</th><th scope="col" class="num">duration</th></tr></thead><tbody>${flowRows}</tbody></table></div>
      <div class="scroll"><table class="plain"><thead><tr><th></th><th scope="col">Engine case</th></tr></thead><tbody>${engineRows}</tbody></table></div>
    </div>
  </section>
  <section id="personas" class="tab">
    <h2>Personas</h2>
    <p class="lede">The people the tasks are tried with: who they are, the betasim profile they start from, the abilities the model reads, the targets they belong to and the tasks where they struggle most.</p>
    <div class="persons">${people || '<p class="muted">No personas.</p>'}</div>
  </section>
  ${agents.length ? `<section id="llm" class="tab">
    <h2>LLM testers</h2>
    <p class="lede">A persona played by a model, using the real app one move at a time and looking at the screen, without having seen the code. It finds what the numbers miss: where people look for things, what they expect, what hooks them.</p>
    <div class="agents">${agents.map(a => { const e = a.outcome || {}; return `<article class="agent">
      <header><h3>${esc(a.scenario)} · ${esc(a.phase)}</h3><span class="kind">${a.moves} moves</span></header>
      <div class="chips"><span class="badge ${e.success === 'yes' ? 'goal' : ''}">success: ${esc(e.success ?? '—')}</span><span class="badge ${e.hooked === 'yes' ? 'goal' : ''}">hooked: ${esc(e.hooked ?? '—')}</span></div>
      ${e.where_i_got_lost ? `<p><b>Where they got lost.</b> ${esc(e.where_i_got_lost)}</p>` : ''}
      ${e.why ? `<p><b>Why they ${e.hooked === 'no' ? 'would not come back' : 'would come back'}.</b> ${esc(e.why)}</p>` : ''}
      ${e.what_would_make_me_pay ? `<p class="muted"><b>What would make them pay.</b> ${esc(e.what_would_make_me_pay)}</p>` : ''}
    </article>`; }).join('')}</div>
  </section>` : ''}
  <p class="foot">The testers are simulated: they find structural problems (long paths, hidden controls, small targets, jargon, controls a screen reader cannot name), not unexpected misunderstandings. The numbers compare tasks, personas and runs; they do not predict. A test with real people is still needed.</p>
</main>
<script>
(function(){
  // the tabs: the address says which one is open, so a link, a reload or Back keeps it; #persona-x opens Personas at that card
  var links=[].slice.call(document.querySelectorAll('.tabs a')), panels=[].slice.call(document.querySelectorAll('section.tab'));
  function show(){
    var hash=location.hash.slice(1), card=hash.indexOf('persona-')===0 ? document.getElementById(hash) : null;
    var id=card ? 'personas' : (panels.some(function(p){ return p.id===hash; }) ? hash : 'overview');
    panels.forEach(function(p){ p.classList.toggle('on', p.id===id); });
    links.forEach(function(a){ if(a.dataset.tab===id){ a.setAttribute('aria-current','page'); a.scrollIntoView({block:'nearest',inline:'nearest'}); } else a.removeAttribute('aria-current'); });
    if(card){ card.scrollIntoView({block:'start'}); card.focus({preventScroll:true}); } else if(hash) window.scrollTo(0,0);
  }
  window.addEventListener('hashchange', show); show();
  var buttons=[].slice.call(document.querySelectorAll('.filters button'));
  function apply(f){
    buttons.forEach(function(b){ b.setAttribute('aria-pressed', String(b.dataset.f===f)); });
    [].forEach.call(document.querySelectorAll('#all-findings .f[data-sev]'), function(li){ li.hidden = f!=='all' && li.dataset.sev!==f; });
    try{ localStorage.setItem('betasim-filter', f); }catch(e){}
  }
  buttons.forEach(function(b){ b.addEventListener('click', function(){ apply(b.dataset.f); }); });
  var saved='all'; try{ saved=localStorage.getItem('betasim-filter')||'all'; }catch(e){}
  if(buttons.some(function(b){ return b.dataset.f===saved; })) apply(saved);
})();
</script>
`;
}
