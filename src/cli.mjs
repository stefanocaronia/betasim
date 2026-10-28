import { loadConfig } from './config.mjs';
import { runAll } from './run.mjs';
import { runAB } from './ab.mjs';
import { brief } from './brief.mjs';
import { play } from './play.mjs';
import { agentBrief, agentReport } from './agents.mjs';
import { loadDir } from './util.mjs';
import { loadPersonas } from './personas.mjs';
import { look } from './look.mjs';
import { init } from './init.mjs';

const HELP = `betasim (or bs): engine tests, YAML flows and simulated beta testers.

  betasim init [url | folder]                 readies a site: test/betasim.yaml and a first flow, no code to write
  betasim look <url | folder | file.html>     looks at the page: screenshots, console and accessibility (axe), at 375 and 1280, light and dark
           [--width 375,1280] [--theme light,dark] [--click <selector>] [--press <key>] [--wait <ms>] [--full] [--aria] [--still] [--out look]
  betasim [engine] [flows] [usability] [all]   runs the suites (default: all)
  betasim --ab A,B [flows] [usability]         A/B: the same flows and personas on two variants of the app, and the differences (report/ab)
  betasim list                                 lists cases, flows, tasks, personas and variants
  betasim brief --task <id> --persona <id>     the first screen and the persona, for an LLM agent
  betasim agent-brief --scenario <file> --phase <id> [--fresh] [--variant B]   the full brief for an LLM tester
  betasim play --session <folder> [--do "tap: Quick timer"]    one move of the LLM tester, and the screen it leads to
  betasim agent-report [--scenario <file>]      the LLM tester's diary becomes a report

Options:
  --config <file>   the project's betasim.yaml (default: ./betasim.yaml, ./test/betasim.yaml)
  --only <text>     only the cases, flows and tasks whose id contains the text
  --runs <n>        simulated trials for each persona-task pair
  --seed <n>        random seed: same seed, same results
  --ab <A,B>        compares two variants of betasim.yaml (with no value: the first two)
  --variant <id>    brief and agent-brief: the variant of the app the tester sees
  --headed          shows the browser
  --quiet           prints only the short summary
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
    show('personas', loadPersonas(cfg));
    show('variants', cfg.variants);
    return 0;
  }
  const wanted = args._.filter(x => x !== 'run');
  const suites = !wanted.length || wanted.includes('all') ? ['engine', 'flows', 'usability'] : wanted;
  if (args.ab) return runAB(cfg, suites.filter(s => s !== 'engine'), args);   // the engine does not change with the interface
  return runAll(cfg, suites, args);
}
