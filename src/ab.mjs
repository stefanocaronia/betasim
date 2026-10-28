import fs from 'node:fs';
import path from 'node:path';
import { loadDir, ensureDir } from './util.mjs';
import { loadPersonas } from './personas.mjs';
import { openTarget } from './run.mjs';
import { runFlow } from './suites/flows.mjs';
import { runUsability, audienceOf } from './suites/usability.mjs';
import { simulate } from './usability/model.mjs';
import { rng, hashSeed } from './util.mjs';
import { buildFindings } from './findings.mjs';
import { writeReport } from './report.mjs';
import { scoreSegments, tagFindings, floorFindings } from './segments.mjs';
import { renderDashboard, trendPoint, overallScore, pageHead } from './dashboard.mjs';

/*
 * A/B: the same flows and the same simulated people on two variants of the app. A variant is a setup the adapter
 * applies over every flow (betasim.yaml, `variants`); a step or an argument written per variant ({A: …, B: …})
 * takes the one of its variant. Success is exact from the model, so a difference comes from the paths, not from
 * chance; under TIE two numbers read as equal, because the model's constants are plausible, not measured.
 */
const TIE = 0.01;

export async function runAB(cfg, suites, args) {
  const began = Date.now();
  const ids = (args.ab === true ? cfg.variants.slice(0, 2).map(v => v.id) : String(args.ab).split(',')).map(s => String(s).trim()).filter(Boolean);
  const variants = ids.map(id => cfg.variants.find(v => v.id === id));
  if (ids.length !== 2 || variants.some(v => !v)) throw new Error(`--ab wants two variants of betasim.yaml, e.g. --ab A,B (declared: ${cfg.variants.map(v => v.id).join(', ') || 'none'})`);
  if (variants.some(v => v.setup) && !cfg.adapter.variant) throw new Error('A/B: the adapter needs a variant(page, setup) function');
  const only = args.only ? String(args.only).toLowerCase() : null;
  const pick = xs => (only ? xs.filter(x => x.id.toLowerCase().includes(only)) : xs);
  const runs = +(args.runs || cfg.runs), seed = +(args.seed || cfg.seed);
  cfg.runs = runs;
  const flows = loadDir(cfg.dirs.flows), tasks = pick(loadDir(cfg.dirs.tasks)), personas = loadPersonas(cfg);
  const flowById = Object.fromEntries(flows.map(f => [f.id, f]));
  const say = line => { if (!args.quiet) console.log(line); };
  const base = path.join(cfg.reportDir, 'ab');
  fs.rmSync(base, { recursive: true, force: true }); ensureDir(base);

  const target = await openTarget(cfg, args);
  const sides = [];
  try {
    for (const v of variants) {
      const t0 = Date.now(), dir = path.join(base, v.id);
      const ctx = { browser: target.browser, cfg, baseUrl: target.baseUrl, screensDir: path.join(dir, 'screens'), variant: v };
      const results = { meta: { date: new Date().toLocaleString('en-GB'), runs, seed, personas: personas.length, suites, partial: !!only, variant: `${v.id} ${v.name}` }, engine: [], flows: [], usability: {} };
      const flowResults = {};
      if (suites.includes('flows')) {
        for (const f of pick(flows)) {
          const r = await runFlow(ctx, f);
          flowResults[f.id] = r; results.flows.push(r);
          say(`${v.id} ${r.ok ? '✓' : '✗'} flow ${r.id} (${r.taps} taps)${r.ok ? '' : '  ' + r.error}`);
        }
      }
      if (suites.includes('usability')) {
        results.usability = await runUsability(ctx, tasks, personas, flowById, flowResults, { runs, seed });
        if (!suites.includes('flows')) results.flows = Object.values(flowResults);
      }
      results.meta.seconds = (Date.now() - t0) / 1000;
      results.segments = scoreSegments(results.usability, tasks, cfg.segments);
      let findings = buildFindings(results, { personas, tasks, cfg });
      findings.push(...floorFindings(results.segments, personas));
      findings = tagFindings(findings, cfg.segments);
      writeReport(cfg, results, findings, { dir, prev: null });   // each variant keeps a full report of its own
      fs.writeFileSync(path.join(dir, 'index.html'), renderDashboard({ cfg: { ...cfg, name: `${cfg.name} · ${v.id} ${v.name}` }, results, findings, tasks, personas, segments: cfg.segments, history: [], current: trendPoint(v.id, results, findings, tasks, cfg.segments) }));
      sides.push({ variant: v, results, findings });
    }
  } finally {
    await target.close();
  }
  const cmp = compare(sides, tasks, personas, cfg);
  cmp.assumptions = assumptions(sides, tasks, personas, cfg, runs, seed);
  cmp.meta = { date: new Date().toLocaleString('en-GB'), runs, seed, only, seconds: (Date.now() - began) / 1000, personas: personas.length };
  const text = summaryText(cfg, cmp);
  fs.writeFileSync(path.join(base, 'summary.md'), text);
  fs.writeFileSync(path.join(base, 'ab.json'), JSON.stringify(cmp, null, 1));
  fs.writeFileSync(path.join(base, 'index.html'), abPage(cfg, cmp));
  console.log('\n' + text);
  console.log(`Report: ${base} (summary.md, index.html; ogni variante nella sua cartella)`);
  return sides.some(s => s.results.flows.some(r => !r.ok)) ? 1 : 0;
}

