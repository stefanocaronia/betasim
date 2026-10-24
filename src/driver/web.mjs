import { chromium } from 'playwright';

/** Launches the browser: the installed Chrome by default (no download), the bundled Chromium as a fallback. */
export async function launchBrowser(cfg, opts = {}) {
  const headless = !opts.headed;
  const channel = cfg.target.channel;
  if (channel && channel !== 'bundled') {
    try { return await chromium.launch({ headless, channel }); } catch { /* falls back to the bundled browser */ }
  }
  return chromium.launch({ headless });
}

// Runs in the page. Finds what a person would tap: by visible text, by accessible label, by id or css,
// only inside the top layer (an open sheet hides what is behind it) and never inside ignored parts.
const RESOLVE = ({ spec, mode, layers, ignore, disclosure }) => {
  const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const low = s => norm(s).toLowerCase();
  const ignored = el => !!(ignore && el.closest(ignore));
  const visible = el => {
    if (!el || !el.getClientRects().length || el.closest('[hidden]') || ignored(el)) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0;
  };
  let root = document.body, layer = 'page';
  for (const sel of layers) {
    const found = [...document.querySelectorAll(sel)].filter(visible);
    if (found.length) { root = found[found.length - 1]; layer = sel; break; }
  }
  const ACT = 'button,a[href],input,select,textarea,summary,[role=button],[role=switch],[role=tab],[role=menuitem],[role=link],[role=checkbox],[role=radio],[role=option],[data-act],[data-go],[data-route],[onclick]';
  const textOf = el => norm(el.innerText ?? el.textContent);
  const isFieldEl = el => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
  const nameOf = el => el.getAttribute('aria-label') || (isFieldEl(el) ? fieldLabel(el) : textOf(el)) || (el.tagName === 'INPUT' && ['radio', 'checkbox'].includes(el.type) ? '' : el.value) || el.getAttribute('placeholder') || el.getAttribute('title') || el.id || '';
  // the name a screen reader would say, and where it comes from (aria, a real label, the text, or only the placeholder)
  const labelText = el => {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return norm(l.textContent); }   // textContent: the words, not their CSS capitals
    const wrap = el.closest('label');
    if (wrap) { const c = wrap.cloneNode(true); c.querySelectorAll('input,select,textarea').forEach(x => x.remove()); return norm(c.textContent); }
    return '';
  };
  const accName = el => {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = norm(by.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(x => x.textContent).join(' ')); if (t) return [t, 'aria']; }
    const al = el.getAttribute('aria-label'); if (al) return [norm(al), 'aria'];
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
      const l = labelText(el); if (l) return [l, 'label'];
      if (el.getAttribute('title')) return [norm(el.getAttribute('title')), 'title'];
      if (el.getAttribute('placeholder')) return [norm(el.getAttribute('placeholder')), 'placeholder'];
      return ['', 'none'];
    }
    const tx = textOf(el); if (tx) return [tx, 'text'];
    if (el.getAttribute('title')) return [norm(el.getAttribute('title')), 'title'];
    return ['', 'none'];
  };
  const fieldLabel = el => labelText(el) || visualLabel(el);
  // what a sighted person reads next to a field: its own label, or the label of its .field-like box
  const visualLabel = el => {
    const own = labelText(el); if (own) return own;
    const box = el.parentElement; const l = box && [...box.children].find(x => x.tagName === 'LABEL' && !x.contains(el));
    return l ? norm(l.textContent) : '';
  };
  const roleOf = el => el.getAttribute('role') || ({ BUTTON: 'button', A: 'link', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button' })[el.tagName]
    || (el.tagName === 'INPUT' ? ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button' })[el.type] || 'textbox' : 'generic');
  let pool = mode === 'see' ? [...root.querySelectorAll('*')] : [...root.querySelectorAll(ACT)];
  if (mode === 'see' && root !== document.body) pool.unshift(root);
  let cands = pool.filter(visible);
  if (mode === 'input') cands = cands.filter(el => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName));
  let found = [], level = '';
  if (spec.id) { const el = document.getElementById(spec.id); found = el && visible(el) ? [el] : []; level = 'id'; }
  else if (spec.css) { found = [...root.querySelectorAll(spec.css)].filter(visible); level = 'css'; }
  else {
    const want = low(spec.label ?? spec.text);
    // {label}: a control's aria-label; a field's name as a screen reader says it, from aria or from its <label>, as a website's fields are named
    const key = spec.label != null ? (el => low(isFieldEl(el) ? accName(el)[0] : el.getAttribute('aria-label'))) : (el => low(nameOf(el)));
    const tests = [['exact', k => k === want], ['start', k => k.startsWith(want)], ['contains', k => k.includes(want)]];
    for (const [lv, test] of tests) {
      found = cands.filter(el => test(key(el)));
      if (found.length) { level = lv; break; }
      if (spec.exact) break;
    }
  }
  if (spec.within && found.length) {
    const w = low(spec.within);
    const boxes = [...root.querySelectorAll('*')].filter(el => visible(el) && low(el.innerText ?? el.textContent).includes(w));
    const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    const owner = el => boxes.filter(b => b !== el && b.contains(el)).sort((a, b) => area(a) - area(b))[0];
    found = found.filter(owner).sort((a, b) => area(owner(a)) - area(owner(b)));
  }
  // the most specific element: drop the ones that contain another match
  if (found.length > 1) { const inner = found.filter(el => !found.some(o => o !== el && el.contains(o))); if (inner.length) found = inner; }
  const el = found[spec.index || 0];
  if (!el) {
    const names = [...new Set(cands.filter(e => e.matches(ACT)).map(e => nameOf(e).slice(0, 36)).filter(Boolean))].slice(0, 40);
    return { ok: false, error: 'not found', layer, candidates: names };
  }
  let r = el.getBoundingClientRect();
  // geometry for the what-if of remedies: the place inside the scrolling box, what of it is visible, and whether it is pinned
  let box = null;
  for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) { box = p; break; } }
  let pinned = false;
  for (let p = el; p && p !== (box || document.body); p = p.parentElement) { const pos = getComputedStyle(p).position; if (pos === 'sticky' || pos === 'fixed') { pinned = true; break; } }
  const bRect = box ? box.getBoundingClientRect() : { top: 0, bottom: innerHeight };
  // off screen: outside the window, or outside the box that scrolls it (a sheet whose body scrolls between a fixed head and foot)
  const offscreen = r.bottom > Math.min(innerHeight, bRect.bottom) + 1 || r.top < Math.max(0, bRect.top) - 1;
  const geo = {
    top: Math.round(r.top - bRect.top + (box ? box.scrollTop : scrollY)),
    scrollTop: Math.round(box ? box.scrollTop : scrollY),
    viewH: Math.round(Math.max(0, Math.min(bRect.bottom, innerHeight) - Math.max(bRect.top, 0))),
    pinned,
  };
  // other commands on the same screen with the same name: which Play, which Done?
  const twins = mode === 'act' ? cands.filter(o => o !== el && !o.contains(el) && !el.contains(o) && low(nameOf(o)) === low(nameOf(el))) : [];
  const dupes = twins.length;
  // for who sees, a twin matters only in the same card (a Start in every row of a list is clear from its row)
  let card = el.parentElement;
  for (let i = 0; card && card !== root && i < 6 && norm(card.innerText ?? card.textContent).length <= norm(nameOf(el)).length + 3; i++) card = card.parentElement;
  const dupesNear = card ? twins.filter(o => card.contains(o)).length : dupes;
  if (offscreen && mode !== 'see') { el.scrollIntoView({ block: 'center' }); r = el.getBoundingClientRect(); }
  const at = Array.isArray(spec.at) ? spec.at : [0.5, 0.5];   // where to touch, as fractions of the element (the ring's edge, not its digits)
  let cx = r.left + r.width * at[0], cy = r.top + r.height * at[1];
  let hit = true, cover = null;
  if (mode === 'act') {
    const hits = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t) || t.contains(el)); };
    hit = hits(cx, cy);
    // an empty middle (an SVG row, a card with a gap): a finger lands on the name or on the bar, so try other points inside
    if (!hit && !Array.isArray(spec.at)) {
      for (const [fx, fy] of [[0.2, 0.5], [0.8, 0.5], [0.5, 0.3], [0.5, 0.7], [0.1, 0.5], [0.9, 0.5], [0.3, 0.3], [0.7, 0.7]]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (hits(x, y)) { cx = x; cy = y; hit = true; break; }
      }
    }
    if (!hit) { const t = document.elementFromPoint(cx, cy); if (t) cover = nameOf(t).slice(0, 40) || t.tagName.toLowerCase(); }
  }
  // the touch target: Material gives a smaller control 48 dp around it (on the web, an absolute ::before or ::after layer), and a finger hits that
  const pseudoBox = pseudo => { const cs = getComputedStyle(el, pseudo); return cs.content !== 'none' && cs.position === 'absolute' ? [parseFloat(cs.width) || 0, parseFloat(cs.height) || 0] : [0, 0]; };
  const [bw, bh] = pseudoBox('::before'), [aw, ah] = pseudoBox('::after');
  const tw = Math.max(r.width, bw, aw), th = Math.max(r.height, bh, ah);
  document.querySelectorAll('[data-betasim-hit]').forEach(x => x.removeAttribute('data-betasim-hit'));
  el.setAttribute('data-betasim-hit', '1');
  const label = el.getAttribute('aria-label');
  const text = textOf(el);
  const role = roleOf(el);
  const [a11yName, nameSource] = accName(el);
  const isField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
  return {
    ok: hit, error: hit ? null : 'covered by ' + cover, layer, level,
    name: ((isField ? visualLabel(el) || a11yName : nameOf(el)) || nameOf(el)).slice(0, 90), a11yName: a11yName.slice(0, 90), nameSource,
    role, tag: el.tagName.toLowerCase(),
    w: Math.round(tw), h: Math.round(th), cx, cy, offscreen, geo, dupes, dupesNear,
    // a switch or a checkbox with its words next to it is not an icon on its own
    iconOnly: !isField && !text && !!label && !(['switch', 'checkbox', 'radio'].includes(role) && norm(el.parentElement?.innerText ?? '').length > 0),
    labelled: ['aria', 'label', 'text', 'title'].includes(nameSource),
    actionable: role !== 'generic',
    disclosure: !!(disclosure && el.matches(disclosure)),
    fontPx: parseFloat(getComputedStyle(el).fontSize) || 0,
    inputType: el.tagName === 'SELECT' ? 'select' : (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? (el.type || 'text') : null,
  };
};

