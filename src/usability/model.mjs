import { clamp } from '../util.mjs';

/*
 * The simulated tester. Every step of a measured path gets:
 *  - pFind: the chance of finding and choosing the right control at the first try, as a product of factors
 *    (hidden under an expander, off screen, icon without words, a hard word, a new concept, many choices, TalkBack, small text);
 *  - pMis: the chance of a wrong tap on the target (size against the person's hands, after Fitts);
 *  - t: seconds for the step (think, read the new screen, point, type), after the keystroke-level model.
 * The constants are plausible, not measured: the numbers are for comparing tasks, people and runs, not for predicting.
 */

export const REASONS = {
  hidden: { label: 'sta sotto un espansore', suggestion: 'portarlo in vista quando serve, o far dire all’espansore cosa c’è sotto' },
  offscreen: { label: 'bisogna scorrere per trovarlo', suggestion: 'avvicinarlo, o accorciare ciò che sta sopra' },
  icon: { label: 'è solo un’icona, senza parola', suggestion: 'aggiungere una parola, o un’icona più conosciuta' },
  words: { label: 'la parola è difficile per chi sa poco inglese', suggestion: 'una parola più semplice; nell’app tradotta, controllare la traduzione' },
  concept: { label: 'serve capire un’idea nuova', suggestion: 'spiegarla nel punto in cui serve, o farne a meno' },
  choices: { label: 'ci sono troppe scelte sullo schermo', suggestion: 'ridurre o raggruppare le scelte' },
  a11y: { label: 'TalkBack non lo trova o non lo annuncia come comando', suggestion: 'dare nome e ruolo all’elemento' },
  a11yWeak: { label: 'TalkBack lo annuncia solo con il testo d’esempio: manca l’etichetta', suggestion: 'collegare l’etichetta al campo' },
  ambiguous: { label: 'altri comandi sullo schermo hanno lo stesso nome', suggestion: 'nomi diversi per comandi diversi, o un nome che dica a cosa si riferisce' },
  smallText: { label: 'il testo è piccolo per chi è presbite', suggestion: 'testo più grande nel punto critico' },
  input: { label: 'c’è un campo data o ora da compilare', suggestion: 'valori pronti, o un selettore più semplice' },
  small: { label: 'il bersaglio è piccolo e porta a tocchi sbagliati', suggestion: 'un bersaglio di almeno 48 dp' },
  time: { label: 'ci vuole troppo rispetto all’atteso', suggestion: 'meno passaggi, o una strada corta per il caso comune' },
};

function termOf(step, cfg) {
  const name = String(step.name || '').toLowerCase();
  let d = 0, term = null;
  for (const [t, v] of Object.entries(cfg.terms || {})) if (name.includes(t.toLowerCase()) && v > d) { d = v; term = t; }
  return { d, term };
}

