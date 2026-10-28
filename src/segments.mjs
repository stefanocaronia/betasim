/**
 * Targets, from the project's business plan. Two kinds:
 *  - market: an audience with a weight (what to fix first) and a goal on its weighted success;
 *  - floor: a promise that is never traded for market gains: none of its people falls below
 *    the floor on any task meant for them.
 * A market score is the success of its personas on the tasks meant for them, weighted by how often each task happens.
 */
export function scoreSegments(usability, tasks, segments) {
  const byTask = Object.fromEntries(tasks.map(t => [t.id, t]));
  return (segments || []).map(seg => {
    const members = new Set(seg.personas || []);
    const isFloor = seg.kind === 'floor' || seg.floor != null;
    let num = 0, den = 0, criticalMin = null, cells = 0;
    const perTask = [], pairs = [];
    for (const [tid, u] of Object.entries(usability || {})) {
      if (!u.measurable) continue;
      const rows = Object.entries(u.personas).filter(([pid]) => members.has(pid));
      if (!rows.length) continue;
      const w = byTask[tid]?.frequency ?? 1;
      const avg = rows.reduce((a, [, r]) => a + r.success, 0) / rows.length;
      num += avg * w; den += w; cells += rows.length;
      perTask.push([tid, avg]);
      for (const [pid, r] of rows) pairs.push({ task: tid, persona: pid, success: r.success, critical: !!byTask[tid]?.critical });
      if (byTask[tid]?.critical) for (const [, r] of rows) criticalMin = criticalMin == null ? r.success : Math.min(criticalMin, r.success);
    }
    const score = den ? num / den : null;
    const goal = seg.goal || {};
    const worst = perTask.sort((a, b) => a[1] - b[1])[0] || null;
    pairs.sort((a, b) => a.success - b.success);
    if (isFloor) {
      const floor = seg.floor ?? goal.success ?? 0.9;
      const breaks = pairs.filter(p => p.success < floor);
      return { id: seg.id, name: seg.name || seg.id, kind: 'floor', weight: 0, personas: [...members], floor, goal: { success: floor }, score, worst, worstPair: pairs[0] || null, breaks, ok: score != null && !breaks.length, cells };
    }
    const ok = score != null && (goal.success == null || score >= goal.success) && (goal.critical == null || criticalMin == null || criticalMin >= goal.critical);
    return { id: seg.id, name: seg.name || seg.id, kind: 'market', weight: seg.weight ?? 1, personas: [...members], goal, score, criticalMin, worst, ok, cells };
  });
}

/** The floors that are broken: a finding each, before any market consideration. */
export function floorFindings(segScores, personas) {
  const who = id => { const p = personas.find(x => x.id === id); return p ? `${p.name || id} (${p.age ?? '?'})` : id; };
  return segScores.filter(s => s.kind === 'floor' && s.breaks.length).map(s => ({
    id: `T:${s.id}`, severity: s.breaks.some(b => b.critical) ? 'B' : 'A', kind: 'floor', personas: [...new Set(s.breaks.map(b => b.persona))],
    title: `Below the floor promised to "${s.name}": ${s.breaks.length} ${s.breaks.length === 1 ? 'task' : 'tasks'} under ${Math.round(s.floor * 100)}%`,
    evidence: [s.breaks.slice(0, 6).map(b => `${who(b.persona)} ${Math.round(b.success * 100)}% on ${b.task}`).join(', ')],
    suggestion: 'comes before the market targets: a fix that gains more for the market but leaves someone below the floor is not acceptable',
  }));
}

/** Which targets a finding touches, through the personas it names; the heaviest market target sets its priority. */
export function tagFindings(findings, segments) {
  for (const f of findings) {
    const hit = (segments || []).filter(s => (f.personas || []).some(p => (s.personas || []).includes(p)));
    if (hit.length) { f.segments = hit.map(s => s.id); f.weight = Math.max(...hit.map(s => (s.kind === 'floor' || s.floor != null) ? 0.5 : (s.weight ?? 1))); }
  }
  const order = { B: 0, A: 1, P: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || (b.weight || 0) - (a.weight || 0) || a.id.localeCompare(b.id));
}
