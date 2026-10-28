import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { loadDir, readYaml, toYaml, ensureDir } from './util.mjs';
import { loadPersonas } from './personas.mjs';

/*
 * LLM testers. betasim does not call a model itself: it prepares the brief (who the person is, the situation,
 * the goal, how to use the phone through `betasim play`, how to keep the diary) and turns the diary into a report.
 * Any runner can play the person: a Claude Code subagent today, an API script tomorrow.
 */

function sessionDir(cfg, scenarioId, phaseId) { return path.join(cfg.reportDir, 'agents', scenarioId, phaseId); }

function words(p) {
  const out = [];
  if (p.identity) out.push(p.identity.trim());
  if (p.capabilities) out.push('**What you can do, and how.** ' + p.capabilities.trim());
  if (p.knowhow) out.push('**What you know of phones and apps.** ' + p.knowhow.trim());
  if (p.approach) out.push('**How you face a new app.** ' + p.approach.trim());
  if (p.voice) out.push('**How you talk and think.** ' + p.voice.trim());
  return out.join('\n\n');
}

export async function agentBrief(cfg, args) {
  if (!args.scenario || !args.phase) { console.error('agent-brief: --scenario <file> --phase <id>'); return 1; }
  const scenario = readYaml(path.resolve(args.scenario));
  const scenarioId = scenario.id || path.basename(args.scenario).replace(/\.ya?ml$/, '');
  const phase = (scenario.phases || []).find(p => p.id === args.phase);
  const persona = loadPersonas(cfg).find(p => p.id === scenario.persona);
  if (!phase || !persona) { console.error(`${phase ? `persona "${scenario.persona}"` : `phase "${args.phase}"`} not found: check the scenario and betasim.yaml's personas`); return 1; }
  const dir = sessionDir(cfg, scenarioId, phase.id);
  if (args.fresh) fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  const ses = { start: phase.start, setup: phase.setup, interruptions: phase.interruptions || [] };
  if (args.variant) {   // A/B: the tester uses this variant of the app, on every move
    if (!cfg.variants.some(v => v.id === args.variant)) { console.error(`variant "${args.variant}" is not in betasim.yaml`); return 1; }
    ses.variant = args.variant;
  }
  if (phase.continueFrom) ses.continueFrom = path.join('..', phase.continueFrom);
  fs.writeFileSync(path.join(dir, 'session.yaml'), toYaml(ses));
  let memory = '';
  if (phase.continueFrom) {
    const prev = path.join(sessionDir(cfg, scenarioId, phase.continueFrom), 'diary.yaml');
    if (fs.existsSync(prev)) { const dj = readDiary(prev); memory = toYaml(dj.outcome || {}); }
  }
  const rel = p => path.relative(process.cwd(), p).replace(/\\/g, '/');
  const cmd = `node ${rel(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'betasim.mjs'))} play --config ${rel(cfg.file)} --session ${rel(dir)}`;
  const brief = `# You are ${persona.name}, about to use an app on your phone

You are in a usability test, playing a real person. You are not an assistant and not an expert: you are ${persona.name}, ${persona.age}. Do what this person would do, with their limits, habits and patience. If they would not understand, you do not understand; if they would give up, you give up.

## Who you are

${words(persona)}

## The situation

${phase.context.trim()}

## What you want

${phase.goal.trim()}
${memory ? `\n## What you remember from last time\n\n${memory}\n` : ''}
## How you use the phone

The phone is the real app. One move at a time, with this command (Bash):

\`\`\`
${cmd} --do "<move>"
\`\`\`

The first time, run it **without** \`--do\` to see the first screen. The moves:

- \`tap: <words you see on the screen>\`, or \`tap: {label: <name>}\` for an icon without words whose name you know;
- \`type: {into: <name of the field>, text: <what you type>}\`;
- \`scroll: down\` or \`scroll: up\`; \`swipe: left\` or \`swipe: right\`; \`back\`;
- \`wait: 5m\`, when you let time pass (the pasta cooking, the homework).

Each answer gives the time, what happened, the notices, the interruptions, and the screen in two forms: \`image\`, **always to look at with the Read tool** (it is what you would see), and \`screen\`, the list of elements with their names, only to write the move with the right words. A move that finds nothing does nothing, as when you tap in the wrong place.

## Rules

- Stay in character. Read only what this person would read; look at the image before deciding.
- **Do not read any file of the project** (code, documents, specs): you do not know how the app is made. Use only the command above, and Read on the images it returns.
- At most ${phase.budget || 30} moves. Stop earlier if you got what you wanted, or if this person would give up at that point.
- Interruptions come by themselves: when they happen, remember them as this person would (maybe you lost the thread).

## The diary

Keep a diary in \`${rel(path.join(dir, 'diary.yaml'))}\`: after each move add an entry, in the language of the goal above, in ${persona.name}'s voice:

\`\`\`yaml
moves:
  - move: 1
    see: what you notice on the screen, in a few words
    think: what goes through your head
    do: the move you choose, and why
    stumble: only if you got confused or made a mistake, the reason in one line
\`\`\`

At the end add:

\`\`\`yaml
outcome:
  success: yes | partly | no
  what_i_did: ...
  where_i_got_lost: ...
  hooked: yes | maybe | no
  why: ...
  what_would_make_me_pay: ...
\`\`\`

When you are done, answer in three lines: how it went, the worst moment, whether you would use it again.
`;
  fs.writeFileSync(path.join(dir, 'brief.md'), brief);
  console.log(brief);
  return 0;
}