export function stepModel(step, p, cfg) {
  const tech = p.tech ?? 3, eng = p.english ?? 3, explore = p.explore ?? 3, read = p.reading ?? 3, age = p.age ?? 35;
  const blind = p.vision === 'blind', low = p.vision === 'low', presbyopia = p.vision === 'presbyopia';
  const choices = step.screen?.choices ?? 8;
  const f = {};
  f.choices = blind ? 1 - clamp((choices - 5) * 0.012, 0, 0.3) : 1 - clamp((choices - 8) * 0.01 * (1.3 - tech * 0.2), 0, 0.2);
  if (step.disclosure) f.hidden = step.disclosureHint ? 0.75 + 0.05 * explore : 0.5 + 0.09 * explore;   // an expander that says what it hides is found more often
  if (step.offscreen) f.offscreen = 0.6 + 0.06 * explore + 0.02 * (p.patience ?? 3);
  if (step.iconOnly && !blind) {
    const known = (cfg.familiarIcons || []).includes(String(step.name || '').trim().toLowerCase());   // play, pause, stop: every remote has them
    f.icon = known ? 1 - (0.38 - 0.075 * tech) / 3 : 0.62 + 0.075 * tech;
  }
  // which Play, which Done: the same name on several commands; heavier for who listens to them one by one
  const twins = blind ? (step.dupes || 0) : (step.dupesNear ?? step.dupes ?? 0);
  if (twins > 0) f.ambiguous = 1 - clamp(0.04 * twins * (1.2 - tech * 0.15) * (blind ? 1.5 : 1), 0, 0.3);
  const { d: termD, term } = termOf(step, cfg);
  const d = step.termOverride ?? termD;
  // jargon weighs less on people who use apps and read; an interface in a foreign language weighs more
  if (d > 0) { const gap = d + (cfg.uiLanguage === 'en' ? Math.max(0, 3 - eng) * 0.5 : 0) - (tech + read) / 3; if (gap > 0) f.words = 1 - clamp(0.12 * gap, 0, 0.45); }
  if (step.concept) { const cd = step.concept.difficulty ?? 2; f.concept = 1 - clamp(cd * 0.07 * (1.4 - (tech + read) / 10), 0, 0.4); }
  if (blind) {
    if (step.nameSource === 'placeholder' || step.nameSource === 'value') f.a11yWeak = 0.8;
    else if (!step.labelled) f.a11y = 0.15;
    else if (!step.actionable) f.a11y = 0.7;
  }
  if ((presbyopia || low) && step.fontPx && step.fontPx < 13) f.smallText = low ? 0.8 : 0.92;
  if (step.kind === 'input' && ['datetime-local', 'date', 'time'].includes(step.inputType)) f.input = 0.75 + 0.05 * tech;
  for (const k of Object.keys(f)) if (f[k] >= 0.999) delete f[k];
  const pFind = clamp(0.985 * Object.values(f).reduce((a, b) => a * b, 1), 0.02, 0.995);
  const worst = Object.entries(f).sort((a, b) => a[1] - b[1])[0];
  const reason = worst && worst[1] < 0.97 ? worst[0] : null;

  const W = Math.max(8, Math.min(step.w || 44, step.h || 44));
  const motorBase = { fine: 0.004, normal: 0.01, busy: 0.03, unsteady: 0.05 }[p.motor || 'normal'] ?? 0.01;
  const pMis = blind ? 0.01 : clamp(motorBase * clamp((40 / W) ** 2, 0.3, 6) + (low ? 0.02 : 0) + (age >= 70 ? 0.012 : 0), 0, 0.5);

  const think = 1.2 * (1 + (5 - tech) * 0.12) * (age >= 65 ? 1.35 : age <= 12 ? 1.1 : 1) * (1 - ((p.hurry ?? 3) - 3) * 0.05);
  const words = step.screenChanged ? (step.screen?.words ?? 0) : 0;
  const wps = 3.3 * (cfg.uiLanguage === 'en' ? 0.35 + 0.13 * eng : 1) * (age >= 70 ? 0.7 : 1) * (age <= 12 ? 0.6 : 1);
  const tRead = blind ? words * 0.5 / 2.5 : words * (0.08 + 0.07 * read) / wps;
  const slow = { fine: 0.9, normal: 1, busy: 1.2, unsteady: 1.6 }[p.motor || 'normal'] ?? 1;
  const tPoint = blind ? (choices / 2) * 0.9 : (0.2 + 0.12 * Math.log2(1 + 250 / W)) * slow * (age >= 70 ? 1.3 : 1);
  let tInput = 0;
  if (step.kind === 'input') { tInput = (step.chars || 0) * (0.25 + 0.08 * (5 - tech)); if (f.input) tInput += 5 * (1 + 0.25 * (5 - tech)); }
  return { f, pFind, reason, term, pMis, t: think + tRead + tPoint + tInput };
}

/**
 * One measured path. Success, and where and why people stop, are exact from the step probabilities: no sampling
 * noise, so two runs, two remedies or two variants of the app differ only where the path differs.
 * The Monte Carlo runs give the times and the wrong taps.
 */
export function simulate(steps, p, runs, rand, cfg) {
  const model = steps.map(s => stepModel(s, p, cfg));
  const attempts = 1 + Math.round((p.patience ?? 3) * 0.8);
  const exploreT = 4 + 2.5 * (5 - (p.explore ?? 3));
  const retry = m => m.pFind + (1 - m.pFind) * 0.35 * ((p.explore ?? 3) / 5);   // a second look finds it more often
  let wrongTotal = 0;
  const times = [];
  for (let n = 0; n < runs; n++) {
    let t = 0, wrong = 0, done = true;
    for (let i = 0; i < steps.length; i++) {
      const m = model[i];
      let found = false;
      for (let a = 0; a < attempts; a++) {
        const pf = a === 0 ? m.pFind : retry(m);
        t += a === 0 ? m.t : m.t * 0.6;
        if (rand() < pf) { found = true; break; }
        if (rand() < 0.5) wrong++;
        t += exploreT;
      }
      if (!found) { done = false; break; }
      if (rand() < m.pMis) { t += 2.5; if (rand() < 0.35) { wrong++; t += 5; } }
    }
    wrongTotal += wrong;
    if (done) times.push(t);
  }
  times.sort((a, b) => a - b);
  // stops and reasons in the same unit as before (people out of `runs`), so findings read them as shares
  let reach = 1;
  const stops = {}, reasons = {};
  model.forEach((m, i) => {
    const pass = 1 - (1 - m.pFind) * (1 - retry(m)) ** (attempts - 1);
    const stop = reach * (1 - pass) * runs;
    if (stop >= 0.005) { stops[i] = +stop.toFixed(2); if (m.reason) reasons[m.reason] = (reasons[m.reason] || 0) + stop; }
    reach *= pass;
  });
  for (const k of Object.keys(reasons)) reasons[k] = +reasons[k].toFixed(2);
  const q = f => (times.length ? +times[Math.min(times.length - 1, Math.floor(times.length * f))].toFixed(1) : null);
  return {
    success: reach, medianT: q(0.5), p90T: q(0.9), meanT: times.length ? +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2) : null,
    wrong: +(wrongTotal / runs).toFixed(2), stops, reasons,
    steps: model.map((m, i) => ({ i, pFind: +m.pFind.toFixed(3), pMis: +m.pMis.toFixed(3), reason: m.reason, term: m.term, t: +m.t.toFixed(1) })),
  };
}