// Runs in the page: what the person has in front of them before acting.
const SCREEN = ({ layers, ignore, disclosure }) => {
  const ignored = el => !!(ignore && el.closest(ignore));
  const visible = el => {
    if (!el || !el.getClientRects().length || el.closest('[hidden]') || ignored(el)) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0;
  };
  let root = document.body, layer = 'page';
  for (const sel of layers) {
    const found = [...document.querySelectorAll(sel)].filter(visible);
    if (found.length) { root = found[found.length - 1]; layer = sel; break; }
  }
  const inView = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const ACT = 'button,a[href],input,select,textarea,summary,[role=button],[role=switch],[role=tab],[role=menuitem],[role=link],[data-act],[data-go],[data-route]';
  const acts = [...root.querySelectorAll(ACT)].filter(el => visible(el) && inView(el));
  const outer = acts.filter(el => !acts.some(o => o !== el && o.contains(el)));
  let words = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const p = walker.currentNode.parentElement;
    if (!p || !visible(p) || !inView(p)) continue;
    words += (walker.currentNode.textContent.match(/[\p{L}\p{N}]+/gu) || []).length;
  }
  // the closed expanders on this screen and where they sit, for the what-if of opening them for everybody
  const topIn = el => {
    let box = null;
    for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) { box = p; break; } }
    const r = el.getBoundingClientRect(), b = box ? box.getBoundingClientRect() : { top: 0 };
    return Math.round(r.top - b.top + (box ? box.scrollTop : scrollY));
  };
  const disclosures = disclosure ? [...root.querySelectorAll(disclosure)].filter(visible)
    .map(d => ({ name: String(d.getAttribute('aria-label') || d.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), top: topIn(d) })) : [];
  return { route: location.hash || location.pathname, layer, choices: outer.length, words, disclosures };
};

