# betasim

Test automatici e beta tester simulati per app, descritti in YAML. Nato per TimerLines, ma non sa niente di TimerLines: ogni progetto porta i suoi dati e un piccolo adattatore. Ha un repository suo, pubblico, con licenza MIT; i progetti lo installano da GitHub, senza un pacchetto npm pubblicato.

Tre livelli:

1. **Motore.** Casi "d'oro": una situazione, degli eventi nel tempo, i numeri attesi. Il progetto li fa girare nel suo motore e betasim confronta. Gli stessi file YAML si possono far leggere ai test di un'altra implementazione, per esempio i test Kotlin: la stessa cena deve dare gli stessi numeri.
2. **Flussi.** Percorsi a tocchi veri nella pagina, con le parole di [Maestro](https://maestro.mobile.dev) (`tapOn`, `inputText`, `assertVisible`, `back`), più `keypad` per i campi a tastierino, più il tempo finto (`advance: 12h`) e le domande allo stato dell'app (`assertState`). Passano o falliscono.
3. **Beta tester simulati.** Ogni persona è un profilo fatto di numeri; ogni compito ha un obiettivo e un percorso. betasim misura il percorso sulla pagina vera (grandezza dei bersagli, testo da leggere, comandi nascosti o fuori schermo, nomi per TalkBack) e fa provare a ogni persona il compito molte volte. Ne escono riuscita, tempi e i punti dove la gente si ferma, con il perché.

Tutto finisce in un report corto, pensato per essere letto da una persona o da un LLM che itera: si legge, si corregge, si rilancia, e il giro dopo dice cosa è nuovo e cosa è risolto.

## Il limite, detto chiaro

I tester simulati trovano i problemi **strutturali**: percorsi lunghi, comandi nascosti, bersagli piccoli, parole gergali, elementi muti per TalkBack. Non trovano i fraintendimenti imprevisti, perché un modello non si distrae e non ha idee sbagliate sue. Le costanti del modello sono plausibili, non misurate: i numeri servono a **confrontare** (compiti, persone, un giro con il precedente), non a predire. Il test con cinque persone vere resta; questo serve ad arrivarci senza i problemi ovvi, e ad accorgersi subito quando una modifica peggiora qualcosa.

## Installazione

Come dipendenza di sviluppo del progetto, dal repository:

```
npm install --save-dev github:stefanocaronia/betasim
```

Usa il Chrome installato (`channel: chrome`); senza Chrome, `channel: bundled` e una volta `npx playwright install chromium`.

## Uso

Dalla radice del progetto:

```
npx betasim --config test/betasim.yaml
```

| Comando | Cosa fa |
|---|---|
| `betasim` o `betasim all` | le tre suite |
| `betasim engine flows` | solo le suite nominate |
| `betasim list` | elenca casi, flussi, compiti, persone, varianti |
| `betasim --ab A,B` | A/B: gli stessi flussi e le stesse persone su due varianti dell'app, e le differenze (vedi sotto) |
| `betasim brief --task <id> --persona <id>` | il brief per un agente LLM: la persona, l'obiettivo, il primo schermo come albero di accessibilità |

Opzioni: `--only <testo>` (solo gli id che lo contengono), `--runs <n>`, `--seed <n>` (stesso seme, stessi risultati), `--headed` (il browser si vede), `--quiet` (solo il riepilogo), `--ab <A,B>` (il confronto tra due varianti), `--variant <id>` (per `brief` e `agent-brief`: la variante che vede il tester). Il codice di uscita è 1 se un caso o un flusso fallisce.

## I file di un progetto

```
test/
  betasim.yaml     il bersaglio e le regole
  adapter.mjs      come betasim parla con l'app
  engine/*.yaml    casi del motore
  flows/*.yaml     flussi
  tasks/*.yaml     compiti per i tester simulati
  personas/*.yaml  persone in più (facoltativo; quelle di base sono in `personas/` di betasim)
  report/          i risultati (da non versionare)
```

### betasim.yaml

```yaml
name: TimerLines
target:
  serve: ../design/02-wireframe       # una cartella da servire; oppure url: http://...
  entry: index.html
  viewport: {width: 375, height: 812}
  timezone: Europe/Rome
  startTime: "2026-10-05T18:00:00"    # l'orologio finto parte qui e si muove solo quando lo dice un flusso
  channel: chrome
  layers: ["#overlay .overlay"]       # un foglio aperto copre la pagina: si tocca solo lì dentro
  ignore: "#panel"                    # parti della pagina che non sono l'app
  root: "#screen"                     # dove sta l'app, per il brief
  disclosure: "[aria-expanded=false]" # gli espansori ("More options")
adapter: adapter.mjs
ui_language: native                   # native: l'app sarà tradotta; en: le persone la usano in inglese
personas: [builtin]                   # le persone di base, più eventuali cartelle del progetto
runs: 300
seed: 7
terms: {Ready by: 3, More options: 2} # quanto una parola è gergo, da 0 a 3
```

### adapter.mjs

Un oggetto con funzioni facoltative, tutte con la pagina Playwright come primo argomento:

- `ready(page)`: aspetta che l'app sia pronta.
- `setup(page, setup)`: prepara lo stato di un flusso (il campo `setup` del flusso).
- `back(page)`: il tasto indietro.
- `query(page, name, arg)`: risponde alle domande di `assertState`.
- `engine(page, caso, tools)`: fa girare un caso del motore e restituisce i numeri; `tools.advance(ms)` muove l'orologio finto, `tools.parseDur("4m25s")` converte.

### Un flusso

```yaml
name: La cena, dall'avvio al piatto in tavola
setup: {start: [cena]}            # facoltativo, lo interpreta l'adattatore
steps:
  - tapOn: Timers                 # testo visibile o nome accessibile: prima uguale, poi "inizia con", poi "contiene"
  - tapOn: {label: Start}         # solo aria-label
  - tapOn: {text: Start, within: Antibiotic, index: 0}
  - tapOn: {css: ".ring", at: [0.5, 0.04]}   # dove toccare, in frazioni dell'elemento
  - tapOn: Play
    concept: {name: waits for play, difficulty: 2}   # un'idea da capire per fare questo passo
  - inputText: {into: {id: e-title}, text: Kettle}
  - keypad: {into: {label: Duration}, keys: "7 00"}   # un campo a tastierino: lo apre se è chiuso (aria-expanded), preme i tasti per nome tra quelli che comanda (aria-controls); per il modello è un campo compilato, come inputText
  - advance: 11m                  # tempo finto: un salto, come un telefono che si risveglia
  - assertVisible: {label: "Timer 1 of 5"}
  - assertNotVisible: Notifications are off
  - assertState: {query: status, arg: Dinner, equals: done}   # anche contains, notContains, min, max, length
  - go: "#/linea/cena"
  - back
  - screenshot: dopo-il-play
  - swipe: {direction: LEFT, from: {css: ".ring", at: [0.08, 0.5]}}   # un dito che scorre, come in Maestro
  - drag: {from: Timer three, to: Timer one, where: above}   # pressione lunga, poi si porta sopra (above) o sotto (below) un altro elemento
covers: [focus-swipe]             # le funzioni di features.yaml che il flusso attraversa
expect: {maxTaps: 5}              # oltre il budget, un avviso
```

Ogni flusso parte da zero, in un contesto nuovo del browser. `optional: true` su un passo lo salta se non trova il bersaglio.

### Un caso del motore

```yaml
name: Il play della pasta con 2 minuti di ritardo
line: cena
events:
  - {at: 13m, do: gate, step: pasta}
at: 13m
expect:
  steps:
    pasta: {start: 13m, end: 22m}
```

Le durate si scrivono `250ms`, `45s`, `4m25s`, `1h30m`, `2d` o `11:00`; confrontate con una tolleranza di un secondo (`tolerance:` la cambia). I numeri semplici e i testi devono essere uguali.

### Un compito

```yaml
goal: "Fai partire un timer da 4 minuti per le uova."
flow: uova-4-minuti      # il percorso di chi sa dove andare
audience: all            # oppure una lista di id o di etichette delle persone
frequency: 5             # quanto spesso capita, da 1 a 5
critical: true           # se una persona si ferma qui, è un blocco
expected_seconds: 8
```

### Una persona

```yaml
name: Pina
age: 78
summary: Pensionata; usa WhatsApp e le foto, il resto glielo imposta il nipote.
tags: [cucina, casa]
tech: 1          # pratica con le app, da 1 a 5
english: 0       # da 0 a 5, conta solo con ui_language: en
vision: presbyopia   # none, presbyopia, low, blind (TalkBack)
motor: unsteady  # fine, normal, busy (mani occupate o bagnate), unsteady
explore: 1       # quanto apre menu ed espansori, da 1 a 5
reading: 4       # quanto legge le scritte
patience: 2      # quanti tentativi prima di arrendersi
hurry: 1
```

Le persone di base sono diciotto: cuoca di casa, chef, studente universitario, liceale, sportivo, genitore impegnato, insegnante, istruttore di palestra, imprenditore, project manager, content creator, nonna, ragazzino, persona non vedente con TalkBack, adulto con ADHD, scacchista di circolo, giocatrice da tavolo, cronometrista di dibattito.

### I target

I pubblici per cui il prodotto esiste, presi dal piano di business del progetto: stanno nel progetto (`targets: targets.yaml` in betasim.yaml, oppure la lista direttamente lì), mai nel pacchetto.

```yaml
- id: cucina
  name: Chi cucina
  weight: 3                          # quanto conta, da 1 a 3
  personas: [cuoca-di-casa, chef, nonna]
  goal: {success: 0.95, critical: 0.9}   # la riuscita pesata da raggiungere; e il minimo sui compiti critici
```

Il punteggio di un target è la riuscita dei suoi membri sui compiti pensati per loro, pesata su quanto spesso i compiti capitano. Ogni finding dice quali target tocca, e a parità di gravità sale quello che tocca il target più pesante.

## Il report

In `report/latest/`; il giro precedente va in `report/history/` (ne restano dodici).

- `summary.md`: una schermata. I conteggi, cosa è nuovo e cosa è risolto rispetto al giro prima, i target, i finding in ordine di gravità, la riuscita per compito e per persona. **Si legge per primo** (da un LLM, o da chi ha solo un terminale).
- `index.html`: la **dashboard**, per una persona: i target con il loro andamento, la mappa compiti e persone a colori (passando sopra una casella si vede dove quella persona si ferma), i finding con il filtro per gravità, l'andamento dei giri, i flussi e i casi del motore. Un solo file, senza server; chiaro e scuro. Non è in tempo reale perché un giro dura mezzo minuto: si rigenera alla fine di ogni giro.
- `findings.yaml`: ogni finding con un id stabile, la gravità (B blocca, A fa male, P è un dettaglio), dove, le prove in numeri, le persone colpite, i target toccati, una proposta e, per l'usabilità, le soluzioni simulate con la preferita. Gli id: `E:` caso del motore, `F:` flusso rotto, `W:` flusso oltre il budget, `U:compito:passo:motivo` usabilità, `U:small:` bersaglio piccolo, `C:` funzione senza flusso.
- `traces/<flusso>.yaml`: il percorso misurato, passo per passo (grandezza, scelte sullo schermo, parole, nascosto, fuori schermo, nome per TalkBack).
- `results.json`: tutto. `screens/`: le schermate dei fallimenti.

## I rimedi simulati

Ogni finding di usabilità è un problema (un comando nascosto, fuori schermo, piccolo, una parola difficile, due comandi con lo stesso nome...), e ogni problema ha una o più soluzioni alternative. Per un espansore, per esempio: portare in vista solo il comando che serve, far dire all'espansore cosa c'è sotto, aprirlo per tutti. Per un pulsante fuori schermo: fissare in vista la riga dei pulsanti, oppure portarlo più in alto.

betasim applica ogni soluzione ai percorsi misurati, **anche agli altri flussi che passano dalla stessa schermata**, con gli effetti collaterali: un espansore aperto per tutti allunga e affolla la schermata per chi non ne aveva bisogno; una barra fissa ruba spazio al resto; un comando spostato in alto spinge giù gli altri. Poi fa riprovare tutti i compiti a tutte le persone e misura quanto cambia la riuscita pesata dei target (in punti) e il tempo medio.

- Per ogni problema, la soluzione **preferita** è quella che serve di più ai target: prima quella che porta un target sopra il suo obiettivo, poi la riuscita, poi il tempo, poi il target più pesante.
- Le soluzioni preferite di problemi diversi sulla stessa schermata vengono provate **insieme**: **collidono** se insieme rendono meno della migliore delle due da sola (allora si tiene quella che serve di più ai target); **si aiutano** se rendono più della somma; **si ostacolano** se rendono molto meno della somma.
- Una soluzione che peggiora un target lo dice ("peggiora Accessibilità").

I numeri servono a scegliere tra alternative, non a promettere risultati. Per misurare gli effetti, il driver registra la posizione di ogni comando nella sua area che scorre, cosa è fissato, e quanto contenuto rivela ogni espansore aperto.

## A/B: due varianti a confronto

Quando c'è da scegliere tra due strutture (quattro schede o cinque, un menu o un pulsante diretto), le si mettono tutte e due nell'app, dietro un'impostazione, e betasim le prova con gli stessi flussi e le stesse persone.

- **Le varianti** stanno in `betasim.yaml`: ognuna ha un nome e un `setup`, che l'adapter applica sopra ogni flusso con la funzione `variant(page, setup)`, dopo il setup del flusso e dopo ogni `setState`. La prima variante è l'app com'è: un giro normale è un giro della prima.

  ```yaml
  variants:
    A: {name: Quattro schede}
    B: {name: Cinque schede, setup: {settings: {fiveTabs: true}}}
  ```

- **I flussi restano uno per file.** Dove le varianti divergono, un passo o un argomento si scrive per variante; una variante che non è nominata salta il passo:

  ```yaml
  - tapOn: {A: Timers, B: Sequences}          # lo stesso passo, un bersaglio diverso
  - A: {tapOn: Sequence}                       # solo in A
  - A: {tapOn: Timers}                         # due passi diversi, con le loro note
    B: {tapOn: Sequences, concept: {name: which tab has it, difficulty: 1}}
  ```

  Il numero del passo resta quello del file, così un finding ha lo stesso id nelle due varianti e si vede se una lo risolve.
- `betasim --ab A,B` (senza valore, le prime due) fa i flussi e l'usabilità di tutte e due, senza il motore, che non cambia con l'interfaccia. In `report/ab/` scrive `summary.md` e `index.html` (il confronto), `ab.json`, e in `A/` e `B/` il report completo di ogni variante; `report/latest` e la storia non si toccano.
- **Il confronto** è fatto solo sui compiti misurabili in tutte e due: la riuscita pesata, i target e le soglie d'impegno, ogni compito (riuscita, tocchi, tempo mediano), ogni persona (dove guadagna e dove perde di più), le coppie persona-compito che cambiano di più, e le cose da guardare che ci sono solo in una delle due.
- **Niente test statistico**: la riuscita è calcolata esatta dal modello (vedi sotto), quindi una differenza viene dai percorsi e non dal caso. Il limite vero è il modello, plausibile e non misurato: sotto un punto due varianti sono **pari** (≈).
- **Quello che il modello non vede lo mette il flusso.** Il modello vede le parole, i comandi fuori schermo, le scelte sullo schermo; non vede il dubbio "è un timer o una sequenza?", cioè in quale scheda cercare. Quel costo si scrive come `concept` sul passo della variante che lo chiede, e si dice nel riepilogo, con la prova di quanto cambia il risultato se costa di più o di meno.
- `agent-brief --variant B`: il tester LLM usa quella variante per tutta la sessione.

## La copertura: il controllo di base

`features.yaml` (nel progetto) elenca le funzioni dell'app; ogni flusso e ogni caso del motore dichiara quali attraversa con `covers: [id, ...]`. Il report dice quante funzioni passano per almeno un flusso, quali si rompono e quali non sono provate da nessuno (finding `C:`). È il giro su tutte le funzioni, uguale per tutti, senza persone: se un flusso fallisce è un difetto, o l'interfaccia è cambiata apposta.

## Cosa misura e cosa no

- **Misura** il percorso giusto: se una persona, sapendo dove andare, trova il comando successivo, lo tocca senza sbagliare, e in quanto tempo. Trova i problemi di struttura: comandi nascosti, fuori schermo, piccoli, senza nome per TalkBack, parole gergali, comandi uguali sulla stessa schermata.
- **Non misura** se la persona sa che quella strada esiste, se capisce cosa succede, se ha in testa un modello diverso e cerca altrove. Per questo i risultati di un'app già semplificata vengono quasi tutti verdi: verde vuol dire "nessun ostacolo sulla strada giusta", non "la gente ci riuscirà".
- **Si tara** con il test con persone vere: la riuscita e i tempi di quattro o cinque compiti reali servono a correggere le costanti del modello.
- **Si completa** con gli agenti LLM (`betasim brief`) sulle caselle peggiori, e con i giri di ragionamento sui concetti.

## I tester LLM

I tester a numeri seguono la strada giusta; una persona vera no. Un tester LLM è un modello che interpreta una persona e usa l'app vera, una mossa alla volta, guardando lo schermo, senza aver mai visto il codice: cerca le cose dove se le aspetta, sbaglia, si fa interrompere, decide se tornerà.

- **La persona** ha, oltre ai numeri, una scheda in parole: `identity` (chi è, la sua vita), `capabilities` (lingua, vista, mani, attenzione), `knowhow` (le app che usa, cosa sa di timer e di logica, come reagisce a un'app nuova), `approach`, `voice`. Oggi ce l'hanno la genitore impegnata (Sara), lo scacchista (Nicola), la giocatrice da tavolo (Irene) e il cronometrista di dibattito (Samuele); le altre si aggiungono allo stesso modo.
- **Lo scenario** (nel progetto, per esempio `test/agents/sara.yaml`) ha le fasi: il primo approccio e, se la persona resta agganciata, un uso qualche giorno dopo. Ogni fase ha l'ora di partenza, il contesto, l'obiettivo detto con le sue parole, il limite di mosse e le interruzioni della vita vera.
- `betasim agent-brief --scenario <file> --phase <id> --fresh` prepara la cartella della sessione e stampa il brief completo per il modello.
- `betasim play --session <cartella> --do "tap: Quick timer"` è il telefono: rifà da capo tutte le mosse con l'orologio finto, applica la nuova e restituisce l'ora, l'esito, gli avvisi, le interruzioni, l'immagine dello schermo e l'albero di accessibilità. Prima di ogni mossa passano 3 secondi, quanto ci mette una persona: gli avvisi spariscono come su un telefono vero (senza, restavano fermi sullo schermo e coprivano i pulsanti). Una mossa che non trova niente non lascia traccia nell'app. La seconda fase riparte dallo stato della prima.
- Il modello tiene un **diario**: per ogni mossa cosa vede, cosa pensa, cosa fa, e l'eventuale inciampo; alla fine l'esito, dove si è persa, se è agganciata e cosa la farebbe pagare.
- `betasim agent-report` trasforma i diari in report; gli inciampi entrano nei finding del giro (`L:`), la dashboard mostra l'esito.

betasim non chiama nessun modello: prepara il brief e legge il diario. Oggi il modello è un subagente di Claude Code; domani può essere uno script con le API. Una persona per due fasi (sessanta mosse) è costata circa 25 minuti e 260 mila token con un modello medio: si usa sui compiti che contano, non a ogni giro.

## Il modello, in breve

**Le icone familiari** (`familiar_icons` in `betasim.yaml`): un comando di sola icona costa, perché bisogna riconoscere il simbolo; se il suo nome è in quella lista (il play, la pausa, lo stop che tutti conoscono dal telecomando) costa un terzo. È un giudizio del progetto, come il peso delle parole in `terms`.

Per ogni passo di un percorso: la probabilità di trovare e scegliere il comando giusto al primo tentativo è un prodotto di fattori (sotto un espansore, fuori schermo, solo icona, parola gergale, idea nuova, tante scelte, nome e ruolo per TalkBack, testo piccolo, campo data; un espansore che nomina il comando del passo dopo, come More options con "Repeat", conta come uno che dice cosa c'è sotto); la probabilità di un tocco sbagliato viene dalla grandezza del bersaglio contro le mani della persona (il bersaglio è quello che il dito prende: il controllo, o lo strato `::before`/`::after` assoluto che gli sta attorno se è più grande, come i 48 dp di Material attorno a un chip di 32); il tempo dal modello a battute (pensare, leggere lo schermo nuovo, puntare, scrivere). Chi non trova riprova, con un po' di esperienza in più, finché la pazienza regge; poi si ferma. La riuscita, e dove e perché le persone si fermano, sono calcolate esatte da queste probabilità: niente rumore di campionamento, così due giri, due rimedi o due varianti differiscono solo dove il percorso differisce. Le prove simulate (`runs`) danno i tempi e i tocchi sbagliati. Tutto in `src/usability/model.mjs`, commentato.

## Iterare con un LLM

1. Lanciare betasim e leggere `summary.md`.
2. Per un finding, leggere la sua voce in `findings.yaml` e, se serve, la traccia del flusso.
3. Correggere l'app (o il flusso, se l'interfaccia è cambiata apposta; mai indebolire un caso senza capire chi dei due sbaglia).
4. Rilanciare: il riepilogo dice se il finding è risolto e se ne è nato un altro.

Per un agente che interpreta una persona, `betasim brief` prepara il punto di partenza; l'agente risponde con il nome di cosa toccherebbe.

## Più avanti

- **Android**: un driver con la stessa interfaccia di `src/driver/web.mjs` (trovare per testo o nome, toccare, scrivere, misurare, leggere l'albero), sopra adb e uiautomator o sopra Maestro. Flussi, persone, compiti e report restano gli stessi.
- **Agenti LLM**: un comando che tiene aperta la sessione e riceve un tocco alla volta, per le caselle peggiori del giro algoritmico.
- **Le schede di tutte le persone**: `identity`, `capabilities`, `knowhow`, `approach` e `voice`, come per la genitore impegnata. Servono ai tester LLM e alle interviste.
- **Le interviste**: fare domande a una persona, sia da un LLM sia da chi sviluppa (per esempio quali casi d'uso vorrebbe, cosa secondo lei manca). Un comando come `betasim ask --persona <id> "<domanda>"` prepara il brief: la scheda, ciò che la persona ha visto dell'app (i suoi diari, o una presentazione delle funzioni da `features.yaml`) e la domanda; il modello risponde con la sua voce. Chi sviluppa chiede dalla chat con l'assistente, o da una casella nella dashboard. Le risposte sono ipotesi da verificare con persone vere, come i diari dei tester LLM.
- **La memoria dei tester**: oggi la seconda fase di uno scenario legge l'esito della prima, e basta. Ogni persona avrà una memoria sua, nella cartella del progetto indicata in `betasim.yaml`, fuori dalle sessioni. Alla fine di ogni sessione la persona scrive, con le sue parole, cosa ricorda: cosa ha fatto, dove stanno le cose, cosa l'ha irritata, se tornerà. Aggiunge la data e la versione dell'app che ha visto. È il succo, non il diario intero. La leggono il brief di ogni scenario e le interviste; se l'app è cambiata, il brief lo dice, come un aggiornamento vero. `betasim memory [--persona <id>]` la mostra; `betasim forget --persona <id>` o `--all` la cancella, senza toccare diari e report, che sono le prove. Con la memoria si prova chi torna dopo un aggiornamento; senza, chi arriva nuovo. Le persone a numeri non hanno memoria: misurano sempre la prima volta.
- **Un pacchetto a sé**: basta spostare la cartella in un suo repository; non dipende da niente del progetto.
