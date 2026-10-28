/**
 * Coverage: the project's list of features (features.yaml) against the flows and engine cases that declare
 * `covers: [feature ids]`. A feature with no flow is a gap; a feature whose flows fail is covered but broken.
 * It is the plain functional check, the same for everybody: every feature is clicked through at least once.
 */
export function coverage(features, flows, engineCases, results) {
  const flowOk = Object.fromEntries((results.flows || []).map(r => [r.id, r.ok]));
  const caseOk = Object.fromEntries((results.engine || []).map(r => [r.id, r.ok]));
  const rows = new Map((features || []).map(f => [f.id, { id: f.id, name: f.name || f.id, area: f.area || '', decision: f.decision, critical: !!f.critical, flows: [], cases: [] }]));
  const unknown = [];
  for (const fl of flows) for (const id of fl.covers || []) { const r = rows.get(id); if (r) r.flows.push(fl.id); else unknown.push(`${fl.id} → ${id}`); }
  for (const c of engineCases) for (const id of c.covers || []) { const r = rows.get(id); if (r) r.cases.push(c.id); else unknown.push(`${c.id} → ${id}`); }
  const list = [...rows.values()].map(r => {
    const ran = [...r.flows.filter(id => id in flowOk), ...r.cases.filter(id => id in caseOk)];
    const failing = [...r.flows.filter(id => flowOk[id] === false), ...r.cases.filter(id => caseOk[id] === false)];
    const status = !r.flows.length && !r.cases.length ? 'missing' : failing.length ? 'failing' : ran.length ? 'ok' : 'not run';
    return { ...r, status, failing };
  });
  const covered = list.filter(r => r.status === 'ok' || r.status === 'failing' || r.status === 'not run').length;
  return { total: list.length, covered, rows: list, unknown };
}

export function coverageFindings(cov) {
  const out = [];
  for (const r of cov.rows) {
    if (r.status === 'missing') out.push({ id: `C:${r.id}`, severity: r.critical ? 'A' : 'P', kind: 'coverage', title: `No flow tries "${r.name}"${r.area ? ` (${r.area})` : ''}`, evidence: [r.decision ? `decision ${r.decision}` : 'from features.yaml'], suggestion: 'write a flow that goes through it, with covers: [' + r.id + ']' });
  }
  if (cov.unknown.length) out.push({ id: 'C:unknown', severity: 'P', kind: 'coverage', title: 'Flows or cases that name features missing from features.yaml', evidence: cov.unknown.slice(0, 8), suggestion: 'fix the id in covers, or add the feature to features.yaml' });
  return out;
}
