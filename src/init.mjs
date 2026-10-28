import fs from 'node:fs';
import path from 'node:path';

// Who uses the site: betasim's generic profiles until the project writes its own personas, and from the start a floor nobody may fall below.
const PEOPLE = `personas: [builtin]   # betasim's generic profiles; your own personas go in test/personas/ (README: Personas and profiles)
targets:
  - id: everyone
    name: Everyone can use it
    floor: 0.8           # nobody below 80% on any task meant for them; remove it only on purpose
    personas: [senior, low-vision, screen-reader]
`;

/**
 * Readies betasim in a website with no code to write: test/betasim.yaml aimed at the site (a URL, as a dev server's, or a folder served on the spot),
 * a first flow that opens it, and the reports kept out of git. What is there already stays.
 */
export function init(args) {
  const where = args.url ?? args._[1] ?? 'http://localhost:5173/';
  const dir = path.resolve('test');
  const isFolder = fs.existsSync(where) && fs.statSync(where).isDirectory();
  const target = isFolder ? `  serve: ${path.relative(dir, path.resolve(where)).replaceAll('\\', '/') || '.'}   # the folder of the site, served on the spot` : `  url: ${where}   # the site as its dev server serves it`;
  const files = {
    'betasim.yaml': `name: ${path.basename(process.cwd())}\ntarget:\n${target}\n  viewport: {width: 375, height: 812}\n  channel: chrome\nui_language: native\n${PEOPLE}`,
    'flows/home.yaml': 'name: The home page opens\nsteps:\n  - screenshot: home\n# Add steps as a person would go: tapOn: Contacts, inputText: {into: {label: Email}, text: a@b.it}, assertVisible: Thank you\n',
  };
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) { console.log(`kept:    ${path.relative('.', file)}`); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`written: ${path.relative('.', file)}`);
  }
  // The project's AI learns from its own instructions what betasim does and what to propose.
  const rules = ['CLAUDE.md', 'AGENTS.md'].map(name => path.resolve(name)).find(file => fs.existsSync(file)) ?? path.resolve('CLAUDE.md');
  const told = fs.existsSync(rules) && fs.readFileSync(rules, 'utf8').includes('betasim');
  if (!told) {
    fs.appendFileSync(rules, `${fs.existsSync(rules) ? '\n' : ''}## Seeing and trying the pages\n\nWith betasim: read \`node_modules/betasim/AI-GUIDE.md\` and follow it. In short: after every visible change \`npx betasim look <page>\` and look at the screenshots; before saying it is done \`npx betasim flows\`; propose the simulated and the LLM testers at the right time, as the guide says.\n`);
    console.log(`told:    ${path.relative('.', rules)} (where to find betasim's guide)`);
  }
  const ignore = path.resolve('.gitignore');
  const lines = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8').split(/\r?\n/) : [];
  const missing = ['test/report/', 'look/'].filter(line => !lines.includes(line));
  if (missing.length) fs.appendFileSync(ignore, `${lines.length && lines.at(-1) !== '' ? '\n' : ''}${missing.join('\n')}\n`);
  console.log('\nNext: npx betasim look <the page> to see it at 375 and 1280 in both themes; npx betasim flows to run the flows in test/flows.');
  return 0;
}
