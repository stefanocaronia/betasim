import path from 'node:path';
import { REASONS } from './usability/model.mjs';
import { pct } from './util.mjs';

const short = s => { s = String(s || ''); return s.length > 42 ? s.slice(0, 40) + '…' : s; };
const ORDER = { B: 0, A: 1, P: 2 };

/**
 * Turns results into findings with stable ids, so two runs can be compared:
 * E: engine case, F: broken flow, W: flow over its tap budget, U: usability (task, step, reason).
 * Severity follows the project's scale: B blocks, A hurts, P is a detail.
 */
export function buildFindings(results, { personas, tasks, cfg }) {
  const byPersona = Object.fromEntries(personas.map(p => [p.id, p]));
  const byTask = Object.fromEntries(tasks.map(t => [t.id, t]));
  const who = id => { const p = byPersona[id]; return p ? `${p.name || id} (${p.age ?? '?'})` : id; };
  const N = results.meta.runs;
  const out = [];

  for (const r of results.engine || []) {
    if (r.ok) continue;
    out.push({ id: `E:${r.id}`, severity: 'B', kind: 'engine', title: `Il caso del motore «${r.name}» non torna`,
      evidence: r.error ? [r.error] : r.diffs.slice(0, 8),
      suggestion: 'O si corregge il motore, o si corregge il caso: mai indebolire un test senza aver capito quale dei due è sbagliato.' });
  }
  for (const r of results.flows || []) {
    if (!r.ok) {
      out.push({ id: `F:${r.id}`, severity: 'B', kind: 'flow', title: `Il flusso «${r.name}» si ferma al passo ${r.failedAt ?? '?'}`,
        where: { flow: r.id, step: r.failedAt }, evidence: [r.error],
        screenshot: r.screenshot ? path.relative(cfg.dir, r.screenshot).replace(/\\/g, '/') : undefined,
        suggestion: 'Se l’interfaccia è cambiata apposta si aggiorna il flusso; altrimenti è un difetto.' });
    }
    for (const w of r.warnings || []) {
      if (!w.startsWith('console:')) out.push({ id: `W:${r.id}`, severity: 'P', kind: 'flow', title: `Il flusso «${r.name}» supera il suo budget: ${w}`, evidence: [w] });
    }
  }

  const small = {};
  for (const [tid, u] of Object.entries(results.usability || {})) {
    const task = byTask[tid] || { id: tid };
    const goal = short(task.goal || tid);
    if (!u.measurable) { out.push({ id: `U:${tid}:unmeasured`, severity: 'A', kind: 'usability', task: tid, title: `Il compito «${goal}» non si può misurare`, evidence: [u.reason] }); continue; }
    const rows = Object.entries(u.personas);
    if (!rows.length) continue;
    const ranked = [...rows].sort((a, b) => a[1].success - b[1].success);
    const minS = ranked[0][1].success, avgS = rows.reduce((a, [, r]) => a + r.success, 0) / rows.length;
    u.steps.forEach((s, i) => {
      const losses = rows.map(([pid, r]) => [pid, (r.stops[i] || 0) / N]).filter(([, l]) => l > 0).sort((a, b) => b[1] - a[1]);
      if (!losses.length) return;
      const maxL = losses[0][1], avgL = losses.reduce((a, [, l]) => a + l, 0) / rows.length;
      if (maxL < 0.1 && avgL < 0.04) return;
      const m = u.personas[losses[0][0]].steps[i];
      const reason = m.reason || 'choices';
      const R = REASONS[reason] || { label: reason, suggestion: '' };
      // how bad is this step: the share of the most affected persona that gives up here
      const severity = (task.critical && maxL >= 0.15) || maxL >= 0.3 ? 'B' : maxL >= 0.1 ? 'A' : 'P';
      const detail = reason === 'words' && m.term ? ` («${m.term}»)` : reason === 'concept' && s.concept ? ` («${s.concept}»)` : '';
      out.push({
        id: `U:${tid}:${s.step}:${reason}`, severity, kind: 'usability', task: tid,
        title: `«${goal}»: al passo ${s.step}, «${short(s.name)}», ${R.label}${detail}`,
        where: { task: tid, flow: u.flow, step: s.step, target: s.name, route: s.route },
        evidence: [
          `si fermano qui: ${losses.slice(0, 4).map(([pid, l]) => `${who(pid)} ${pct(l)}`).join(', ')}`,
          `riuscita del compito: la peggiore ${who(ranked[0][0])} ${pct(minS)}, la media ${pct(avgS)}`,
        ],
        personas: losses.slice(0, 4).map(([pid]) => pid), suggestion: R.suggestion,
      });
    });
    if (task.expected_seconds) {
      const slow = rows.filter(([, r]) => r.medianT != null && r.medianT > 2 * task.expected_seconds);
      if (slow.length && slow.length >= rows.length / 3) {
        out.push({ id: `U:${tid}:time`, severity: 'A', kind: 'usability', task: tid,
          title: `«${goal}»: ${REASONS.time.label}, ${task.expected_seconds} s`,
          evidence: [`tempo mediano: ${slow.slice(0, 5).map(([pid, r]) => `${who(pid)} ${Math.round(r.medianT)} s`).join(', ')}`],
          suggestion: REASONS.time.suggestion });
      }
    }
    u.steps.forEach((s, i) => {
      const worst = rows.map(([pid, r]) => [pid, r.steps[i].pMis]).sort((a, b) => b[1] - a[1])[0];
      if (!worst || worst[1] < 0.08) return;
      const key = s.name;
      const f = (small[key] ??= { id: `U:small:${short(key)}`, severity: 'P', kind: 'usability', control: key, title: `«${short(key)}», ${s.w}×${s.h}: ${REASONS.small.label}`, evidence: [], tasks: [], suggestion: REASONS.small.suggestion, worst: 0 });
      if (!f.tasks.includes(tid)) f.tasks.push(tid);
      if (worst[1] > f.worst) { f.worst = worst[1]; f.evidence = [`tocco sbagliato: ${who(worst[0])} ${pct(worst[1])}`]; }
    });
  }
  for (const f of Object.values(small)) { delete f.worst; f.evidence.push(`nei compiti: ${f.tasks.join(', ')}`); delete f.tasks; out.push(f); }

  const seen = new Set();
  return out.filter(f => (seen.has(f.id) ? false : seen.add(f.id)))
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.id.localeCompare(b.id));
}
