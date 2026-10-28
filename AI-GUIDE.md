# betasim: a guide for the AI working on a site or an app

You assist whoever builds the project. betasim lets you see and try the pages as a person would. Here is what to do on your own, and what to propose and when. The file formats are in betasim's README (`node_modules/betasim/README.md`).

## Every day, without asking

- After every visible change: `npx betasim look <page>`. Look at the screenshots in `look/` (375 and 1280, light and dark) and read the console and accessibility output. Fix before saying it is done. Judge from the images, not from the code.
- Before saying a piece of work is finished: `npx betasim flows`. A broken flow is fixed in the page; in the flow only if the path changed on purpose.
- When an important path appears (a menu, a form, a purchase, a booking), write its flow in `test/flows/`: the steps of someone who knows where to go, with the words that are on the page.
- To see an intermediate state: `npx betasim look <page> --click "<selector>" --wait 500`. For the tree a screen reader reads: `--aria`.

## To propose, at the right time

Propose in one sentence, with what it costs and what it gives, and wait for a yes.

1. **The simulated testers** (free, half a minute). Propose them when the site has two or three paths that matter, and after every change to how those look. They measure whether people find the controls: hidden, off screen, small, with hard words, with no name for people who cannot see.
   - Ask who the site is for: the audiences, how much each counts, and for each who they are (age, practice with phones, hurry, trouble seeing or using their hands). Write the audiences in `targets` of `test/betasim.yaml`, with the weight and the goal agreed with whoever builds the project.
   - For each audience write one or two personas in `test/personas/`: a name, an age, a one-line summary, the audience as a tag, and the betasim profile closest to them (`profile: senior`; the profiles are in `node_modules/betasim/profiles/`), changing only the numbers that differ. Then set `personas: [builtin, personas]` in `test/betasim.yaml`, or `[personas]` once the floor below names the project's own personas.
   - Keep the `everyone` floor that `init` wrote (the elderly, low vision, screen reader): remove it only if whoever builds the project decides so.
   - For each important path write a task in `test/tasks/`: the goal in the users' words, the flow, how often it happens, whether it is critical.
   - Run `npx betasim usability` and read `test/report/latest/summary.md` first. Propose the fixes by severity; the report already simulates some of them with the expected gain.
2. **The LLM testers** (they cost: about half an hour and a few hundred thousand tokens per persona). Propose them only at the big moments: before publishing, after a redesign, when the numbers are green but something does not convince. A model plays a persona and uses the site one move at a time, without having seen the code: it finds the misunderstandings the numbers cannot see.
   - It needs a written profile of the persona and a scenario with phases ("LLM testers" in the README).
   - `npx betasim agent-brief --scenario <file> --phase <id> --fresh`, then one move at a time with `npx betasim play --session <folder> --do "tap: ..."`, the diary, and finally `npx betasim agent-report`. The tester is a subagent of yours, or you in a separate session: betasim calls no model.
3. **The A/B comparison** (free). Propose it when there are two ideas for the same page: the variants in `betasim.yaml`, then `npx betasim --ab A,B`.

## What to say, always

- The simulated testers' numbers are for comparing (before and after, one page and another), not for promising. Green means "no obstacle on the right path", not "people will make it".
- Before publishing, still recommend a test with four or five real people: betasim gets you there without the obvious mistakes.
