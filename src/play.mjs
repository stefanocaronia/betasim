import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { WebDriver, inPage } from './driver/web.mjs';
import { openTarget } from './run.mjs';
import { applyVariant } from './suites/flows.mjs';
import { readYaml, toYaml, parseDur, fmtDur, ensureDir } from './util.mjs';

/*
 * One move at a time, for an LLM playing a person. The session folder keeps the moves (actions.yaml);
 * every call replays them from scratch in a fresh browser with the fake clock, so the state is exact and
 * nothing has to stay open between moves. A move that finds nothing leaves no trace in the app
 * (it goes to attempts.yaml, the person just looked in the wrong place).
 *
 * Moves: "tap: <words on screen>" · "tap: {label: <name>}" · "type: {into: <field>, text: <text>}" ·
 *        "wait: 3m" · "scroll: down|up" · "swipe: left|right" · "back"
 */

const ACTS = 'actions.yaml', ATTEMPTS = 'attempts.yaml', SESSION = 'session.yaml';
const MOVE_TIME = 3000;   // a person takes a few seconds before each move: the notices fade as they do on a real phone

export function parseMove(raw) {
  let o = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t === 'back') return { cmd: 'back' };
    try { o = YAML.parse(t); } catch { return { cmd: 'invalid' }; }
  }
  if (!o || typeof o !== 'object') return { cmd: 'invalid' };
  const [k, v] = Object.entries(o)[0] || [];
  switch (k) {
    case 'tap': return { cmd: 'tap', target: v };
    case 'type': return { cmd: 'type', target: v?.into, text: v?.text };
    case 'wait': return { cmd: 'wait', ms: parseDur(String(v)) };
    case 'scroll': return { cmd: 'scroll', dir: String(v || 'down').toLowerCase() };
    case 'swipe': return { cmd: 'swipe', dir: String(v || 'left').toUpperCase() };
    case 'back': return { cmd: 'back' };
    default: return { cmd: 'invalid' };
  }
}

const show = t => (t && typeof t === 'object' ? (t.text ?? t.label ?? JSON.stringify(t)) : String(t ?? ''));