const avg = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = xs => { const v = xs.filter(x => x != null).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };

/** The two variants side by side, only on the tasks both could measure, so every difference is like for like. */
export function compare([a, b], tasks, personas, cfg) {
  const byTask = Object.fromEntries(tasks.map(t => [t.id, t]));
  const who = id => { const p = personas.find(x => x.id === id); return p ? `${p.name || id} (${p.age ?? '?'})` : id; };
  const ua = a.results.usability, ub = b.results.usability;
  const both = Object.keys(ua).filter(t => ua[t].measurable && ub[t]?.measurable);
  const unmeasured = [...new Set([...Object.keys(ua), ...Object.keys(ub)])].filter(t => !both.includes(t))
    .map(t => ({ task: t, A: ua[t]?.measurable ? null : ua[t]?.reason || 'not run', B: ub[t]?.measurable ? null : ub[t]?.reason || 'not run' }));
  const cell = (u, t, p) => u[t].personas[p];
  const common = t => Object.keys(ua[t].personas).filter(p => ub[t].personas[p]);
  const worstOf = (u, t) => common(t).reduce((w, p) => (w == null || cell(u, t, p).success < cell(u, t, w).success ? p : w), null);

  const taskRows = both.map(t => {
    const ps = common(t);
    const sa = avg(ps.map(p => cell(ua, t, p).success)), sb = avg(ps.map(p => cell(ub, t, p).success));
    const wa = worstOf(ua, t), wb = worstOf(ub, t);
    return {
      task: t, critical: !!byTask[t]?.critical, a: sa, b: sb, d: sb - sa,
      tapsA: ua[t].taps + ua[t].inputs, tapsB: ub[t].taps + ub[t].inputs,
      timeA: median(ps.map(p => cell(ua, t, p).medianT)), timeB: median(ps.map(p => cell(ub, t, p).medianT)),
      worstA: wa && { persona: wa, success: cell(ua, t, wa).success }, worstB: wb && { persona: wb, success: cell(ub, t, wb).success },
    };
  }).sort((x, y) => y.d - x.d);

  const personRows = personas.map(p => {
    const ts = both.filter(t => ua[t].personas[p.id] && ub[t].personas[p.id]);
    if (!ts.length) return null;
    const ds = ts.map(t => ({ task: t, d: cell(ub, t, p.id).success - cell(ua, t, p.id).success })).sort((x, y) => y.d - x.d);
    const sa = avg(ts.map(t => cell(ua, t, p.id).success)), sb = avg(ts.map(t => cell(ub, t, p.id).success));
    return { persona: p.id, who: who(p.id), tags: p.tags || [], tasks: ts.length, a: sa, b: sb, d: sb - sa, best: ds[0], worst: ds[ds.length - 1] };
  }).filter(Boolean).sort((x, y) => y.d - x.d);

  const pairs = both.flatMap(t => common(t).map(p => ({ task: t, persona: p, who: who(p), a: cell(ua, t, p).success, b: cell(ub, t, p).success, d: cell(ub, t, p).success - cell(ua, t, p).success })))
    .filter(x => Math.abs(x.d) >= TIE).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));

  const keep = u => Object.fromEntries(both.map(t => [t, u[t]]));
  const segA = scoreSegments(keep(ua), tasks, cfg.segments), segB = scoreSegments(keep(ub), tasks, cfg.segments);
  const segments = segA.map((s, i) => {
    const o = segB[i];
    return {
      id: s.id, name: s.name, kind: s.kind, weight: s.weight, goal: s.goal, floor: s.floor,
      a: s.score, b: o.score, d: s.score != null && o.score != null ? o.score - s.score : null, okA: s.ok, okB: o.ok, critA: s.criticalMin, critB: o.criticalMin,
      breaksA: (s.breaks || []).map(x => ({ ...x, who: who(x.persona) })), breaksB: (o.breaks || []).map(x => ({ ...x, who: who(x.persona) })),
      worstA: s.worstPair ? { ...s.worstPair, who: who(s.worstPair.persona) } : null, worstB: o.worstPair ? { ...o.worstPair, who: who(o.worstPair.persona) } : null,
    };
  });

  const idsA = new Set(a.findings.map(f => f.id)), idsB = new Set(b.findings.map(f => f.id));
  const brief = f => ({ id: f.id, severity: f.severity, title: f.title, segments: f.segments });
  const flows = s => ({ ok: s.results.flows.filter(r => r.ok).length, total: s.results.flows.length, failing: s.results.flows.filter(r => !r.ok).map(r => ({ id: r.id, error: r.error })) });
  return {
    tie: TIE,
    variants: [a, b].map(s => ({ id: s.variant.id, name: s.variant.name })),
    flows: [flows(a), flows(b)],
    tasks: taskRows, unmeasured, personas: personRows, pairs, segments,
    overall: { a: overallScore(keep(ua), tasks), b: overallScore(keep(ub), tasks) },
    findings: { onlyA: a.findings.filter(f => !idsB.has(f.id)).map(brief), onlyB: b.findings.filter(f => !idsA.has(f.id)).map(brief), both: a.findings.filter(f => idsB.has(f.id)).length },
  };
}

