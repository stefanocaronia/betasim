import path from 'node:path';
import { WebDriver } from '../driver/web.mjs';
import { parseDur, matchesText, ensureDir } from '../util.mjs';

// Maestro's words where they exist (tapOn, inputText, assertVisible, back, launchApp), plus fake time and app state.
const COMMANDS = ['launchApp', 'tapOn', 'inputText', 'keypad', 'pressKey', 'swipe', 'drag', 'assertVisible', 'assertNotVisible', 'advance', 'wait', 'go', 'back', 'assertState', 'setState', 'screenshot', 'note'];

export function parseStep(step) {
  if (typeof step === 'string') return { cmd: step, arg: null, notes: {}, unknown: !COMMANDS.includes(step) };
  const keys = Object.keys(step || {});
  const cmd = keys.find(k => COMMANDS.includes(k));
  if (!cmd) return { cmd: keys[0], arg: null, notes: {}, unknown: true };
  const notes = {};
  for (const k of keys) if (k !== cmd) notes[k] = step[k];
  return { cmd, arg: step[cmd], notes };
}

/**
 * A/B: a step, an argument or a setup written per variant ({A: …, B: …}, keys among the declared variants)
 * becomes the one of the running variant; undefined when that variant has none, and the step is skipped.
 */
export function forVariant(x, variant, ids) {
  if (!variant || !x || typeof x !== 'object' || Array.isArray(x)) return x;
  const keys = Object.keys(x);
  return keys.length && keys.every(k => ids.includes(k)) ? x[variant.id] : x;
}

/** Applies the running variant over the app: after the flow's setup and after every setState, which start over. */
export async function applyVariant(page, cfg, variant) {
  if (!variant?.setup) return;
  if (!cfg.adapter.variant) throw new Error('A/B: the adapter needs a variant(page, setup) function');
  await cfg.adapter.variant(page, variant.setup);
}

const show = t => (t != null && typeof t === 'object' ? JSON.stringify(t) : String(t));
const miss = (cmd, target, r) => `${cmd} ${show(target)}: ${r.error || 'not found'}${r.layer && r.layer !== 'page' ? ` (in ${r.layer})` : ''}${r.candidates ? `. Visible: ${r.candidates.join(' | ')}` : ''}`;

export function checkValue(value, spec) {
  const js = x => JSON.stringify(x);
  const list = Array.isArray(value) ? value : [value];
  if ('equals' in spec && js(value) !== js(spec.equals) && String(value) !== String(spec.equals)) return `expected ${js(spec.equals)}, got ${js(value)}`;
  if ('contains' in spec && !list.some(x => matchesText(x, spec.contains))) return `expected to contain ${js(spec.contains)}, got ${js(value)}`;
  if ('notContains' in spec && list.some(x => matchesText(x, spec.notContains))) return `expected not to contain ${js(spec.notContains)}, got ${js(value)}`;
  // a missing value never passes a bound: Number(null) is 0, and "at most 44" passed on an element that no longer exists (Bruno, 8 October)
  if ('min' in spec && (value == null || !(Number(value) >= spec.min))) return `expected at least ${spec.min}, got ${js(value)}`;
  if ('max' in spec && (value == null || !(Number(value) <= spec.max))) return `expected at most ${spec.max}, got ${js(value)}`;
  if ('length' in spec && (!Array.isArray(value) || value.length !== spec.length)) return `expected ${spec.length} items, got ${js(value)}`;
  return null;
}

/** An expander says what it hides when its text names the target of the next tap or entry (TimerLines 292: More options with the names of the hidden options). */
function namesNext(steps, i, own, r) {
  const said = String(r.a11yName || r.name || '').toLowerCase();
  for (let j = i + 1; j < steps.length; j++) { const s = own(steps[j]); if (!s || typeof s !== 'object') continue; const c = ['tapOn', 'inputText', 'keypad'].find(k => k in s); if (!c) continue;   // a step can be a bare word, like back
    const tg = c === 'tapOn' ? s[c] : (s[c] || {}).into; const name = typeof tg === 'string' ? tg : (tg && (tg.label || tg.text)) || '';
    return !!name && said.includes(String(name).toLowerCase()); }
  return false;
}

