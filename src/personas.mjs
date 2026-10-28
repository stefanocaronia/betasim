import path from 'node:path';
import { loadDir } from './util.mjs';
import { PKG_DIR } from './config.mjs';

/** betasim's generic profiles: abilities only, no name or story. `personas: [builtin]` in betasim.yaml uses them as they are. */
export const PROFILES_DIR = path.join(PKG_DIR, 'profiles');

// what the model reads of a persona; a project's persona takes these from its profile and may change any of them
const ABILITIES = ['age', 'tech', 'english', 'vision', 'motor', 'keyboard', 'explore', 'reading', 'patience', 'hurry', 'pace'];

/** The project's personas, each with its profile's abilities under its own values. */
export function loadPersonas(cfg) {
  const profiles = Object.fromEntries(loadDir(PROFILES_DIR).map(p => [p.id, p]));
  return cfg.personaDirs.flatMap(loadDir).map(p => {
    if (p.profile == null) return p;
    const base = profiles[p.profile];
    if (!base) throw new Error(`persona "${p.id}" (${p._file}): profile "${p.profile}" does not exist; the profiles are ${Object.keys(profiles).join(', ')}`);
    return { ...Object.fromEntries(ABILITIES.filter(k => base[k] != null).map(k => [k, base[k]])), ...p };
  });
}