async function doMove(d, m) {
  switch (m.cmd) {
    case 'tap': {
      const r = await d.tap(m.target);
      return r.ok ? { ok: true, did: `tocco «${r.name.slice(0, 60)}»` } : { ok: false, error: `non trovo «${show(m.target)}» da toccare${r.error && r.error !== 'not found' ? ` (${r.error})` : ''}`, visible: r.candidates };
    }
    case 'type': {
      const r = await d.input(m.target, m.text ?? '');
      return r.ok ? { ok: true, did: `scrivo «${m.text}» in «${r.name.slice(0, 40)}»` } : { ok: false, error: `non trovo il campo «${show(m.target)}»`, visible: r.candidates };
    }
    case 'wait':
      if (!(m.ms > 0)) return { ok: false, error: 'quanto aspetto? per esempio wait: 3m' };
      await d.advance(m.ms); return { ok: true, did: `aspetto ${fmtDur(m.ms)}` };
    case 'scroll': {
      // the box that scrolls under the finger (the wheel does not move it while the fake clock is paused)
      const vp = d.cfg.target.viewport;
      await d.page.evaluate(inPage(({ dy, x, y }, { up, point }) => {
        let el = point(x, y);
        while (el && !(el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = up(el);
        (el || document.scrollingElement).scrollBy(0, dy);
      }), { dy:m.dir === 'up' ? -450 : 450, x: vp.width / 2, y: vp.height / 2 });
      await d.settle();
      return { ok: true, did: `scorro ${m.dir === 'up' ? 'in su' : 'in giù'}` };
    }
    case 'swipe': { const r = await d.swipe(m.dir); return r.ok ? { ok: true, did: `trascino il dito verso ${m.dir === 'LEFT' ? 'sinistra' : 'destra'}` } : { ok: false, error: 'non riesco a scorrere qui' }; }
    case 'back':
      if (d.cfg.adapter.back) await d.cfg.adapter.back(d.page); else await d.page.goBack();
      await d.settle(); return { ok: true, did: 'torno indietro' };
    default: return { ok: false, error: 'mossa non capita: usa tap, type, wait, scroll, swipe o back' };
  }
}

function loadPhase(dir) {
  const ses = fs.existsSync(path.join(dir, SESSION)) ? readYaml(path.join(dir, SESSION)) || {} : {};
  const acts = fs.existsSync(path.join(dir, ACTS)) ? readYaml(path.join(dir, ACTS)) || [] : [];
  return { ses, acts };
}

/** Replays a session (and the one it continues) and returns the driver on the last screen. */
async function replay(cfg, dir, target) {
  const own = loadPhase(dir);
  const chain = [];
  if (own.ses.continueFrom) {
    const prevDir = path.resolve(dir, own.ses.continueFrom);
    chain.push({ dir: prevDir, ...loadPhase(prevDir) });
  }
  chain.push({ dir, ...own, own: true });
  const first = chain[0].ses;
  const d = await new WebDriver(target.browser, { ...cfg, target: { ...cfg.target, startTime: first.start || cfg.target.startTime } }, target.baseUrl).open();
  if (first.setup && cfg.adapter.setup) { await cfg.adapter.setup(d.page, first.setup); await d.settle(); }
  const variant = cfg.variants.find(v => v.id === first.variant) || cfg.variants[0] || null;   // A/B: the variant the session was briefed on
  await applyVariant(d.page, cfg, variant); await d.settle();
  const log = [];
  let interruption = null;
  for (const part of chain) {
    if (part.own && part !== chain[0] && part.ses.start) {   // the second phase starts at its own hour, days later
      const now = await d.page.evaluate(() => Date.now());
      const at = new Date(part.ses.start).getTime();
      if (at > now) await d.advance(at - now);
    }
    for (let i = 0; i < part.acts.length; i++) {
      const move = parseMove(part.acts[i]);
      if (move.cmd !== 'wait') await d.advance(MOVE_TIME);   // before the move, so the screen after it still shows what it caused
      const res = await doMove(d, move);
      if (part.own) log.push({ n: i + 1, move: part.acts[i], ...res });
      const intr = (part.ses.interruptions || []).find(x => x.after === i + 1);
      if (intr) {
        await d.advance(parseDur(String(intr.wait || '2m')));
        if (part.own && i + 1 === part.acts.length) interruption = intr.text;
      }
    }
  }
  return { d, log, interruption };
}

async function describe(d) {
  const t = d.cfg.target;
  const aria = await d.aria();
  const notice = t.toast ? await d.page.evaluate(inPage((sel, { all }) => all(document, sel).map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ')), t.toast) : '';
  const now = await d.page.evaluate(() => Date.now());
  const clock = new Date(now).toLocaleString('it-IT', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: t.timezone });
  return { aria, notice, clock };
}

export async function play(cfg, args) {
  if (!args.session) { console.error('play: --session <cartella> è obbligatorio'); return 1; }
  const dir = path.resolve(args.session);
  ensureDir(dir);
  const actsFile = path.join(dir, ACTS);
  const acts = fs.existsSync(actsFile) ? readYaml(actsFile) || [] : [];
  if (args.do) { acts.push(String(args.do)); fs.writeFileSync(actsFile, toYaml(acts)); }
  const target = await openTarget(cfg, args);
  try {
    const { d, log, interruption } = await replay(cfg, dir, target);
    const last = log[log.length - 1];
    if (args.do && last && !last.ok) {   // nothing happened in the app: the move is not kept, the attempt is
      acts.pop(); fs.writeFileSync(actsFile, toYaml(acts));
      const attempts = fs.existsSync(path.join(dir, ATTEMPTS)) ? readYaml(path.join(dir, ATTEMPTS)) || [] : [];
      attempts.push({ after: acts.length, move: args.do, error: last.error });
      fs.writeFileSync(path.join(dir, ATTEMPTS), toYaml(attempts));
    }
    const scr = await describe(d);
    const shot = path.join(dir, `screen-${String(acts.length).padStart(3, '0')}.png`);
    await d.shot(shot);
    if (d.errors.length) console.error('page error: ' + d.errors[0]);
    await d.close();
    const out = {
      mossa: acts.length,
      ora: scr.clock,
      esito: !last ? 'hai appena aperto l’app' : last.ok ? last.did : `${last.error}: non è successo niente`,
      ...(last && !last.ok && last.visible ? { comandi_sullo_schermo: last.visible } : {}),
      ...(interruption ? { interruzione: interruption } : {}),
      ...(scr.notice ? { avviso: scr.notice } : {}),
      immagine: shot,
      schermo: scr.aria,
    };
    console.log(toYaml(out));
    return 0;
  } finally {
    await target.close();
  }
}
