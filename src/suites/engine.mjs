import { WebDriver } from '../driver/web.mjs';
import { parseDur, fmtDur } from '../util.mjs';

/** A golden case: the project adapter runs it and returns numbers; betasim compares them with `expect`. */
export async function runEngineCase(ctx, c) {
  const { browser, cfg, baseUrl } = ctx;
  const res = { id: c.id, name: c.name || c.id, ok: true, diffs: [], error: null };
  if (!cfg.adapter.engine) { res.ok = false; res.error = 'the adapter has no engine() function'; return res; }
  const d = new WebDriver(browser, cfg, baseUrl);
  try {
    await d.open();
    const tools = { parseDur, advance: ms => d.advance(ms), settle: () => d.settle() };
    const actual = await cfg.adapter.engine(d.page, c, tools);
    res.actual = actual;
    const tol = c.tolerance != null ? parseDur(c.tolerance) : 1000;
    compare(c.expect || {}, actual, '', res.diffs, tol);
    if (d.errors.length) res.diffs.push('page error: ' + d.errors[0]);
    res.ok = !res.diffs.length;
  } catch (err) {
    res.ok = false; res.error = 'runner error: ' + String(err && err.message ? err.message : err).split('\n')[0];
  }
  await d.close();
  return res;
}

// Strings that read as durations ("11m", "4m25s") are compared in milliseconds, within the tolerance;
// plain numbers and everything else must match exactly.
function compare(expected, actual, where, diffs, tol) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    for (const k of Object.keys(expected)) compare(expected[k], actual == null ? undefined : actual[k], where ? `${where}.${k}` : k, diffs, tol);
    return;
  }
  if (Array.isArray(expected)) {
    expected.forEach((e, i) => compare(e, actual == null ? undefined : actual[i], `${where}[${i}]`, diffs, tol));
    return;
  }
  if (typeof expected === 'string' && typeof actual === 'number') {
    if (expected === 'Infinity' && actual === Infinity) return;
    const ms = parseDur(expected);
    if (isFinite(ms)) { if (Math.abs(ms - actual) > tol) diffs.push(`${where}: expected ${expected}, got ${fmtDur(actual)}`); return; }
  }
  if (typeof expected === 'number' && typeof actual === 'number' && Math.abs(expected - actual) < 1e-9) return;
  if (expected !== actual && String(expected) !== String(actual)) diffs.push(`${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
