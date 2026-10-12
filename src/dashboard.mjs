import fs from 'node:fs';
import path from 'node:path';
import { readYaml } from './util.mjs';
import { scoreSegments } from './segments.mjs';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pc = x => (x == null ? '—' : Math.round(x * 100) + '%');

/** The page head of betasim's pages: fonts, colours (light and dark), the shared styles. */
export const pageHead = title => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
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
.pill .v{font:500 15px/1.2 var(--mono)}
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
.fs::before{content:"Proposta: ";color:var(--accent);font-weight:600}
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
.dchip.up{color:var(--good)}.dchip.down{color:var(--bad)}
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
@media (max-width:520px){h1{font-size:24px}.pill{min-width:0;flex:1 1 40%}}
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
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="andamento: ultimo valore ${pct ? pc(lv) : lv}">`
    + `<line class="sp-base" x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}"/>${area}`
    + (pts.length > 1 ? `<polyline class="sp-line" points="${line}"/>` : '')
    + `<circle class="sp-end" cx="${x(li).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="3.2"/></svg>`;
}

const heat = s => (s == null ? 'h0' : s >= 0.97 ? 'h5' : s >= 0.93 ? 'h4' : s >= 0.85 ? 'h3' : s >= 0.7 ? 'h2' : 'h1');

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
    ['Motore', `${engineOk}/${results.engine.length}`, engineOk === results.engine.length ? 'ok' : 'bad'],
    ['Flussi', `${flowsOk}/${results.flows.length}`, flowsOk === results.flows.length ? 'ok' : 'bad'],
    ['Riuscita pesata', pc(current.overall), current.overall >= 0.95 ? 'ok' : current.overall >= 0.9 ? 'warn' : 'bad'],
    ['Finding', `B ${count('B')} · A ${count('A')} · P ${count('P')}`, count('B') ? 'bad' : count('A') ? 'warn' : 'ok'],
  ].map(([k, v, s]) => `<div class="pill ${s}"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('');

  const who = id => byPersona[id]?.name || id;
  const floorCard = s => `<article class="target floor ${s.ok ? 'ok' : 'miss'}">
      <header><h3>${esc(s.name)}</h3><span class="kind">impegno</span></header>
      <div class="score"><span class="big">${pc(s.worstPair?.success)}</span><span class="goal">il più basso · soglia ${pc(s.floor)}</span></div>
      <p class="status">${s.ok ? 'Nessuno sotto la soglia' : `${s.breaks.length} sotto la soglia: ${s.breaks.slice(0, 3).map(b => `${esc(who(b.persona))} su <b>${esc(b.task)}</b> ${pc(b.success)}`).join(', ')}`}</p>
      <p class="who">${s.personas.map(id => esc(who(id))).join(', ')}</p>
    </article>`;
  const targetCards = segScores.map(s => s.kind === 'floor' ? floorCard(s) : `<article class="target ${s.ok ? 'ok' : 'miss'}">
      <header><h3>${esc(s.name)}</h3><span class="w" title="peso nel piano">${'●'.repeat(s.weight)}${'○'.repeat(Math.max(0, 3 - s.weight))}</span></header>
      <div class="score"><span class="big">${pc(s.score)}</span><span class="goal">obiettivo ${pc(s.goal.success)}</span></div>
      <p class="status">${s.ok ? 'Raggiunto' : 'Sotto l’obiettivo'}${s.worst ? ` · il compito peggiore: <b>${esc(s.worst[0])}</b> ${pc(s.worst[1])}` : ''}</p>
      ${s.goal.critical != null && s.criticalMin != null ? `<p class="status">Compiti critici: la persona peggiore ${pc(s.criticalMin)}, l’obiettivo ${pc(s.goal.critical)}</p>` : ''}
      <p class="who">${s.personas.map(id => esc(byPersona[id]?.name || id)).join(', ')}</p>
      ${spark(runs.map(r => r.segs?.[s.id] ?? null), { min: 0.7 })}
    </article>`).join('');

  const head = usedPersonas.map(p => `<th scope="col" title="${esc(p.summary || '')}"><span>${esc(p.name || p.id)}</span><small>${p.age ?? ''}</small></th>`).join('');
  const rows = U.map(([tid, u]) => {
    const t = tasks.find(x => x.id === tid) || {};
    if (!u.measurable) return `<tr><th scope="row" title="${esc(t.goal || '')}">${esc(tid)}</th><td colspan="${usedPersonas.length + 1}" class="na">non misurabile: ${esc(u.reason)}</td></tr>`;
    const vals = Object.values(u.personas).map(r => r.success);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const cells = usedPersonas.map(p => {
      const r = u.personas[p.id];
      if (!r) return '<td class="h0"></td>';
      const stop = Object.entries(r.stops).sort((a, b) => b[1] - a[1])[0];
      const why = stop ? ` · si ferma al passo ${u.steps[stop[0]]?.step} (${u.steps[stop[0]]?.name || ''})` : '';
      return `<td class="${heat(r.success)}" title="${esc(`${p.name}: ${pc(r.success)} · mediana ${r.medianT ?? '—'} s${why}`)}">${Math.round(r.success * 100)}</td>`;
    }).join('');
    return { avg, html: `<tr><th scope="row" title="${esc(t.goal || '')}">${esc(tid)}${t.critical ? ' <i class="crit" title="critico">!</i>' : ''}</th>${cells}<td class="avg ${heat(avg)}">${Math.round(avg * 100)}</td></tr>` };
  }).sort((a, b) => (a.avg ?? -1) - (b.avg ?? -1)).map(r => r.html || r).join('');

  const segName = Object.fromEntries(segScores.map(s => [s.id, s.name]));
  const items = findings.map(f => `<li class="f sev-${f.severity}" data-sev="${f.severity}">
      <div class="fh"><span class="sev">${f.severity}</span><code>${esc(f.id)}</code>${(f.segments || []).map(s => `<span class="seg">${esc(segName[s] || s)}</span>`).join('')}</div>
      <p class="ft">${esc(f.title)}</p>
      ${(f.evidence || []).map(e => `<p class="fe">${esc(e)}</p>`).join('')}
      ${f.suggestion ? `<p class="fs">${esc(f.suggestion)}</p>` : ''}
      ${f.screenshot ? `<p class="fe">schermata: <code>${esc(f.screenshot)}</code></p>` : ''}
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
      const goal = o.reachesGoal?.length ? `<span class="badge goal">porta sopra l’obiettivo: ${esc(o.reachesGoal.map(id => segN[id] || id).join(', '))}</span>` : '';
      const time = Math.abs(o.timeDelta || 0) >= 0.1 ? `<span class="dchip ${o.timeDelta < 0 ? 'up' : 'down'}">tempo ${o.timeDelta > 0 ? '+' : '−'}${Math.abs(o.timeDelta).toFixed(1)} s</span>` : '';
      return `<li class="${pref ? 'pref' : ''}"><span class="opt">${pref ? '<span class="badge pref">preferita</span> ' : ''}${esc(o.label)}</span><span class="num">${pt(o.gain)}</span><div class="chips">${chipsOf(o)}${time}${goal}</div></li>`;
    }).join('');
    return `<tr><th scope="row"><code>${r.id}</code></th><td><b>«${esc(r.name)}»</b> <span class="muted">· ${esc(r.screen)} · ${esc(r.findings.join(', '))}</span>${lost ? ' <span class="badge lose">in collisione: scartata</span>' : ''}<ul class="opts">${opts}</ul></td></tr>`;
  }).join('');
  const minor = (results.remedies || []).filter(r => r.negligible);
  const pairsHtml = pairs.map(p => `<li class="pair ${p.kind}">${p.kind === 'collide'
    ? `<b>${p.a}</b> e <b>${p.b}</b> collidono: insieme ${pt(p.together)} punti, meno del migliore dei due da solo. Preferito <b>${p.preferred}</b>, quello che serve di più ai target.`
    : p.kind === 'synergy' ? `<b>${p.a}</b> e <b>${p.b}</b> insieme rendono più della somma: ${pt(p.together)} punti.`
    : `<b>${p.a}</b> e <b>${p.b}</b> si ostacolano: insieme ${pt(p.together)} punti.`}</li>`).join('');
  const cov = results.coverage;
  const covHtml = cov ? [...new Set(cov.rows.map(r => r.area || '—'))].map(a => `<div class="area"><h3>${esc(a)}</h3><ul class="feat">${cov.rows.filter(r => (r.area || '—') === a)
    .map(r => `<li class="st-${r.status.replace(' ', '-')}"><span class="dot" aria-hidden="true"></span><span>${esc(r.name)}</span>${r.flows.length || r.cases.length ? `<code>${esc([...r.flows, ...r.cases].slice(0, 2).join(', '))}${r.flows.length + r.cases.length > 2 ? '…' : ''}</code>` : '<code>nessun flusso</code>'}</li>`).join('')}</ul></div>`).join('') : '';
  const trend = `<div class="trend">
      <div><h3>Riuscita pesata</h3>${spark(runs.map(r => r.overall), { min: 0.7 })}<p class="last">${pc(current.overall)} in questo giro</p></div>
      <div><h3>Finding B e A</h3>${spark(runs.map(r => r.B + r.A), { min: 0, max: Math.max(1, ...runs.map(r => r.B + r.A)), pct: false })}<p class="last">${count('B') + count('A')} in questo giro</p></div>
      <div><h3>Giri</h3><p class="last">${runs.length} (${esc(runs[0]?.date || '')} → ${esc(current.date || '')})</p></div>
    </div>`;

  return `${pageHead(`${cfg.name} betasim`)}<div class="wrap">
  <header class="top">
    <div><h1>${esc(cfg.name)}</h1><p class="run">betasim · giro del ${esc(m.date)} · ${m.runs} prove per coppia persona-compito · seme ${m.seed} · ${Math.round(m.seconds)} s</p></div>
    <div class="counts">${pills}</div>
  </header>
  <section id="target">
    <h2>Target</h2>
    <p class="lede">I pubblici del piano. Quelli di mercato hanno un peso e un obiettivo: la riuscita dei loro membri sui compiti pensati per loro, pesata su quanto spesso capitano. Quelli d’impegno hanno una soglia che non si scambia con i guadagni: nessuno sotto, su nessun compito pensato per lui.</p>
    <div class="targets">${targetCards || '<p class="lede">Nessun target in betasim.yaml.</p>'}</div>
  </section>
  <section id="mappa">
    <h2>Compiti e persone</h2>
    <p class="lede">La riuscita di ogni persona su ogni compito, in percentuale, dal compito più difficile in su. Passando sopra una casella si vede dove quella persona si ferma.</p>
    <div class="scroll"><table class="heat"><thead><tr><th scope="col"></th>${head}<th scope="col">media</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="legend"><span><i class="h5"></i>97% e oltre</span><span><i class="h4"></i>93–96</span><span><i class="h3"></i>85–92</span><span><i class="h2"></i>70–84</span><span><i class="h1"></i>sotto 70</span><span><i class="h0"></i>fuori dal pubblico del compito</span></div>
  </section>
  <section id="finding">
    <h2>Finding</h2>
    <div class="filters" role="group" aria-label="Gravità">
      <button type="button" id="f-all" data-f="all" aria-pressed="true">Tutti ${findings.length}</button>
      <button type="button" id="f-B" data-f="B" aria-pressed="false">B ${count('B')}</button>
      <button type="button" id="f-A" data-f="A" aria-pressed="false">A ${count('A')}</button>
      <button type="button" id="f-P" data-f="P" aria-pressed="false">P ${count('P')}</button>
    </div>
    <ol class="flist">${items || '<li class="f"><p class="ft">Niente da guardare in questo giro.</p></li>'}</ol>
  </section>
  ${(results.agents || []).length ? `<section id="llm">
    <h2>Tester LLM</h2>
    <p class="lede">Una persona interpretata da un modello, che usa l’app vera una mossa alla volta guardando lo schermo, senza aver mai visto il codice. Trova quello che i numeri non vedono: dove cerca le cose, cosa si aspetta, cosa la aggancia.</p>
    <div class="agents">${results.agents.map(a => { const e = a.esito || {}; return `<article class="agent">
      <header><h3>${esc(a.scenario)} · ${esc(a.phase)}</h3><span class="kind">${a.moves} mosse</span></header>
      <div class="chips"><span class="badge ${e.riuscita === 'sì' ? 'goal' : ''}">riuscita: ${esc(e.riuscita ?? '—')}</span><span class="badge ${e.agganciata === 'sì' ? 'goal' : ''}">agganciata: ${esc(e.agganciata ?? '—')}</span></div>
      ${e.dove_mi_sono_persa ? `<p><b>Dove si è persa.</b> ${esc(e.dove_mi_sono_persa)}</p>` : ''}
      ${e.perché ? `<p><b>Perché ${e.agganciata === 'no' ? 'non torna' : 'torna'}.</b> ${esc(e.perché)}</p>` : ''}
      ${e.cosa_mi_farebbe_pagare ? `<p class="muted"><b>Cosa la farebbe pagare.</b> ${esc(e.cosa_mi_farebbe_pagare)}</p>` : ''}
    </article>`; }).join('')}</div>
  </section>` : ''}
  <section id="rimedi">
    <h2>Rimedi simulati</h2>
    <p class="lede">Per ogni problema, le soluzioni possibili applicate ai percorsi misurati, anche agli altri flussi che passano dalla stessa schermata, e rifatte provare a tutte le persone. Il numero è quanto cambia la riuscita pesata dei target, in punti; la preferita è quella che serve di più ai target. Poi le preferite di problemi diversi sulla stessa schermata si provano insieme: collidono se insieme rendono meno della migliore da sola.</p>
    ${remedyRows ? `<div class="scroll"><table class="rem"><tbody>${remedyRows}</tbody></table></div>` : '<p class="lede">Nessun rimedio da simulare in questo giro.</p>'}
    ${minor.length ? `<p class="muted">Effetto trascurabile sui target: ${minor.map(r => `${r.id} «${esc(r.name)}»`).join(', ')}.</p>` : ''}
    ${pairsHtml ? `<ul class="pairs">${pairsHtml}</ul>` : '<p class="muted">Nessuna collisione tra le soluzioni preferite dei problemi sulla stessa schermata.</p>'}
  </section>
  <section id="copertura">
    <h2>Copertura</h2>
    <p class="lede">${cov ? `Il controllo di base, uguale per tutti: ${cov.covered} funzioni su ${cov.total} passano per almeno un flusso che le clicca. Verde: provata e funziona; rosso: il flusso si rompe; grigio: nessun flusso la prova ancora.` : 'La copertura si calcola quando girano tutti i flussi e il progetto ha un features.yaml.'}</p>
    ${covHtml ? `<div class="areas">${covHtml}</div>` : ''}
  </section>
  <section id="andamento">
    <h2>Andamento</h2>
    ${trend}
  </section>
  <section id="flussi">
    <h2>Flussi e motore</h2>
    <div class="two">
      <div class="scroll"><table class="plain"><thead><tr><th></th><th scope="col">Flusso</th><th scope="col" class="num">tocchi</th><th scope="col" class="num">durata</th></tr></thead><tbody>${flowRows}</tbody></table></div>
      <div class="scroll"><table class="plain"><thead><tr><th></th><th scope="col">Caso del motore</th></tr></thead><tbody>${engineRows}</tbody></table></div>
    </div>
  </section>
  <p class="foot">I tester sono simulati: trovano i problemi di struttura (percorsi lunghi, comandi nascosti, bersagli piccoli, gergo, elementi muti per TalkBack), non i fraintendimenti imprevisti. I numeri servono a confrontare compiti, persone e giri, non a predire. Il test con persone vere resta.</p>
</div>
<script>
(function(){
  var buttons=[].slice.call(document.querySelectorAll('.filters button'));
  function apply(f){
    buttons.forEach(function(b){ b.setAttribute('aria-pressed', String(b.dataset.f===f)); });
    [].forEach.call(document.querySelectorAll('.f[data-sev]'), function(li){ li.hidden = f!=='all' && li.dataset.sev!==f; });
    try{ localStorage.setItem('betasim-filter', f); }catch(e){}
  }
  buttons.forEach(function(b){ b.addEventListener('click', function(){ apply(b.dataset.f); }); });
  var saved='all'; try{ saved=localStorage.getItem('betasim-filter')||'all'; }catch(e){}
  if(buttons.some(function(b){ return b.dataset.f===saved; })) apply(saved);
})();
</script>
`;
}
