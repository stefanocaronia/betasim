# betasim: guida per l'AI che lavora a un sito o a un'app

Sei l'assistente di chi costruisce il progetto. betasim ti fa vedere e provare le pagine come una persona. Qui c'è cosa fare da sola, cosa proporre e quando. I formati dei file sono nel README di betasim (`node_modules/betasim/README.md`).

## Ogni giorno, senza chiedere

- Dopo ogni modifica visibile: `npx betasim look <pagina>`. Guarda gli screenshot in `look/` (375 e 1280, chiaro e scuro) e leggi console e accessibilità. Correggi prima di dire che è fatto. Giudica dalle immagini, non dal codice.
- Prima di dire che un lavoro è finito: `npx betasim flows`. Un flusso rotto si ripara nella pagina; nel flusso solo se il percorso è cambiato apposta.
- Quando nasce un percorso importante (un menu, un modulo, un acquisto, una prenotazione), scrivine il flusso in `test/flows/`: i passi di chi sa dove andare, con le parole che si leggono sulla pagina.
- Per vedere un passaggio: `npx betasim look <pagina> --click "<selettore>" --wait 500`. Per l'albero che legge uno screen reader: `--aria`.

## Da proporre, al momento giusto

Proponi in una frase, con cosa costa e cosa dà, e aspetta il sì.

1. **I tester simulati** (gratis, mezzo minuto). Proponili quando il sito ha due o tre percorsi che contano, e dopo ogni cambio del loro aspetto. Misurano se la gente trova i comandi: nascosti, fuori schermo, piccoli, con parole difficili, senza nome per chi non vede.
   - Chiedi per chi è il sito: età, pratica con il telefono, fretta, chi ha problemi di vista. Poi scegli tra le persone di base (`npx betasim list`) quelle che somigliano; per chi manca, scrivi una persona nuova in `test/personas/`, con i numeri del README.
   - Scrivi i pubblici in `targets` di `test/betasim.yaml`, con il peso e l'obiettivo detti con chi costruisce il progetto.
   - Per ogni percorso importante scrivi un compito in `test/tasks/`: l'obiettivo con le parole di chi usa il sito, il flusso, quanto spesso capita, se è critico.
   - Lancia `npx betasim usability` e leggi per primo `test/report/latest/summary.md`. Proponi le correzioni in ordine di gravità; il report ne simula già alcune con il guadagno previsto.
2. **I tester LLM** (costano: circa mezz'ora e qualche centinaio di migliaia di token per una persona). Proponili solo nei momenti grandi: prima di pubblicare, dopo un rifacimento, quando i numeri sono verdi ma qualcosa non convince. Un modello interpreta una persona e usa il sito una mossa alla volta, senza aver visto il codice: trova i fraintendimenti che i numeri non vedono.
   - Serve una scheda in parole della persona e uno scenario con le fasi (vedi «I tester LLM» nel README).
   - `npx betasim agent-brief --scenario <file> --phase <id> --fresh`, poi una mossa alla volta con `npx betasim play --session <cartella> --do "tap: ..."`, il diario, e infine `npx betasim agent-report`. Il tester è un tuo subagente, o tu stessa in una sessione a parte: betasim non chiama nessun modello.
3. **Il confronto A/B** (gratis). Proponilo quando ci sono due idee per la stessa pagina: le varianti in `betasim.yaml`, poi `npx betasim --ab A,B`.

## Cosa dire, sempre

- I numeri dei tester simulati servono a confrontare (prima e dopo, una pagina e l'altra), non a promettere. Verde vuol dire «nessun ostacolo sulla strada giusta», non «la gente ci riuscirà».
- Prima di pubblicare resta da consigliare la prova con quattro o cinque persone vere: betasim serve ad arrivarci senza gli errori ovvi.