/**
 * What the model cannot see, a flow writes as a `concept` on a step of one variant only: an assumption. Each one is
 * tried without it and at double its difficulty, to show how much the verdict leans on it.
 */
export function assumptions(sides, tasks, personas, cfg, runs, seed) {
  const conceptsOf = side => {
    const used = new Set(tasks.map(t => side.results.usability[t.id]?.flow).filter(Boolean));
    const out = new Map();
    for (const f of side.results.flows) if (used.has(f.id)) for (const st of f.trace || []) if (st.concept?.name) {
      const c = out.get(st.concept.name) || { name: st.concept.name, difficulty: st.concept.difficulty ?? 2, steps: 0 };
      c.steps++; out.set(st.concept.name, c);
    }
    return out;
  };
  const [ca, cb] = sides.map(conceptsOf);
  const floorsOf = u => scoreSegments(u, tasks, cfg.segments).filter(x => x.kind === 'floor').map(x => ({ id: x.id, name: x.name, breaks: x.breaks.length }));
  const out = [];
  sides.forEach((side, i) => {
    const mine = i ? cb : ca, other = i ? ca : cb;
    for (const c of mine.values()) {
      if (other.has(c.name)) continue;
      const flows = Object.fromEntries(side.results.flows.map(f => [f.id, f]));
      const tryAt = cd => {
        const u = {};
        for (const t of tasks) {
          const base = side.results.usability[t.id];
          if (!base?.measurable || !flows[base.flow]) continue;
          const trace = flows[base.flow].trace.map(st => (st.concept?.name === c.name ? { ...st, concept: cd ? { ...st.concept, difficulty: cd } : undefined } : st));
          const per = {};
          for (const p of audienceOf(t, personas)) per[p.id] = simulate(trace, p, runs, rng(hashSeed(`${seed}:${t.id}:${p.id}`)), cfg);
          u[t.id] = { ...base, personas: per };
        }
        return { difficulty: cd, overall: overallScore(u, tasks), floors: floorsOf(u) };
      };
      out.push({ variant: side.variant.id, ...c, as: tryAt(c.difficulty), without: tryAt(0), double: tryAt(c.difficulty * 2) });
    }
  });
  return out;
}