// Before an expander opens: mark what is hidden in the top layer. After: measure what came into view.
const MARK_HIDDEN = ({ layers, ignore }) => {
  let root = document.body;
  for (const sel of layers) { const f = [...document.querySelectorAll(sel)].filter(el => el.getClientRects().length); if (f.length) { root = f[f.length - 1]; break; } }
  let i = 0;
  root.querySelectorAll('[hidden]').forEach(el => { if (!(ignore && el.closest(ignore))) el.setAttribute('data-betasim-hid', String(i++)); });
  return i;
};
const MEASURE_REVEALED = () => {
  const ACT = 'button,a[href],input,select,textarea,summary,[role=button],[role=switch],[role=tab],[role=menuitem],[role=link],[data-act],[data-go],[data-route]';
  const shown = [...document.querySelectorAll('[data-betasim-hid]')].filter(el => !el.hidden && !el.closest('[hidden]') && el.getClientRects().length);
  const outer = shown.filter(el => !shown.some(o => o !== el && o.contains(el)));
  let dh = 0, dc = 0, dw = 0;
  for (const el of outer) {
    dh += el.getBoundingClientRect().height;
    dc += [...el.querySelectorAll(ACT)].filter(x => x.getClientRects().length).length;
    dw += (el.textContent.match(/[\p{L}\p{N}]+/gu) || []).length;
  }
  document.querySelectorAll('[data-betasim-hid]').forEach(el => el.removeAttribute('data-betasim-hid'));
  return { dh: Math.round(dh), dc, dw };
};