/** A diary written by a model is YAML, but a value with ": " or a quote that does not close it breaks it: such values get quoted, and it is read again. */
function readDiary(file) {
  const text = fs.readFileSync(file, 'utf8');
  try { return YAML.parse(text) || {}; } catch {
    const whole = v => /^"(?:[^"\\]|\\.)*"\s*$/.test(v) || /^'(?:[^']|'')*'\s*$/.test(v) || /^[|>]/.test(v);
    const fixed = text.split('\n').map(line => {
      const m = /^(\s*(?:- )?)(see|think|do|stumble): (.+)$/.exec(line);
      return m && !whole(m[3]) ? `${m[1]}${m[2]}: ${JSON.stringify(m[3])}` : line;
    }).join('\n');
    return YAML.parse(fixed) || {};
  }
}

/** The diary becomes a report: the outcome, the stumbles as findings (L:), the path actually taken. */
export function agentReport(cfg, args) {
  const root = path.join(cfg.reportDir, 'agents');
  const scenarioId = args.scenario ? path.basename(args.scenario).replace(/\.ya?ml$/, '') : null;
  const dirs = [];
  if (fs.existsSync(root)) for (const s of fs.readdirSync(root)) {
    if (scenarioId && s !== scenarioId) continue;
    for (const p of fs.readdirSync(path.join(root, s))) { const d = path.join(root, s, p); if (fs.existsSync(path.join(d, 'diary.yaml'))) dirs.push([s, p, d]); }
  }
  const reports = [];
  for (const [s, p, d] of dirs) {
    const diary = readDiary(path.join(d, 'diary.yaml'));
    const acts = fs.existsSync(path.join(d, 'actions.yaml')) ? readYaml(path.join(d, 'actions.yaml')) || [] : [];
    const attempts = fs.existsSync(path.join(d, 'attempts.yaml')) ? readYaml(path.join(d, 'attempts.yaml')) || [] : [];
    const ses = fs.existsSync(path.join(d, 'session.yaml')) ? readYaml(path.join(d, 'session.yaml')) || {} : {};
    const scen = fs.existsSync(path.join(cfg.dir, 'agents', `${s}.yaml`)) ? readYaml(path.join(cfg.dir, 'agents', `${s}.yaml`)) || {} : {};
    const interrupted = new Set((ses.interruptions || []).map(x => x.after));   // an interruption is life, not a finding
    // giving up weighs more than a hesitation; the diary may be in the app's language, so a few Italian words count too
    const quits = /give up|gave up|i quit|i don.t understand|lascio|mollato|mi arrendo|rinuncio|abbandono|non capisco/i;
    const stumbles = (diary.moves || []).filter(m => m.stumble && !interrupted.has(m.move)).map(m => ({
      id: `L:${s}:${p}:${m.move}`, severity: quits.test(m.stumble) ? 'A' : 'P', kind: 'llm',
      personas: scen.persona ? [scen.persona] : [], title: `${s}, ${p}, move ${m.move}: ${m.stumble}`, evidence: [m.see, m.think].filter(Boolean) }));
    const r = { scenario: s, phase: p, persona: scen.persona, moves: acts.length, misses: attempts.length, outcome: diary.outcome || null, stumbles };
    fs.writeFileSync(path.join(d, 'report.yaml'), toYaml(r));
    reports.push(r);
    const e = diary.outcome || {};
    console.log(`${s} / ${p}: ${acts.length} moves, ${attempts.length} missed taps · success ${e.success ?? '—'} · hooked ${e.hooked ?? '—'}`);
    for (const f of stumbles) console.log(`  ${f.severity} ${f.title}`);
  }
  if (!reports.length) console.log('No diary found.');
  return 0;
}

/** All LLM sessions with a report, for the dashboard. */
export function readAgentReports(cfg) {
  const root = path.join(cfg.reportDir, 'agents');
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const s of fs.readdirSync(root)) for (const p of fs.readdirSync(path.join(root, s))) {
    const f = path.join(root, s, p, 'report.yaml');
    if (fs.existsSync(f)) out.push(readYaml(f));
  }
  return out;
}
