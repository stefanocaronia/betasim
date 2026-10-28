import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPersonas, PROFILES_DIR } from '../src/personas.mjs';

const project = personas => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'betasim-personas-'));
  for (const [id, text] of Object.entries(personas)) fs.writeFileSync(path.join(dir, `${id}.yaml`), text);
  return { personaDirs: [PROFILES_DIR, dir] };
};

test('a persona takes its profile\'s abilities and keeps its own', () => {
  const pina = loadPersonas(project({ pina: 'name: Pina\nage: 82\nprofile: senior\ntags: [cooking]\n' })).find(p => p.id === 'pina');
  assert.equal(pina.age, 82);
  assert.equal(pina.vision, 'presbyopia');
  assert.equal(pina.motor, 'unsteady');
  assert.equal(pina.name, 'Pina');
  assert.deepEqual(pina.tags, ['cooking']);
});

test('the generic profiles are personas as they are', () => {
  const ids = loadPersonas({ personaDirs: [PROFILES_DIR] }).map(p => p.id);
  assert.ok(['expert', 'senior', 'screen-reader', 'low-vision'].every(id => ids.includes(id)));
});

test('an unknown profile is an error that names the profiles', () => {
  assert.throws(() => loadPersonas(project({ x: 'name: X\nprofile: nobody\n' })), /profile "nobody" does not exist; the profiles are .*senior/);
});