export class WebDriver {
  constructor(browser, cfg, baseUrl) {
    this.browser = browser; this.cfg = cfg; this.baseUrl = baseUrl; this.adapter = cfg.adapter || {};
  }

  async open() {
    const t = this.cfg.target;
    this.context = await this.browser.newContext({
      viewport: t.viewport, deviceScaleFactor: t.deviceScale, locale: t.locale, timezoneId: t.timezone,
      serviceWorkers: 'block', reducedMotion: 'reduce',
    });
    this.page = await this.context.newPage();
    this.errors = []; this.warnings = [];
    this.page.on('pageerror', e => this.errors.push(String(e && e.message ? e.message : e)));
    this.page.on('console', m => { if (m.type() === 'error') this.warnings.push(m.text()); });
    this.startMs = new Date(t.startTime).getTime();
    this.clockMs = 0;
    // the page loads with a running clock a minute early, then time stops at startTime and moves only when told
    await this.page.clock.install({ time: this.startMs - 60e3 });
    await this.page.goto(this.baseUrl + (t.entry || ''));
    if (this.adapter.ready) await this.adapter.ready(this.page);
    await this.page.clock.pauseAt(this.startMs);
    await this.settle(300);
    return this;
  }

  async close() { try { await this.context.close(); } catch { /* already closed */ } }

  /** Lets the page's timers run a little: re-renders, debounces, the release of a held pointer. */
  async settle(ms = 300) { await this.page.clock.runFor(ms); this.clockMs += ms; }

