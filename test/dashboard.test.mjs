import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboard, trendPoint } from '../src/dashboard.mjs';

// one task, two personas: Pina stops at the second step, Marco does not
const results = {
  meta: { date: '28/10/2026, 10:00:00', runs: 100, seed: 7, seconds: 3 }, engine: [], flows: [{ id: 'eggs', name: 'Eggs', ok: true, taps: 2, inputs: 0, ms: 900, trace: [] }],
  usability: {
    eggs: {
      measurable: true, flow: 'eggs', taps: 2, inputs: 0, steps: [{ step: 1, name: 'Timers' }, { step: 2, name: 'Start' }],
      personas: {
        pina: { success: 0.8, medianT: 9, stops: { 1: 20 }, steps: [{ reason: null }, { reason: 'hidden' }] },
        marco: { success: 0.99, medianT: 4, stops: {}, steps: [{ reason: null }, { reason: null }] },
      },
    },
  },
};
const personas = [{ id: 'pina', name: 'Pina', age: 82, profile: 'senior', tech: 1, reading: 4, vision: 'presbyopia' }, { id: 'marco', name: 'Marco', age: 35, tech: 5 }];
const tasks = [{ id: 'eggs', goal: 'Boil the eggs', flow: 'eggs' }];
const segments = [{ id: 'everyone', name: 'Everyone', floor: 0.9, personas: ['pina', 'marco'] }];
const page = renderDashboard({ cfg: { name: 'Test', uiLanguage: 'native' }, results, findings: [], tasks, personas, segments, history: [], current: trendPoint('latest', results, [], tasks, segments) });

test('the dashboard has a tab for each part, and the page works without script', () => {
  for (const id of ['overview', 'targets', 'map', 'findings', 'remedies', 'coverage', 'flows', 'personas']) {
    assert.match(page, new RegExp(`<a href="#${id}" data-tab="${id}"`));
    assert.match(page, new RegExp(`<section id="${id}" class="tab">`));
  }
  assert.match(page, /<html lang="en">/);
  assert.match(page, /html\.js section\.tab\{display:none\}/);
});

test('a persona has a card, reached from its name in the table', () => {
  assert.match(page, /<th scope="col" title=""><a href="#persona-pina">/);
  assert.match(page, /<article class="person" id="persona-pina" tabindex="-1">/);
  assert.match(page, /title="the betasim profile it starts from">senior</);
  assert.match(page, /stops at step 2, &quot;Start&quot;: it is under an expander/);
});

test('one run has no trend chart yet', () => {
  assert.match(page, /The trend appears from the second run/);
  assert.doesNotMatch(page, /<svg class="lc"/);
});
