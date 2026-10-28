import { launchBrowser } from './driver/web.mjs';
import { serveStatic } from './server.mjs';
import { loadDir } from './util.mjs';
import { loadPersonas } from './personas.mjs';
import { runEngineCase } from './suites/engine.mjs';
import { runFlow } from './suites/flows.mjs';
import { runUsability } from './suites/usability.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { buildFindings } from './findings.mjs';
import { prepareReport, writeReport } from './report.mjs';
import { scoreSegments, tagFindings, floorFindings } from './segments.mjs';
import { renderDashboard, readHistory, trendPoint } from './dashboard.mjs';
import { coverage, coverageFindings } from './coverage.mjs';
import { evaluateRemedies } from './whatif.mjs';
import { readAgentReports } from './agents.mjs';

export async function openTarget(cfg, args = {}) {
  let server = null, baseUrl = cfg.target.url;
  if (cfg.target.serve) { server = await serveStatic(cfg.target.serve); baseUrl = server.url; }
  if (!baseUrl) throw new Error('target.serve or target.url is needed in betasim.yaml');
  const browser = await launchBrowser(cfg, { headed: args.headed });
  return { browser, baseUrl, close: async () => { await browser.close(); if (server) await server.close(); } };
}

export async function runAll(cfg, suites, args) {
  const began = Date.now();
  const only = args.only ? String(args.only).toLowerCase() : null;
  const pick = xs => (only ? xs.filter(x => x.id.toLowerCase().includes(only)) : xs);
  const runs = +(args.runs || cfg.runs), seed = +(args.seed || cfg.seed);
  cfg.runs = runs;
  const engineCases = pick(loadDir(cfg.dirs.engine));
  const flows = loadDir(cfg.dirs.flows);
  const tasks = pick(loadDir(cfg.dirs.tasks));
  const personas = loadPersonas(cfg);
  const flowById = Object.fromEntries(flows.map(f => [f.id, f]));
  const quiet = !!args.quiet;
  const say = line => { if (!quiet) console.log(line); };

  const partial = !!only || !['engine', 'flows', 'usability'].every(s => suites.includes(s));
  const rep = prepareReport(cfg, { partial });
  const target = await openTarget(cfg, args);
  const ctx = { browser: target.browser, cfg, baseUrl: target.baseUrl, screensDir: rep.screensDir, variant: cfg.variants[0] || null };   // a plain run is a run of the first variant
  const results = { meta: { date: new Date().toLocaleString('en-GB'), runs, seed, personas: personas.length, suites, partial: !!only }, engine: [], flows: [], usability: {} };
  const flowResults = {};
  try {
    if (suites.includes('engine')) {
      for (const c of engineCases) {
        const r = await runEngineCase(ctx, c);
        results.engine.push(r);
        say(`${r.ok ? '✓' : '✗'} engine ${r.id}${r.ok ? '' : '  ' + (r.error || r.diffs.slice(0, 2).join('; '))}`);
      }
    }
    if (suites.includes('flows')) {
      for (const f of pick(flows)) {
        const r = await runFlow(ctx, f);
        flowResults[f.id] = r; results.flows.push(r);
        say(`${r.ok ? '✓' : '✗'} flow ${r.id} (${r.taps} taps${r.inputs ? `, ${r.inputs} inputs` : ''}, ${r.ms} ms)${r.ok ? '' : '  ' + r.error}`);
      }
    }
    if (suites.includes('usability')) {
      results.usability = await runUsability(ctx, tasks, personas, flowById, flowResults, { runs, seed });
      if (!suites.includes('flows')) results.flows = Object.values(flowResults);
      say(`· usability: ${Object.keys(results.usability).length} tasks × ${personas.length} personas × ${runs} runs`);
    }
  } finally {
    await target.close();
  }
  results.meta.seconds = (Date.now() - began) / 1000;
  results.segments = scoreSegments(results.usability, tasks, cfg.segments);
  let findings = buildFindings(results, { personas, tasks, cfg });
  findings.push(...floorFindings(results.segments, personas));   // the promises first
  results.agents = readAgentReports(cfg);   // the LLM testers' diaries, from their last session
  for (const a of results.agents) for (const f of a.stumbles || []) findings.push(f);
  // the plain functional check: every feature of features.yaml clicked through by at least one flow
  if (cfg.features.length && suites.includes('flows') && !only) {
    results.coverage = coverage(cfg.features, flows, loadDir(cfg.dirs.engine), results);
    findings.push(...coverageFindings(results.coverage));
  }
  // remedies: what each proposal would do to the targets, alone and together with the others on its screen
  if (suites.includes('usability') && Object.keys(results.usability).length) {
    const wi = evaluateRemedies({ findings, usability: results.usability, flowResults, tasks, personas, cfg, runs, seed });
    results.remedies = wi.remedies; results.remedyPairs = wi.pairs;
    const byFinding = {};
    for (const r of wi.remedies) for (const fid of r.findings) byFinding[fid] = r;
    for (const f of findings) {
      const r = byFinding[f.id]; if (!r) continue;
      const clash = wi.pairs.filter(p => p.kind === 'collide' && (p.a === r.id || p.b === r.id));
      f.remedy = {
        id: r.id, preferred: r.label, gain: +r.gain.toFixed(4), harmful: r.harmful || undefined,
        options: r.options.map(o => `${o.label}: ${(o.gain * 100).toFixed(1)} pt${o.sideEffects.length ? ` (worsens ${o.sideEffects.join(', ')})` : ''}`),
        collides: clash.length ? clash.map(p => `${p.a === r.id ? p.b : p.a}: preferred ${p.preferred}`) : undefined,
      };
    }
  }
  findings = tagFindings(findings, cfg.segments);
  if (partial && rep.prev) {   // a partial run is compared only with what it ran
    const has = id => !only || String(id).toLowerCase().includes(only);
    rep.prev = rep.prev.filter(f => (f.kind === 'engine' && suites.includes('engine') && has(f.id))
      || (f.kind === 'flow' && suites.includes('flows') && has(f.id))
      || (f.kind === 'usability' && suites.includes('usability') && has(f.task || f.id)));
  }
  const { summary } = writeReport(cfg, results, findings, rep);
  // the dashboard: the same results for a person, with the trend of the runs kept in history
  const history = partial ? [] : readHistory(cfg.reportDir, tasks, cfg.segments);
  const current = trendPoint('latest', results, findings, tasks, cfg.segments);
  fs.writeFileSync(path.join(rep.dir, 'index.html'), renderDashboard({ cfg, results, findings, tasks, personas, segments: cfg.segments, history, current }));
  console.log('\n' + summary);
  console.log(`Report: ${rep.dir} · dashboard: ${path.join(rep.dir, 'index.html')}`);
  return results.engine.some(r => !r.ok) || results.flows.some(r => !r.ok) ? 1 : 0;
}
