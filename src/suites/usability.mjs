import { runFlow } from './flows.mjs';
import { simulate } from '../usability/model.mjs';
import { rng, hashSeed } from '../util.mjs';

export function audienceOf(task, personas) {
  const a = task.audience ?? 'all';
  if (a === 'all') return personas;
  const wanted = Array.isArray(a) ? a : (a.tags || []);
  return personas.filter(p => wanted.includes(p.id) || (p.tags || []).some(t => wanted.includes(t)));
}

/** Measures each task's path once on the real page, then lets every persona of the audience try it many times. */
export async function runUsability(ctx, tasks, personas, flowById, flowResults, { runs, seed }) {
  const out = {};
  for (const task of tasks) {
    const flow = flowById[task.flow];
    if (!flow) { out[task.id] = { measurable: false, reason: `flow "${task.flow}" not found` }; continue; }
    let fr = flowResults[flow.id];
    if (!fr) { fr = await runFlow(ctx, flow); flowResults[flow.id] = fr; }
    if (!fr.ok) { out[task.id] = { measurable: false, flow: flow.id, reason: `flow ${flow.id} fails: ${fr.error}` }; continue; }
    const steps = fr.trace;
    const per = {};
    for (const p of audienceOf(task, personas)) {
      per[p.id] = simulate(steps, p, runs, rng(hashSeed(`${seed}:${task.id}:${p.id}`)), ctx.cfg);
    }
    out[task.id] = {
      measurable: true, flow: flow.id, taps: fr.taps, inputs: fr.inputs,
      steps: steps.map(s => ({ step: s.step, name: s.name, route: s.screen?.route, w: s.w, h: s.h, concept: s.concept?.name })),
      personas: per,
    };
  }
  return out;
}
