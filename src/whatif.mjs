import { simulate } from './usability/model.mjs';
import { scoreSegments } from './segments.mjs';
import { audienceOf } from './suites/usability.mjs';
import { rng, hashSeed } from './util.mjs';

/*
 * What-if of remedies. Every problem found (a hidden option, a command off screen, a small target, a hard word...)
 * gets one or more alternative solutions. Each one is applied to every measured path that goes through the same
 * screen, with its side effects: an expander opened for everybody makes the screen longer and fuller for the flows
 * that never needed it; a pinned bar takes room from the rest; a command moved up pushes the others down.
 * Then every persona tries every task again and the targets are scored. For each problem the alternative that
 * serves the targets best is the preferred one; then the preferred solutions of different problems on the same
 * screen are tried together: they collide when together they give less than the better of the two alone.
 */

const VARIANTS = {
  hidden: [
    ['reveal-one', 'bring only the needed control into view'],
    ['hint', 'have the expander say what it hides'],
    ['reveal-all', 'open the expander for everyone'],
  ],
  offscreenButton: [
    ['pin-row', 'pin the button row in view'],
    ['move-up', 'move the control higher'],
  ],
  offscreen: [
    ['move-up', 'move the control higher'],
    ['shorten', 'shorten what is above it'],
  ],
  small: [['enlarge', 'make the target 48 dp']],
  words: [['simpler', 'a simpler word']],
  icon: [['word', 'a word beside the icon']],
  a11y: [['name', 'a name and a role for screen readers']],
  a11yWeak: [['label', 'tie the label to the field']],
  keys: [['focus', 'reachable with the keyboard']],
  ambiguous: [['rename', 'different names for the same-named controls']],
  concept: [['explain', 'explain the idea where it is needed']],
  input: [['presets', 'ready values instead of the field']],
};

export function screenKeyOf(cfg, screen) {
  const route = screen?.route || '';
  for (const [re, name] of Object.entries(cfg.screens || {})) {
    try { if (new RegExp(re).test(route)) return name; } catch { /* a bad pattern is ignored */ }
  }
  return route;
}
const controlKey = t => {
  if (t == null) return '';
  if (typeof t !== 'object') return String(t).toLowerCase();
  if (t.label != null) return 'label:' + String(t.label).toLowerCase();
  if (t.id != null) return 'id:' + t.id;
  if (t.css != null) return 'css:' + t.css;
  return String(t.text ?? '').toLowerCase();
};
const controlText = t => String(t && typeof t === 'object' ? (t.text ?? t.label ?? '') : (t ?? '')).toLowerCase();

/** The problems behind the findings, one per (reason, screen, command), each with its alternative solutions. */
export function problemsFrom(findings, usability, flowResults, cfg) {
  const byKey = new Map();
  const add = (f, reason, s, trace) => {
    if (!s) return;
    const kind = reason === 'offscreen' && s.role === 'button' ? 'offscreenButton' : reason;
    if (!VARIANTS[kind]) return;
    const screen = screenKeyOf(cfg, s.screen), control = controlKey(s.target);
    const key = reason === 'small' ? `small|${screen}|${s.name}` : `${reason}|${screen}|${control}`;
    if (!byKey.has(key)) {
      // for an expander: the command the flow needed under it, to bring only that one into view
      const idx = trace ? trace.indexOf(s) : -1;
      const next = idx >= 0 ? trace.slice(idx + 1).find(x => screenKeyOf(cfg, x.screen) === screen) : null;
      byKey.set(key, { id: `R${byKey.size + 1}`, reason, kind, screen, control, text: controlText(s.target), name: s.name, need: next ? { h: next.h, name: next.name } : null, findings: [] });
    }
    const p = byKey.get(key);
    if (!p.findings.includes(f.id)) p.findings.push(f.id);
  };
  for (const f of findings) {
    if (f.kind !== 'usability') continue;
    const parts = f.id.split(':');
    if (parts[1] === 'small') {
      for (const fr of Object.values(flowResults)) for (const s of fr.trace || []) if (s.name === f.control) add(f, 'small', s, fr.trace);
      continue;
    }
    const [, tid, stepNo, reason] = parts;
    const u = usability[tid];
    const trace = u && flowResults[u.flow]?.trace;
    add(f, reason, trace && trace.find(s => String(s.step) === stepNo), trace);
  }
  return [...byKey.values()];
}

function revealTable(flowResults, cfg) {
  const t = {};
  for (const fr of Object.values(flowResults)) for (const s of fr.trace || []) {
    if (!s.reveal) continue;
    const k = `${screenKeyOf(cfg, s.screen)}|${controlText(s.target)}`;
    if (!t[k] || s.reveal.dh > t[k].dh) t[k] = s.reveal;
  }
  return t;
}

const offByGeo = (s, g) => g.top + s.h > g.scrollTop + g.viewH || g.top < g.scrollTop;

