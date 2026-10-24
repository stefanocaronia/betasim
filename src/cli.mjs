import { loadConfig } from './config.mjs';
import { runAll } from './run.mjs';
import { runAB } from './ab.mjs';
import { brief } from './brief.mjs';
import { play } from './play.mjs';
import { agentBrief, agentReport } from './agents.mjs';
import { loadDir } from './util.mjs';
import { look } from './look.mjs';
import { init } from './init.mjs';

const HELP = `betasim (o bs): test del motore, flussi YAML e beta tester simulati.

  betasim init [url | cartella]               prepara un sito: test/betasim.yaml e un primo flusso, senza codice da scrivere
  betasim look <url | cartella | file.html>   guarda la pagina: screenshot, console e accessibilità (axe), a 375 e 1280, chiaro e scuro
           [--width 375,1280] [--theme light,dark] [--click <selettore>] [--press <tasto>] [--wait <ms>] [--full] [--aria] [--still] [--out look]
  betasim [engine] [flows] [usability] [all]   lancia le suite (default: all)
  betasim --ab A,B [flows] [usability]         A/B: gli stessi flussi e le stesse persone su due varianti dell'app, e le differenze (report/ab)
  betasim list                                 elenca casi, flussi, compiti, persone e varianti
  betasim brief --task <id> --persona <id>     il primo schermo e la persona, per un agente LLM
  betasim agent-brief --scenario <file> --phase <id> [--fresh] [--variant B]   il brief completo per un tester LLM
  betasim play --session <cartella> [--do "tap: Quick timer"]    una mossa del tester LLM, e lo schermo che ne esce
  betasim agent-report [--scenario <file>]      il diario del tester LLM diventa un report

Opzioni:
  --config <file>   betasim.yaml del progetto (default: ./betasim.yaml, ./test/betasim.yaml)
  --only <testo>    solo i casi, flussi e compiti il cui id contiene il testo
  --runs <n>        prove simulate per ogni coppia persona-compito
  --seed <n>        seme del caso: stesso seme, stessi risultati
  --ab <A,B>        confronta due varianti di betasim.yaml (senza valore: le prime due)
  --variant <id>    brief e agent-brief: la variante dell'app che vede il tester
  --headed          mostra il browser
  --quiet           stampa solo il riepilogo corto
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { args.help = true; continue; }
    if (['--click', '--press', '--wait'].includes(a)) { (args.steps ??= []).push([a.slice(2), argv[++i]]); continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2), next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true; else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(HELP); return 0; }
  if (args._[0] === 'look') return look(args);
  if (args._[0] === 'init') return init(args);
  const cfg = await loadConfig(args.config);
  const cmd = args._[0];
  if (cmd === 'brief') return brief(cfg, args);
  if (cmd === 'play') return play(cfg, args);
  if (cmd === 'agent-brief') return agentBrief(cfg, args);
  if (cmd === 'agent-report') return agentReport(cfg, args);
  if (cmd === 'list') {
    const show = (title, items) => console.log(`${title} (${items.length}): ${items.map(x => x.id).join(', ')}`);
    show('engine', loadDir(cfg.dirs.engine)); show('flows', loadDir(cfg.dirs.flows)); show('tasks', loadDir(cfg.dirs.tasks));
    show('personas', cfg.personaDirs.flatMap(loadDir));
    show('variants', cfg.variants);
    return 0;
  }
  const wanted = args._.filter(x => x !== 'run');
  const suites = !wanted.length || wanted.includes('all') ? ['engine', 'flows', 'usability'] : wanted;
  if (args.ab) return runAB(cfg, suites.filter(s => s !== 'engine'), args);   // the engine does not change with the interface
  return runAll(cfg, suites, args);
}
