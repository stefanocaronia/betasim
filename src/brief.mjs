import { WebDriver } from './driver/web.mjs';
import { openTarget } from './run.mjs';
import { loadDir, toYaml } from './util.mjs';
import { loadPersonas } from './personas.mjs';
import { forVariant, applyVariant } from './suites/flows.mjs';

/**
 * The hook for LLM testers: the persona, the goal and the first screen as an accessibility tree.
 * An agent reads it, thinks aloud as the persona and answers with the name of what it would tap.
 */
export async function brief(cfg, args) {
  const tasks = loadDir(cfg.dirs.tasks), flows = loadDir(cfg.dirs.flows), personas = loadPersonas(cfg);
  const task = tasks.find(t => t.id === args.task), persona = personas.find(p => p.id === args.persona);
  if (!task || !persona) { console.error(`task or persona not found (tasks: ${tasks.map(t => t.id).join(', ')}; personas: ${personas.map(p => p.id).join(', ')})`); return 1; }
  const flow = flows.find(f => f.id === task.flow);
  const target = await openTarget(cfg, args);
  let screen = '';
  try {
    const d = await new WebDriver(target.browser, cfg, target.baseUrl).open();
    const variant = cfg.variants.find(v => v.id === args.variant) || cfg.variants[0] || null;
    const setup = forVariant(flow?.setup, variant, cfg.variants.map(v => v.id));
    if (setup && cfg.adapter.setup) { await cfg.adapter.setup(d.page, setup); await d.settle(); }
    await applyVariant(d.page, cfg, variant); await d.settle();
    screen = await d.aria();
    await d.close();
  } finally { await target.close(); }
  const { _file, ...who } = persona;
  console.log(toYaml({
    persona: who,
    goal: task.goal,
    screen,
    rules: [
      'You are this persona and do not know the app. Read only what this persona would read.',
      'Answer with one line of thinking aloud, then ONE element to tap, with its exact name as it appears in screen; or "I give up".',
      'After each tap you get the new screen. Stop when you think you are done.',
    ],
  }));
  return 0;
}