/** Applies a list of [problem, variant] to a copy of the traces. */
export function applyRemedies(base, list, cfg, reveals) {
  const traces = structuredClone(base);
  for (const steps of Object.values(traces)) for (const s of steps) if (s.geo) s.geo0 = { ...s.geo };
  for (const [p, variant] of list) {
    for (const steps of Object.values(traces)) {
      const onScreen = steps.filter(s => screenKeyOf(cfg, s.screen) === p.screen);
      if (!onScreen.length) continue;
      const hits = onScreen.filter(s => (p.reason === 'small' ? s.name === p.name : controlKey(s.target) === p.control));
      const push = (from, dy, except) => { for (const o of onScreen) if (o !== except && o.geo && from != null && o.geo.top >= from) { o.geo = { ...o.geo, top: o.geo.top + dy }; o.moved = true; } };
      const growScreen = (dh, dc, dw) => {
        for (const s of onScreen) {
          const d = (s.screen?.disclosures || []).find(x => x.name.toLowerCase().startsWith(p.text));
          if (!d) continue;
          if (s.geo && s.geo.top > d.top && dh) { s.geo = { ...s.geo, top: s.geo.top + dh }; s.moved = true; }
          s.screen = { ...s.screen, choices: (s.screen.choices || 0) + dc, words: (s.screen.words || 0) + dw };
        }
      };
      switch (variant) {
        case 'reveal-all': {
          if (hits.length) { for (const s of hits) s.removed = true; break; }   // the tap is not needed any more
          const info = reveals[`${p.screen}|${p.text}`];
          if (info) growScreen(info.dh, info.dc, info.dw);   // a flow that never opened it: longer and fuller
          break;
        }
        case 'reveal-one':
          if (hits.length) { for (const s of hits) s.removed = true; break; }
          growScreen((p.need?.h || 44) + 8, 1, 3);
          break;
        case 'hint': for (const s of hits) s.disclosureHint = true; break;
        case 'pin-row': {
          const rows = hits.map(s => s.geo?.top).filter(t => t != null);
          for (const s of onScreen) {
            const rowmate = hits.includes(s) || (s.geo && rows.some(t => Math.abs(s.geo.top - t) <= 12));
            if (rowmate) { s.geo = { ...(s.geo || {}), pinned: true }; s.offscreen = false; }
            else if (s.geo) { s.geo = { ...s.geo, viewH: s.geo.viewH - 56 }; s.moved = true; }   // the bar takes its room
          }
          break;
        }
        case 'move-up':
          for (const s of hits) {
            if (!s.geo) { s.offscreen = false; continue; }
            const first = Math.min(...onScreen.filter(o => o.geo).map(o => o.geo.top));
            push(first, s.h + 8, s);
            s.geo = { ...s.geo, top: first, scrollTop: 0 }; s.moved = true;
          }
          break;
        case 'shorten':
          for (const s of hits) if (s.geo) { s.geo = { ...s.geo, top: Math.max(0, s.geo.top - 120) }; s.moved = true; }
          break;
        case 'enlarge':
          for (const s of hits) { const grow = Math.max(0, 48 - s.h); s.w = Math.max(48, s.w); s.h = Math.max(48, s.h); if (grow && s.geo) push(s.geo.top + 1, grow, s); }
          break;
        case 'simpler': for (const s of hits) s.termOverride = 0; break;
        case 'word': for (const s of hits) s.iconOnly = false; break;
        case 'name': case 'label': for (const s of hits) { s.labelled = true; s.actionable = true; s.nameSource = 'aria'; } break;
        case 'rename': for (const s of hits) { s.dupes = 0; s.dupesNear = 0; } break;
        case 'focus': for (const s of hits) s.keyboard = true; break;
        case 'explain':
          for (const s of hits) { s.concept = null; if (s.geo) push(s.geo.top + 1, 20, s); for (const o of onScreen) if (o.screenChanged) o.screen = { ...o.screen, words: (o.screen.words || 0) + 12 }; }
          break;
        case 'presets': for (const s of hits) s.inputType = 'text'; break;
      }
    }
  }
  // only a real change of geometry changes what needs scrolling: the measured flag stays when the formula agrees before and after
  for (const steps of Object.values(traces)) {
    for (const s of steps) if (s.moved && s.geo && s.geo0 && !s.geo.pinned) { const before = offByGeo(s, s.geo0), after = offByGeo(s, s.geo); if (before !== after) s.offscreen = after; }
  }
  for (const k of Object.keys(traces)) traces[k] = traces[k].filter(s => !s.removed);
  return traces;
}

function scoreAll(traces, tasks, personas, cfg, runs, seed) {
  const usability = {};
  let tNum = 0, tDen = 0;
  for (const task of tasks) {
    const steps = traces[task.flow];
    if (!steps) continue;
    const per = {};
    for (const p of audienceOf(task, personas)) per[p.id] = simulate(steps, p, runs, rng(hashSeed(`${seed}:${task.id}:${p.id}`)), cfg);
    usability[task.id] = { measurable: true, personas: per };
    const times = Object.values(per).map(r => r.meanT).filter(t => t != null);
    if (times.length) { const w = task.frequency ?? 1; tNum += w * times.reduce((a, b) => a + b, 0) / times.length; tDen += w; }
  }
  const seg = scoreSegments(usability, tasks, cfg.segments);
  seg.meanT = tDen ? tNum / tDen : null;   // seconds per task, weighted by how often tasks happen
  return seg;
}

