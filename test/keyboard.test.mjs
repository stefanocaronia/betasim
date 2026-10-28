import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, WebDriver } from '../src/driver/web.mjs';
import { serveStatic } from '../src/server.mjs';
import { stepModel } from '../src/usability/model.mjs';

// What the driver measures for who uses the keyboard alone, and what the model makes of it.
const cfg = {
  target: {
    viewport: { width: 1280, height: 800 }, deviceScale: 1, locale: 'en-GB', timezone: 'UTC', startTime: '2026-01-05T09:00:00',
    channel: 'chrome', layers: [], ignore: '', disclosure: '[aria-expanded=false]',
  },
  adapter: {},
};
let server, browser, driver;

before(async () => {
  server = await serveStatic(path.join(path.dirname(fileURLToPath(import.meta.url)), 'pages', 'keyboard'));
  browser = await launchBrowser(cfg);
});
after(async () => { await driver?.close(); await browser?.close(); await server?.close(); });

const fresh = async () => { await driver?.close(); driver = await new WebDriver(browser, cfg, server.url).open(); return driver; };

test('a button is reached by Tab, counted from the top when nothing has the focus', async () => {
  const d = await fresh();
  const r = await d.find('Second', 'act');
  assert.equal(r.keyboard, true);
  assert.equal(r.keySteps, 2);
});

test('the stops are counted from where the focus is, backwards too', async () => {
  const d = await fresh();
  await d.page.focus('[role=tab][tabindex="0"]');
  assert.equal((await d.find('First', 'act')).keySteps, 2);
});

test('a tab out of the Tab order is reached with arrows inside its group', async () => {
  const d = await fresh();
  const r = await d.find('Documents', 'act');
  assert.equal(r.keyboard, true);
  assert.equal(r.keySteps, 4);
});

test('a control inside a shadow root is in the Tab order', async () => {
  const d = await fresh();
  const r = await d.find('Inside', 'act');
  assert.equal(r.keyboard, true);
  assert.equal(r.keySteps, 4);
});

test('a clickable box the keyboard never reaches', async () => {
  const d = await fresh();
  const r = await d.find({ css: '.square' }, 'act');
  assert.equal(r.keyboard, false);
  assert.equal(r.keySteps, null);
});

test('the model stops who uses the keyboard where it does not reach, and no one else', () => {
  const step = { name: 'E4', kind: 'tap', w: 120, h: 48, labelled: true, actionable: true, keyboard: false, keySteps: null, screen: { choices: 6 } };
  const typist = { tech: 4, vision: 'none', motor: 'normal', keyboard: true };
  assert.equal(stepModel(step, typist, {}).reason, 'keys');
  assert.ok(stepModel(step, typist, {}).pFind < 0.2);
  assert.ok(stepModel(step, { ...typist, keyboard: undefined }, {}).pFind > 0.9);
  assert.ok(stepModel({ ...step, keyboard: true, keySteps: 1 }, typist, {}).pFind > 0.9);
});

test('far stops cost time to who uses the keyboard', () => {
  const step = { name: 'Go', kind: 'tap', w: 120, h: 48, labelled: true, actionable: true, keyboard: true, screen: { choices: 6 } };
  const typist = { tech: 4, vision: 'none', motor: 'normal', keyboard: true };
  assert.ok(stepModel({ ...step, keySteps: 20 }, typist, {}).t > stepModel({ ...step, keySteps: 1 }, typist, {}).t + 4);
});
