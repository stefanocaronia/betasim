import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, WebDriver } from '../src/driver/web.mjs';
import { serveStatic } from '../src/server.mjs';

// Words as a person reads them, on a page right to left whose names are isolated by invisible marks.
const cfg = {
  target: {
    viewport: { width: 1280, height: 800 }, deviceScale: 1, locale: 'he-IL', timezone: 'UTC', startTime: '2026-01-05T09:00:00',
    channel: 'chrome', layers: [], ignore: '', disclosure: '[aria-expanded=false]',
  },
  adapter: {},
};
let server, browser, driver;

before(async () => {
  server = await serveStatic(path.join(path.dirname(fileURLToPath(import.meta.url)), 'pages', 'words'));
  browser = await launchBrowser(cfg);
  driver = await new WebDriver(browser, cfg, server.url).open();
});
after(async () => { await driver?.close(); await browser?.close(); await server?.close(); });

test('finds a label by its words, without the marks that isolate a name', async () => {
  const r = await driver.find({ label: 'מעקב אחרי Il vino di Bertoldo' }, 'act');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.level, 'exact');
  assert.equal(r.name, 'מעקב אחרי Il vino di Bertoldo');
});

test('sees text whose marks set its direction', async () => {
  assert.equal((await driver.see('Trovare tre botti במולינו')).ok, true);
});