export function evaluateRemedies({ findings, usability, flowResults, tasks, personas, cfg, runs, seed }) {
  const problems = problemsFrom(findings, usability, flowResults, cfg);
  if (!problems.length || !(cfg.segments || []).length) return { remedies: problems, pairs: [] };
  const base = Object.fromEntries(Object.entries(flowResults).filter(([, fr]) => fr.ok).map(([id, fr]) => [id, fr.trace]));
  const reveals = revealTable(flowResults, cfg);
  const n = Math.min(runs, 200);
  const baseSeg = scoreAll(base, tasks, personas, cfg, n, seed);
  const weightSum = baseSeg.reduce((a, s) => a + (s.score != null ? s.weight : 0), 0) || 1;
  const eps = 0.0005;
  const breaksOf = seg => seg.filter(s => s.kind === 'floor').reduce((a, s) => a + s.breaks.length, 0);
  const baseBreaks = breaksOf(baseSeg);
  const measure = list => {
    const seg = scoreAll(applyRemedies(base, list, cfg, reveals), tasks, personas, cfg, n, seed);
    const per = {}; let gain = 0;
    seg.forEach((s, i) => { const b = baseSeg[i]; if (s.score == null || b.score == null) return; per[s.id] = s.score - b.score; gain += s.weight * (s.score - b.score); });
    return { gain: gain / weightSum, per, reachesGoal: seg.filter((s, i) => s.kind !== 'floor' && !baseSeg[i].ok && s.ok).map(s => s.id), timeDelta: seg.meanT != null && baseSeg.meanT != null ? seg.meanT - baseSeg.meanT : 0, floorDelta: breaksOf(seg) - baseBreaks };
  };
  const heaviestDelta = per => { let best = null; for (const s of baseSeg) { const d = per?.[s.id]; if (d != null && (best == null || s.weight > best.w)) best = { w: s.weight, d }; } return best ? best.d : 0; };
  // the floors come first: an option that leaves more people under their floor never wins
  const better = (x, y) => ((x.floorDelta || 0) !== (y.floorDelta || 0) ? (x.floorDelta || 0) < (y.floorDelta || 0)
    : x.reachesGoal.length !== y.reachesGoal.length ? x.reachesGoal.length > y.reachesGoal.length
    : Math.abs(x.gain - y.gain) > eps ? x.gain > y.gain
    : Math.abs((x.timeDelta || 0) - (y.timeDelta || 0)) > 0.05 ? (x.timeDelta || 0) < (y.timeDelta || 0)
    : heaviestDelta(x.perSegment) >= heaviestDelta(y.perSegment));
  for (const p of problems) {
    p.options = VARIANTS[p.kind].map(([variant, label]) => {
      const m = measure([[p, variant]]);
      return { variant, label, gain: m.gain, timeDelta: +m.timeDelta.toFixed(2), floorDelta: m.floorDelta, perSegment: m.per, reachesGoal: m.reachesGoal, sideEffects: Object.entries(m.per).filter(([, d]) => d < -0.001).map(([id]) => id) };
    });
    const best = p.options.reduce((a, o) => (better(o, a) ? o : a));
    p.preferred = best.variant; p.label = best.label; p.gain = best.gain; p.perSegment = best.perSegment;
    p.reachesGoal = best.reachesGoal; p.sideEffects = best.sideEffects; p.harmful = best.gain < -eps;
    p.timeDelta = best.timeDelta;
    p.negligible = p.options.every(o => Math.abs(o.gain) < eps && Math.abs(o.timeDelta) < 0.1 && !o.sideEffects.length && !o.floorDelta);   // nothing a target would notice
  }
  // the preferred solutions of different problems, on the same screen, tried together
  const pairs = [];
  const useful = problems.filter(p => p.gain > eps);
  for (let i = 0; i < useful.length; i++) for (let j = i + 1; j < useful.length; j++) {
    const a = useful[i], b = useful[j];
    if (a.screen !== b.screen) continue;
    const both = measure([[a, a.preferred], [b, b.preferred]]);   // collisions are judged on the targets' success, and on the floors
    const aFloor = a.options.find(o => o.variant === a.preferred)?.floorDelta || 0, bFloor = b.options.find(o => o.variant === b.preferred)?.floorDelta || 0;
    let kind = null;
    if (both.floorDelta > Math.min(aFloor, bFloor)) kind = 'collide';
    else if (both.gain < Math.max(a.gain, b.gain) - eps) kind = 'collide';
    else if (both.gain > a.gain + b.gain + eps) kind = 'synergy';
    else if (both.gain < 0.7 * (a.gain + b.gain)) kind = 'interfere';
    if (!kind) continue;
    const preferred = kind === 'collide' ? (better(a, b) ? a.id : b.id) : null;
    pairs.push({ a: a.id, b: b.id, kind, together: both.gain, preferred });
  }
  problems.sort((x, y) => y.gain - x.gain);
  return { remedies: problems, pairs };
}