const p1 = x => (x == null ? '—' : (x * 100).toFixed(1) + '%');
const pt = d => (d == null ? '—' : `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)} pt`);
const mark = (d, tie) => (d == null ? '' : Math.abs(d) < tie ? '≈' : d > 0 ? '▲' : '▼');
const secs = x => (x == null ? '—' : Math.round(x) + ' s');

const critLine = s => (s.goal?.critical != null && s.critA != null ? ` · critical tasks, lowest ${p1(s.critA)} → ${p1(s.critB)} (at least ${p1(s.goal.critical)})` : '');

function floorLine(s, side) {
  const breaks = side === 'A' ? s.breaksA : s.breaksB, worst = side === 'A' ? s.worstA : s.worstB;
  return breaks.length ? `${breaks.length} below (${breaks.slice(0, 3).map(b => `${b.who} ${b.task} ${p1(b.success)}`).join(', ')}${breaks.length > 3 ? ', …' : ''})`
    : `nobody below${worst ? `, lowest ${p1(worst.success)} (${worst.task})` : ''}`;
}

function summaryText(cfg, c) {
  const [A, B] = c.variants, L = [], tie = c.tie;
  const up = c.tasks.filter(t => t.d >= tie), down = c.tasks.filter(t => t.d <= -tie), even = c.tasks.filter(t => Math.abs(t.d) < tie);
  L.push(`# betasim A/B · ${cfg.name} · ${c.meta.date}`, '');
  L.push(`A "${A.name}" against B "${B.name}" · ${c.tasks.length} tasks measured in both, ${c.meta.personas} personas · exact success from the model, times from ${c.meta.runs} trials (seed ${c.meta.seed}) · ${Math.round(c.meta.seconds)} s`);
  L.push(`Under ${Math.round(tie * 100)} point the two variants are even (≈): the model is plausible, not measured.`);
  L.push('', `Flows: A ${c.flows[0].ok}/${c.flows[0].total} · B ${c.flows[1].ok}/${c.flows[1].total}`);
  c.flows.forEach((f, i) => f.failing.forEach(x => L.push(`✗ ${i ? 'B' : 'A'} ${x.id}: ${x.error}`)));
  L.push('', '## In short');
  L.push(`Weighted success: A ${p1(c.overall.a)} → B ${p1(c.overall.b)} (${pt(c.overall.b - c.overall.a)}). B better on ${up.length} tasks, worse on ${down.length}, even on ${even.length}.`);
  const markets = c.segments.filter(s => s.kind !== 'floor' && s.a != null), floors = c.segments.filter(s => s.kind === 'floor' && s.a != null);
  if (markets.length) {
    L.push('', '## Market targets: A → B (goal)');
    for (const s of markets) L.push(`${s.okA ? '✓' : '✗'}→${s.okB ? '✓' : '✗'} ${String(s.name).padEnd(24)} ${p1(s.a)} → ${p1(s.b)}  ${pt(s.d)} ${mark(s.d, tie)} (goal ${p1(s.goal?.success)})${critLine(s)}`);
  }
  if (floors.length) {
    L.push('', '## Floors: nobody below the floor');
    for (const s of floors) L.push(`${s.okA ? '✓' : '✗'}→${s.okB ? '✓' : '✗'} ${s.name} (floor ${Math.round(s.floor * 100)}%): A ${floorLine(s, 'A')} · B ${floorLine(s, 'B')}`);
  }
  const taskLine = t => `${pt(t.d).padStart(9)} ${mark(t.d, tie)} ${t.task.padEnd(26)} ${p1(t.a)} → ${p1(t.b)} · ${t.tapsA} → ${t.tapsB} taps · ${secs(t.timeA)} → ${secs(t.timeB)}${t.critical ? ' · critical' : ''}`;
  L.push('', '## Tasks that change: average success A → B · taps · median time');
  for (const t of [...up, ...down]) L.push(taskLine(t));
  if (!up.length && !down.length) L.push('None: every task is even.');
  if (even.length) L.push(`Even: ${even.map(t => t.task + (t.tapsA !== t.tapsB ? ` (${t.tapsA} → ${t.tapsB} taps)` : '')).join(', ')}`);
  L.push('', '## Personas: average success A → B · the task where they gain and where they lose most');
  for (const p of c.personas) L.push(`${pt(p.d).padStart(9)} ${mark(p.d, tie)} ${p.who.padEnd(22)} ${p1(p.a)} → ${p1(p.b)}${p.best && p.best.d >= tie ? ` · better ${p.best.task} ${pt(p.best.d)}` : ''}${p.worst && p.worst.d <= -tie ? ` · worse ${p.worst.task} ${pt(p.worst.d)}` : ''}`);
  if (c.pairs.length) {
    L.push('', `## The persona × task pairs that change most (${c.pairs.length} over ${Math.round(tie * 100)} point)`);
    for (const x of c.pairs.slice(0, 15)) L.push(`${pt(x.d).padStart(9)} ${x.who} · ${x.task}  ${p1(x.a)} → ${p1(x.b)}`);
  }
  if ((c.assumptions || []).length) {
    L.push('', '## Assumptions of one variant only: how much the cost the model cannot see weighs');
    const fl = r => r.floors.filter(x => x.breaks).map(x => `${x.name} ${x.breaks} below`).join(', ') || 'nobody below the floors';
    const other = v => (v === c.variants[0].id ? { id: c.variants[1].id, overall: c.overall.b } : { id: c.variants[0].id, overall: c.overall.a });
    for (const a of c.assumptions) {
      const o = other(a.variant);
      L.push(`"${a.name}", only in ${a.variant}, difficulty ${a.difficulty}, ${a.steps} steps (${o.id} ${p1(o.overall)}):`);
      for (const [label, r] of [['without', a.without], ['as is', a.as], ['double', a.double]]) L.push(`   ${label.padEnd(7)} ${a.variant} ${p1(r.overall)} (${pt(r.overall - o.overall)} on ${o.id}) · ${fl(r)}`);
    }
  }
  L.push('', `## To look at: ${c.findings.both} in both`);
  L.push(`Only in A, gone in B (${c.findings.onlyA.length})`);
  for (const f of c.findings.onlyA.slice(0, 12)) L.push(`- ${f.severity} ${f.id}  ${f.title}`);
  L.push(`Only in B, new (${c.findings.onlyB.length})`);
  for (const f of c.findings.onlyB.slice(0, 12)) L.push(`+ ${f.severity} ${f.id}  ${f.title}`);
  if (c.unmeasured.length) {
    L.push('', '## Out of the comparison: not measurable in one of the two');
    for (const u of c.unmeasured) L.push(`${u.task}: ${u.A ? `A ${String(u.A).slice(0, 120)}` : ''}${u.A && u.B ? ' · ' : ''}${u.B ? `B ${String(u.B).slice(0, 120)}` : ''}`);
  }
  L.push('', 'Details: index.html (the comparison page), ab.json, and in A/ and B/ the full report of each variant.');
  return L.join('\n') + '\n';
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

export function abPage(cfg, c) {
  const [A, B] = c.variants, tie = c.tie;
  const cls = d => (d == null || Math.abs(d) < tie ? 'tie' : d > 0 ? 'up' : 'down');
  const delta = d => `<td class="num ${cls(d)}">${esc(pt(d))} ${mark(d, tie)}</td>`;
  const up = c.tasks.filter(t => t.d >= tie).length, down = c.tasks.filter(t => t.d <= -tie).length;
  const pills = [
    ['Flows A', `${c.flows[0].ok}/${c.flows[0].total}`, c.flows[0].failing.length ? 'bad' : 'ok'],
    ['Flows B', `${c.flows[1].ok}/${c.flows[1].total}`, c.flows[1].failing.length ? 'bad' : 'ok'],
    ['Weighted success', `${p1(c.overall.a)} → ${p1(c.overall.b)}`, Math.abs(c.overall.b - c.overall.a) < tie ? 'warn' : c.overall.b > c.overall.a ? 'ok' : 'bad'],
    ['Tasks', `▲ ${up} · ▼ ${down} · ≈ ${c.tasks.length - up - down}`, down > up ? 'bad' : up ? 'ok' : 'warn'],
  ].map(([k, v, s]) => `<div class="pill ${s}"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('');
  const segCards = c.segments.filter(s => s.a != null).map(s => s.kind === 'floor'
    ? `<article class="target floor ${s.okB ? 'ok' : 'miss'}"><header><h3>${esc(s.name)}</h3><span class="kind">floor</span></header>
      <div class="score"><span class="big">${s.breaksA.length} → ${s.breaksB.length}</span><span class="goal">below the ${Math.round(s.floor * 100)}% floor</span></div>
      <p class="status">A: ${esc(floorLine(s, 'A'))}</p><p class="status">B: ${esc(floorLine(s, 'B'))}</p></article>`
    : `<article class="target ${s.okB ? 'ok' : 'miss'}"><header><h3>${esc(s.name)}</h3><span class="w">weight ${s.weight}</span></header>
      <div class="score"><span class="big">${p1(s.b)}</span><span class="goal">B · A ${p1(s.a)} · goal ${p1(s.goal?.success)}</span></div>
      <p class="status ${cls(s.d)}">${esc(pt(s.d))} ${mark(s.d, tie)}</p>${s.goal?.critical != null && s.critA != null ? `<p class="who">Critical tasks, lowest: ${p1(s.critA)} → ${p1(s.critB)} (at least ${p1(s.goal.critical)})</p>` : ''}</article>`).join('');
  const taskRows = c.tasks.map(t => `<tr><th scope="row">${esc(t.task)}${t.critical ? ' <span class="kind">critical</span>' : ''}</th><td class="num">${p1(t.a)}</td><td class="num">${p1(t.b)}</td>${delta(t.d)}<td class="num">${t.tapsA} → ${t.tapsB}</td><td class="num">${secs(t.timeA)} → ${secs(t.timeB)}</td></tr>`).join('');
  const personRows = c.personas.map(p => `<tr><th scope="row">${esc(p.who)}</th><td class="num">${p1(p.a)}</td><td class="num">${p1(p.b)}</td>${delta(p.d)}<td>${p.best && p.best.d >= tie ? `${esc(p.best.task)} <span class="up">${esc(pt(p.best.d))}</span>` : ''}${p.worst && p.worst.d <= -tie ? `${p.best && p.best.d >= tie ? ' · ' : ''}${esc(p.worst.task)} <span class="down">${esc(pt(p.worst.d))}</span>` : ''}</td></tr>`).join('');
  const fl = (xs, sign) => xs.length ? `<ul class="plainlist">${xs.map(f => `<li><span class="sev">${sign} ${esc(f.severity)}</span> ${esc(f.title)} <code>${esc(f.id)}</code></li>`).join('')}</ul>` : '<p class="muted">None.</p>';
  const failing = c.flows.flatMap((f, i) => f.failing.map(x => `<li><b>${i ? 'B' : 'A'}</b> ${esc(x.id)}: ${esc(x.error)}</li>`)).join('');
  return `${pageHead(`${cfg.name} A/B`)}
<style>
.up{color:var(--good)}.down{color:var(--bad)}.tie{color:var(--muted)}
.plain th,.plain td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;font-size:13px;vertical-align:baseline}
.plain thead th{font-weight:500;color:var(--muted);white-space:nowrap}
.plain td.num{font:500 13px var(--mono);white-space:nowrap;text-align:right}
.plain tbody th{font-weight:500;white-space:nowrap}
.plainlist{margin:0;padding-left:18px;display:grid;gap:4px;font-size:14px}.plainlist code{font-size:11px}
.sev{font:500 12px var(--mono);color:var(--muted)}
.muted{color:var(--muted);margin:0}
.target .kind{margin-left:4px}
.status.up,.status.down,.status.tie{font:500 14px var(--mono)}
.target .big{white-space:nowrap}
</style>
<div class="wrap">
  <header class="top">
    <div><h1>A/B · ${esc(A.name)} against ${esc(B.name)}</h1><p class="run">betasim · ${esc(cfg.name)} · ${esc(c.meta.date)} · ${c.tasks.length} tasks, ${c.meta.personas} personas · exact success from the model, times from ${c.meta.runs} trials · seed ${c.meta.seed}</p></div>
    <div class="counts">${pills}</div>
  </header>
  <p class="lede">The same simulated personas do the same tasks on the two variants, A "${esc(A.name)}" and B "${esc(B.name)}". Success is computed exactly from the model: a difference comes from the paths, not from chance. Under ${Math.round(tie * 100)} point the variants are even (≈), because the model's constants are plausible, not measured.</p>
  ${failing ? `<section><h2>Broken flows</h2><ul class="plainlist">${failing}</ul></section>` : ''}
  <section><h2>Targets</h2><div class="targets">${segCards}</div></section>
  <section><h2>Tasks</h2><p class="lede">The average success of each task's audience, from B's biggest gain to its biggest loss.</p>
    <div class="scroll"><table class="plain"><thead><tr><th scope="col">Task</th><th scope="col" class="num">A</th><th scope="col" class="num">B</th><th scope="col" class="num">B − A</th><th scope="col" class="num">taps</th><th scope="col" class="num">median time</th></tr></thead><tbody>${taskRows}</tbody></table></div></section>
  <section><h2>Personas</h2><p class="lede">Each persona's average success on the tasks meant for them, and where B makes them gain and lose most.</p>
    <div class="scroll"><table class="plain"><thead><tr><th scope="col">Persona</th><th scope="col" class="num">A</th><th scope="col" class="num">B</th><th scope="col" class="num">B − A</th><th scope="col">better · worse</th></tr></thead><tbody>${personRows}</tbody></table></div></section>
  ${(c.assumptions || []).length ? `<section><h2>Assumptions</h2><p class="lede">The model does not see everything: what it misses, a flow writes as an idea to grasp on a step of one variant only. Here, the result without that assumption and with twice its weight.</p>
    <div class="scroll"><table class="plain"><thead><tr><th scope="col">Assumption</th><th scope="col">weight</th><th scope="col" class="num">weighted success</th><th scope="col">below the floors</th></tr></thead><tbody>${c.assumptions.flatMap(a => [['without', a.without], ['as is', a.as], ['double', a.double]].map(([label, r], k) => `<tr>${k ? '<th scope="row"></th>' : `<th scope="row">"${esc(a.name)}", only in ${esc(a.variant)} (${a.steps} steps)</th>`}<td>${label} (${r.difficulty})</td><td class="num">${p1(r.overall)}</td><td>${esc(r.floors.filter(x => x.breaks).map(x => `${x.name} ${x.breaks}`).join(', ') || 'none')}</td></tr>`)).join('')}</tbody></table></div></section>` : ''}
  <section><h2>To look at</h2><p class="lede">${c.findings.both} are in both variants.</p>
    <h3>Only in A: B solves them (${c.findings.onlyA.length})</h3>${fl(c.findings.onlyA, '−')}
    <h3>Only in B: B brings them in (${c.findings.onlyB.length})</h3>${fl(c.findings.onlyB, '+')}
  </section>
  ${c.unmeasured.length ? `<section><h2>Out of the comparison</h2><ul class="plainlist">${c.unmeasured.map(u => `<li>${esc(u.task)}: ${esc([u.A && 'A ' + u.A, u.B && 'B ' + u.B].filter(Boolean).join(' · '))}</li>`).join('')}</ul></section>` : ''}
  <p class="foot">The testers are simulated: the comparison says which of the two structures is easier to walk, and for whom, not how much it will be liked. The full report of each variant is in the A/ and B/ folders.</p>
</div>
`;
}
