import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, WebDriver } from '../src/driver/web.mjs';
import { serveStatic } from '../src/server.mjs';

// The driver on a page whose card body sits in an open shadow root, with another one nested in it.
const cfg = {
  target: {
    viewport: { width: 375, height: 812 }, deviceScale: 1, locale: 'en-GB', timezone: 'UTC', startTime: '2026-01-05T09:00:00',
    channel: 'chrome', layers: [], ignore: '', disclosure: '[aria-expanded=false]',
  },
  adapter: {},
};
let server, browser, driver;

before(async () => {
  server = await serveStatic(path.join(path.dirname(fileURLToPath(import.meta.url)), 'pages', 'shadow'));
  browser = await launchBrowser(cfg);
});
after(async () => { await browser?.close(); await server?.close(); });

const fresh = async () => { await driver?.close(); driver = await new WebDriver(browser, cfg, server.url).open(); return driver; };
const heard = d => d.page.locator('#log').textContent();

test('taps a button inside a shadow root', async () => {
  const d = await fresh();
  const r = await d.tap('Done');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.level, 'exact');
  assert.equal(await heard(d), 'click Done');
});

test('taps a button inside a nested shadow root, by its label', async () => {
  const d = await fresh();
  const r = await d.tap({ label: 'Keep the rest' });
  assert.equal(r.ok, true, r.error);
  assert.equal(await heard(d), 'click Keep the rest');
});

test('finds in document order, the shadow tree in the place of its host', async () => {
  const d = await fresh();
  const first = await d.find('Roll', 'act'), second = await d.find({ text: 'Roll', index: 1 }, 'act');
  assert.deepEqual([first.name, second.name], ['Rolls', 'Roll +2 Hit dice d8']);
});

test('types into a field labelled inside its shadow root', async () => {
  const d = await fresh();
  const r = await d.input({ label: 'How many' }, '2');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.nameSource, 'label');
  assert.equal(await d.page.locator('#count').inputValue(), '2');
  assert.equal(await heard(d), 'input 2');
});

test('sees text inside a shadow root, never inside a hidden host', async () => {
  const d = await fresh();
  assert.equal((await d.see('Spend hit dice')).ok, true);
  const hidden = await d.tap('Secret');
  assert.equal(hidden.ok, false);
  assert.ok(hidden.candidates.includes('Done') && hidden.candidates.includes('Keep the rest') && !hidden.candidates.includes('Secret'));
});

test('measures the screen across shadow roots', async () => {
  const d = await fresh();
  const s = await d.screen();
  assert.equal(s.choices, 5);   // Rolls, the field, Roll, Done and the widget's button
  assert.equal(s.words, 18);
  assert.deepEqual(s.disclosures.map(x => x.name), ['Rolls']);
});
