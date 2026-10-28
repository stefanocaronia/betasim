import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, readYaml, toYaml, stamp, pct } from './util.mjs';

/** Moves the previous `latest` into history (the last 12 are kept) and returns its findings, for the diff. */
export function prepareReport(cfg, { partial = false } = {}) {
  const base = cfg.reportDir, latest = path.join(base, 'latest'), historyDir = path.join(base, 'history');
  let prev = null;
  // a partial run (some suites, or --only) never replaces the last full run: it goes to partial/ and is compared with it
  if (partial) {
    const pf = path.join(latest, 'findings.yaml');
    if (fs.existsSync(pf)) prev = readYaml(pf) || [];
    const dir = path.join(base, 'partial');
    fs.rmSync(dir, { recursive: true, force: true }); ensureDir(dir);
    return { dir, screensDir: path.join(dir, 'screens'), prev, partial: true };
  }
  if (fs.existsSync(latest)) {
    const pf = path.join(latest, 'findings.yaml');
    if (fs.existsSync(pf)) prev = readYaml(pf) || [];
    ensureDir(historyDir);
    const dest = path.join(historyDir, stamp(fs.statSync(latest).mtime));
    try { fs.renameSync(latest, dest); } catch { fs.rmSync(latest, { recursive: true, force: true }); }
    const all = fs.readdirSync(historyDir).sort();
    for (const old of all.slice(0, Math.max(0, all.length - 12))) fs.rmSync(path.join(historyDir, old), { recursive: true, force: true });
  }
  ensureDir(latest);
  return { dir: latest, screensDir: path.join(latest, 'screens'), prev };
}

export function diffFindings(prev, now) {
  if (!prev) return null;
  const before = new Map(prev.map(f => [f.id, f])), after = new Map(now.map(f => [f.id, f]));
  return { added: now.filter(f => !before.has(f.id)), resolved: prev.filter(f => !after.has(f.id)), kept: now.filter(f => before.has(f.id)) };
}

export function writeReport(cfg, results, findings, rep) {
  const { dir, prev } = rep;
  const traces = path.join(dir, 'traces');
  ensureDir(traces);
  for (const f of results.flows) {
    fs.writeFileSync(path.join(traces, `${f.id}.yaml`), toYaml({
      flow: f.id, ok: f.ok, taps: f.taps, inputs: f.inputs, error: f.error || undefined,
      steps: f.trace.map(s => ({
        step: s.step, kind: s.kind, name: s.name, size: `${s.w}x${s.h}`, route: s.screen?.route, layer: s.screen?.layer,
        choices: s.screen?.choices, words: s.screen?.words,
        hidden: s.disclosure || undefined, offscreen: s.offscreen || undefined, iconOnly: s.iconOnly || undefined,
        unnamed: s.labelled ? undefined : true, notAButton: s.actionable ? undefined : true,
        noKeyboard: s.keyboard === false || undefined, tabs: s.keySteps ?? undefined, concept: s.concept?.name,
      })),
    }));
  }
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 1));
  fs.writeFileSync(path.join(dir, 'findings.yaml'), findings.length ? toYaml(findings) : '[]\n');
  const diff = diffFindings(prev, findings);
  const summary = summaryText(cfg, results, findings, diff);
  fs.writeFileSync(path.join(dir, 'summary.md'), summary);
  return { summary, diff };
}

