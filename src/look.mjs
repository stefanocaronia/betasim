import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { serveStatic } from './server.mjs';

const require = createRequire(import.meta.url);

/**
 * Looks at a page as a person would: at each width and theme asked, a screenshot, what the console said, the problems of accessibility axe finds,
 * and with --aria the page as a screen reader reads it. The page is a URL, or a folder (or an html file in it) served on the spot.
 */
export async function look(args) {
  const where = args.url ?? args._[1];
  if (!where) { console.error('Which page? betasim look <url | folder | file.html> [--width 375,1280] [--theme light,dark]'); return 2; }
  const widths = String(args.width ?? '375,1280').split(',').map(Number).filter(Boolean);
  const themes = String(args.theme ?? 'light,dark').split(',');
  const out = path.resolve(args.out ?? 'look');
  const steps = actions(args);
  fs.mkdirSync(out, { recursive: true });

  let server = null, url = where;
  if (fs.existsSync(where)) {
    const file = path.resolve(where), folder = fs.statSync(file).isDirectory() ? file : path.dirname(file);
    server = await serveStatic(folder);
    url = server.url + (fs.statSync(file).isDirectory() ? '' : path.basename(file));
  }

  const browser = await launch(args);
  let problems = 0;
  try {
    for (const width of widths) {
      for (const theme of themes) {
        const page = await browser.newPage({ viewport: { width, height: width < 600 ? 812 : 900 }, colorScheme: theme === 'dark' ? 'dark' : 'light', reducedMotion: args.still ? 'reduce' : 'no-preference' });
        const said = [];
        // A file that does not load is told by its address, not by the console's bare line.
        page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().startsWith('Failed to load resource')) said.push(`${m.type()}: ${m.text()}`); });
        page.on('pageerror', e => said.push(`error: ${e.message}`));
        page.on('requestfailed', r => said.push(`not loaded: ${r.url()} (${r.failure()?.errorText ?? ''})`));
        page.on('response', r => { if (r.status() >= 400) said.push(`not loaded: ${r.url()} (${r.status()})`); });
        await page.goto(url, { waitUntil: 'networkidle' });
        for (const step of steps) await act(page, step);
        await page.waitForTimeout(400);
        const shot = path.join(out, `${width}-${theme}.png`);
        await page.screenshot({ path: shot, fullPage: !!args.full });
        const axe = await accessibility(page);
        problems += said.length + axe.length;
        console.log(`\n${width}px, ${theme}: ${shot}`);
        console.log(said.length ? `Console:\n  ${said.join('\n  ')}` : 'Console: nothing.');
        console.log(axe.length ? `Accessibility:\n  ${axe.join('\n  ')}` : 'Accessibility: nothing found.');
        if (args.aria) console.log(`\n${await page.locator('body').ariaSnapshot()}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    if (server) await server.close();
  }
  return problems ? 1 : 0;
}

/** The clicks, keys and waits asked, in their order: --click <selector>, --press <key>, --wait <ms>. */
function actions(args) {
  return (args.steps ?? []).map(([name, value]) => ({ name, value }));
}

async function act(page, step) {
  if (step.name === 'click') await page.locator(step.value).first().click();
  else if (step.name === 'press') await page.keyboard.press(step.value);
  else if (step.name === 'wait') await page.waitForTimeout(Number(step.value));
  await page.waitForTimeout(300);
}

/** What axe finds wrong for people with a screen reader, a keyboard or weak sight, one line each: how bad, what, how many. */
async function accessibility(page) {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
  return result.violations.map(v => `${v.impact ?? 'minor'}: ${v.help} (${v.nodes.length}×, ${v.id}) e.g. ${v.nodes[0]?.target?.join(' ') ?? ''}`);
}

/** The installed Chrome (no download), else the bundled Chromium. */
async function launch(args) {
  const headless = !args.headed;
  try { return await chromium.launch({ headless, channel: 'chrome' }); } catch { return chromium.launch({ headless }); }
}
