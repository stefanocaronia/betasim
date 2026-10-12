import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readYaml } from './util.mjs';

export const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATES = ['betasim.yaml', 'test/betasim.yaml', 'tests/betasim.yaml'];

/** Reads the project's betasim.yaml; every relative path in it is relative to that file. */
export async function loadConfig(configPath) {
  const file = configPath
    ? path.resolve(configPath)
    : CANDIDATES.map(c => path.resolve(c)).find(f => fs.existsSync(f));
  if (!file || !fs.existsSync(file)) throw new Error('betasim.yaml not found: pass --config path/to/betasim.yaml');
  const dir = path.dirname(file);
  const raw = readYaml(file) || {};
  const rel = p => (p == null ? p : path.resolve(dir, p));
  const target = {
    kind: 'web',
    viewport: { width: 375, height: 812 },
    deviceScale: 2,
    locale: 'en-GB',
    timezone: 'UTC',
    startTime: '2026-01-05T09:00:00',
    channel: 'chrome',
    layers: [],
    ignore: '',
    disclosure: '[aria-expanded=false]',
    ...(raw.target || {}),
  };
  if (target.serve) target.serve = rel(target.serve);
  const personaDirs = (raw.personas || ['builtin']).map(p => (p === 'builtin' ? path.join(PKG_DIR, 'personas') : rel(p)));
  const cfg = {
    name: raw.name || path.basename(path.dirname(dir)),
    file, dir, target, personaDirs,
    dirs: {
      engine: rel(raw.suites?.engine ?? 'engine'),
      flows: rel(raw.suites?.flows ?? 'flows'),
      tasks: rel(raw.suites?.usability ?? 'tasks'),
    },
    reportDir: rel(raw.report ?? 'report'),
    uiLanguage: raw.ui_language || 'en',
    terms: raw.terms || {},
    // icons everybody knows (the play and pause of every player): an icon-only control with one of these names costs a third
    familiarIcons: (raw.familiar_icons || []).map(s => String(s).trim().toLowerCase()),
    runs: raw.runs || 300,
    seed: raw.seed || 1,
    // the project's targets (audiences with weight and goal): a list here, or a YAML file of their own
    segments: typeof raw.targets === 'string' ? (readYaml(rel(raw.targets)) || []) : (raw.targets || []),
    // the project's features, for the coverage of the plain functional check; and the names of its screens
    features: typeof raw.features === 'string' ? (readYaml(rel(raw.features)) || []) : (raw.features || []),
    screens: raw.screens || {},
    // A/B: variants of the app, each a setup the adapter applies over every flow; the first is the app as it is,
    // and a plain run is a run of the first
    variants: Object.entries(raw.variants || {}).map(([id, v]) => ({ id, name: v?.name || id, setup: v?.setup || null })),
    adapter: {},
  };
  if (raw.adapter) cfg.adapter = (await import(pathToFileURL(rel(raw.adapter)).href)).default || {};
  return cfg;
}