const pt = x => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pt`;
const short = s => { s = String(s || ''); return s.length > 36 ? s.slice(0, 34) + '…' : s; };

function summaryText(cfg, results, findings, diff) {
  const L = [], m = results.meta;
  const engineOk = results.engine.filter(r => r.ok).length, flowsOk = results.flows.filter(r => r.ok).length;
  const U = Object.entries(results.usability || {});
  L.push(`# betasim · ${cfg.name} · ${m.date}`, '');
  L.push(`Engine ${engineOk}/${results.engine.length} · Flows ${flowsOk}/${results.flows.length} · Usability: ${U.length} tasks, ${m.personas} personas, ${m.runs} trials per pair (seed ${m.seed}) · ${Math.round(m.seconds)} s`);
  if (diff) {
    L.push('', '## Since the last run', `New ${diff.added.length} · Solved ${diff.resolved.length} · Still there ${diff.kept.length}`);
    for (const f of diff.added.slice(0, 10)) L.push(`+ ${f.severity} ${f.id}  ${f.title}`);
    for (const f of diff.resolved.slice(0, 10)) L.push(`- ${f.severity} ${f.id}  ${f.title}`);
  }
  if ((results.segments || []).some(s => s.score != null)) {
    L.push('', '## Market targets: weighted success · goal · worst task');
    for (const s of results.segments.filter(x => x.kind !== 'floor')) L.push(`${s.ok ? '✓' : '✗'} ${String(s.name).padEnd(22)} ${pct(s.score)} · goal ${pct(s.goal?.success)}${s.goal?.critical != null && s.criticalMin != null ? ` · critical tasks ${pct(s.criticalMin)} (at least ${pct(s.goal.critical)})` : ''} · ${s.worst ? `${s.worst[0]} ${pct(s.worst[1])}` : '—'}`);
  }
  const floorSegs = (results.segments || []).filter(s => s.kind === 'floor' && s.score != null);
  if (floorSegs.length) {
    L.push('', '## Floors: nobody below the floor, on the tasks meant for them');
    for (const s of floorSegs) L.push(`${s.ok ? '✓' : '✗'} ${String(s.name).padEnd(30)} ${s.ok ? `lowest ${pct(s.worstPair?.success)} (${s.worstPair?.task})` : `${s.breaks.length} under ${pct(s.floor)}: ${s.breaks.slice(0, 3).map(b => `${b.task} ${pct(b.success)}`).join(', ')}`}`);
  }
  L.push('', `## To look at (${findings.length})`);
  for (const f of findings.slice(0, 20)) {
    L.push(`${f.severity} ${f.id}  ${f.title}${f.segments ? `  [${f.segments.join(', ')}]` : ''}`);
    if (f.evidence?.length) L.push(`   ${f.evidence.slice(0, 2).join(' · ')}`);
  }
  if (findings.length > 20) L.push(`… ${findings.length - 20} more in findings.yaml`);
  if ((results.remedies || []).length) {
    const segName = Object.fromEntries((results.segments || []).map(s => [s.id, s.name]));
    const gainOf = id => results.remedies.find(r => r.id === id)?.gain ?? 0;
    const names = ids => ids.map(id => segName[id] || id).join(', ');
    L.push('', '## Simulated remedies: the fixes tried for each problem, in points of the targets\' weighted success; ✓ the preferred one');
    const minor = results.remedies.filter(r => r.negligible);
    for (const r of results.remedies.filter(x => !x.negligible).slice(0, 10)) {
      L.push(`${r.id} "${short(r.name)}", ${r.screen} (${r.findings.join(', ')})${r.harmful ? ' · no fix helps' : ''}`);
      for (const o of r.options) {
        const top = Object.entries(o.perSegment || {}).filter(([, d]) => Math.abs(d) >= 0.0005).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id, d]) => `${segName[id] || id} ${pt(d)}`).join(', ');
        L.push(`   ${o.variant === r.preferred ? '✓' : ' '} ${pt(o.gain).padStart(8)}  ${o.label}${o.floorDelta > 0 ? ` · leaves ${o.floorDelta} more below a floor` : o.floorDelta < 0 ? ` · brings ${-o.floorDelta} back above a floor` : ''}${Math.abs(o.timeDelta || 0) >= 0.1 ? ` · time ${o.timeDelta > 0 ? '+' : '−'}${Math.abs(o.timeDelta).toFixed(1)} s` : ''}${top ? ` · ${top}` : ''}${o.reachesGoal?.length ? ` · brings ${names(o.reachesGoal)} above its goal` : ''}${o.sideEffects?.length ? ` · worsens ${names(o.sideEffects)}` : ''}`);
      }
    }
    if (minor.length) L.push(`Negligible effect on the targets: ${minor.map(r => `${r.id} "${short(r.name)}"`).join(', ')}`);
    if (!(results.remedyPairs || []).length) L.push('No clash between the preferred fixes of problems on the same screen.');
    for (const p of results.remedyPairs || []) {
      const alone = `${p.a} alone ${pt(gainOf(p.a))}, ${p.b} ${pt(gainOf(p.b))}`;
      if (p.kind === 'collide') L.push(`✗ ${p.a} and ${p.b} clash: together ${pt(p.together)}, ${alone} → preferred ${p.preferred}`);
      else if (p.kind === 'synergy') L.push(`+ ${p.a} and ${p.b} together give more than the sum: ${pt(p.together)} (${alone})`);
      else L.push(`~ ${p.a} and ${p.b} get in each other's way: together ${pt(p.together)} (${alone})`);
    }
  }
  if (results.coverage) {
    const c = results.coverage;
    L.push('', `## Coverage: ${c.covered} of ${c.total} features go through at least one flow (${pct(c.total ? c.covered / c.total : 0)})`);
    const failing = c.rows.filter(r => r.status === 'failing'), missing = c.rows.filter(r => r.status === 'missing');
    if (failing.length) L.push(`Broken: ${failing.map(r => r.id).join(', ')}`);
    if (missing.length) L.push(`No flow: ${missing.map(r => r.id).join(', ')}`);
  }
  if (U.length) {
    L.push('', '## Tasks: average success · worst persona · median time · taps');
    const rows = U.map(([tid, u]) => {
      if (!u.measurable) return [tid, -1, `not measurable: ${String(u.reason).slice(0, 100)}`];
      const ps = Object.entries(u.personas);
      if (!ps.length) return [tid, 2, 'no persona in its audience'];
      const avg = ps.reduce((a, [, r]) => a + r.success, 0) / ps.length;
      const worst = [...ps].sort((a, b) => a[1].success - b[1].success)[0];
      const med = ps.map(([, r]) => r.medianT).filter(x => x != null).sort((a, b) => a - b);
      const mt = med.length ? Math.round(med[Math.floor(med.length / 2)]) + ' s' : '—';
      return [tid, avg, `${pct(avg)} · ${worst[0]} ${pct(worst[1].success)} · ${mt} · ${u.taps + u.inputs}`];
    }).sort((a, b) => a[1] - b[1]);
    for (const [tid, , txt] of rows) L.push(`${tid.padEnd(26)} ${txt}`);
    const byPersona = {};
    for (const [tid, u] of U) if (u.measurable) for (const [pid, r] of Object.entries(u.personas)) (byPersona[pid] ??= []).push([tid, r.success]);
    L.push('', '## Personas: average success · worst task');
    const prow = Object.entries(byPersona).map(([pid, xs]) => {
      const avg = xs.reduce((a, [, s]) => a + s, 0) / xs.length;
      const w = [...xs].sort((a, b) => a[1] - b[1])[0];
      return [pid, avg, `${pct(avg)} · ${w[0]} ${pct(w[1])}`];
    }).sort((a, b) => a[1] - b[1]);
    for (const [pid, , txt] of prow) L.push(`${pid.padEnd(20)} ${txt}`);
  }
  if ((results.agents || []).length) {
    L.push('', '## LLM testers: personas played by a model, on the real app');
    for (const a of results.agents) { const e = a.outcome || {}; L.push(`${a.scenario} / ${a.phase}: ${a.moves} moves · success ${e.success ?? '—'} · hooked ${e.hooked ?? '—'}${e.where_i_got_lost ? ` · got lost: ${String(e.where_i_got_lost).slice(0, 140)}…` : ''}`); }
  }
  L.push('', 'Details: index.html (the dashboard), findings.yaml (each finding with evidence and a proposal), traces/ (the measured paths), results.json, screens/ (the failures).');
  return L.join('\n') + '\n';
}
