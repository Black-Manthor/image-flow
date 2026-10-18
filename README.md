# Image Rows and Wraps

[English](#english) · [Italiano](#italiano)

![An image row and a wrap in Live Preview](https://raw.githubusercontent.com/Black-Manthor/image-rows-and-wraps/HEAD/assets/readme/panoramica.gif)

## English

Arrange images side by side in image rows, or with text flowing beside them
(**wrap**), with the same layout in Live Preview, Reading view and PDF. Notes
stay plain Markdown: even without the plugin, the images and the text remain in
the note.

> [!NOTE]
> The plugin speaks Obsidian's language: Italian when Obsidian is in Italian,
> English otherwise.

- Requires Obsidian 1.13.4 or later, desktop only.
- No network connection, no account, no telemetry. The plugin does not read or
  write files outside the vault.

### Installation

From the community directory: **Settings → Community plugins → Browse**, search
for «Image Rows and Wraps», **Install**, then **Enable**.

<details>
<summary>Manual installation</summary>

Download `main.js`, `manifest.json` and `styles.css` from the
[latest GitHub release](https://github.com/Black-Manthor/image-rows-and-wraps/releases/latest)
and put them in `<vault>/.obsidian/plugins/image-rows-and-wraps/`. Restart
Obsidian and enable the plugin in **Settings → Community plugins**. If you use
a custom vault configuration folder, use it in place of `.obsidian`.

</details>

### Image rows

Put image links on the same line, separated by spaces, with a blank line above
and below: they become an image row. A single image works too.

```markdown
Text before.

![[photo-1.png|200]] ![[photo-2.png|300]] ![[photo-3.png|200]]

Text after.
```

![Reordering an image row by dragging, resizing with the handle, vertical alignment from the bar](https://raw.githubusercontent.com/Black-Manthor/image-rows-and-wraps/HEAD/assets/readme/righe.gif)

- The number in the link is the desired width, in px. Without a number, the
  image's original width is used.
- If the images do not fit, they all shrink together, in the same proportion:
  they never wrap to a new line and are never cropped. With many images, split
  the row in two.
- Each image row uses a band up to 700 px wide. In a narrower column it
  shrinks; in a wider one it does not grow beyond the chosen widths.

**Editing an image row with the mouse**, in Live Preview:

- **Width:** drag the handle on the edge of an image. Only the number in the
  link changes.
- **Order:** drag an image before or after another one, also into another row.
  Dropped between two paragraphs, it becomes a new row.
- **Row bar** (appears on hover): a handle to move the whole row, the
  **distribution** (left, center, right, spread to the edges, spread with
  margins), the **vertical alignment** and the **gap** between the images.

The bar's choices are written in a comment at the end of the row, invisible in
Reading view and in the PDF, for example `%%iw-row align=center gap=24%%`. You
never need to type it. Without a comment, the defaults from the settings apply.
Omitted keys also follow the current defaults; explicit choices override them.

| Key | Values | Default |
| --- | --- | --- |
| `align` | `left`, `center`, `right`, `between` (to the edges), `evenly` (with margins) | `left` |
| `valign` | `top`, `center`, `bottom` | `top` |
| `gap` | gap in px on the 700 px reference | `12` |

### Wrap

A wrap holds an image with text flowing beside it, which continues below once
it is taller than the image. Create one with the **Add wrap** command, with the cursor on an image or a paragraph. In Markdown it looks like
this:

```markdown
[wrap:start] %%iw-wrap side=left%%

![[photo.png|300]]

Text beside the image, which continues below once it is taller than the image.

[wrap:end]
```

For the wrap layout, the first content must be a single image wikilink on
its own line. Blank lines must separate the opening marker, image, text and
closing marker, as in the example. The plugin’s commands already generate
this structure. If these separations are altered, use **Fix the format of the
note’s wraps** to restore the required spacing.

![Adding a wrap, changing its side, resizing the image](https://raw.githubusercontent.com/Black-Manthor/image-rows-and-wraps/HEAD/assets/readme/wrap.gif)

- The image of the wrap goes on the left or on the right (`side=left` or
  `side=right`). The text, lists, quotes, tables and code that follow sit
  beside it.
- **Width:** drag the handle on the image's edge towards the text. The maximum
  is a percentage of the column, set in the settings.
- **Wrap bar** (appears on hover): a handle to move the whole wrap,
  **Switch wrap side** and **Remove wrap, keep content**.

### Commands

All commands are in the command palette and in the menu of the
**Image Rows and Wraps** button in the ribbon. You can give them a hotkey in
**Settings → Hotkeys**. No hotkeys are assigned by default.
Commands that change the note require an editor in Live Preview or Source
mode. In Live Preview, click an image row or wrap to edit its Markdown; move
the cursor outside the block to see its layout again.

| Command | What it does |
| --- | --- |
| Add wrap | creates a wrap around the image or paragraph under the cursor |
| Switch wrap side | left ↔ right |
| Remove wrap, keep content | removes only the markers |
| Fix the format of the note's wraps | restores the required blank lines between wrap markers, image and text when their spacing has been altered |
| Center images | centers the image row under the cursor. In a wrap, it removes the wrap and turns the image into a centered row |
| Merge with the nearby image row | merges two image rows |
| Put each image in its own row | splits the images into a row each |
| Split the image row before this image | splits the row in two, before the image under the cursor |
| Move image left in its row | swaps the image with the previous one |
| Move image right in its row | swaps the image with the next one |
| Choose image row distribution | chooses the horizontal distribution, as in the row bar |
| Choose image row vertical alignment | chooses top, middle or bottom alignment |
| Choose gap between images | chooses the gap, as in the row bar |

Every command, gesture or choice from the bars is a single change, undone with
**Undo**. Only the parts of the Markdown the operation needs are changed. Image
files are never modified.

### Settings

**Settings → Image Rows and Wraps**:

- **Image dragging:** move images with the mouse in Live Preview. When off,
  Obsidian's own dragging applies.
- **Image rows:** the default distribution, vertical alignment and gap, for
  rows without choices of their own.
- **Wrap:** the gap between image and text (default: 1 em), and the image's
  maximum width (default: 45% of the column).
- **Notices:** how long the plugin's messages stay on screen.
- **Restore defaults:** resets the plugin's settings; explicit choices saved
  in your notes are kept.

### PDF

Use Obsidian's **Export to PDF** to export a note containing image rows and
wraps. The plugin applies their layout during that export; PDF generation
and saving are handled by Obsidian. Compatibility with Better Export PDF
has also been tested with version 2.0.3.

An image row is not split across two pages, unless it is taller than the
printable area. Wraps without the required blank-line separations are not
laid out as wraps in the PDF; a notice explains how to correct their format.
Tools that convert Markdown without going through Obsidian (for example those
based on Pandoc) do not apply the plugin's layout.

![The same note in Reading view and in the exported PDF](https://raw.githubusercontent.com/Black-Manthor/image-rows-and-wraps/HEAD/assets/readme/lettura-pdf.gif)

### Known limits

- Only images written as wikilinks (`![[photo.png]]`) are supported for now.
  Standard Markdown images `![](…)` and external images stay as Obsidian shows
  them.
- Image rows are recognized only in dedicated paragraphs of local image
  wikilinks, outside lists, quotes, callouts, code and properties. A paragraph
  mixing images and text is not an image row.
- Image rows inside a wrap, and wraps inside a wrap, are not supported.
- A list, quote, table or code block that starts beside a wrap's image stays in
  its column until it ends.
- In Reading view, task checkboxes inside a wrap cannot be ticked with a click:
  use Live Preview.
- If the required blank lines between wrap markers, image and text are
  missing, the format is nonconforming: the layout may not be applied
  correctly, markers can remain visible, and a notice may appear, including
  during PDF export. In Live Preview, an orange bar offers **Fix the wrap's
  format**. Use **Fix the format of the note's wraps** to restore the required
  spacing throughout the note.
- Desktop only, for now.

### Reporting a problem

Problems and ideas are welcome as
[issues on GitHub](https://github.com/Black-Manthor/image-rows-and-wraps/issues).
To contribute code, see [CONTRIBUTING.md](https://github.com/Black-Manthor/image-rows-and-wraps/blob/HEAD/CONTRIBUTING.md). Development, builds
and tests require Node.js 24 (24.19.0 or later in that series). Plugin users
do not need to install Node.js.

### License

[MIT](https://github.com/Black-Manthor/image-rows-and-wraps/blob/HEAD/LICENSE) © 2026 Black-Manthor.

## Italiano

Disponi le immagini in righe di immagini affiancate o con il testo che scorre
accanto (**wrap**), con la stessa impaginazione in Live Preview, in Lettura e
nel PDF. Le note restano in Markdown: anche senza il plugin, le immagini e il
testo rimangono nella nota.

> [!NOTE]
> Il plugin parla la lingua di Obsidian: italiano quando Obsidian è in italiano,
> inglese altrimenti.

- Richiede Obsidian 1.13.4 o successivo, solo desktop.
- Nessuna connessione di rete, nessun account, nessuna telemetria. Il plugin non
  legge né scrive file fuori dal vault.

### Installazione

Dal catalogo: **Impostazioni → Plugin della comunità → Sfoglia**, cerca
«Image Rows and Wraps», **Installa** e poi **Attiva**.

<details>
<summary>Installazione a mano</summary>

Scarica `main.js`, `manifest.json` e `styles.css` dall'
[ultima release su GitHub](https://github.com/Black-Manthor/image-rows-and-wraps/releases/latest)
e mettili in `<vault>/.obsidian/plugins/image-rows-and-wraps/`. Riavvia Obsidian
e attiva il plugin in **Impostazioni → Plugin della comunità**. Se usi una
cartella di configurazione personalizzata del vault, usala al posto di `.obsidian`.

</details>

### Righe di immagini

Inserisci i collegamenti alle immagini sulla stessa riga, separati da spazi,
con una riga vuota sopra e sotto: diventano una riga di immagini. Vale anche
per una sola immagine.

```markdown
Testo prima.

![[foto-1.png|200]] ![[foto-2.png|300]] ![[foto-3.png|200]]

Testo dopo.
```

![Riordinare una riga di immagini trascinando, ridimensionare con la maniglia, allineamento verticale dalla barra](https://raw.githubusercontent.com/Black-Manthor/image-rows-and-wraps/HEAD/assets/readme/righe.gif)

- Il numero nel collegamento è la larghezza desiderata, in px. Senza numero vale
  la larghezza originale dell'immagine.
- Se le immagini non ci stanno, si riducono tutte insieme, nella stessa
  proporzione: non vanno a capo e non vengono tagliate. Con molte immagini,
  dividi la riga di immagini in due.
- Ogni riga di immagini usa una fascia larga al massimo 700 px. Su una colonna
  più stretta si riduce, mentre su una più larga non si ingrandisce oltre le
  larghezze scelte.

**Modificare una riga di immagini con il mouse**, in Live Preview:

- **Larghezza:** trascina la maniglia sul bordo di un'immagine. Cambia solo il
  numero nel collegamento.
- **Ordine:** trascina un'immagine prima o dopo un'altra, anche in un'altra
  riga di immagini. Se la rilasci fra due paragrafi, forma una nuova riga di
  immagini.
- **Barra della riga di immagini** (compare al passaggio del mouse): la maniglia
  per spostare l'intera riga di immagini, la **distribuzione** (a sinistra, al
  centro, a destra, sui bordi, con margini), l'**allineamento verticale** e la
  **distanza** fra le immagini.

Le scelte della barra vengono scritte in un commento alla fine della riga di immagini,
invisibile in Lettura e nel PDF, per esempio `%%iw-row align=center gap=24%%`.
Non serve scriverlo a mano. Senza commento valgono i valori predefiniti scelti
nelle impostazioni. Anche le voci omesse seguono i predefiniti attuali; le
scelte esplicite prevalgono.

| Voce | Valori | Predefinito |
| --- | --- | --- |
| `align` | `left`, `center`, `right`, `between` (sui bordi), `evenly` (con margini) | `left` |
| `valign` | `top`, `center`, `bottom` | `top` |
| `gap` | distanza in px sul riferimento da 700 px | `12` |

### Wrap

Un wrap contiene un'immagine con il testo che le scorre accanto e continua
sotto quando supera la sua altezza. Si crea con il comando **Aggiungi wrap**,
con il cursore su un'immagine o su un paragrafo. Nel Markdown è così:

```markdown
[wrap:start] %%iw-wrap side=left%%

![[foto.png|300]]

Testo accanto all'immagine, che continua sotto quando supera la sua altezza.

[wrap:end]
```

Per impaginare il wrap, il primo contenuto deve essere un solo wikilink di
immagine, da solo sulla sua riga. Le righe vuote devono separare il marcatore
iniziale, l'immagine, il testo e il marcatore finale, come nell'esempio.
I comandi del plugin generano già questa struttura. Se queste separazioni
vengono alterate, usa **Correggi il formato dei wrap della nota** per
ripristinare la spaziatura richiesta.

![Aggiungere un wrap, cambiarne il lato, ridimensionare l'immagine](https://raw.githubusercontent.com/Black-Manthor/image-rows-and-wraps/HEAD/assets/readme/wrap.gif)

- L'immagine del wrap può essere messa a sinistra o a destra (`side=left` o
  `side=right`). Il testo, gli elenchi, le citazioni, le tabelle e il codice che
  seguono le stanno accanto.
- **Larghezza:** trascina la maniglia sul bordo dell'immagine verso il testo. Il
  massimo è una percentuale della colonna, che si sceglie nelle impostazioni.
- **Barra del wrap** (compare al passaggio del mouse): la maniglia per spostare
  il wrap intero, **Cambia lato del wrap** e **Rimuovi wrap mantenendo il
  contenuto**.

### Comandi

Tutti i comandi sono disponibili nella palette dei comandi e nel menu del
pulsante **Image Rows and Wraps** nella barra laterale. Puoi assegnare loro
una scorciatoia da **Impostazioni → Tasti di scelta rapida**. Non ci sono
scorciatoie predefinite. I comandi che modificano la nota richiedono un editor
in Live Preview o in modalità Sorgente. In Live Preview, fai clic su una riga
di immagini o su un wrap per modificarne il Markdown; sposta il cursore fuori
dal blocco per rivederne l'impaginazione.

| Comando | Cosa fa |
| --- | --- |
| Aggiungi wrap | crea un wrap attorno all'immagine o al paragrafo sotto il cursore |
| Cambia lato del wrap | sinistra ↔ destra |
| Rimuovi wrap mantenendo il contenuto | toglie solo i marcatori |
| Correggi il formato dei wrap della nota | ripristina le righe vuote richieste fra marcatori, immagine e testo quando la spaziatura viene alterata |
| Centra immagini | centra la riga di immagini sotto il cursore. In un wrap, rimuove il wrap e dispone l'immagine in una riga di immagini centrata |
| Unisci con la riga di immagini vicina | unisce due righe di immagini |
| Metti ogni immagine su una riga propria | separa le immagini, creando una riga di immagini per ciascuna |
| Dividi la riga di immagini prima di questa | divide la riga di immagini in due, prima dell'immagine sotto il cursore |
| Sposta l’immagine a sinistra nella riga | scambia l'immagine con la precedente |
| Sposta l’immagine a destra nella riga | scambia l'immagine con la successiva |
| Scegli la distribuzione della riga di immagini | sceglie la distribuzione orizzontale, come nella barra della riga di immagini |
| Scegli l’allineamento verticale della riga di immagini | sceglie l'allineamento in alto, al centro o in basso |
| Scegli la distanza tra le immagini | sceglie la distanza, come nella barra della riga di immagini |

Ogni comando, gesto o scelta dalle barre è una sola modifica, annullabile con
**Annulla**. Cambiano solo le parti del Markdown necessarie all'operazione.
I file delle immagini non vengono mai modificati.

### Impostazioni

**Impostazioni → Image Rows and Wraps**:

- **Trascinamento immagini:** permette di spostare le immagini con il mouse in
  Live Preview. Se disattivato, il trascinamento resta quello di Obsidian.
- **Righe di immagini:** permette di cambiare i valori predefiniti di
  distribuzione, allineamento verticale e distanza, per le righe di immagini che
  non hanno valori propri.
- **Wrap:** la distanza fra immagine e testo (predefinita: 1 em) e la larghezza
  massima dell'immagine (predefinita: 45% della colonna).
- **Avvisi:** permette di definire la durata dei messaggi del plugin.
- **Ripristina valori predefiniti:** ripristina le impostazioni del plugin;
  le scelte esplicite salvate nelle note restano.

### PDF

Usa **Esporta in PDF** di Obsidian per esportare una nota con righe di immagini
e wrap. Il plugin ne applica l'impaginazione durante quell'esportazione; la
generazione e il salvataggio del PDF sono gestiti da Obsidian. La compatibilità
con Better Export PDF è stata verificata anche con la versione 2.0.3.

Una riga di immagini non viene spezzata fra due pagine, salvo che sia più alta
dell'area stampabile. I wrap privi delle separazioni con righe vuote richieste
non vengono impaginati come wrap nel PDF; un avviso spiega come correggerne
il formato. Gli strumenti che convertono il Markdown senza passare da
Obsidian (per esempio quelli basati su Pandoc) non applicano l'impaginazione
definita dal plugin.

![La stessa nota in lettura e nel PDF esportato](https://raw.githubusercontent.com/Black-Manthor/image-rows-and-wraps/HEAD/assets/readme/lettura-pdf.gif)

### Limiti noti

- Al momento sono supportate solo le immagini scritte come wikilink
  (`![[foto.png]]`). Le immagini Markdown standard `![](…)` e quelle esterne
  restano come Obsidian le mostra.
- Le righe di immagini vengono riconosciute solo in paragrafi dedicati di
  wikilink di immagini locali, fuori da elenchi, citazioni, callout, codice e
  proprietà. Un paragrafo che mescola immagini e testo non è una riga di immagini.
- Non sono supportate righe di immagini dentro un wrap né wrap annidati.
- Un elenco, una citazione, una tabella o del codice che iniziano accanto
  all'immagine di un wrap restano nella loro colonna fino alla fine.
- In modalità Lettura le caselle delle attività dentro un wrap non si spuntano
  con un clic: usa Live Preview.
- Se mancano le righe vuote richieste fra marcatori, immagine e testo, il
  formato non è conforme: l'impaginazione può non essere applicata
  correttamente, i marcatori possono restare visibili e può comparire un
  avviso, anche durante l'esportazione PDF. In Live Preview, la barra arancione
  offre **Correggi il formato del wrap**. Usa **Correggi il formato dei wrap
  della nota** per ripristinare la spaziatura richiesta in tutta la nota.
- Solo desktop, per ora.

### Segnalare un problema

Problemi e idee sono benvenuti come
[issue su GitHub](https://github.com/Black-Manthor/image-rows-and-wraps/issues).
Per contribuire al codice, vedi [CONTRIBUTING.md](https://github.com/Black-Manthor/image-rows-and-wraps/blob/HEAD/CONTRIBUTING.md) (in inglese).
Sviluppo, compilazione e test richiedono Node.js 24 (da 24.19.0 nella serie 24).
Gli utenti del plugin non devono installare Node.js.

### Licenza

[MIT](https://github.com/Black-Manthor/image-rows-and-wraps/blob/HEAD/LICENSE) © 2026 Black-Manthor.
