import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { loadDir, readYaml, toYaml, ensureDir } from './util.mjs';

/*
 * LLM testers. betasim does not call a model itself: it prepares the brief (who the person is, the situation,
 * the goal, how to use the phone through `betasim play`, how to keep the diary) and turns the diary into a report.
 * Any runner can play the person: a Claude Code subagent today, an API script tomorrow.
 */

function sessionDir(cfg, scenarioId, phaseId) { return path.join(cfg.reportDir, 'agents', scenarioId, phaseId); }

function words(p) {
  const out = [];
  if (p.identity) out.push(p.identity.trim());
  if (p.capabilities) out.push('**Cosa sai fare, e come.** ' + p.capabilities.trim());
  if (p.knowhow) out.push('**Cosa conosci di telefoni e app.** ' + p.knowhow.trim());
  if (p.approach) out.push('**Come affronti un’app nuova.** ' + p.approach.trim());
  if (p.voice) out.push('**Come parli e pensi.** ' + p.voice.trim());
  return out.join('\n\n');
}

export async function agentBrief(cfg, args) {
  if (!args.scenario || !args.phase) { console.error('agent-brief: --scenario <file> --phase <id>'); return 1; }
  const scenario = readYaml(path.resolve(args.scenario));
  const scenarioId = scenario.id || path.basename(args.scenario).replace(/\.ya?ml$/, '');
  const phase = (scenario.phases || []).find(p => p.id === args.phase);
  const persona = cfg.personaDirs.flatMap(loadDir).find(p => p.id === scenario.persona);
  if (!phase || !persona) { console.error('fase o persona non trovata'); return 1; }
  const dir = sessionDir(cfg, scenarioId, phase.id);
  if (args.fresh) fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  const ses = { start: phase.start, setup: phase.setup, interruptions: phase.interruptions || [] };
  if (args.variant) {   // A/B: the tester uses this variant of the app, on every move
    if (!cfg.variants.some(v => v.id === args.variant)) { console.error(`variante "${args.variant}" non in betasim.yaml`); return 1; }
    ses.variant = args.variant;
  }
  if (phase.continueFrom) ses.continueFrom = path.join('..', phase.continueFrom);
  fs.writeFileSync(path.join(dir, 'session.yaml'), toYaml(ses));
  let memory = '';
  if (phase.continueFrom) {
    const prev = path.join(sessionDir(cfg, scenarioId, phase.continueFrom), 'diary.yaml');
    if (fs.existsSync(prev)) { const dj = readDiary(prev); memory = toYaml(dj.esito || {}); }
  }
  const rel = p => path.relative(process.cwd(), p).replace(/\\/g, '/');
  const cmd = `node ${rel(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'betasim.mjs'))} play --config ${rel(cfg.file)} --session ${rel(dir)}`;
  const brief = `# Sei ${persona.name}, e stai per usare un'app sul telefono

Stai facendo un test di usabilità interpretando una persona vera. Non sei un assistente e non sei un esperto: sei ${persona.name}, ${persona.age} anni. Fai quello che farebbe lei, con i suoi limiti, le sue abitudini, la sua pazienza. Se lei non capirebbe, non capisci; se lei lascerebbe perdere, lasci perdere.

## Chi sei

${words(persona)}

## La situazione

${phase.context.trim()}

## Cosa vuoi ottenere

${phase.goal.trim()}
${memory ? `\n## Cosa ricordi della volta scorsa\n\n${memory}\n` : ''}
## Come usi il telefono

Il telefono è l'app vera. Una mossa alla volta, con questo comando (Bash):

\`\`\`
${cmd} --do "<mossa>"
\`\`\`

La prima volta lancialo **senza** \`--do\`, per vedere lo schermo iniziale. Le mosse possibili:

- \`tap: <parole che vedi sullo schermo>\`, oppure \`tap: {label: <nome>}\` per un'icona senza scritta di cui conosci il nome;
- \`type: {into: <nome del campo>, text: <cosa scrivi>}\`;
- \`scroll: down\` o \`scroll: up\`; \`swipe: left\` o \`swipe: right\`; \`back\`;
- \`wait: 5m\`, se lasci passare del tempo (la pasta che cuoce, i compiti).

Ogni risposta ti dice l'ora, cosa è successo, gli avvisi, le interruzioni, e ti dà lo schermo in due forme: \`immagine\`, **da guardare sempre con lo strumento Read** (è quello che vedresti tu), e \`schermo\`, l'elenco degli elementi con i loro nomi, che serve solo a scrivere la mossa con le parole giuste. Se una mossa non trova niente, non succede niente: come quando tocchi nel posto sbagliato.

## Regole

- Resta nel personaggio. Leggi solo quello che lei leggerebbe; guarda l'immagine prima di decidere.
- **Non leggere nessun file del progetto** (codice, documenti, specifiche): non sai come è fatta l'app. Usa solo il comando qui sopra e il Read sulle immagini che ti restituisce.
- Al massimo ${phase.budget || 30} mosse. Ti fermi prima se hai ottenuto quello che volevi, o se lei a quel punto lascerebbe perdere.
- Le interruzioni arrivano da sole: quando succedono, ricordale come le ricorderebbe lei (magari hai perso il filo).

## Il diario

Tieni un diario in \`${rel(path.join(dir, 'diary.yaml'))}\`: dopo ogni mossa aggiungi una voce, in italiano, con la voce di ${persona.name}:

\`\`\`yaml
mosse:
  - mossa: 1
    vedo: cosa noti sullo schermo, in poche parole
    penso: cosa ti passa per la testa
    faccio: la mossa che scegli, e perché
    inciampo: solo se ti sei confusa o hai sbagliato, il motivo in una riga
\`\`\`

Alla fine aggiungi:

\`\`\`yaml
esito:
  riuscita: sì | in parte | no
  cosa_ho_fatto: ...
  dove_mi_sono_persa: ...
  agganciata: sì | forse | no
  perché: ...
  cosa_mi_farebbe_pagare: ...
\`\`\`

Quando hai finito, rispondi con tre righe: com'è andata, il momento peggiore, se torneresti a usarla.
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
      const m = /^(\s*(?:- )?)(vedo|penso|faccio|inciampo): (.+)$/.exec(line);
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
    const stumbles = (diary.mosse || []).filter(m => m.inciampo && !interrupted.has(m.mossa)).map(m => ({
      id: `L:${s}:${p}:${m.mossa}`, severity: /lascio|mollato|mi arrendo|rinuncio|abbandono|non capisco/i.test(m.inciampo) ? 'A' : 'P', kind: 'llm',
      personas: scen.persona ? [scen.persona] : [], title: `${s}, ${p}, mossa ${m.mossa}: ${m.inciampo}`, evidence: [m.vedo, m.penso].filter(Boolean) }));
    const r = { scenario: s, phase: p, persona: scen.persona, moves: acts.length, misses: attempts.length, esito: diary.esito || null, stumbles };
    fs.writeFileSync(path.join(d, 'report.yaml'), toYaml(r));
    reports.push(r);
    const e = diary.esito || {};
    console.log(`${s} / ${p}: ${acts.length} mosse, ${attempts.length} tocchi a vuoto · riuscita ${e.riuscita ?? '—'} · agganciata ${e.agganciata ?? '—'}`);
    for (const f of stumbles) console.log(`  ${f.severity} ${f.title}`);
  }
  if (!reports.length) console.log('Nessun diario trovato.');
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