/** Runs one flow in a fresh browser context; the trace keeps what the usability model needs. */
export async function runFlow(ctx, flow) {
  const { browser, cfg, baseUrl, screensDir, variant } = ctx;
  const ids = (cfg.variants || []).map(v => v.id), own = x => forVariant(x, variant, ids);
  const res = { id: flow.id, name: flow.name || flow.id, ok: true, taps: 0, inputs: 0, trace: [], error: null, failedAt: null, simTime: 0, warnings: [] };
  const started = Date.now();
  const d = new WebDriver(browser, cfg, baseUrl);
  try {
    await d.open();
    const setup = own(flow.setup);
    if (setup && cfg.adapter.setup) { await cfg.adapter.setup(d.page, setup); await d.settle(); }
    if (variant?.setup) { await applyVariant(d.page, cfg, variant); await d.settle(); }
    let prev = null;
    const steps = flow.steps || [];
    for (let i = 0; i < steps.length; i++) {
      const step = own(steps[i]);
      if (step === undefined) continue;   // a step of another variant
      const { cmd, arg: anyArg, notes, unknown } = parseStep(step);
      const arg = own(anyArg);
      if (arg === undefined) continue;
      const fail = msg => { res.ok = false; res.error = `step ${i + 1}: ${msg}`; res.failedAt = i + 1; };
      if (unknown) { fail(`unknown command "${cmd}"`); break; }
      if (cmd === 'tapOn' || cmd === 'inputText') {
        const screen = await d.screen();
        const target = cmd === 'tapOn' ? arg : (arg && typeof arg === 'object' ? (arg.into ?? arg.field) : null);
        const text = cmd === 'inputText' ? (arg && typeof arg === 'object' ? arg.text : arg) : null;
        let r, reveal;
        if (cmd === 'tapOn') {
          r = await d.find(arg, 'act');
          if (r.ok) {
            if (r.disclosure) await d.markHidden();
            await d.clickAt(r);
            if (r.disclosure) reveal = await d.measureRevealed();   // what the expander hid: height, commands, words
          }
        } else r = await d.input(target, text);
        if (!r.ok) { if (notes.optional) continue; fail(miss(cmd, target, r)); break; }
        if (cmd === 'tapOn') res.taps++; else res.inputs++;
        const changed = !prev || prev.route !== screen.route || prev.layer !== screen.layer;
        res.trace.push({
          step: i + 1, kind: cmd === 'tapOn' ? 'tap' : 'input', target, name: r.name, a11yName: r.a11yName, nameSource: r.nameSource, role: r.role, w: r.w, h: r.h,
          offscreen: r.offscreen, iconOnly: r.iconOnly, labelled: r.labelled, actionable: r.actionable, disclosure: r.disclosure, disclosureHint: r.disclosure ? namesNext(steps, i, own, r) : undefined,
          fontPx: r.fontPx, inputType: r.inputType, chars: text != null ? String(text).length : 0, match: r.level,
          geo: r.geo, dupes: r.dupes, dupesNear: r.dupesNear, reveal, screen, screenChanged: changed, ...notes,
        });
        prev = screen;
      } else if (cmd === 'keypad') {   // a keypad field: the real keys are pressed, and for the model it is one entry, like typing into a field
        const screen = await d.screen();
        const keys = String(arg?.keys ?? '').trim().split(/\s+/).filter(Boolean);
        const r = await d.keypad(arg?.into, keys);
        if (!r.ok) { if (notes.optional) continue; fail(miss(cmd, arg?.into, r)); break; }
        res.inputs++;
        const changed = !prev || prev.route !== screen.route || prev.layer !== screen.layer;
        res.trace.push({
          step: i + 1, kind: 'input', target: arg.into, name: r.name, a11yName: r.a11yName, nameSource: r.nameSource, role: r.role, w: r.w, h: r.h,
          offscreen: r.offscreen, iconOnly: false, labelled: r.labelled, actionable: r.actionable, disclosure: false,
          fontPx: r.fontPx, inputType: 'keypad', chars: r.presses, match: r.level,
          geo: r.geo, dupes: r.dupes, dupesNear: r.dupesNear, screen, screenChanged: changed, ...notes,
        });
        prev = screen;
      } else if (cmd === 'assertVisible' || cmd === 'assertNotVisible') {
        const r = await d.see(arg);
        if (cmd === 'assertVisible' && !r.ok) { fail(miss(cmd, arg, r)); break; }
        if (cmd === 'assertNotVisible' && r.ok) { fail(`${cmd} ${show(arg)}: it is visible ("${r.name}")`); break; }
      } else if (cmd === 'advance' || cmd === 'wait') {
        const ms = parseDur(arg);
        if (!isFinite(ms)) { fail(`${cmd}: bad duration "${arg}"`); break; }
        await d.advance(ms); res.simTime += ms;
      } else if (cmd === 'swipe') {
        const dir = arg && typeof arg === 'object' ? arg.direction : arg;
        const r = await d.swipe(dir, arg && typeof arg === 'object' ? arg.from : null);
        if (!r.ok) { fail(miss(cmd, arg.from, r)); break; }
        res.taps++;
        res.trace.push({ step: i + 1, kind: 'swipe', target: arg, name: `swipe ${dir}`, role: 'gesture', w: 200, h: 200, labelled: true, actionable: true, screen: await d.screen(), screenChanged: false, concept: notes.concept || { name: 'swipe', difficulty: 2 }, ...notes });
      } else if (cmd === 'drag') {   // a long press, then a drag to the top or bottom edge of another element
        const r = await d.drag(arg.from, arg.to, arg.where || 'below');
        if (!r.ok) { fail(miss(cmd, arg.from, r)); break; }
        res.taps++;
        res.trace.push({ step: i + 1, kind: 'drag', target: arg, name: 'drag', role: 'gesture', w: 200, h: 200, labelled: true, actionable: true, screen: await d.screen(), screenChanged: true, concept: notes.concept || { name: 'drag', difficulty: 3 }, ...notes });
      } else if (cmd === 'go') {
        await d.go(arg);
      } else if (cmd === 'back') {
        if (cfg.adapter.back) await cfg.adapter.back(d.page); else await d.page.goBack();
        await d.settle();
      } else if (cmd === 'pressKey') {   // keys of a physical keyboard, as Maestro's pressKey: "7 0 0", "Backspace", "Enter" (a Bluetooth keyboard on the phone)
        for (const k of String(arg).split(' ').filter(Boolean)) await d.page.keyboard.press(k);
        await d.settle();
      } else if (cmd === 'assertState') {
        if (!cfg.adapter.query) { fail('the adapter has no query() function'); break; }
        const value = await cfg.adapter.query(d.page, arg.query, arg.arg);
        const why = checkValue(value, arg);
        if (why) { fail(`assertState ${arg.query}${arg.arg != null ? `(${arg.arg})` : ''}: ${why}`); break; }
      } else if (cmd === 'setState') {
        await cfg.adapter.setup(d.page, arg); await d.settle();
        if (variant?.setup) { await applyVariant(d.page, cfg, variant); await d.settle(); }
      } else if (cmd === 'screenshot') {
        ensureDir(screensDir); await d.shot(path.join(screensDir, `${flow.id}-${arg || i + 1}.png`));
      }
      if (d.errors.length) { fail('page error: ' + d.errors[0]); break; }
    }
    const budget = own(flow.expect?.maxTaps);
    if (res.ok && budget != null && res.taps > budget) res.warnings.push(`${res.taps} taps, budget ${budget}`);
  } catch (err) {
    res.ok = false; res.error = 'runner error: ' + String(err && err.message ? err.message : err).split('\n')[0];
  }
  if (!res.ok && d.page) {
    try { ensureDir(screensDir); const f = path.join(screensDir, `${flow.id}-fail.png`); await d.shot(f); res.screenshot = f; } catch { /* no screenshot */ }
  }
  for (const w of (d.warnings || []).slice(0, 3)) res.warnings.push('console: ' + w.slice(0, 160));
  res.ms = Date.now() - started;
  await d.close();
  return res;
}
