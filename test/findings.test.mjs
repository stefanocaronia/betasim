import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFindings } from '../src/findings.mjs';

// The time finding: a task slower than twice its expected seconds, for a persona, stretched by the persona's pace.
const results = medians => ({
  meta: { runs: 300 },
  usability: {
    read: { measurable: true, flow: 'read', steps: [], personas: Object.fromEntries(Object.entries(medians).map(([id, medianT]) => [id, { success: 1, medianT, stops: {}, reasons: {}, steps: [] }])) },
  },
});
const tasks = [{ id: 'read', goal: 'Read the letter', expected_seconds: 10 }];
const timeOf = (medians, personas) => buildFindings(results(medians), { personas, tasks, cfg: { dir: '.' } }).find(f => f.id === 'U:read:time');

test('a task twice slower than expected is a finding', () => {
  assert.ok(timeOf({ eyes: 25, ear: 25 }, [{ id: 'eyes' }, { id: 'ear' }]));
});

test('the pace of a screen reader stretches what is expected of who uses one', () => {
  assert.equal(timeOf({ eyes: 15, ear: 55 }, [{ id: 'eyes' }, { id: 'ear', pace: 3 }]), undefined);
  assert.ok(timeOf({ eyes: 15, ear: 65 }, [{ id: 'eyes' }, { id: 'ear', pace: 3 }]));
});
