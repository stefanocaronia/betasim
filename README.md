# betasim

Tests and simulated beta testers for web apps, written in YAML. betasim was made for TimerLines but knows nothing about it: each project brings its own files and a small adapter. MIT licence; projects install it from GitHub, with no npm package.

Three levels:

1. **Engine.** Golden cases: a situation, events in time, the expected numbers. The project runs them in its engine and betasim compares. The same YAML can feed the tests of another implementation.
2. **Flows.** Real taps on the real page, in [Maestro](https://maestro.mobile.dev)'s words (`tapOn`, `inputText`, `assertVisible`, `back`), with fake time and questions to the app's state. They pass or fail.
3. **Simulated testers.** Personas made of numbers try each task many times along its flow. betasim measures the path on the page (target sizes, words to read, hidden or off-screen controls, names for a screen reader) and reports success, times, and where people stop and why.

Everything ends in a short report, written for a person or an LLM that fixes the app and runs again; each run says what is new and what is solved.

**The limit.** The simulated testers find structural problems: long paths, hidden controls, small targets, jargon, controls a screen reader cannot name. They do not find unexpected misunderstandings. The model's constants are plausible, not measured: the numbers compare runs, tasks and personas, they do not predict. A test with five real people is still needed; betasim gets you there without the obvious problems.

## Install

```
npm install --save-dev github:stefanocaronia/betasim
```

It uses the installed Chrome (`channel: chrome`); without it, `channel: bundled` and once `npx playwright install chromium`. Write `npx betasim` in instructions: `bs` is an alias, but `npx bs` without betasim installed fetches another package.

## A website, with no code

```
npx betasim init http://localhost:5173/     # or the site's folder: npx betasim init dist
npx betasim look http://localhost:5173/     # screenshots at 375 and 1280, light and dark, in look/
npx betasim flows                           # the flows in test/flows/*.yaml
```

`init` writes `test/betasim.yaml` and a first flow, keeps the reports out of git, and points the project's `CLAUDE.md` or `AGENTS.md` to [GUIDA-AI.md](GUIDA-AI.md), the guide for the AI working on the site. `look` takes, at each width and theme, a screenshot, the console errors, the files that failed to load and the accessibility problems [axe](https://github.com/dequelabs/axe-core) finds; `--aria` adds the page as a screen reader reads it, and `--click <selector>`, `--press <key>` and `--wait <ms>` act before the shot, in order. It exits with 1 when it finds something to look at.

## Commands

| Command | What it does |
|---|---|
| `betasim` or `betasim all` | the three suites |
| `betasim engine flows` | only the suites named |
| `betasim list` | cases, flows, tasks, personas, variants |
| `betasim --ab A,B` | the same flows and personas on two variants of the app, and the differences |
| `betasim brief --task <id> --persona <id>` | the persona, the goal and the first screen, for an LLM agent |
| `betasim agent-brief`, `play`, `agent-report` | the LLM testers (below) |

Options: `--config <file>` (default `betasim.yaml` or `test/betasim.yaml`), `--only <text>` (only ids containing it), `--runs <n>`, `--seed <n>` (same seed, same results), `--headed`, `--quiet`. The exit code is 1 when a case or a flow fails.

## A project's files

```
test/
  betasim.yaml     the target and the rules
  adapter.mjs      how betasim talks to the app
  engine/*.yaml    engine cases
  flows/*.yaml     flows
  tasks/*.yaml     tasks for the simulated testers
  personas/*.yaml  extra personas (optional)
  report/          results (not versioned)
```

### betasim.yaml

```yaml
name: TimerLines
target:
  serve: ../design/02-wireframe       # a folder to serve; or url: http://...
  entry: index.html
  viewport: {width: 375, height: 812}
  timezone: Europe/Rome
  startTime: "2026-10-05T18:00:00"    # the fake clock starts here and moves only when a flow says so
  channel: chrome
  layers: ["#overlay .overlay"]       # an open sheet covers the page: only its controls can be tapped
  ignore: "#panel"                    # parts of the page that are not the app
  root: "#screen"                     # where the app is, for the briefs
  disclosure: "[aria-expanded=false]" # expanders ("More options")
adapter: adapter.mjs
ui_language: native                   # native: the app will be translated; en: people use it in English
personas: [builtin]                   # the built-in personas, plus any project folders
targets: targets.yaml                 # the audiences, below
features: features.yaml               # the features, for coverage
runs: 300
seed: 7
terms: {Ready by: 3, More options: 2} # how much a word is jargon, 0 to 3
familiar_icons: [Play, Pause]         # icon-only controls everybody knows cost a third
```

### adapter.mjs

An object of optional functions, each taking the Playwright page first: `ready(page)` waits for the app; `setup(page, setup)` prepares a flow's state; `back(page)` is the back button; `query(page, name, arg)` answers `assertState`; `variant(page, setup)` applies an A/B variant; `engine(page, case, tools)` runs an engine case and returns its numbers (`tools.advance(ms)` moves the fake clock, `tools.parseDur("4m25s")` converts).

### A flow

```yaml
name: Dinner, from start to the table
setup: {start: [dinner]}          # optional, read by the adapter
steps:
  - tapOn: Timers                 # visible text or accessible name: equal first, then "starts with", then "contains"
  - tapOn: {label: Start}         # aria-label only
  - tapOn: {text: Start, within: Antibiotic, index: 0}
  - tapOn: {css: ".ring", at: [0.5, 0.04]}   # where to touch, as fractions of the element
  - tapOn: Play
    concept: {name: waits for play, difficulty: 2}   # an idea a person must grasp for this step
  - inputText: {into: {id: e-title}, text: Kettle}
  - keypad: {into: {label: Duration}, keys: "7 00"}  # a keypad field: opens it (aria-expanded), presses the keys it controls (aria-controls)
  - pressKey: Enter               # a physical keyboard
  - advance: 11m                  # fake time: a jump, like a phone waking up
  - assertVisible: {label: "Timer 1 of 5"}
  - assertNotVisible: Notifications are off
  - assertState: {query: status, arg: Dinner, equals: done}   # also contains, notContains, min, max, length
  - go: "#/line/dinner"
  - back
  - screenshot: after-play
  - swipe: {direction: LEFT, from: {css: ".ring"}}
  - drag: {from: Timer three, to: Timer one, where: above}   # long press, then above or below another element
covers: [focus-swipe]             # the features of features.yaml the flow goes through
expect: {maxTaps: 5}              # over budget, a warning
```

Each flow starts from scratch, in a new browser context. `optional: true` skips a step whose target is missing. Targets, labels and text are found inside open shadow roots too (a widget's or a plugin's body), in document order; `css` matches within each tree, not across its edge.

### An engine case

```yaml
name: Pasta played 2 minutes late
line: dinner
events:
  - {at: 13m, do: gate, step: pasta}
at: 13m
expect:
  steps:
    pasta: {start: 13m, end: 22m}
```

Durations are written `250ms`, `45s`, `4m25s`, `1h30m`, `2d` or `11:00`, compared within a second (`tolerance:` changes it); plain numbers and text must be equal.

### A task

```yaml
goal: "Start a 4-minute timer for the eggs."
flow: eggs-4-minutes     # the path of someone who knows where to go
audience: all            # or a list of persona ids or tags
frequency: 5             # how often it happens, 1 to 5
critical: true           # a persona stopping here is a blocker
expected_seconds: 8
```

### A persona

```yaml
name: Pina
age: 78
summary: Retired; uses WhatsApp and photos, her grandson sets up the rest.
tags: [cooking, home]
tech: 1              # practice with apps, 1 to 5
english: 0           # 0 to 5, only with ui_language: en
vision: presbyopia   # none, presbyopia, low, blind (screen reader)
motor: unsteady      # fine, normal, busy (hands full or wet), unsteady
explore: 1           # how much they open menus and expanders, 1 to 5
reading: 4           # how much they read
patience: 2          # attempts before giving up
hurry: 1
```

Eighteen built-in personas are in `personas/`, from a home cook to a blind user with a screen reader.

### Targets and coverage

The audiences the product is for, from the project's business plan, live in the project:

```yaml
- id: cooking
  name: People who cook
  weight: 3                              # how much it counts, 1 to 3
  personas: [cuoca-di-casa, chef, nonna]
  goal: {success: 0.95, critical: 0.9}   # weighted success to reach, and the minimum on critical tasks
```

A target's score is its members' success on their tasks, weighted by how often the tasks happen. Each finding names the targets it touches.

`features.yaml` lists the app's features; flows and cases declare theirs with `covers: [id, ...]`. The report says which features no flow goes through.

## The report

In `report/latest/`; the previous run moves to `report/history/` (twelve are kept).

- `summary.md`: one screen, read first. Counts, what is new and solved, the targets, the findings by severity, success per task and persona.
- `index.html`: the dashboard, one file, light and dark: targets and their trend, the task-persona map, the findings, the flows.
- `findings.yaml`: each finding with a stable id, a severity (B blocks, A hurts, P is a detail), the evidence, the personas and targets hit, a proposal and, for usability, the simulated remedies. Ids: `E:` engine case, `F:` broken flow, `W:` flow over budget, `U:task:step:reason` usability, `U:small:` small target, `C:` feature with no flow, `L:` LLM tester.
- `traces/<flow>.yaml`: the measured path, step by step. `results.json`: everything. `screens/`: screenshots of failures.

## Simulated remedies

Each usability finding has one or more alternative fixes: for an expander, bring the needed control into view, have the expander name what it hides, or open it for everyone; for an off-screen button, pin the button row or move it up. betasim applies each fix to every measured path that crosses the same screen, side effects included (an open expander crowds the screen for everyone), lets all personas retry all tasks, and measures the change in the targets' weighted success and in time. The preferred fix is the one that helps the targets most; preferred fixes on the same screen are also tried together, to see whether they clash or help each other. The numbers choose between alternatives; they promise nothing.

## A/B

Put both variants in the app behind a setting and declare them; the first is the app as it is:

```yaml
variants:
  A: {name: Four tabs}
  B: {name: Five tabs, setup: {settings: {fiveTabs: true}}}
```

Where variants differ, a step or an argument is written per variant, and an unnamed variant skips it: `tapOn: {A: Timers, B: Sequences}`, or `A: {tapOn: Sequence}`. Step numbers stay those of the file, so a finding keeps its id across variants. `betasim --ab A,B` runs flows and usability on both and writes the comparison to `report/ab/`. Success is computed exactly, so a difference comes from the paths, not from chance; under one point two variants are even. What the model cannot see, such as which tab to look in, goes on the step as a `concept`.

## LLM testers

A model plays a persona and uses the real app one move at a time, looking at the screen, without having seen the code: it looks where it expects things, makes mistakes, gets interrupted.

- The persona needs a written profile besides its numbers (`identity`, `capabilities`, `knowhow`, `approach`, `voice`); the scenario (in the project) has phases, each with a time, a context, a goal in the persona's words, a move limit and interruptions.
- `betasim agent-brief --scenario <file> --phase <id> --fresh` prepares the session folder and prints the brief.
- `betasim play --session <folder> --do "tap: Quick timer"` is the phone: it replays all moves with the fake clock, applies the new one, and returns the time, the outcome, the notices, the screenshot and the accessibility tree.
- The model keeps a diary; `betasim agent-report` turns diaries into findings (`L:`).

betasim calls no model: it prepares the brief and reads the diary. One persona over two phases cost about 25 minutes and 260 thousand tokens: use it on the tasks that matter.

## The model

For each step, the chance of finding and choosing the right control first time is a product of factors: under an expander, off screen, icon only, jargon, a new idea, many choices, name and role for a screen reader, small text, a date field. The chance of a wrong tap comes from the target's size (the control, or a larger absolute `::before`/`::after` layer around it) against the persona's hands; time comes from a keystroke-level model. Who fails retries with a little more experience while patience lasts, then stops. Success and stopping points are computed exactly from these probabilities; the simulated runs give times and wrong taps. All of it is in `src/usability/model.mjs`.

## Iterating with an LLM

1. Run betasim and read `summary.md`.
2. For a finding, read its entry in `findings.yaml` and, if needed, the flow's trace.
3. Fix the app, or the flow if the interface changed on purpose; never weaken a case without knowing which side is wrong.
4. Run again: the summary says whether the finding is solved and whether a new one appeared.

## Development notes

Developed with the help of AI coding agents. Everything is designed, reviewed and tested by the project's human maintainer. `npm test` runs betasim's own tests (`test/`, with the installed Chrome).

**We encourage everyone to use AI for their own purposes.**  
The means of production should belong to the people.  
Fight corporate control of technology, not our right to use it.