  /** Fake time: a jump, like a phone waking up (due timers fire once), then a few real ticks. */
  async advance(ms) {
    if (!(ms > 0)) return;
    if (ms <= 2000) await this.page.clock.runFor(ms);
    else { await this.page.clock.fastForward(ms - 500); await this.page.clock.runFor(500); }
    this.clockMs += ms;
  }

  opts() { const t = this.cfg.target; return { layers: t.layers || [], ignore: t.ignore || '', disclosure: t.disclosure || '' }; }
  async find(target, mode) { return this.page.evaluate(RESOLVE, { spec: normTarget(target), mode, ...this.opts() }); }
  async screen() { return this.page.evaluate(SCREEN, this.opts()); }

  async tap(target) {
    const r = await this.find(target, 'act');
    if (!r.ok) return r;
    await this.clickAt(r);
    return r;
  }

  async clickAt(r) { await this.page.mouse.click(r.cx, r.cy); await this.settle(); }

  /** A finger drag, as Maestro's swipe: from the middle of the screen or of an element, in a direction. */
  async swipe(direction, from) {
    const vp = this.cfg.target.viewport;
    let x = vp.width / 2, y = vp.height / 2;
    if (from) { const r = await this.find(from, 'see'); if (!r.ok) return r; x = r.cx; y = r.cy; }
    const [dx, dy] = { LEFT: [-1, 0], RIGHT: [1, 0], UP: [0, -1], DOWN: [0, 1] }[String(direction || 'LEFT').toUpperCase()] || [-1, 0];
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    for (let i = 1; i <= 10; i++) { await this.page.mouse.move(x + dx * i * 22, y + dy * i * 22); await this.page.clock.runFor(16); }
    await this.page.mouse.up();
    await this.settle();
    return { ok: true };
  }
  /** A long press and a drag: lift an element, bring it to the top or the bottom edge of another one, let go. */
  async drag(from, to, where) {
    const a = await this.find(from, 'see'); if (!a.ok) return a;
    const b = await this.find(to, 'see'); if (!b.ok) return b;
    const box = await this.page.evaluate(() => { const el = document.querySelector('[data-betasim-hit]'); const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    const ty = where === 'above' ? box.top + 2 : box.bottom - 2;
    await this.page.mouse.move(a.cx, a.cy);
    await this.page.mouse.down();
    await this.page.clock.runFor(500);   // the long press lifts it
    for (let i = 1; i <= 12; i++) { await this.page.mouse.move(a.cx, a.cy + (ty - a.cy) * i / 12); await this.page.clock.runFor(16); }
    await this.page.mouse.up();
    await this.settle();
    return { ok: true };
  }
  async markHidden() { return this.page.evaluate(MARK_HIDDEN, this.opts()); }
  async measureRevealed() { return this.page.evaluate(MEASURE_REVEALED); }

  async input(target, text) {
    const r = await this.find(target, 'input');
    if (!r.ok) return r;
    await this.page.evaluate(({ text }) => {
      const el = document.querySelector('[data-betasim-hit]');
      if (!el) return;
      el.focus();
      // what a person would type or pick on a phone ("19:30", "0745", "28/10") becomes the value the field wants
      const p2 = n => String(n).padStart(2, '0');
      const today = new Date(), ymd = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;
      const asTime = s => { const m = /^(\d{1,2})[:.,h ]?(\d{2})$/.exec(String(s).trim()); return m ? `${p2(m[1])}:${m[2]}` : null; };
      const asDate = s => { const m = /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/.exec(String(s).trim()); if (!m) return null; const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : today.getFullYear(); return `${y}-${p2(m[2])}-${p2(m[1])}`; };
      let value = String(text);
      if (el.type === 'time') value = asTime(value) || value;
      else if (el.type === 'date') value = asDate(value) || value;
      else if (el.type === 'datetime-local' && !/T/.test(value)) {
        const parts = value.trim().split(/\s+/);
        const t = asTime(parts[parts.length - 1]), d = parts.length > 1 ? asDate(parts[0]) : null;
        if (t) value = `${d || ymd}T${t}`;
      }
      if (el.tagName === 'SELECT') {
        const opt = [...el.options].find(o => o.value === value || o.textContent.trim().toLowerCase() === value.toLowerCase());
        if (opt) el.value = opt.value;
      } else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { text: String(text) });
    await this.settle();
    return r;
  }

  /** A keypad field (a duration typed from the right, a PIN): taps the field if it is closed (aria-expanded), then presses the keys by name, inside the keys it controls (aria-controls). */
  async keypad(target, keys) {
    const r = await this.find(target, 'act');
    if (!r.ok) return r;
    const field = await this.page.evaluate(() => { const el = document.querySelector('[data-betasim-hit]'); return el ? { controls: el.getAttribute('aria-controls') || '', closed: el.getAttribute('aria-expanded') === 'false' } : null; });
    if (!field || !field.controls) return { ok: false, error: 'not a keypad field (no aria-controls)', candidates: [] };
    if (field.closed) await this.clickAt(r);
    // what a person types ("15 00", "4500") becomes key presses: the longest key that fits first ("00" before "0")
    const names = await this.page.evaluate(id => { const box = document.getElementById(id); return box ? [...box.querySelectorAll('button,[role=button]')].map(b => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(Boolean) : []; }, field.controls);
    const presses = [];
    for (let tok of keys) {
      while (tok) { const k = names.filter(n => tok.startsWith(n)).sort((x, y) => y.length - x.length)[0]; if (!k) return { ok: false, error: `no key for "${tok}"`, candidates: names }; presses.push(k); tok = tok.slice(k.length); }
    }
    for (const k of presses) {
      const at = await this.page.evaluate(({ id, k }) => {
        const box = document.getElementById(id);
        const key = box && [...box.querySelectorAll('button,[role=button]')].find(b => (b.getAttribute('aria-label') || b.textContent || '').trim() === k);
        if (!key || !key.getClientRects().length) return null;
        const center = () => { const q = key.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; };
        let c = center(); const on = document.elementFromPoint(c.x, c.y);
        if (!on || !(on === key || key.contains(on))) { key.scrollIntoView({ block: 'center' }); c = center(); }   // the keys open below the field, maybe under a pinned foot: a person scrolls to them
        return c;
      }, { id: field.controls, k });
      if (!at) return { ok: false, error: `no key "${k}"`, candidates: [] };
      await this.page.mouse.click(at.x, at.y); await this.settle();
    }
    // done typing: the keypad closes, as a phone keyboard goes away when you tap on (inputText does not model the keyboard either)
    const open = await this.page.evaluate(id => { const f = document.querySelector(`[aria-controls="${id}"]`); if (!f || f.getAttribute('aria-expanded') !== 'true') return null; const q = f.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, field.controls);
    if (open) { await this.page.mouse.click(open.x, open.y); await this.settle(); }
    return { ...r, presses: presses.length };
  }

  async see(target) { return this.find(target, 'see'); }
  async go(route) { await this.page.evaluate(h => { location.hash = h; }, route); await this.settle(); }
  async aria() {
    const t = this.cfg.target;
    for (const sel of [...(t.layers || []), t.root || 'body']) {   // root: the app without the prototype's own panels
      const loc = this.page.locator(sel).last();
      if (await loc.isVisible().catch(() => false)) return loc.ariaSnapshot();
    }
    return '';
  }
  async shot(file) { await this.page.screenshot({ path: file }); }
}

export function normTarget(target) {
  if (target == null) return {};
  if (typeof target === 'string' || typeof target === 'number') return { text: String(target) };
  return { ...target };
}
