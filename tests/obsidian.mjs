// End-to-end checks in the real Obsidian app: see tests/obsidian-app.mjs for the setup.
import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchObsidian, openNote, prepareVault, record, registryFile, root, saveAppCoverage, vault } from './obsidian-app.mjs';
import { detachWorkspaceWindow } from './obsidian-window.mjs';
import { consoleOutcome } from './console-policy.mjs';
import { longNote } from './long-note.mjs';

const shots = join(root, 'screenshots');
const wrapText = 'Testo accanto all’immagine. '.repeat(40);
// Native blocks with a box of their own beside a wrap's image.
// The last wrap ends with a short table: what follows goes below its image.
// Tables keep their own layout context while they remain beside the image.
const BLOCCHI = ['- primo livello\n  - secondo livello\n- [ ] da fare\n  - [x] fatto', '> Citazione.\n> - voce uno\n> - voce due', '```js\nconst x = 1;\n```', '| A | B |\n| --- | --- |\n| 1 | 2 |']
	.map(body => `[wrap:start] %%iw-wrap side=left%%\n\n![[a.png|160]]\n\n${body}\n\n[wrap:end]\n`).join('\n') + '\nFine.\n';
// A row and a wrap at the top of a note long enough that, scrolled far from
// them, Obsidian drops their widgets: a move must go on.
const LONTANO_RIGA = '![[a.png|200]] ![[b.png|150]] %%iw-row gap=20%%';
const LONTANO_WRAP = '[wrap:start] %%iw-wrap side=left%%\n\n![[c.png|200]]\n\nTesto del wrap.\n\n[wrap:end]';
const LONTANO = `Prima.\n\n${LONTANO_RIGA}\n\n${LONTANO_WRAP}\n\n`
	+ Array.from({ length: 400 }, (_, index) => `Paragrafo lontano ${index + 1}. ${'Testo di riempimento. '.repeat(12)}`).join('\n\n') + '\n';
const RIGHE = 'Testo prima.\n\n![[a.png|200]] ![[b.png|300]] ![[c.png|200]]\n\n![[a.png|250]] %%iw-row align=center%%\n\nTesto dopo.\n';
const filler = n => Array.from({ length: n }, (_, i) => `Riempimento ${i + 1}. ${'Testo di prova per la nota. '.repeat(6)}`).join('\n\n');
const compactText = (phrase, count) => (phrase + ' ').repeat(count).trim();
const COMPATTO = [
	'Testo prima.',
	'[wrap:start] %%iw-wrap side=left%%\n![[b.png|200]]\n' + compactText('Testo accanto all’immagine nel wrap compatto.', 10),
	'## Titolo nel wrap compatto',
	'- voce uno\n- voce due',
	compactText('Ultimo paragrafo del wrap compatto.', 10) + '\n[wrap:end]',
	'Testo dopo il wrap compatto.',
	'[wrap:start] %%iw-wrap side=right%%\n![[a.png|180]]\n\n' + compactText('Secondo wrap compatto, immagine sola nel suo paragrafo.', 8),
	compactText('Altro paragrafo.', 8) + '\n[wrap:end]',
	'Fine.',
].join('\n\n') + '\n';
// A note of 14 short wraps, embedded below an HTML spacer that moves it by
// 0.75 pt per px (a negative one through its collapsing margin). On Letter
// with the default margin, the image of its "right-heading" wrap meets the
// bottom of page 1 within CONFINE_RANGE.
const CONFINE_CASI = (() => {
	const blocks = [];
	for (const side of ['left', 'right']) for (const kind of ['heading', 'paragraph', 'heading-only', 'later-heading']) {
		const id = `${side}-${kind}`;
		blocks.push(`PRIMA ${id}.`, `[wrap:start] %%iw-wrap side=${side}%%`, '![[c.png|160]]');
		if (kind === 'paragraph' || kind === 'later-heading') blocks.push(`Paragrafo ${id}. Testo normale accanto all’immagine.`);
		if (kind !== 'paragraph') blocks.push(`## Titolo ${id}`);
		if (kind !== 'heading-only') blocks.push(`Corpo ${id}. Testo breve per verificare il confine del wrap.`);
		blocks.push('[wrap:end]', `DOPO ${id}.`);
	}
	for (let level = 1; level <= 6; level++) blocks.push(`PRIMA livello-${level}.`, '[wrap:start] %%iw-wrap side=left%%', '![[c.png|160]]', `${'#'.repeat(level)} Titolo livello-${level}`, `Corpo livello-${level}.`, '[wrap:end]', `DOPO livello-${level}.`);
	return blocks.join('\n\n') + '\n';
})();
// The spacer offsets (px) between which that image stops fitting on page 1,
// and the step the search narrows them to. Without the fix, the embedded note
// is sent to page 2 from the first offset where the image no longer fits for
// about 4 px (measured on 1.13.4 and 1.14.4): a step of 0.5 px always puts an
// export inside that window.
const CONFINE_RANGE = [-8, 0], CONFINE_STEP = 0.5;
const confineSpacer = offset => `<div style="${offset >= 0 ? `height: ${offset}px` : `height: 0; margin-block-end: ${offset}px`}"></div>`;
let obsidian;

before(async () => {
	await prepareVault({
		'Righe.md': RIGHE,
  'GutterUscita.md': ['Prima.', '[wrap:start] %%iw-wrap side=left%%', '![[gutter-tall.png|167]]', '## Titolo dopo l’immagine', 'Testo nel wrap separato. '.repeat(12).trim(), '[wrap:end]', '![[a.png|180]] ![[gutter-tall.png|180]]', 'Fine.'].join('\n\n'),

  'TitoliCarrier.md': ['Prima.', '[wrap:start] %%iw-wrap side=left%%', '![[a.png|180]]', '## Titolo due', 'Testo accanto. '.repeat(30), '[wrap:end]', '[wrap:start] %%iw-wrap side=right%%', '![[b.png|180]]', '### Titolo tre', 'Altro testo. '.repeat(30), '[wrap:end]', 'Fine.'].join('\n\n'),
		'Compatto.md': COMPATTO,
		'IncorporaWrap.md': '[[Wrap]]\n\n![[Wrap]]\n\nDopo.\n',
		'ConfineCasi.md': CONFINE_CASI,
		'IncorporaCompatto.md': '[[Compatto]]\n\n![[Compatto]]\n\nDopo.\n',
		...Object.fromEntries(['LetturaSequenze', 'LetturaDistribuzione', 'LetturaNascosta', 'LetturaPopout', 'LetturaPopoutEditor'].map(name => [`${name}.md`, 'Prima.\n\n![[a.png|160]] ![[b.png|160]] %%iw-row gap=24%%\n\nDopo.\n'])),
		'LetturaEstranea.md': 'Nota estranea.\n\n![[a.png|120]] ![[b.png|120]] %%iw-row align=right gap=24%%\n\nFine.\n',
		'LetturaDiversa.md': 'Prima.\n\n![[a.png|160]] ![[b.png|160]] %%iw-row gap=24%%\n\nDopo.\n',
		'LetturaLunga.md': 'Prima.\n\n![[a.png|160]] ![[b.png|160]] %%iw-row gap=24%%\n\n' + filler(400) + '\nFine.\n',
		'LetturaAffiancata.md': 'Prima.\n\n![[a.png|160]] ![[b.png|160]] %%iw-row gap=24%%\n\nDopo.\n',
		'LetturaGiaVistaRiga.md': 'Prima.\n\n![[a.png|160]] ![[b.png|160]] %%iw-row gap=8%%\n\nDopo.\n',
		'LetturaGiaVistaWrap.md': `Prima.\n\n[wrap:start] %%iw-wrap side=left%%\n\n![[b.png|200]]\n\n${wrapText}\n\n[wrap:end]\n\nDopo.\n`,
		// Tests that edit a note get a copy of their own: an editor change may still
		// be unsaved when the next test opens another note.
		...Object.fromEntries(['Commento', 'Palette', 'Altezza', 'Maniglia', 'SceltaA', 'SceltaB', 'Annulla', 'Distanza'].map(name => [`${name}.md`, RIGHE])),
		'Wrap.md': `[wrap:start] %%iw-wrap side=left%%\n\n![[b.png|300]]\n\n${wrapText}\n\n[wrap:end]\n\nFuori dal wrap.\n`,
		'Lunga.md': longNote(100, 'a.png'),
		'Stampa.md': `Testo prima.\n\n![[a.png|200]] ![[b.png|300]] ![[c.png|200]]\n\n![[a.png|250]] %%iw-row align=center%%\n\n[wrap:start] %%iw-wrap side=left%%\n\n![[b.png|200]]\n\n${wrapText}\n\n[wrap:end]\n\nTesto dopo.\n`,
		'Misto.md': Array.from({ length: 30 }, (_, index) => `## Sezione ${index + 1}\n\n${'Paragrafo introduttivo. '.repeat(20)}\n\n`
			+ `![[a.png|200]] ![[c.png|250]]\n\n[wrap:start] %%iw-wrap side=${index % 2 ? 'right' : 'left'}%%\n\n![[b.png|180]]\n\n${wrapText}\n\n[wrap:end]\n\n`).join(''),
		'SpostaRiga.md': `Uno.\n\n![[a.png|200]] ![[b.png|150]] %%iw-row gap=20%%\n\nDue.\n\n[wrap:start] %%iw-wrap side=left%%\n\n![[c.png|200]]\n\n${wrapText}\n\n[wrap:end]\n\nTre.\n`,
		'Finestra.md': `Uno.\n\n![[a.png|200]] ![[b.png|150]]\n\nDue.\n\n[wrap:start] %%iw-wrap side=left%%\n\n![[c.png|200]]\n\n${wrapText}\n\n[wrap:end]\n\nTre.\n`,
		'Ridimensiona.md': `Prima.\n\n[wrap:start] %%iw-wrap side=left%%\n\n![[c.png|200]]\n\n${wrapText}\n\n[wrap:end]\n\nIn mezzo.\n\n[wrap:start] %%iw-wrap side=right%%\n\n![[a.png|200]]\n\n${wrapText}\n\n[wrap:end]\n\nDopo.\n`,
		'Trascina.md': `Uno.\n\n![[a.png|200]] ![[b.png|150]]\n\nDue.\n\nTre.\n\n[wrap:start] %%iw-wrap side=left%%\n\n![[c.png|200]]\n\n${wrapText}\n\n[wrap:end]\n\nFine.\n`,
		'Sistema.md': 'Prima.\n[wrap:start]\n![[a.png|200]]\nTesto accanto.\n[wrap:end]\nDopo.\n',
		'Blocchi.md': BLOCCHI,
		'Lontano.md': LONTANO,
		// A row whose second image is upright (taller than the first) and a wrap
		// with a short text (room to click beside it), between long text.
		// Wraps with a heading after the image (a native rule spaces a heading
		// after a P), one without, and a row of images: each far from the
		// note's ends, so that an exit below can keep the clicked line.
		'UscitaTitoli.md': [filler(25),
			'Sopra wrap H2.', '[wrap:start] %%iw-wrap side=left%%', '![[gutter-tall.png|167]]', '## Titolo due', 'Testo accanto. '.repeat(20).trim(), '[wrap:end]', 'Sotto wrap H2.', filler(8),
			'Sopra wrap H3.', '[wrap:start] %%iw-wrap side=right%%', '![[gutter-tall.png|167]]', '### Titolo tre', 'Altro testo. '.repeat(20).trim(), '[wrap:end]', 'Sotto wrap H3.', filler(8),
			'Sopra wrap semplice.', '[wrap:start] %%iw-wrap side=left%%', '![[gutter-tall.png|167]]', 'Paragrafo accanto. '.repeat(20).trim(), '[wrap:end]', 'Sotto wrap semplice.', filler(8),
			'Sopra riga.', '![[a.png|180]] ![[gutter-tall.png|180]]', 'Sotto riga.', filler(25)].join('\n\n') + '\n',
		'Ingresso.md': [filler(20), 'Sopra la riga.', '![[a.png|200]] ![[b.png|200]]', 'Sotto la riga.', filler(4), 'Sopra il wrap.',
			'[wrap:start] %%iw-wrap side=left%%', '![[c.png|260]]', 'Testo breve accanto all’immagine.', '[wrap:end]', 'Sotto il wrap.', filler(20)].join('\n\n') + '\n',
		'Spazi.md': `Primo paragrafo.\n\n![[a.png|200]] ![[b.png|300]] ![[c.png|200]]\n\nSecondo paragrafo.\n\n[wrap:start] %%iw-wrap side=left%%\n\n![[b.png|200]]\n\n${wrapText}\n\n[wrap:end]\n\nTerzo paragrafo.\n`,
	}, [['gutter-tall.png', 300, 600, '#739'], ['a.png', 400, 300, '#c44'], ['b.png', 300, 400, '#4a4'], ['c.png', 500, 250, '#44c']]);
	await mkdir(join(shots, 'fine-test'), { recursive: true });
	if (process.env.IW_OBSIDIAN_THEME_DIR) {
  const theme = JSON.parse(await readFile(join(process.env.IW_OBSIDIAN_THEME_DIR, 'manifest.json'), 'utf8'));
  await cp(process.env.IW_OBSIDIAN_THEME_DIR, join(vault, '.obsidian', 'themes', theme.name), { recursive: true });
  await writeFile(join(vault, '.obsidian', 'appearance.json'), JSON.stringify({ cssTheme: theme.name }));
 }
 obsidian = await launchObsidian();
 if (process.env.IW_OBSIDIAN_THEME_DIR) {
  const theme = await obsidian.page.evaluate(() => window.app.customCss.theme);
  record({ kind: 'environment', theme });
  assert.ok(theme, 'community theme loaded');
 }
});

// The registry tags what the app writes with the test in progress.
beforeEach(t => { if (obsidian) obsidian.state.current = t.name; });

// The app as each test left it, named after the test: a rare failure can be
// looked at afterwards. Overwritten at each run.
// A failed test also leaves one in `fallimenti/`, never overwritten, and its
// path in the registry.
afterEach(async t => {
	if (!obsidian) return;
	const name = t.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80);
	await obsidian.page.screenshot({ path: join(shots, 'fine-test', `${name}.png`) }).catch(() => {});
	if (t.passed === false) {
		const failure = join(shots, 'fallimenti', `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}.png`);
		await mkdir(join(shots, 'fallimenti'), { recursive: true });
		// In the registry only once saved; otherwise why not.
		try {
			await obsidian.page.screenshot({ path: failure });
			record({ kind: 'screenshot', test: t.name, path: failure });
		} catch (error) {
			record({ kind: 'screenshot', test: t.name, missing: true, reason: String(error?.message ?? error).split('\n')[0] });
		}
	}
	await resetApp(t.name);
});

// The app back as every test expects it: one tab, no other window, no dialog.
// Anything a test left open is closed, and said in the registry with the test.
async function resetApp(test) {
	const { page } = obsidian;
	const left = [];
	for (const other of page.context().pages()) {
		if (other === page || other.isClosed()) continue;
		left.push(`una finestra (${other.url().slice(0, 60)})`);
		await detachWorkspaceWindow(other);
	}
	const extra = await page.evaluate(() => {
		const leaves = [];
		window.app.workspace.iterateRootLeaves(leaf => { leaves.push(leaf); });
		for (const leaf of leaves.slice(1)) leaf.detach();
		return { tabs: Math.max(0, leaves.length - 1), dialogs: document.querySelectorAll('.modal-container').length };
	}).catch(() => ({ tabs: 0, dialogs: 0 }));
	for (let i = 0; i < 3 && await page.locator('.modal-container').count().catch(() => 0); i++) await page.keyboard.press('Escape');
	if (extra.tabs) left.push(`${extra.tabs} schede`);
	if (extra.dialogs) left.push(`${extra.dialogs} finestre di dialogo`);
	if (left.length) record({ kind: 'console', level: 'warning', source: 'banco', test, text: `lasciate aperte dal test, chiuse: ${left.join(', ')}` });
}

after(async () => {
	if (obsidian) await saveAppCoverage(obsidian.page);
	await obsidian?.app.close();
});

// Obsidian's tooltips on screen, by text.
const visibleTooltips = page => page.evaluate(() => Array.from(document.body.children)
	.filter(el => el.classList.contains('tooltip') && getComputedStyle(el).display !== 'none').map(el => el.textContent));

const container = mode => `.workspace-leaf.mod-active ${mode === 'reading' ? '.markdown-reading-view' : '.markdown-source-view'}`;

async function open(path, mode) {
	const { page } = obsidian;
	await openNote(page, path, mode);
	// Keep the cursor out of the blocks, otherwise Live Preview shows their source.
	if (mode === 'live') await page.evaluate(() => { const editor = window.app.workspace.activeEditor.editor; editor.setCursor(editor.lastLine(), 0); });
	await page.waitForFunction(selector => {
		const images = [...document.querySelectorAll(`${selector} .image-embed`)];
		return images.length > 0 && images.every(image => image.classList.contains('is-loaded'));
	}, container(mode), { timeout: 15000 });
}

// Waits until `count` elements match `selector` in `scope`, for up to 5 s:
// the layout comes after drawing, later in an app just started.
const laidOut = async (scope, selector, count) => {
	try {
		await obsidian.page.waitForFunction(({ scope, selector, count }) =>
			document.querySelectorAll(`${scope} ${selector}`).length >= count, { scope, selector, count }, { timeout: 5000 });
	} catch (error) {
		const found = await obsidian.page.locator(`${scope} ${selector}`).count().catch(() => 0);
		throw new Error(`layout non pronto entro 5 s: ${selector} in ${scope}, trovati ${found}, attesi almeno ${count}`, { cause: error });
	}
};

const boxes = (selector, scope) => obsidian.page.evaluate(({ selector, scope }) =>
	[...document.querySelectorAll(`${scope} ${selector}`)].map(element => {
		const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
		return { left, right, top, bottom, width, height };
	}), { selector, scope });

for (const mode of ['live', 'reading']) {
	test(`righe di immagini (${mode})`, async () => {
		await open('Righe.md', mode);
		const scope = container(mode);
		// Laid out once drawn: waited for, not a fixed time (the first tests run
		// in an app just started, slower).
		await laidOut(scope, '.iw-row', 2);
		const rows = await boxes('.iw-row', scope);
		assert.equal(rows.length, 2);
		const images = await boxes('.iw-row .image-embed', scope);
		assert.equal(images.length, 4);
		const [a, b, c, centered] = images;
		for (const image of [b, c]) assert.ok(Math.abs(image.top - a.top) < 1, 'immagini della riga alla stessa altezza');
		assert.ok(a.right <= b.left && b.right <= c.left, 'immagini affiancate da sinistra a destra');
		assert.ok(Math.abs(b.width / a.width - 1.5) < 0.02 && Math.abs(c.width - a.width) < 1, 'larghezze nel rapporto 200:300:200');
		assert.ok(Math.abs((centered.left + centered.right) / 2 - (rows[1].left + rows[1].right) / 2) < 2, 'align=center');
		await obsidian.page.screenshot({ path: join(shots, `righe-${mode}.png`) });
	});

	test(`wrap a sinistra (${mode})`, async () => {
		await open('Wrap.md', mode);
		const scope = container(mode);
		await laidOut(scope, '.iw-preview .image-embed.iw-left', 1);
		const [image] = await boxes('.iw-preview .image-embed.iw-left', scope);
		// Rarely missing: report what was on screen instead.
		if (!image) assert.fail(`immagine del wrap assente: ${JSON.stringify(await obsidian.page.evaluate(selector => ({
			file: window.app.workspace.getActiveFile()?.path, mode: window.app.workspace.activeLeaf?.view.getMode?.(),
			previews: document.querySelectorAll(`${selector} .iw-preview`).length,
			embeds: [...document.querySelectorAll(`${selector} .image-embed, ${selector} .internal-embed`)].map(embed =>
				`${embed.className} src=${embed.getAttribute('src')} img=${embed.querySelector('img')?.complete ?? 'nessuna'}`),
		}), scope))}`);
		const lines = await obsidian.page.evaluate(selector => {
			const paragraph = document.querySelector(`${selector} .iw-first-paragraph`);
			const range = document.createRange();
			range.selectNodeContents(paragraph);
			return [...range.getClientRects()].map(({ left, top, bottom }) => ({ left, top, bottom }));
		}, scope);
		const beside = lines.filter(line => line.top < image.bottom - 1);
		const below = lines.filter(line => line.top >= image.bottom);
		assert.ok(beside.length > 0 && beside.every(line => line.left >= image.right), 'testo a destra dell’immagine');
		assert.ok(below.length > 0 && below.every(line => line.left < image.right), 'testo che continua sotto l’immagine');
		await obsidian.page.screenshot({ path: join(shots, `wrap-${mode}.png`) });
	});
}

// This test app is in English: the plugin speaks the app's language, set at
// load (i18n/index.ts).
test('il plugin parla la lingua di Obsidian: qui l’inglese, nei comandi e nel pulsante', async () => {
	const { page } = obsidian;
	const seen = await page.evaluate(() => ({ lang: document.documentElement.lang,
		command: window.app.commands.commands['image-rows-and-wraps:add-wrap']?.name,
		ribbon: document.querySelector('.side-dock-ribbon-action[aria-label="Image Rows and Wraps"]') !== null }));
	assert.deepEqual(seen, { lang: 'en', command: 'Image Rows and Wraps: Add wrap', ribbon: true });
});

test('Lettura: una riga il cui solo commento è cambiato viene reimpaginata', async () => {
	const { page } = obsidian;
	await open('Commento.md', 'live');
	// Only the comment changes: Reading view keeps the section's HTML as it was.
	await page.evaluate(() => {
		const editor = window.app.workspace.activeEditor.editor;
		const line = editor.getValue().split('\n').findIndex(text => text.includes('align=center'));
		const text = editor.getLine(line);
		editor.replaceRange(text.replace('align=center', 'align=right'), { line, ch: 0 }, { line, ch: text.length });
	});
	// In Live Preview the row is updated in place: its handles move to the left
	// edge, the one that moves in a right-aligned row.
	await page.waitForFunction(selector => document.querySelector(`${selector} .iw-row-preview.mod-align-right`), container('live'), { timeout: 5000 });
	const handles = await page.evaluate(selector => Array.from(document.querySelectorAll(`${selector} .iw-row-preview.mod-align-right .iw-row-handle`))
		.map(handle => handle.classList.contains('mod-left')), container('live'));
	assert.ok(handles.length > 0 && handles.every(Boolean), `maniglie sul bordo sinistro: ${JSON.stringify(handles)}`);
	await openNote(page, 'Commento.md', 'reading');
	const scope = container('reading');
	await page.waitForFunction(selector => document.querySelector(`${selector} p.iw-row.iw-row-align-right`), scope, { timeout: 5000 });
	const [, row] = await boxes('.iw-row', scope);
	const [, , , image] = await boxes('.iw-row .image-embed', scope);
	assert.ok(Math.abs(image.right - row.right) < 2, 'immagine al bordo destro della riga');
});

async function pairedReadingScenario(path, topology, steps, typing = false) {
	const { page } = obsidian;
	await openNote(page, path, 'live');
	await page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(0, 0));
	await laidOut(container('live'), '.iw-row-preview', 1);
	let popout;
	const opening = topology.includes('popout') ? page.context().waitForEvent('page') : null;
	try {
		await page.evaluate(async topology => {
			const app = window.app;
			let live = app.workspace.activeLeaf;
			let reading;
			if (topology === 'popout-live') {
				reading = live;
				await reading.view.setState({ mode: 'preview' }, {});
				live = app.workspace.openPopoutLeaf();
				await live.openFile(reading.view.file, { state: { mode: 'source', source: false } });
				live.view.editor.setCursor(live.view.editor.lastLine(), 0);
			} else reading = topology === 'popout-reading' ? app.workspace.openPopoutLeaf() : app.workspace.getLeaf(topology === 'hidden' ? 'tab' : 'split', 'vertical');
			await reading.openFile(live.view.file, { state: { mode: 'preview' } });
			window.pairedReading = { live, reading, hidden: topology === 'hidden' };
			app.workspace.setActiveLeaf(live, { focus: true });
		}, topology);
		if (opening) { popout = await opening; await popout.waitForLoadState(); }
		if (typing === 'other') await page.evaluate(async () => {
			const pair = window.pairedReading, app = window.app;
			pair.other = app.workspace.getLeaf('split', 'vertical');
			await pair.other.openFile(app.vault.getFileByPath('LetturaEstranea.md'), { state: { mode: 'source', source: false } });
			pair.other.view.editor.setCursor(pair.other.view.editor.lastLine(), 0);
			app.workspace.setActiveLeaf(pair.live, { focus: true });
		});
		const inputPage = topology === 'popout-live' ? popout : page;
		await inputPage.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
		await page.waitForFunction(() => {
			const { live, reading, hidden } = window.pairedReading;
			return [live, reading].every(leaf => {
				if (hidden && leaf === reading) return reading.view.containerEl.getBoundingClientRect().width === 0;
				const row = leaf.view.containerEl.querySelector(leaf === reading ? '.markdown-preview-view p.iw-row' : '.iw-row-preview p.iw-row');
				return row && (hidden && leaf === reading || row.getBoundingClientRect().width > 0) && [...row.querySelectorAll('img')].every(img => img.complete && img.naturalWidth);
			});
		});
		// No remaining layout or save retry may make the uncorrected code pass.
		for (const [kind, index, align, valign] of steps) {
			await inputPage.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
			await page.waitForTimeout(2800);
			await page.evaluate(({ kind, align, valign, typing }) => {
				const app = window.app, pair = window.pairedReading;
				pair.saved = null;
				pair.saveCalled = null;
				const modify = app.vault.modify;
				pair.originalModify = modify;
				app.vault.modify = function (file, ...args) {
					if (file.path === pair.live.view.file.path) pair.saveCalled = performance.now();
					return modify.call(this, file, ...args);
				};
				pair.changed = null;
				pair.receive = null;
				pair.activation = null;
				pair.expected = { align, valign };
				pair.modifyRef = app.vault.on('modify', file => { if (file.path === pair.live.view.file.path) pair.saved = performance.now(); });
				pair.editRef = app.workspace.on('editor-change', (_, info) => {
					if (info.file?.path === pair.live.view.file.path && pair.changed === null) {
						pair.changed = performance.now();
						if (typing) {
							let remaining = 40;
							pair.typing = setInterval(() => {
								const editor = (typing === 'other' ? pair.other : pair.live).view.editor, line = editor.lastLine();
								editor.replaceRange('x', { line, ch: editor.getLine(line).length });
								if (!--remaining) clearInterval(pair.typing);
							}, 20);
						}
					}
				});
				const cm = pair.live.view.editor.cm;
				pair.originalDispatch = cm.dispatch;
				pair.originalDoc = cm.state.doc;
				pair.firstDispatch = true;
				cm.dispatch = function (...args) {
					const start = performance.now();
					const result = pair.originalDispatch.apply(this, args);
					if (pair.firstDispatch && this.state.doc !== pair.originalDoc) {
						pair.firstDispatch = false;
						pair.changed = start;
						pair.dispatchMs = performance.now() - start;
					}
					return result;
				};
				pair.measure = new Promise(resolve => {
					const deadline = performance.now() + 5000;
					const sample = () => {
						if (pair.changed === null) {
							if (performance.now() >= deadline) { resolve({ updated: false, reason: 'documento non modificato entro 5 s' }); return; }
							pair.timer = setTimeout(sample, 5); return;
						}
						const now = performance.now(), row = pair.reading.view.containerEl.querySelector('.markdown-preview-view p.iw-row');
						if (pair.receive === null && pair.reading.view.getViewData().includes(`${kind}=${kind === 'align' ? align : valign}`)) pair.receive = now - pair.changed;
						const images = [...row?.querySelectorAll('img') ?? []].map(img => img.getBoundingClientRect());
						const center = box => valign === 'bottom' ? box.bottom : valign === 'top' ? box.top : (box.top + box.bottom) / 2;
						const rect = row?.getBoundingClientRect();
						const horizontal = images.length === 2 && (align === 'right' ? Math.abs(images[1].right - rect.right) < 2 : align === 'center' ? Math.abs((images[0].left + images[1].right - rect.left - rect.right) / 2) < 2 : Math.abs(images[0].left - rect.left) < 2);
						const geometry = horizontal && Math.abs(center(images[0]) - center(images[1])) < 2;
						const updated = row?.classList.contains(`iw-row-valign-${valign}`) && row.classList.contains(`iw-row-align-${align}`) && geometry && rect.width > 0;
						if (pair.hidden && pair.activation === null && now - pair.changed >= 200) { pair.activation = performance.now(); app.workspace.setActiveLeaf(pair.reading, { focus: true }); }
						if (updated || now - pair.changed >= 750) resolve({ updated, ms: now - pair.changed, receive: pair.receive, dispatchMs: pair.dispatchMs, activation: pair.activation === null ? null : pair.activation - pair.changed, afterActivation: pair.activation === null ? null : now - pair.activation, savedBeforeLayout: pair.saveCalled !== null, modifyEventBeforeLayout: pair.saved !== null, classes: row?.className, images: images.map(({ top, bottom }) => ({ top, bottom })) });
						else pair.timer = setTimeout(sample, 5);
					};
					sample();
				});
				pair.live.view.containerEl.querySelectorAll('.iw-row-toolbar button')[kind === 'align' ? 1 : 2].click();
			}, { kind, align, valign, typing });
			await inputPage.locator('.menu .menu-item').nth(index).click();
			const result = await page.evaluate(() => window.pairedReading.measure);
			console.log(`tempi Lettura affiancata (${topology}, ${kind}): ${JSON.stringify(result)}`);
			assert.ok(result.updated && result.ms <= 750, `classi e geometria entro 750 ms: ${JSON.stringify(result)}`);
			if (topology !== 'hidden') assert.equal(result.savedBeforeLayout, false, 'layout prima di vault.modify');
			else assert.ok(result.afterActivation < 250, `layout dalla riattivazione: ${JSON.stringify(result)}`);
			if (typing) await page.waitForTimeout(850);
			await page.evaluate(() => {
				const pair = window.pairedReading;
				window.app.vault.offref(pair.modifyRef); window.app.workspace.offref(pair.editRef);
				pair.modifyRef = pair.editRef = null;
				window.app.vault.modify = pair.originalModify;
				pair.originalModify = null;
				pair.live.view.editor.cm.dispatch = pair.originalDispatch;
				pair.originalDispatch = null;
				window.app.workspace.setActiveLeaf(pair.live, { focus: true });
			});
		}
	} finally {
		await page.evaluate(topology => {
			const pair = window.pairedReading;
			if (!pair) return;
			clearTimeout(pair.timer); clearInterval(pair.typing);
			if (pair.originalDispatch) pair.live.view.editor.cm.dispatch = pair.originalDispatch;
			if (pair.originalModify) window.app.vault.modify = pair.originalModify;
			if (pair.modifyRef) window.app.vault.offref(pair.modifyRef);
			if (pair.editRef) window.app.workspace.offref(pair.editRef);
			pair.reading.detach();
			if (pair.other) pair.other.detach();
			if (topology === 'popout-live') pair.live.detach();
			delete window.pairedReading;
		}, topology);
		if (popout) await popout.waitForEvent('close', { timeout: 5000 }).catch(error => { if (!popout.isClosed()) throw error; });
	}
}

test('Lettura affiancata: il commento esistente aggiorna classi e geometria entro 750 ms prima del salvataggio', async () => {
	await pairedReadingScenario('LetturaAffiancata.md', 'split', [['valign', 1, 'left', 'center']]);
});

test('Lettura affiancata: ordine inverso e modifiche ripetute', async () => {
	await pairedReadingScenario('LetturaSequenze.md', 'split', [['valign', 1, 'left', 'center'], ['align', 1, 'center', 'center'], ['valign', 2, 'center', 'bottom'], ['align', 2, 'right', 'bottom']], false);
});

test('Lettura affiancata: distribuzione poi verticale', async () => {
	await pairedReadingScenario('LetturaDistribuzione.md', 'split', [['align', 1, 'center', 'top'], ['valign', 1, 'center', 'center']], false);
});

test('Lettura affiancata: nota lunga e digitazione continua', async () => {
	await pairedReadingScenario('LetturaLunga.md', 'split', [['valign', 1, 'left', 'center']], true);
});

test('Lettura affiancata: digitazione in una nota diversa non rinvia il layout', async () => {
	await pairedReadingScenario('LetturaDiversa.md', 'split', [['valign', 1, 'left', 'center']], 'other');
});

test('Lettura affiancata: scheda nascosta: tempo distinto dalla riattivazione', async () => {
	await pairedReadingScenario('LetturaNascosta.md', 'hidden', [['valign', 1, 'left', 'center']], false);
});

test('Lettura affiancata: Lettura nella finestra separata', async () => {
	await pairedReadingScenario('LetturaPopout.md', 'popout-reading', [['align', 1, 'center', 'top'], ['valign', 1, 'center', 'center']], false);
});

test('Lettura affiancata: editor nella finestra separata', async () => {
	await pairedReadingScenario('LetturaPopoutEditor.md', 'popout-live', [['valign', 1, 'left', 'center'], ['align', 1, 'center', 'center']], false);
});

// A Reading tab already shown, then left inactive; the note's comment is
// changed from its Live Preview tab and, once the text has reached the Reading
// view, the Reading tab is shown again. The section is processed anew from the
// plugin's visibility observer: its new layout must be in the first frame that
// shows it, and the browser must report no ResizeObserver loop. Frames
// are read with animation callbacks, without an observer of the test's own.
async function readingShownAgain(path, kind, from, to) {
	const { page } = obsidian;
	const before = obsidian.errors.length;
	const result = await page.evaluate(async ({ path, kind, from, to }) => {
		const app = window.app, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), frame = () => new Promise(resolve => requestAnimationFrame(resolve));
		const file = app.vault.getFileByPath(path);
		const live = app.workspace.getLeaf(false);
		await live.openFile(file, { state: { mode: 'source', source: false } });
		const reading = app.workspace.getLeaf('tab');
		await reading.openFile(file, { state: { mode: 'preview' } });
		app.workspace.setActiveLeaf(reading, { focus: true });
		const read = () => {
			const scope = reading.view.containerEl.querySelector('.markdown-preview-view');
			const element = scope?.querySelector(kind === 'riga' ? 'p.iw-row' : '.iw-reading-wrap');
			if (!element) return null;
			const value = kind === 'riga' ? element.style.getPropertyValue('--iw-row-gap') : (element.className.match(/iw-layout-iw-\w+/) ?? [''])[0];
			return { value, width: element.getBoundingClientRect().width };
		};
		for (let i = 0; i < 200 && !(read()?.width > 0); i++) await sleep(25);
		const shown = read();
		await sleep(300);
		app.workspace.setActiveLeaf(live, { focus: true });
		await sleep(500);
		const editor = live.view.editor;
		const index = editor.getValue().indexOf(from);
		editor.replaceRange(to, editor.offsetToPos(index), editor.offsetToPos(index + from.length));
		let arrived = false;
		for (let i = 0; i < 400 && !(arrived = reading.view.getViewData().includes(to)); i++) await sleep(5);
		await sleep(150);
		app.workspace.setActiveLeaf(reading, { focus: true });
		const samples = [];
		for (let i = 0; i < 12; i++) { await frame(); samples.push(read()); }
		const firstVisible = samples.findIndex(sample => sample?.width > 0);
		const firstNew = samples.findIndex(sample => sample?.width > 0 && sample.value !== shown.value);
		reading.detach();
		app.workspace.setActiveLeaf(live, { focus: true });
		return { shown, arrived, firstVisible, firstNew, samples: samples.slice(0, 4) };
	}, { path, kind, from, to });
	await page.waitForTimeout(300);
	const loops = obsidian.errors.slice(before).filter(entry => /ResizeObserver loop/.test(entry.text));
	console.log(`Lettura già vista (${kind}): ${JSON.stringify({ ...result, loops: loops.length })}`);
	assert.ok(result.shown?.width > 0, `la Lettura mostrata prima del cambio: ${JSON.stringify(result)}`);
	assert.equal(result.arrived, true, 'il testo nuovo arrivato alla Lettura prima del ritorno');
	assert.ok(result.firstVisible >= 0 && result.firstNew === result.firstVisible, `nuova disposizione nel primo fotogramma visibile: ${JSON.stringify(result)}`);
	assert.deepEqual(loops.map(entry => `${entry.event} ${entry.window}: ${entry.text}`), [], 'nessun ciclo di ResizeObserver al ritorno');
}

test('Lettura già vista in un’altra scheda: riga di immagini cambiata, nuova disposizione nel primo fotogramma, nessun ciclo di ResizeObserver', async () => {
	await readingShownAgain('LetturaGiaVistaRiga.md', 'riga', 'gap=8', 'gap=24');
});

test('Lettura già vista in un’altra scheda: wrap cambiato di lato, nuova disposizione nel primo fotogramma, nessun ciclo di ResizeObserver', async () => {
	await readingShownAgain('LetturaGiaVistaWrap.md', 'wrap', 'side=left', 'side=right');
});

test('Live Preview: cambiando la distanza predefinita ogni riga viene ridisegnata una volta sola', async () => {
	const { page } = obsidian;
	await open('Righe.md', 'live');
	const previous = await page.evaluate(() => window.app.plugins.plugins['image-rows-and-wraps'].store.current.rowGap);
	let result;
	try {
		result = await page.evaluate(async selector => {
			const store = window.app.plugins.plugins['image-rows-and-wraps'].store;
			const scope = document.querySelector(selector);
			let created = 0;
			const observer = new MutationObserver(records => {
				for (const record of records) for (const node of record.addedNodes) {
					if (node.nodeType === 1 && (node.matches('.iw-row-preview') || node.querySelector('.iw-row-preview'))) created++;
				}
			});
			observer.observe(scope, { childList: true, subtree: true });
			try {
				await store.change({ ...store.current, rowGap: 30 });
				await new Promise(resolve => setTimeout(resolve, 2000));
				const gaps = [...scope.querySelectorAll('.iw-row-preview p.iw-row')].map(row => row.style.getPropertyValue('--iw-row-gap'));
				return { created, rows: gaps.length, gaps };
			} finally {
				observer.disconnect();
			}
		}, container('live'));
		// Prove that the temporary value reached disk before requesting its
		// restoration; equality with the original file alone could be stale.
		await page.waitForFunction(async () => {
			const plugin = window.app.plugins.plugins['image-rows-and-wraps'], store = plugin.store;
			return (await plugin.loadData())?.rowGap === 30 && !store.unsaved && store.writing === 0;
		});
		assert.equal(result.rows, 2);
		// Before 0.26.3 each row was redrawn every frame for seconds (hundreds of
		// times). Now once for the new settings, plus at most once more when the
		// new height is reported (Obsidian redraws the line when it changes).
		assert.ok(result.created <= result.rows * 2, `righe ricreate: ${result.created}`);
		// The first row (200 + 300 + 200 and two 30 px gaps: 760 px) is scaled to
		// the 700 px reference; the second has one image, hence no gap.
		assert.deepEqual(result.gaps, [`${30 / 760 * 100}%`, '0%']);
	} finally {
		await page.evaluate(async previous => {
			const store = window.app.plugins.plugins['image-rows-and-wraps'].store;
			await store.change({ ...store.current, rowGap: previous });
			store.persist.run();
		}, previous);
		await page.waitForFunction(async previous => {
			const plugin = window.app.plugins.plugins['image-rows-and-wraps'], store = plugin.store;
			return (await plugin.loadData())?.rowGap === previous && !store.unsaved && store.writing === 0;
		}, previous);
	}
});

test('preferenze cambiate fuori da Obsidian (Sync): applicate subito, righe di immagini ridisegnate', async () => {
	const { page } = obsidian;
	await open('Righe.md', 'live');
	// Opening the note can finish delivery of the preceding settings effects.
	// Cross the external-change boundary only after the restored value is both
	// on disk and free of any local write still queued or in progress.
	await page.waitForFunction(async () => {
		const plugin = window.app.plugins.plugins['image-rows-and-wraps'], store = plugin.store;
		return (await plugin.loadData())?.rowGap === store.current.rowGap && !store.unsaved && store.writing === 0;
	});
	const before = await page.evaluate(() => ({ ...window.app.plugins.plugins['image-rows-and-wraps'].store.current }));
	const externalGap = 31;
	const gaps = () => page.evaluate(selector => [...document.querySelectorAll(`${selector} .iw-row-preview p.iw-row`)]
		.map(row => row.style.getPropertyValue('--iw-row-gap')), container('live'));
	// Prepare the same on-disk state an external program would leave. Obsidian
	// owns detection/Sync: this test starts at the public callback and verifies
	// the plugin's response to that event.
	try {
		const applied = await page.evaluate(async ({ before, externalGap }) => {
			const plugin = window.app.plugins.plugins['image-rows-and-wraps'];
			await plugin.saveData({ ...before, rowGap: externalGap });
			await plugin.onExternalSettingsChange();
			return { current: plugin.store.current.rowGap, stored: (await plugin.loadData())?.rowGap,
				unsaved: plugin.store.unsaved, writing: plugin.store.writing };
		}, { before, externalGap });
		assert.deepEqual(applied, { current: externalGap, stored: externalGap, unsaved: false, writing: 0 },
			`la modifica esterna deve essere applicata alla conclusione del callback: ${JSON.stringify(applied)}`);
		await page.waitForFunction(gap => window.app.plugins.plugins['image-rows-and-wraps'].store.current.rowGap === gap, externalGap, { timeout: 10000 })
			.catch(() => assert.fail('data.json cambiato fuori da Obsidian: il plugin non ha riletto le preferenze entro 10 s'));
		await page.waitForFunction(({ selector, gap }) => document.querySelector(`${selector} .iw-row-preview p.iw-row`)?.style.getPropertyValue('--iw-row-gap') === `${gap / (700 + gap * 2) * 100}%`,
			{ selector: container('live'), gap: externalGap }, { timeout: 5000 }).catch(async () => assert.fail(`riga di immagini non ridisegnata con la nuova distanza: ${JSON.stringify(await gaps())}`));
	} finally {
		await page.evaluate(async before => {
			const plugin = window.app.plugins.plugins['image-rows-and-wraps'];
			await plugin.saveData(before);
			await plugin.onExternalSettingsChange();
		}, before);
		await page.waitForFunction(async gap => {
			const plugin = window.app.plugins.plugins['image-rows-and-wraps'], store = plugin.store;
			return store.current.rowGap === gap && (await plugin.loadData())?.rowGap === gap && !store.unsaved && store.writing === 0;
		}, before.rowGap, { timeout: 10000 });
	}
});

const editorText = () => obsidian.page.evaluate(() => window.app.workspace.activeEditor.editor.getValue());
const undo = () => obsidian.page.evaluate(() => window.app.workspace.activeEditor.editor.undo());

test('Correggi il formato dei wrap della nota: più modifiche, un solo passo di Annulla', async () => {
	const { page } = obsidian;
	await openNote(page, 'Sistema.md', 'live');
	const before = await editorText();
	const expected = 'Prima.\n\n[wrap:start] %%iw-wrap side=left%%\n\n![[a.png|200]]\nTesto accanto.\n\n[wrap:end]\n\nDopo.\n';
	await page.evaluate(() => window.app.commands.executeCommandById('image-rows-and-wraps:fix-wraps'));
	await page.waitForFunction(expected => window.app.workspace.activeEditor.editor.getValue() === expected, expected);
	assert.equal(await editorText(), expected);
	await undo();
	assert.equal(await editorText(), before);
});

test('Annulla: due scelte dalla palette sono due passi, come dalla barra', async () => {
	const { page } = obsidian;
	await openNote(page, 'Palette.md', 'live');
	const before = await editorText();
	const choose = async value => {
		// The cursor on the first row, then the palette command and its dialog.
		await page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(2, 3));
		await page.evaluate(() => window.app.commands.executeCommandById('image-rows-and-wraps:row-set-gap'));
		const input = page.locator('.prompt-input');
		await input.waitFor();
		await input.fill(String(value));
		await page.keyboard.press('Enter');
		await input.waitFor({ state: 'detached' });
		await page.waitForFunction(value => new RegExp(`gap=${value}(?:\\s|%)`).test(window.app.workspace.activeEditor.editor.getLine(2)), value);
	};
	await choose(20);
	await choose(24);
	const row = text => text.split('\n')[2];
	assert.match(row(await editorText()), /gap=24/);
	await undo();
	assert.match(row(await editorText()), /gap=20/, 'il primo Annulla toglie solo la seconda scelta');
	await undo();
	assert.equal(await editorText(), before);
});

test('una scelta dalla palette non modifica un’altra nota aperta nel frattempo', async () => {
	const { page } = obsidian;
	// Two notes with the same row at the same place: Obsidian reuses the editor
	// of the pane for the second one, so only the file tells them apart.
	await openNote(page, 'SceltaA.md', 'live');
	const before = await editorText();
	await page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(2, 3));
	await page.evaluate(() => window.app.commands.executeCommandById('image-rows-and-wraps:row-set-gap'));
	const input = page.locator('.prompt-input');
	await input.waitFor();
	const editor = await page.evaluateHandle(() => window.app.workspace.activeEditor.editor);
	// B opens in the same pane while the dialog is open (as a sync or another plugin could).
	await page.evaluate(() => window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath('SceltaB.md')));
	await page.waitForFunction(() => window.app.workspace.getActiveFile()?.path === 'SceltaB.md');
	assert.ok(await page.evaluate(editor => editor === window.app.workspace.activeEditor.editor, editor), 'stesso editor per B');
	await page.evaluate(() => document.querySelectorAll('.notice').forEach(notice => notice.remove()));
	await input.fill('24');
	await page.keyboard.press('Enter');
	await input.waitFor({ state: 'detached' });
	await page.waitForFunction(() => [...document.querySelectorAll('.notice')].some(notice => notice.textContent.includes('Another note was opened while you were choosing')));
	assert.equal(await editorText(), before, 'B non cambia');
	const notices = await page.evaluate(() => [...document.querySelectorAll('.notice')].map(notice => notice.textContent));
	assert.ok(notices.some(text => text.includes('Another note was opened while you were choosing')), `avviso mostrato: ${notices.join(' | ')}`);
	assert.equal(await page.evaluate(() => window.app.vault.cachedRead(window.app.vault.getFileByPath('SceltaA.md'))), before, 'A non cambia');
});

test('altezza della riga: tolta quando la riga non è più di immagini', async () => {
	const { page } = obsidian;
	await open('Altezza.md', 'live');
	const scope = container('live');
	const heights = () => page.evaluate(selector => document.querySelectorAll(`${selector} .cm-line[data-iw-row-height]`).length, scope);
	await page.waitForFunction(selector => document.querySelectorAll(`${selector} .cm-line[data-iw-row-height]`).length === 2, scope, { timeout: 5000 });
	await page.evaluate(() => {
		const editor = window.app.workspace.activeEditor.editor;
		editor.replaceRange('Ora è testo.', { line: 2, ch: 0 }, { line: 2, ch: editor.getLine(2).length });
		editor.setCursor(editor.lastLine(), 0);
	});
	await page.waitForFunction(selector => document.querySelectorAll(`${selector} .cm-line[data-iw-row-height]`).length === 1, scope);
	assert.equal(await heights(), 1);
});

// A click that opens a wrap's or a row's source keeps the clicked line where it
// was on screen: the wrap's text is below its image in the source. A click
// below an open wrap keeps the clicked line in every frame.
const placeLongBlock = async (heading, skip, y) => {
	const { page } = obsidian;
		for (let i = 0; i < 6; i++) {
			await page.evaluate(({ heading, skip, y }) => {
				const view = window.app.workspace.activeEditor.editor.cm;
				const text = view.state.doc.toString();
				const from = text.indexOf(skip, text.indexOf(heading));
				view.scrollDOM.scrollTop += view.documentTop + view.lineBlockAt(from).top - y;
			}, { heading, skip, y });
			await page.waitForTimeout(300);
		}
	};
const clickAndMeasureLongBlock = async (heading, skip, root, inner, beside = false) => {
	const { page } = obsidian;
		const before = await page.evaluate(({ heading, skip, root, inner, beside }) => {
			const view = window.app.workspace.activeEditor.editor.cm;
			const text = view.state.doc.toString();
			const section = text.indexOf(heading);
			const next = text.indexOf('## Sezione', section + heading.length);
			const start = view.state.doc.lineAt(text.indexOf(skip, section)).from;
			const block = [...document.querySelectorAll(root)].find(e => { const at = view.posAtDOM(e); return at > section && at < next; });
			const element = inner ? block.querySelector(inner) : block;
			const box = element.getBoundingClientRect();
			return { start, top: box.top, x: beside ? box.right - 20 : box.left + box.width / 2, y: box.top + Math.min(box.height / 2, 40) };
		}, { heading, skip, root, inner, beside });
		await page.mouse.click(before.x, before.y);
		await page.waitForTimeout(800);
		// The top of the line, not the caret: on a row's line the caret sits below
		// the images Obsidian shows there.
		const after = await page.evaluate(start => {
			const view = window.app.workspace.activeEditor.editor.cm;
			return { head: view.state.selection.main.head, top: view.documentTop + view.lineBlockAt(start).top };
		}, before.start);
		return { before, after };
	};

test('Live Preview: entrare e uscire da un wrap non sposta il punto cliccato', async () => {
	const { page } = obsidian;
	await open('Misto.md', 'live');
	await page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(0, 0));
	await placeLongBlock('## Sezione 12', 'Testo accanto', 350);
	const wrap = await clickAndMeasureLongBlock('## Sezione 12', 'Testo accanto', '.cm-content .iw-preview:not(.iw-row-preview)', '.iw-first-paragraph');
	assert.equal(wrap.after.head, wrap.before.start, 'il cursore all’inizio del paragrafo cliccato');
	assert.ok(Math.abs(wrap.after.top - wrap.before.top) <= 1, `wrap: il paragrafo da ${wrap.before.top} a ${wrap.after.top}`);
	// Leaving it from below: the next heading, brought into view and clicked,
	// sampled at every frame for a second.
	await placeLongBlock('## Sezione 13', '## Sezione 13', 500);
	await page.evaluate(() => {
		const view = window.app.workspace.activeEditor.editor.cm;
		const at = view.state.doc.toString().indexOf('## Sezione 13');
		window.iwFrames = [];
		const start = performance.now();
		const tick = () => {
			window.iwFrames.push(view.coordsAtPos(at)?.top);
			if (performance.now() - start < 1000) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	const leave = await page.evaluate(() => {
		const line = [...document.querySelectorAll('.cm-content .cm-line')].find(l => l.textContent.includes('Sezione 13'));
		const box = line.getBoundingClientRect();
		return { x: box.left + 60, y: box.top + box.height / 2 };
	});
	await page.waitForTimeout(100);
	await page.mouse.click(leave.x, leave.y);
	await page.waitForTimeout(1100);
	const left = await page.evaluate(() => {
		const view = window.app.workspace.activeEditor.editor.cm;
		const text = view.state.doc.toString();
		const wrapFrom = text.indexOf('[wrap:start]', text.indexOf('## Sezione 12'));
		return { frames: window.iwFrames, drawn: [...document.querySelectorAll('.cm-content .iw-preview:not(.iw-row-preview)')].some(w => view.posAtDOM(w) === wrapFrom) };
	});
	assert.ok(left.drawn, 'il wrap è di nuovo disegnato');
	assert.ok(Math.max(...left.frames) - Math.min(...left.frames) <= 1, `uscita: la riga cliccata si è mossa (${[...new Set(left.frames.map(Math.round))].join(', ')})`);
});

test('Live Preview: aprire una riga di immagini non sposta il punto cliccato', async () => {
	const { page } = obsidian;
	await open('Misto.md', 'live');
	await page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(0, 0));
	await page.waitForTimeout(800);
	await placeLongBlock('## Sezione 20', '![[a.png|200]]', 350);
	const row = await clickAndMeasureLongBlock('## Sezione 20', '![[a.png|200]]', '.cm-content .iw-row-preview', null, true);
	assert.equal(row.after.head, row.before.start, 'il cursore all’inizio della riga di immagini');
	assert.ok(Math.abs(row.after.top - row.before.top) <= 1, `riga: da ${row.before.top} a ${row.after.top}`);
});

// Entering from an empty point of a block keeps the block, and everything
// above it, where it was in every frame; three entries, each left with a click
// above, leave the block where it started (previously each entry moved a row up by
// the images Obsidian shows on its source line, a wrap by its marker lines).
const emptyPointEntry = async kind => {
	const { page } = obsidian;
	return page.evaluate(kind => {
		const view = window.app.workspace.activeEditor.editor.cm;
		const text = view.state.doc.toString();
		const reference = text.indexOf(kind === 'row' ? 'Sopra la riga.' : 'Sopra il wrap.');
		const start = text.indexOf(kind === 'row' ? '![[a.png|200]] ![[b.png|200]]' : '[wrap:start]', reference);
		const root = [...document.querySelectorAll('.workspace-leaf.mod-active .cm-content .iw-preview')].find(e => view.posAtDOM(e) === start);
		const r = root.getBoundingClientRect();
		const right = [...root.querySelectorAll('img')].map(e => e.getBoundingClientRect().right).reduce((a, b) => Math.max(a, b), r.left);
		const candidates = kind === 'row'
			? [0.5, 0.65, 0.8].map(f => ({ x: right + (r.right - right) * f, y: r.top + r.height / 2 }))
			: [[30, 8], [60, 8], [30, 2], [60, 2]].map(([dx, dy]) => ({ x: r.right - dx, y: r.bottom - dy }));
		const point = candidates.find(p => {
			const e = document.elementFromPoint(p.x, p.y);
			return e && root.contains(e) && !e.closest('img, .iw-row-handle, .iw-wrap-handle, .iw-block-toolbar') && !(e.tagName === 'P' && !e.classList.contains('iw-row'));
		});
		return { start, reference, top: r.top, point };
	}, kind);
};
// The images on screen loaded (the note starts with text only).
const imagesShown = () => obsidian.page.waitForFunction(selector => {
	const images = [...document.querySelectorAll(`${selector} .image-embed`)];
	return images.length > 0 && images.every(image => image.classList.contains('is-loaded'));
}, container('live'), { timeout: 15000 }).then(() => obsidian.page.waitForTimeout(300));
const framesDuring = async (positions, action) => {
	const { page } = obsidian;
	await page.evaluate(positions => {
		const view = window.app.workspace.activeEditor.editor.cm;
		window.iwFrames = [];
		const t0 = performance.now();
		const tick = () => {
			window.iwFrames.push(positions.map(p => view.coordsAtPos(p)?.top ?? null));
			if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, positions);
	await page.waitForTimeout(50);
	await action();
	await page.waitForTimeout(1100);
	return page.evaluate(() => window.iwFrames);
};

for (const [kind, label, reference, skip] of [['row', 'una riga di immagini', 'Sopra la riga.', '![[a.png|200]]'], ['wrap', 'un wrap', 'Sopra il wrap.', '[wrap:start]']]) {
	test(`Live Preview: entrando da un punto vuoto di ${label}, la nota resta ferma in ogni fotogramma`, async () => {
		const { page } = obsidian;
		await openNote(page, 'Ingresso.md', 'live');
		await page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(0, 0));
		await placeLongBlock(reference, skip, 350);
		await imagesShown();
		const block = await emptyPointEntry(kind);
		assert.ok(block.point, 'un punto vuoto nel blocco');
		const frames = await framesDuring([block.reference], () => page.mouse.click(block.point.x, block.point.y));
		const tops = frames.map(f => Math.round(f[0]));
		assert.ok(Math.max(...tops) - Math.min(...tops) <= 1, `il testo sopra si è mosso (${[...new Set(tops)].join(', ')})`);
		const after = await page.evaluate(start => {
			const view = window.app.workspace.activeEditor.editor.cm;
			return { line: view.documentTop + view.lineBlockAt(start).top, head: view.state.selection.main.head };
		}, block.start);
		assert.ok(after.head >= block.start, 'il cursore nel blocco');
		assert.ok(Math.abs(after.line - block.top) <= 1, `la prima riga del blocco da ${block.top} a ${after.line}`);
	});
}

// A row drawn again starts at its last known height. Saved rounded (275 for
// 274.67), the row took its real height a frame after being drawn and moved
// everything below by the difference. Tolerance 0.02 px: Chromium lays
// out in 1/64 px (0.016), so positions differ by at least that when anything
// moves; the shift measured before the fix was 0.07 px in this app (0.1 px on
// Windows), well above it.
test('Live Preview: uscendo da sotto, la riga di immagini ridisegnata non si muove più e non si aggiorna di continuo', async () => {
	const { page } = obsidian;
	await openNote(page, 'Ingresso.md', 'live');
	await page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(0, 0));
	await placeLongBlock('Sopra la riga.', '![[a.png|200]]', 300);
	await imagesShown();
	const block = await emptyPointEntry('row');
	const image = await page.evaluate(start => {
		const view = window.app.workspace.activeEditor.editor.cm;
		const root = [...document.querySelectorAll('.workspace-leaf.mod-active .cm-content .iw-row-preview')].find(e => view.posAtDOM(e) === start);
		const r = root.querySelector('img').getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	}, block.start);
	await page.mouse.click(image.x, image.y);
	await page.waitForTimeout(800);
	const below = await page.evaluate(() => {
		const view = window.app.workspace.activeEditor.editor.cm;
		const at = view.state.doc.toString().indexOf('Sotto la riga.');
		const c = view.coordsAtPos(at);
		return { at, x: c.left + 25, y: (c.top + c.bottom) / 2 };
	});
	// Every frame, unrounded: the clicked line below and the drawn row's height;
	// every change of the row's saved height.
	await page.evaluate(({ start, at }) => {
		const view = window.app.workspace.activeEditor.editor.cm;
		window.iwFrames = [];
		window.iwHeightReports = [];
		const t0 = performance.now();
		window.iwReports = new MutationObserver(records => {
			for (const record of records) if (record.attributeName === 'data-iw-row-height') window.iwHeightReports.push(performance.now() - t0);
		});
		window.iwReports.observe(view.contentDOM, { attributes: true, subtree: true, attributeFilter: ['data-iw-row-height'] });
		const tick = () => {
			const root = [...document.querySelectorAll('.workspace-leaf.mod-active .cm-content .iw-row-preview')].find(e => { try { return view.posAtDOM(e) === start; } catch { return false; } });
			window.iwFrames.push({ t: performance.now() - t0, drawn: Boolean(root), id: root ? (root.dataset.iwProbe ??= String(Math.random())) : null,
				height: root ? root.getBoundingClientRect().height : null, below: view.coordsAtPos(at)?.top ?? null });
			if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, { start: block.start, at: below.at });
	await page.waitForTimeout(50);
	await page.mouse.click(below.x, below.y);
	await page.waitForTimeout(1300);
	const { frames, reports } = await page.evaluate(() => { window.iwReports.disconnect(); return { frames: window.iwFrames, reports: window.iwHeightReports }; });
	const drawn = frames.filter(f => f.drawn);
	assert.ok(drawn.length > 20, `la riga ridisegnata (${drawn.length} fotogrammi)`);
	const spread = values => Math.max(...values) - Math.min(...values);
	assert.ok(spread(drawn.map(f => f.below)) <= 0.02, `la riga sotto si è mossa dopo il ridisegno: ${[...new Set(drawn.map(f => f.below.toFixed(2)))].join(' → ')}`);
	assert.ok(spread(drawn.map(f => f.height)) <= 0.02, `la riga di immagini ha cambiato altezza: ${[...new Set(drawn.map(f => f.height.toFixed(2)))].join(' → ')}`);
	assert.equal(new Set(drawn.map(f => f.id)).size, 1, 'la riga non viene ridisegnata di nuovo');
	const t0 = drawn[0].t;
	assert.ok(reports.filter(t => t > t0 + 200).length === 0, `aggiornamenti dell'altezza dopo il ridisegno: ${reports.map(t => Math.round(t)).join(', ')}`);
});

// Leaving from below, the clicked line and what is below it keep their screen
// pixel. The browser scrolls by whole device pixels and draws each position
// rounded to the nearest one: a height change of 11.6 px compensated by 12
// brought them down a pixel, on Windows at every exit. Where the
// rounding falls depends on the editor's sub-pixel place (78.484 px on that
// Windows): the editor is moved by eighths of a pixel, and the app zoomed,
// so that some exits cross a half pixel whatever the height change. Where a
// line of text is whole device pixels (zoom 1 and 1.25: 24 and 30) the
// clicked line keeps its pixel, and at zoom 1 also the wrap's image further
// down, which shares its sub-pixel place. Zoomed to 1.1 (26.4 device pixels
// a line) every line has its own fraction: there the scroll is the nearest
// one, the clicked line moving by at most half a device pixel (keeping it
// exactly moved the lines below more often). In the frames after the redraw
// nothing moves (0.02 px, as above), the scroll changes once and the clicked
// line moves by less than a device pixel (no extra drift: the scroll also
// takes in the lines above that CodeMirror measures again, zoomed).
test('Live Preview: uscendo da sotto, la riga cliccata e ciò che sta sotto restano sullo stesso pixel', async () => {
	const { page } = obsidian;
	await openNote(page, 'Ingresso.md', 'live');
	const failures = [];
	let exits = 0;
	try {
		for (const zoom of [1, 1.25, 1.1]) for (let eighth = 0; eighth < 8; eighth++) {
			const shift = eighth / 8;
			await page.evaluate(({ zoom, shift }) => {
				require('electron').webFrame.setZoomFactor(zoom);
				const style = document.getElementById('iw-test-fase') ?? document.head.createEl('style', { attr: { id: 'iw-test-fase' } });
				style.textContent = `.workspace-leaf.mod-active .view-header { height: calc(var(--header-height) + ${shift}px) !important; }`;
				window.app.workspace.activeEditor.editor.setCursor(0, 0);
			}, { zoom, shift });
			// High enough that, zoomed, the line below the row's source stays on screen.
			await placeLongBlock('Sopra la riga.', '![[a.png|200]]', 150);
			await imagesShown();
			const block = await emptyPointEntry('row');
			const image = await page.evaluate(start => {
				const view = window.app.workspace.activeEditor.editor.cm;
				const root = [...document.querySelectorAll('.workspace-leaf.mod-active .cm-content .iw-row-preview')].find(e => view.posAtDOM(e) === start);
				const r = root.querySelector('img').getBoundingClientRect();
				return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
			}, block.start);
			await page.mouse.click(image.x, image.y);
			await page.waitForTimeout(600);
			// The clicked line, the first image below it and the scroll, every
			// frame from before the click; the row's drawn height.
			const below = await page.evaluate(start => {
				const view = window.app.workspace.activeEditor.editor.cm;
				const text = view.state.doc.toString();
				const at = text.indexOf('Sotto la riga.');
				const next = text.indexOf('[wrap:start]', at);
				const c = view.coordsAtPos(at);
				window.iwFrames = [];
				const t0 = performance.now();
				const tick = () => {
					const root = [...document.querySelectorAll('.workspace-leaf.mod-active .cm-content .iw-preview')];
					const row = root.find(e => { try { return view.posAtDOM(e) === start; } catch { return false; } });
					const wrap = root.find(e => { try { return view.posAtDOM(e) === next; } catch { return false; } });
					window.iwFrames.push({ drawn: Boolean(row), line: view.coordsAtPos(at)?.top ?? null, image: wrap?.querySelector('img')?.getBoundingClientRect().top ?? null,
						scroll: view.scrollDOM.scrollTop, height: view.lineBlockAt(start).height });
					if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
				const line = view.defaultLineHeight * devicePixelRatio;
				return { x: c.left + 25, y: (c.top + c.bottom) / 2, scale: devicePixelRatio, whole: Math.abs(line - Math.round(line)) <= 0.02 };
			}, block.start);
			await page.waitForTimeout(100);
			await page.mouse.click(below.x, below.y);
			await page.waitForTimeout(1000);
			const frames = await page.evaluate(() => window.iwFrames);
			const before = frames.filter(f => !f.drawn).at(-1);
			const after = frames.filter(f => f.drawn);
			const pixel = value => Math.round(value * below.scale);
			const spread = values => Math.max(...values) - Math.min(...values);
			const where = `zoom ${zoom}, editor spostato di ${shift} px`;
			exits++;
			assert.ok(before && after.length > 20, `${where}: la riga di Markdown e poi la riga ridisegnata (${frames.length} fotogrammi, ${after.length} con la riga disegnata, clic a ${Math.round(below.x)},${Math.round(below.y)})`);
			assert.equal(below.whole, zoom !== 1.1, `${where}: righe di testo di pixel interi`);
			const kept = below.whole
				? after.every(f => pixel(f.line) === pixel(before.line)) && (zoom !== 1 || after.every(f => pixel(f.image) === pixel(before.image)))
				: Math.abs(after[0].line - before.line) * below.scale <= 0.52;
			if (!kept) {
				failures.push(`${where}: riga cliccata ${before.line.toFixed(3)} → ${after[0].line.toFixed(3)}, immagine sotto ${before.image.toFixed(3)} → ${after[0].image.toFixed(3)}`);
			}
			assert.ok(spread(after.map(f => f.line)) <= 0.02 && spread(after.map(f => f.image)) <= 0.02, `${where}: si muove dopo il ridisegno`);
			assert.equal(new Set(after.map(f => f.scroll)).size, 1, `${where}: lo scorrimento cambia dopo il ridisegno`);
			assert.ok(Math.abs(after[0].line - before.line) < 1 / below.scale, `${where}: la riga cliccata da ${before.line} a ${after[0].line} (scorrimento ${before.scroll} → ${after[0].scroll})`);
		}
	} finally {
		await page.evaluate(() => { require('electron').webFrame.setZoomFactor(1); document.getElementById('iw-test-fase')?.remove(); });
	}
	assert.deepEqual(failures, [], `${failures.length} uscite su ${exits} cambiano pixel (con lo zoom: la riga cliccata si sposta di più di mezzo pixel)`);
});

test('Live Preview: tre ingressi da un punto vuoto, ciascuno chiuso con un clic sopra, non spostano la riga di immagini', async () => {
	const { page } = obsidian;
	await openNote(page, 'Ingresso.md', 'live');
	await page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(0, 0));
	await placeLongBlock('Sopra la riga.', '![[a.png|200]]', 350);
	await imagesShown();
	const first = await emptyPointEntry('row');
	for (let cycle = 1; cycle <= 3; cycle++) {
		const block = await emptyPointEntry('row');
		assert.ok(Math.abs(block.top - first.top) <= 1, `ciclo ${cycle}: la riga da ${first.top} a ${block.top}`);
		await page.mouse.click(block.point.x, block.point.y);
		await page.waitForTimeout(600);
		// Out with a click on the line above (what is above stays).
		const above = await page.evaluate(reference => {
			const c = window.app.workspace.activeEditor.editor.cm.coordsAtPos(reference);
			return { x: c.left + 30, y: c.top + 6 };
		}, block.reference);
		await page.mouse.click(above.x, above.y);
		await page.waitForTimeout(600);
	}
	const last = await emptyPointEntry('row');
	assert.ok(Math.abs(last.top - first.top) <= 1, `dopo tre cicli la riga da ${first.top} a ${last.top}`);
});

// A click on a list item, a quote, code or a table inside a wrap puts the
// caret at the start of that block's text, not on the wrap's image.
test('Live Preview: un clic su elenco, citazione, codice o tabella in un wrap va all’inizio del suo testo', async () => {
	const { page } = obsidian;
	await open('Blocchi.md', 'live');
	// The caret goes to the start of the text, after the Markdown marks.
	const cases = [['li', 'secondo livello', 'secondo livello'], ['blockquote', 'Citazione.', 'Citazione.'],
		['pre', 'const x', 'const x = 1;'], ['td', '1', '1 | 2 |']];
	for (const [selector, text, expected] of cases) {
		await page.evaluate(() => { const editor = window.app.workspace.activeEditor.editor; editor.setCursor(editor.lastLine(), 0); });
		await page.waitForTimeout(600);
		// The caret on the last line scrolled to the end: the block back on screen.
		const find = ({ selector, text }) => [...document.querySelectorAll(`.cm-content .iw-preview ${selector}`)]
			.find(e => e.textContent.trim().startsWith(text) && !e.querySelector(selector));
		await page.evaluate(({ source, args }) => eval(`(${source})`)(args)?.scrollIntoView({ block: 'center' }), { source: find.toString(), args: { selector, text } });
		await page.waitForTimeout(400);
		const box = await page.evaluate(({ source, args }) => {
			const r = eval(`(${source})`)(args)?.getBoundingClientRect();
			return r && { x: r.left + Math.min(r.width / 2, 60), y: r.top + Math.min(r.height / 2, 10) };
		}, { source: find.toString(), args: { selector, text } });
		assert.ok(box, `${selector} «${text}» disegnato nel wrap`);
		await page.mouse.click(box.x, box.y);
		await page.waitForTimeout(600);
		const rest = await page.evaluate(() => { const view = window.app.workspace.activeEditor.editor.cm; const head = view.state.selection.main.head; return view.state.sliceDoc(head, view.state.doc.lineAt(head).to); });
		assert.equal(rest, expected, `clic su ${selector} «${text}»`);
	}
});

// Top-level lists, quotes and code blocks under `root`, and whether each
// overlaps the box of a wrap's image. Serialized into the print window too.
// Reading keeps the native sections of a wrap it draws whole, hidden: skipped.
function blockOverlaps(root) {
	const images = [...root.querySelectorAll('.image-embed.iw-left, .image-embed.iw-right')].map(image => image.getBoundingClientRect());
	return [...root.querySelectorAll('ul, ol, blockquote, pre')]
		.filter(block => !block.parentElement.closest('ul, ol, blockquote, pre') && !block.closest('.iw-section-hidden'))
		.map(block => {
			const box = block.getBoundingClientRect();
			return { block: block.tagName.toLowerCase(), overlaps: images.some(image =>
				box.top < image.bottom - 1 && box.bottom > image.top + 1 && box.left < image.right - 1 && box.right > image.left + 1) };
		});
}

for (const mode of ['live', 'reading']) {
	test(`blocchi nativi accanto all’immagine di un wrap, senza passarle sotto (${mode})`, async () => {
		await open('Blocchi.md', mode);
		const blocks = await obsidian.page.evaluate(({ selector, source }) => {
			// eslint-disable-next-line no-eval
			return eval(`(${source})`)(document.querySelector(selector));
		}, { selector: container(mode), source: blockOverlaps.toString() });
		assert.deepEqual(blocks.map(block => block.block), ['ul', 'blockquote', 'pre'], JSON.stringify(blocks));
		assert.deepEqual(blocks.filter(block => block.overlaps), [], 'nessun blocco sotto l’immagine');
	});
}

// Exports `path` to PDF with Obsidian's own command and returns
// `measure(view, popup)`, taken in the print window while it exists (it closes
// once the PDF is written), with the PDF's path.
async function exportPdf(path, file, measure) {
	const { page } = obsidian;
	const pdf = join(shots, file);
	await rm(pdf, { force: true });
	await openNote(page, path, 'reading');
	try {
		// Obsidian asks where to save with the system dialog, then draws the note in
		// a hidden window and prints it: the dialog gets a fixed path, the window is
		// measured while it exists.
		await page.evaluate(({ filePath, source }) => {
			// eslint-disable-next-line no-eval
			const measure = eval(`(${source})`);
			// Each step leaves a trace, for the message when the PDF is missing.
			window.iwPrintSteps = [];
			// `remote.dialog` is fetched anew at each read and cached only weakly:
			// without a reference of our own, the replaced one can be collected and
			// Obsidian then gets the real dialog, which waits for an answer.
			window.iwDialog = window.require('electron').remote.dialog;
			window.iwDialog.showSaveDialog = async () => { window.iwPrintSteps.push('percorso'); return { canceled: false, filePath }; };
			const open = window.open;
			window.iwRestorePrint = () => { window.open = open; };
			window.iwPrint = null;
			window.open = function (...args) {
				const popup = open.apply(this, args);
				window.iwPrintSteps.push('finestra');
				const take = () => {
					if (popup.closed) { clearInterval(timer); return; }
					const view = popup.document.querySelector('.print .markdown-preview-view');
					if (!view?.querySelector('.image-embed')) return;
					window.iwPrint = measure(view, popup);
				};
				// A window being closed can throw "illegal access" when read.
				const timer = setInterval(() => { try { take(); } catch { clearInterval(timer); } }, 50);
				return popup;
			};
		}, { filePath: pdf, source: measure.toString() });
		await page.evaluate(() => window.app.commands.executeCommandById('workspace:export-pdf'));
		// Playwright waits for an actionable button. The intercepted save dialog
		// records `percorso`, which proves this click (not an old idle state) ran.
		const exportButton = page.locator('.modal-container button.mod-cta');
		await exportButton.waitFor({ timeout: 10000 });
		await exportButton.click();
		await page.waitForFunction(() => window.iwPrintSteps.includes('percorso'), null, { timeout: 5000 });
		let size = 0, previous = -1, stable = 0;
		for (let i = 0; i < 80 && stable < 3; i++) {
			await page.waitForTimeout(250);
			size = (await stat(pdf).catch(() => ({ size: 0 }))).size;
			stable = size > 5000 && size === previous ? stable + 1 : 0;
			previous = size;
		}
		if (!(size > 5000)) {
			const state = await page.evaluate(() => ({ steps: window.iwPrintSteps,
				dialog: Array.from(document.querySelectorAll('.modal-container button')).map(button => `${button.textContent} [${button.className}]`) }));
			assert.fail(`PDF scritto (${size} byte); passi: ${state.steps.join(', ') || 'nessuno'}; finestra di esportazione: ${state.dialog.join(' | ') || 'chiusa'}`);
		}
		await page.waitForFunction(() => window.iwPrint !== null, null, { timeout: 5000 });
		const printed = await page.evaluate(() => window.iwPrint);
		assert.ok(printed, 'finestra di stampa misurata');
		return { printed, pdf };
	} finally {
		// Whatever happened, no export dialog stays over the page for the next
		// tests: Esc closes Obsidian's dialogs (this one has no close button).
		await page.evaluate(() => window.iwRestorePrint?.());
		for (let i = 0; i < 3 && await page.locator('.modal-container').count(); i++) {
			const before = await page.locator('.modal-container').count();
			await page.keyboard.press('Escape');
			await page.waitForFunction(before => document.querySelectorAll('.modal-container').length < before, before, { timeout: 5000 }).catch(() => {});
		}
	}
}

let rowsPdf;
const exportRowsPdf = () => rowsPdf ??= exportPdf('Stampa.md', 'stampa.pdf', (view, popup) => {
	const box = element => { const { left, right, top, bottom, width } = element.getBoundingClientRect(); return { left, right, top, bottom, width }; };
	const paragraph = view.querySelector('.iw-first-paragraph');
	const range = popup.document.createRange();
	if (paragraph) range.selectNodeContents(paragraph);
	return {
		rows: [...view.querySelectorAll('p.iw-row')].map(row => ({ cls: row.className, box: box(row), images: [...row.querySelectorAll('.image-embed')].map(box) })),
		wrap: [...view.querySelectorAll('.image-embed.iw-left')].map(image => ({ float: popup.getComputedStyle(image).float, box: box(image) })),
		lines: paragraph ? [...range.getClientRects()].map(({ left, top }) => ({ left, top })) : [],
		markers: (view.textContent.match(/\[wrap:(start|end)\]/g) ?? []).length,
	};
});
test('PDF: righe di immagini impaginate', async () => {
	const { printed } = await exportRowsPdf();
	const [first, centered] = printed.rows;
	assert.equal(printed.rows.length, 2);
	assert.match(first.cls, /iw-row-align-left/);
	assert.match(centered.cls, /iw-row-align-center/);
	const [a, b, c] = first.images;
	assert.ok(Math.abs(b.top - a.top) < 1 && Math.abs(c.top - a.top) < 1, 'immagini della riga alla stessa altezza');
	assert.ok(a.right <= b.left && b.right <= c.left, 'immagini affiancate');
	assert.ok(Math.abs(b.width / a.width - 1.5) < 0.02, 'larghezze nel rapporto 200:300:200');
	const [image] = centered.images;
	assert.ok(Math.abs((image.left + image.right) / 2 - (centered.box.left + centered.box.right) / 2) < 2, 'align=center');
});
test('PDF: wrap impaginato e marcatori rimossi', async () => {
	const { printed, pdf } = await exportRowsPdf();
	const [wrap] = printed.wrap;
	assert.equal(wrap?.float, 'left');
	const beside = printed.lines.filter(line => line.top < wrap.box.bottom - 1);
	assert.ok(beside.length > 0 && beside.every(line => line.left >= wrap.box.right), 'testo accanto all’immagine del wrap');
	assert.equal(printed.markers, 0, 'marcatori tolti');
	const { page } = obsidian;
	await copyFile(pdf, join(vault, 'stampa.pdf'));
	await page.waitForFunction(() => window.app.vault.getFileByPath('stampa.pdf') !== null, null, { timeout: 10000 });
	await page.evaluate(async () => { await window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath('stampa.pdf')); });
	await page.waitForFunction(() => window.app.workspace.getActiveFile()?.path === 'stampa.pdf'
		&& [...document.querySelectorAll('canvas')].some(canvas => canvas.width > 0 && canvas.height > 0 && canvas.getBoundingClientRect().width > 0), null, { timeout: 15000 });
	await page.screenshot({ path: join(shots, 'stampa-pdf.png') });
});

let blocksPdf;
const exportBlocksPdf = () => {
	if (!blocksPdf) {
		const source = blockOverlaps.toString();
		blocksPdf = exportPdf('Blocchi.md', 'blocchi.pdf', new Function('view', `
			const images = [...view.querySelectorAll('.image-embed.iw-left')].map(image => image.getBoundingClientRect());
			const after = [...view.querySelectorAll('p')].find(p => p.textContent.trim() === 'Fine.');
			return { blocks: (${source})(view), afterTop: after?.getBoundingClientRect().top, lastImageBottom: images.at(-1)?.bottom };`));
	}
	return blocksPdf;
};
test('PDF: blocchi nativi accanto al wrap', async () => {
	const { printed } = await exportBlocksPdf();
	const { blocks } = printed;
	assert.deepEqual(blocks.map(block => block.block), ['ul', 'blockquote', 'pre'], JSON.stringify(blocks));
	assert.deepEqual(blocks.filter(block => block.overlaps), [], 'nessun blocco sotto l’immagine');
});
test('PDF: dopo una tabella il testo continua sotto l’immagine', async () => {
	const { printed } = await exportBlocksPdf();
	assert.ok(printed.afterTop >= printed.lastImageBottom - 1, `dopo una tabella il testo va sotto l’immagine (${printed.afterTop} < ${printed.lastImageBottom})`);
});

// CodeMirror places line numbers from its height map: every visible line
// block must be as tall, and as high up, as its DOM (the 0.12.17 drift).
const heightDrift = () => obsidian.page.evaluate(() => {
	const view = window.app.workspace.activeEditor.editor.cm;
	let worst = 0;
	for (const block of view.viewportLineBlocks) {
		const node = view.domAtPos(block.from).node;
		const line = (node.nodeType === 1 ? node : node.parentElement).closest('.cm-line');
		if (!line) continue;
		const rect = line.getBoundingClientRect();
		worst = Math.max(worst, Math.abs(rect.top - view.documentTop - block.top), Math.abs(rect.height - block.height));
	}
	return worst;
});

test('Live Preview: altezze allineate ai numeri di riga dopo ogni azione', async () => {
	const { page } = obsidian;
	await page.evaluate(() => window.app.vault.setConfig('showLineNumber', true));
	try {
		await open('Misto.md', 'live');
		const steps = {
		apertura: async () => {},
		'dentro una riga': () => page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(4, 2)),
		'fuori dalla riga': () => page.evaluate(() => { const e = window.app.workspace.activeEditor.editor; e.setCursor(e.lastLine(), 0); e.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }); }),
		'dentro un wrap': () => page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(10, 2)),
		'fuori dal wrap': () => page.evaluate(() => { const e = window.app.workspace.activeEditor.editor; e.setCursor(e.lastLine(), 0); e.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }); }),
		'distanza cambiata': () => page.evaluate(async () => { const store = window.app.plugins.plugins['image-rows-and-wraps'].store; await store.change({ ...store.current, rowGap: 40 }); await new Promise(r => setTimeout(r, 400)); await store.change({ ...store.current, rowGap: 12 }); }),
		'plugin disattivato e riattivato': () => page.evaluate(async () => { await window.app.plugins.disablePlugin('image-rows-and-wraps'); await window.app.plugins.enablePlugin('image-rows-and-wraps'); }),
		};
		const drift = {};
		for (const [name, step] of Object.entries(steps)) {
			await step();
			await page.waitForTimeout(1200);
			drift[name] = Math.round(await heightDrift() * 10) / 10;
		}
		await page.screenshot({ path: join(shots, 'misto-live.png') });
		for (const [name, value] of Object.entries(drift)) assert.ok(value <= 1, `${name}: scarto ${value} px (${JSON.stringify(drift)})`);
	} finally {
		await page.evaluate(() => window.app.vault.setConfig('showLineNumber', false));
	}
});

test('Lettura: scorrendo una nota con righe e wrap il testo non scatta', async () => {
	const { page } = obsidian;
	await open('Misto.md', 'reading');
	const jumps = await page.evaluate(async () => {
		const scroller = document.querySelector('.workspace-leaf.mod-active .markdown-preview-view');
		const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		// A heading on screen: after scrolling by d it must have moved by exactly -d.
		const anchor = () => [...scroller.querySelectorAll('h2')].find(h => { const r = h.getBoundingClientRect(); const s = scroller.getBoundingClientRect(); return r.top > s.top + 50 && r.bottom < s.bottom - 50; });
		const found = [];
		let steps = 0;
		for (const direction of [1, -1]) {
			for (let i = 0; i < 400; i++) {
				const heading = anchor();
				const before = heading?.getBoundingClientRect().top;
				const start = scroller.scrollTop;
				scroller.scrollTop += direction * 250;
				await frame();
				await new Promise(resolve => setTimeout(resolve, 30));
				const moved = scroller.scrollTop - start;
				if (moved === 0) break;
				steps++;
				if (heading?.isConnected) {
					const error = heading.getBoundingClientRect().top - (before - moved);
					if (Math.abs(error) > 2) found.push({ at: Math.round(start), error: Math.round(error), text: heading.textContent });
				}
			}
		}
		return { steps, found };
	});
	await page.screenshot({ path: join(shots, 'misto-reading.png') });
	assert.ok(jumps.steps > 20, `scorrimento effettuato (${jumps.steps} passi)`);
	assert.deepEqual(jumps.found, [], 'nessuno scatto');
});

// The first row of images of the live note, every frame for 1.5 s while
// `act` runs: whether it stays the same element, and the image widths it shows,
// in order. No jump: at most the starting widths and the final ones (the first
// frame may already show the final ones).
async function watchRowFrames(act) {
	const { page } = obsidian;
	await page.evaluate(selector => {
		const row = () => document.querySelector(`${selector} .iw-row-preview`);
		const first = row();
		const seen = { replaced: false, widths: [] };
		window.iwWatch = seen;
		const start = performance.now();
		const tick = () => {
			const now = row();
			if (now !== first) seen.replaced = true;
			const widths = now ? [...now.querySelectorAll('.image-embed')].map(embed => Math.round(embed.getBoundingClientRect().width)).join(',') : '';
			if (seen.widths[seen.widths.length - 1] !== widths) seen.widths.push(widths);
			if (performance.now() - start < 1500) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, container('live'));
	await act();
	await page.waitForTimeout(1700);
	return page.evaluate(() => window.iwWatch);
}

test('Annulla e Ripeti dopo un ridimensionamento: la riga non viene ridisegnata e non scatta', async () => {
	const { page } = obsidian;
	await open('Annulla.md', 'live');
	const before = await editorText();
	// Narrowing a.png lowers the row: its height changes, and before 0.26.43 the
	// height reported after Undo redrew the row, whose images showed for a frame
	// at their unscaled size.
	const embed = page.locator(`${container('live')} .iw-row-preview p.iw-row`).first().locator('.internal-embed').first();
	await embed.hover();
	const box = await embed.locator('.iw-row-handle').boundingBox();
	const x = box.x + box.width / 2, y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	for (let step = 1; step <= 8; step++) { await page.mouse.move(x - step * 6, y); await page.waitForTimeout(40); }
	await page.mouse.up();
	await page.mouse.move(x, y + 400);
	await page.waitForTimeout(800);
	const resized = await editorText();
	assert.notEqual(resized, before, 'ridimensionata');
	const undone = await watchRowFrames(() => page.keyboard.press('Control+z'));
	assert.equal(await editorText(), before);
	assert.equal(undone.replaced, false, 'Annulla: la riga non viene ricreata');
	assert.ok(undone.widths.length <= 2, `Annulla: dalle misure ridimensionate a quelle finali, niente in mezzo (${undone.widths.join(' → ')})`);
	const redone = await watchRowFrames(() => page.keyboard.press('Control+Shift+z'));
	assert.equal(await editorText(), resized);
	assert.equal(redone.replaced, false, 'Ripeti: la riga non viene ricreata');
	assert.ok(redone.widths.length <= 2, `Ripeti: niente misure in mezzo (${redone.widths.join(' → ')})`);
});

test('distanza dalla barra, e il suo Annulla: la riga non viene ridisegnata e non scatta', async () => {
	const { page } = obsidian;
	await open('Distanza.md', 'live');
	const before = await editorText();
	const row = page.locator(`${container('live')} .iw-row-preview`).first();
	// A new gap changes the row's height: before 0.26.44 the height reported
	// after the change redrew the row.
	const chosen = await watchRowFrames(async () => {
		await row.hover();
		await row.locator('.iw-row-toolbar button[aria-label="Gap between images"]').click();
		await page.locator('.menu .menu-item', { hasText: '48 px' }).first().click();
		await page.mouse.move(10, 10);
	});
	assert.match((await editorText()).split('\n')[2], /gap=48/);
	assert.equal(chosen.replaced, false, 'scelta: la riga non viene ricreata');
	assert.ok(chosen.widths.length <= 2, `scelta: niente misure in mezzo (${chosen.widths.join(' → ')})`);
	const undone = await watchRowFrames(() => page.keyboard.press('Control+z'));
	assert.equal(await editorText(), before);
	assert.equal(undone.replaced, false, 'Annulla: la riga non viene ricreata');
	assert.ok(undone.widths.length <= 2, `Annulla: niente misure in mezzo (${undone.widths.join(' → ')})`);
});

test('Live Preview: righe di immagini e wrap stanno a una riga vuota dal testo, come i blocchi di Obsidian', async () => {
	const { page } = obsidian;
	await open('Spazi.md', 'live');
	await page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(0, 0));
	await page.waitForTimeout(800);
	// Text to the nearest visible image or text of the block, above and below.
	// Before 0.26.46 CodeMirror's caret buffers beside the widgets took a line
	// each, and the row's paragraph kept its margins: about 70 px.
	const gaps = await page.evaluate(selector => {
		const content = document.querySelector(`${selector} .cm-content`);
		const textBox = text => {
			const line = [...content.querySelectorAll('.cm-line')].find(node => node.textContent.trim() === text);
			const range = document.createRange(); range.selectNodeContents(line); return range.getBoundingClientRect();
		};
		const block = preview => {
			const boxes = [...preview.querySelectorAll('img, p')].filter(el => el.checkVisibility()).map(el => el.getBoundingClientRect()).filter(box => box.height);
			return { top: Math.min(...boxes.map(box => box.top)), bottom: Math.max(...boxes.map(box => box.bottom)) };
		};
		const row = block(content.querySelector('.iw-row-preview'));
		const wrap = block(content.querySelector('.iw-preview:not(.iw-row-preview)'));
		const [first, second, third] = ['Primo paragrafo.', 'Secondo paragrafo.', 'Terzo paragrafo.'].map(textBox);
		return [row.top - first.bottom, second.top - row.bottom, wrap.top - second.bottom, third.top - wrap.bottom].map(Math.round);
	}, container('live'));
	// One blank line (24 px) and the widget's own 4 px, with a little slack.
	for (const gap of gaps) assert.ok(gap >= 20 && gap <= 36, `spazi ${gaps.join(', ')} px`);
});

test('resize riga: gesto completo, update in-place, salvataggio e singolo Undo', async () => {
	const { page } = obsidian;
	await open('Maniglia.md', 'live');
	const before = await editorText();
	// b.png (300 x 400) is the tallest image of the first row: in 0.21-0.24 a
	// height report during the gesture redrew the row and stopped the handle.
	const embed = page.locator(`${container('live')} .iw-row-preview p.iw-row`).first().locator('.internal-embed').nth(1);
	await embed.hover();
	const handle = embed.locator('.iw-row-handle');
	const box = await handle.boundingBox();
	assert.ok(box, 'maniglia presente');
	const x = box.x + box.width / 2, y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	for (let step = 1; step <= 8; step++) { await page.mouse.move(x - step * 8, y); await page.waitForTimeout(60); }
	// Released with the pointer on the handle, where a hand ends up (the handle
	// follows the pointer: a few moves to settle on it).
	let endX = 0, endY = 0;
	for (let i = 0; i < 4; i++) {
		const end = await handle.boundingBox();
		endX = end.x + end.width / 2; endY = end.y + end.height / 2;
		await page.mouse.move(endX, endY);
		await page.waitForTimeout(100);
	}
	await handle.evaluate(el => { el.dataset.iwBefore = '1'; });
	// From the release on, the row is updated in place: never drawn again from
	// scratch (up to 0.26.12 it was recreated twice and flickered).
	await page.evaluate(selector => {
		window.iwRowsCreated = 0;
		window.iwRowObserver = new MutationObserver(records => {
			for (const record of records) for (const node of record.addedNodes) {
				if (node.nodeType === 1 && (node.matches('.iw-row-preview') || node.querySelector('.iw-row-preview'))) window.iwRowsCreated++;
			}
		});
		window.iwRowObserver.observe(document.querySelector(`${selector} .cm-content`), { childList: true, subtree: true });
	}, container('live'));
	await page.mouse.up();
	await page.waitForTimeout(500);
	const created = await page.evaluate(() => { window.iwRowObserver.disconnect(); return window.iwRowsCreated; });
	assert.equal(created, 0, 'riga aggiornata senza essere ridisegnata');
	// The mouse still on the handle after the release (a hand never is: 1 px): no
	// tooltip telling to do what was just done.
	await page.mouse.move(endX, endY + 1);
	await page.waitForTimeout(1200);
	assert.deepEqual(await visibleTooltips(page), [], 'nessun suggerimento dopo il rilascio');
	// The handle under the mouse is still the same element: a new one would be
	// a fresh hover for Obsidian, with its tooltip after a second.
	assert.equal(await embed.locator('.iw-row-handle[data-iw-before]').count(), 1, 'la maniglia resta la stessa dopo il rilascio');
	assert.ok(await heightDrift() <= 1, 'numeri di riga allineati dopo il rilascio');
	const row = (await editorText()).split('\n')[2];
	const width = Number(/b\.png\|(\d+)/.exec(row)?.[1]);
	assert.ok(width < 300 && width > 150, `larghezza salvata alla fine del gesto: ${row}`);
	await undo();
	assert.equal(await editorText(), before, 'un solo passo di Annulla');
	await page.evaluate(() => { window.iwRowObserver?.disconnect(); delete window.iwRowObserver; });
});

test('resize riga: la perdita del focus annulla il gesto', async () => {
	const { page } = obsidian;
	await open('Maniglia.md', 'live');
	const before = await editorText();
	const embed = page.locator(`${container('live')} .iw-row-preview p.iw-row`).first().locator('.internal-embed').nth(1);
	await embed.hover();
	const again = await embed.locator('.iw-row-handle').boundingBox();
	let down = false;
	try {
		await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
		await page.mouse.down(); down = true;
		for (let step = 1; step <= 4; step++) { await page.mouse.move(again.x - step * 10, again.y + again.height / 2); await page.waitForTimeout(60); }
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		const resizing = await page.evaluate(() => document.body.classList.contains('iw-row-resizing'));
		await page.mouse.up(); down = false;
		await page.waitForTimeout(400);
		assert.equal(resizing, false, 'gesto finito alla perdita del focus');
		assert.equal(await editorText(), before, 'nessuna modifica');
	} finally {
		if (down) await page.mouse.up().catch(() => {});
		await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
	}
});

async function dragRowHandle(page, row, x, y) {
	await page.evaluate(() => document.querySelectorAll('.notice').forEach(notice => notice.remove()));
	await row.hover();
	const handle = await row.locator('.iw-row-toolbar .mod-move').boundingBox();
	assert.ok(handle, 'maniglia nella barra della riga');
	let down = false;
	try {
		await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await page.mouse.down(); down = true;
		for (let step = 1; step <= 10; step++) {
			await page.mouse.move(handle.x + (x - handle.x) * step / 10, handle.y + (y - handle.y) * step / 10);
			await page.waitForTimeout(40);
		}
		await page.mouse.up(); down = false;
		await page.waitForTimeout(500);
	} finally { if (down) await page.mouse.up().catch(() => {}); }
}

test('spostamento riga: la destinazione nel wrap viene rifiutata', async () => {
	const { page } = obsidian;
	await open('SpostaRiga.md', 'live');
	const before = await editorText();
	const scope = container('live');
	// The note from its top: open() leaves the caret on the last line, and a bar
	// near the editor's top edge would start the auto-scroll of the gesture,
	// moving the note under the pointer (this test is about the move).
	await page.evaluate(() => { window.app.workspace.activeEditor.editor.cm.scrollDOM.scrollTop = 0; });
	await page.waitForTimeout(300);
	const row = page.locator(`${scope} .iw-row-preview`).first();
	// Inside the wrap: refused, nothing changes.
	const text = await page.locator(`${scope} .iw-preview:not(.iw-row-preview) .iw-first-paragraph`).boundingBox();
	await dragRowHandle(page, row, text.x + 40, text.y + text.height / 2);
	assert.equal(await editorText(), before, 'rilascio dentro il wrap rifiutato');
});

test('spostamento riga: destinazione valida, allineamento e singolo Undo', async () => {
	const { page } = obsidian;
	await open('SpostaRiga.md', 'live');
	const before = await editorText();
	const scope = container('live');
	await page.evaluate(() => { window.app.workspace.activeEditor.editor.cm.scrollDOM.scrollTop = 0; });
	await page.waitForTimeout(300);
	const row = page.locator(`${scope} .iw-row-preview`).first();
	// Below the paragraph "Due.": the row, with its comment, goes after it.
	const due = await page.locator(`${scope} .cm-line`, { hasText: /^Due\.$/ }).boundingBox();
	await dragRowHandle(page, row, due.x + 40, due.y + due.height - 2);
	assert.equal(await editorText(), before.replace('![[a.png|200]] ![[b.png|150]] %%iw-row gap=20%%\n\nDue.', 'Due.\n\n![[a.png|200]] ![[b.png|150]] %%iw-row gap=20%%'));
	await page.waitForTimeout(800);
	assert.ok(await heightDrift() <= 1, 'numeri di riga allineati dopo lo spostamento');
	await page.screenshot({ path: join(shots, 'sposta-riga.png') });
	await undo();
	assert.equal(await editorText(), before, 'un solo passo di Annulla');
});

test('spostamento di righe e wrap: la presa resta scorrendo lontano con la rotella', async () => {
	const { page } = obsidian;
	// From the top, the caret on «Prima.», outside the blocks (open() would put
	// it on the last line, far from every image).
	await openNote(page, 'Lontano.md', 'live');
	await page.evaluate(() => { const editor = window.app.workspace.activeEditor.editor; editor.setCursor(0, 0); editor.cm.scrollDOM.scrollTop = 0; });
	await page.waitForFunction(selector => {
		const images = [...document.querySelectorAll(`${selector} .image-embed`)];
		return images.length >= 3 && images.every(image => image.classList.contains('is-loaded'));
	}, container('live'), { timeout: 15000 });
	const before = await editorText();
	const scope = container('live');
	for (const [kind, selector, block] of [['riga', '.iw-row-preview', LONTANO_RIGA], ['wrap', '.iw-preview:not(.iw-row-preview)', LONTANO_WRAP]]) {
		await page.evaluate(() => { window.app.workspace.activeEditor.editor.cm.scrollDOM.scrollTop = 0; });
		await page.waitForTimeout(300);
		const preview = page.locator(`${scope} ${selector}`).first();
		await preview.evaluate(element => element.setAttribute('data-iw-partenza', ''));
		await preview.hover();
		const handle = await preview.locator('.mod-move').boundingBox();
		const scroller = await page.locator(`${scope} .cm-scroller`).boundingBox();
		let down = false, number;
		try {
			await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
			await page.mouse.down(); down = true;
			await page.mouse.move(scroller.x + 200, scroller.y + scroller.height / 2, { steps: 8 });
			// Far enough that the block has left the page.
			for (let wheel = 0; wheel < 400 && await page.locator('[data-iw-partenza]').count(); wheel++) {
				await page.mouse.wheel(0, 100);
				await page.waitForTimeout(15);
			}
			await page.waitForTimeout(300);
			assert.equal(await page.locator('[data-iw-partenza]').count(), 0, `${kind}: il blocco di partenza è uscito dalla pagina`);
			assert.equal(await page.evaluate(() => document.body.classList.contains('iw-block-moving')), true, `${kind}: la presa resta`);
			number = await page.evaluate(scope => {
				const box = document.querySelector(`${scope} .cm-scroller`).getBoundingClientRect();
				const line = Array.from(document.querySelectorAll(`${scope} .cm-line`)).find(el => {
					const r = el.getBoundingClientRect();
					return /^Paragrafo lontano \d+\./.test(el.textContent) && r.top > box.top + 60 && r.bottom < box.bottom - 60;
				});
				return Number(/^Paragrafo lontano (\d+)\./.exec(line.textContent)[1]);
			}, scope);
			const target = await page.locator(`${scope} .cm-line`, { hasText: new RegExp(`^Paragrafo lontano ${number}\\.`) }).boundingBox();
			await page.mouse.move(target.x + 40, target.y + target.height - 2, { steps: 6 });
			await page.mouse.up(); down = false;
			await page.waitForTimeout(500);
		} finally { if (down) await page.mouse.up().catch(() => {}); }
		const paragraph = `Paragrafo lontano ${number}. ${'Testo di riempimento. '.repeat(12)}`;
		assert.equal(await editorText(), before.replace(`\n\n${block}`, '').replace(paragraph, `${paragraph}\n\n${block}`), `${kind} dopo il paragrafo ${number}`);
		assert.equal(await page.evaluate(() => document.body.classList.contains('iw-block-moving')), false, kind);
		await undo();
		assert.equal(await editorText(), before, `${kind}: un solo passo di Annulla`);
	}
});

test('contorni delle immagini: seguono lo scorrimento e il cursore', async () => {
	const { page } = obsidian;
	await open('Lunga.md', 'live');
	const scope = container('live');
	// Scrolled to the middle: the images that come on screen are marked as draggable.
	const marked = await page.evaluate(async selector => {
		const scroller = document.querySelector(`${selector} .cm-scroller`);
		scroller.scrollTop = scroller.scrollHeight / 2;
		await new Promise(resolve => setTimeout(resolve, 1200));
		const box = scroller.getBoundingClientRect();
		const visible = [...document.querySelectorAll(`${selector} .image-embed`)].filter(embed => {
			const r = embed.getBoundingClientRect();
			return r.bottom > box.top && r.top < box.bottom;
		});
		return { visible: visible.length, marked: visible.filter(embed => embed.classList.contains('iw-image-feedback')).length };
	}, scope);
	assert.ok(marked.visible > 0 && marked.marked === marked.visible, `immagini segnate dopo lo scorrimento: ${JSON.stringify(marked)}`);
	// The caret on an image's link makes that image the active one; moving away clears it.
	const active = await page.evaluate(async selector => {
		const editor = window.app.workspace.activeEditor.editor;
		const line = editor.getValue().split('\n').findIndex(text => text.startsWith('![['));
		editor.setCursor(line, 4);
		await new Promise(resolve => setTimeout(resolve, 600));
		const on = document.querySelectorAll(`${selector} .image-embed.iw-image-active`).length;
		editor.setCursor(0, 0);
		await new Promise(resolve => setTimeout(resolve, 600));
		return { on, off: document.querySelectorAll(`${selector} .image-embed.iw-image-active`).length };
	}, scope);
	assert.deepEqual(active, { on: 1, off: 0 });
});

async function openPopoutNote() {
	const { page } = obsidian;
	const opened = page.context().waitForEvent('page');
	await page.evaluate(async () => {
		const leaf = window.app.workspace.openPopoutLeaf();
		await leaf.openFile(window.app.vault.getFileByPath('Finestra.md'), { state: { mode: 'source', source: false } });
		leaf.view.editor.setCursor(leaf.view.editor.lastLine(), 0);
	});
	const popout = await opened;
	await popout.waitForFunction(() => document.querySelectorAll('.iw-row-preview p.iw-row .image-embed.is-loaded').length === 2, null, { timeout: 15000 });
	await popout.waitForTimeout(800);
	return popout;
}

test('wrap con H2/H3: geometria misurata e mappa delle altezze dopo ingresso e uscita', async () => {
 const {page} = obsidian;
 for (const mode of ['live', 'reading']) {
  await open('TitoliCarrier.md', mode);
  const geometry = await page.evaluate(selector => [...document.querySelectorAll(`${selector} .iw-preview-content`)]
   .filter(root => root.getBoundingClientRect().width > 0).map(root => {
    const heading = root.querySelector('h2, h3');
    return {tag: heading?.tagName, margin: parseFloat(getComputedStyle(heading).marginTop),
     carrier: !!root.querySelector('.iw-image-carrier'), image: !!root.querySelector('img')};
   }), container(mode));
  assert.equal(geometry.length, 2);
  assert.ok(geometry.every(item => item.carrier && item.image));
  if (!process.env.IW_OBSIDIAN_THEME_DIR) assert.ok(geometry.every(item => item.margin === 16), JSON.stringify(geometry));
  record({kind: 'environment', case: 'heading-carrier-geometry', mode, geometry});
  if (mode === 'live') {
   for (let cycle = 0; cycle < 2; cycle++) {
    await page.evaluate(() => {
     const editor = window.app.workspace.activeEditor.editor;
     editor.setCursor(editor.offsetToPos(editor.getValue().indexOf('Titolo due')));
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {const editor = window.app.workspace.activeEditor.editor;editor.setCursor(editor.lastLine(), 0);});
    await page.waitForTimeout(400);
    assert.ok(await heightDrift() <= 1, 'mappa allineata dopo uscita dal wrap con titolo');
   }
  }
 }
});

test('chiusura nativa: tutte le foglie della separata, principale preservata', async () => {
 const {page} = obsidian;
 const popout = await openPopoutNote();
 try {
  const count = await popout.evaluate(async () => {
   const leaves = [];
   window.app.workspace.iterateAllLeaves(leaf => { if (leaf.getContainer().doc === document) leaves.push(leaf); });
   const added = window.app.workspace.createLeafBySplit(leaves[0], 'vertical');
   await added.openFile(window.app.vault.getFileByPath('Ridimensiona.md'), {state: {mode: 'source', source: false}});
   added.view.editor.setCursor(added.view.editor.lastLine(), 0);
   const actual = [];
   window.app.workspace.iterateAllLeaves(leaf => { if (leaf.getContainer().doc === document) actual.push(leaf); });
   return actual.filter(leaf => leaf.view.getViewType() === 'markdown').length;
  });
  assert.equal(count, 2);
  await popout.waitForSelector('.iw-preview', {state: 'attached'});
  const mainBefore = await page.evaluate(() => {
  const leaves = [];
  window.app.workspace.iterateAllLeaves(leaf => { if (leaf.getContainer().doc === document) leaves.push(leaf); });
  window.iwMainLeavesBeforeClose = leaves;
  return leaves.length;
 });
  const describe = () => {
   const leaves = [];
   window.app.workspace.iterateAllLeaves(leaf => { leaves.push({id: leaf.id, type: leaf.view.getViewType(), file: leaf.view.file?.path,
    doc: leaf.getContainer().doc === document, win: leaf.getContainer().win === window, viewDoc: leaf.view.containerEl.ownerDocument === document}); });
   return leaves;
  };
  console.log('OWNERSHIP main before', JSON.stringify(await page.evaluate(describe)));
  console.log('OWNERSHIP popout before', JSON.stringify(await popout.evaluate(describe)));
  await detachWorkspaceWindow(popout);
  console.log('OWNERSHIP main after', JSON.stringify(await page.evaluate(describe)));
  const remaining = await page.evaluate(() => {
   const leaves = [];
   window.app.workspace.iterateAllLeaves(leaf => { leaves.push(leaf); });
   const result = {main: window.iwMainLeavesBeforeClose.every(leaf => leaves.includes(leaf)),
    count: leaves.filter(leaf => leaf.getContainer().doc === document).length,
    separate: leaves.filter(leaf => leaf.getContainer().doc !== document).length};
   delete window.iwMainLeavesBeforeClose;
   return result;
  });
  assert.deepEqual(remaining, {main: true, count: mainBefore, separate: 0});
 } finally { await detachWorkspaceWindow(popout); }
});

test('chiusura nativa: senza foglia proprietaria conserva la finestra e segnala il problema', async () => {
 const popout = await openPopoutNote();
 try {
  // Controlled missing-owner condition; genuine post-reload orphans are
  // exercised separately by banco-errori, including their forced close.
  await popout.evaluate(() => {
   const workspace = window.app.workspace;
   const original = workspace.iterateAllLeaves;
   window.iwOriginalIteration = original;
   workspace.iterateAllLeaves = callback => original.call(workspace, leaf => {
    if (leaf.getContainer().doc !== document) callback(leaf);
   });
  });
  await assert.rejects(detachWorkspaceWindow(popout), /No workspace leaf owns this window/);
  assert.equal(popout.isClosed(), false);
 } finally {
  await popout.evaluate(() => {
   window.app.workspace.iterateAllLeaves = window.iwOriginalIteration;
   delete window.iwOriginalIteration;
  });
  await detachWorkspaceWindow(popout);
 }
});

test('chiusura nativa: un detach senza chiusura produce timeout, senza fallback forzato', async () => {
 const popout = await openPopoutNote();
 try {
  await popout.evaluate(() => {
   window.app.workspace.iterateAllLeaves(leaf => {
    if (leaf.getContainer().doc !== document) return;
    window.iwOriginalDetach = {leaf, detach: leaf.detach};
    leaf.detach = () => {};
   });
  });
  await assert.rejects(detachWorkspaceWindow(popout), /Timeout/);
  assert.equal(popout.isClosed(), false, 'il timeout conserva la finestra per la diagnosi');
 } finally {
  await popout.evaluate(() => {
   const {leaf, detach} = window.iwOriginalDetach;
   leaf.detach = detach;
   delete window.iwOriginalDetach;
  });
  await detachWorkspaceWindow(popout);
 }
});

test('finestra separata: righe, wrap, feedback e toolbar sono inizializzati', async () => {
	const popout = await openPopoutNote();
	try {
		const state = await popout.evaluate(() => ({
			row: document.querySelector('.iw-row-preview p.iw-row')?.className,
			wrapFloat: getComputedStyle(document.querySelector('.iw-preview .image-embed.iw-left')).float,
			marked: document.querySelectorAll('.image-embed.iw-image-feedback').length,
			buttons: document.querySelectorAll('.iw-row-toolbar button').length,
		}));
		assert.match(state.row ?? '', /iw-row-align-left/);
		assert.equal(state.wrapFloat, 'left');
		assert.ok(state.marked >= 3, `immagini segnate: ${state.marked}`);
		assert.equal(state.buttons, 4);
		// The pointer's events in this window: the image under it marks its
		// region, its resize handle and leaving the window clear the mark.
		const image = await popout.locator('.iw-row-preview p.iw-row .image-embed img').first().boundingBox();
		await popout.mouse.move(image.x + image.width / 2, image.y + image.height / 2);
		await popout.waitForTimeout(100);
		assert.equal(await popout.evaluate(() => document.querySelectorAll('.iw-row-preview.iw-image-hover').length), 1, 'immagine: regione segnata');
		const handle = await popout.locator('.iw-row-preview .iw-row-handle').first().boundingBox();
		await popout.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await popout.waitForTimeout(100);
		assert.equal(await popout.evaluate(() => document.querySelectorAll('.iw-image-hover').length), 0, 'maniglia: nessuna regione segnata');
		await popout.mouse.move(image.x + image.width / 2, image.y + image.height / 2);
		await popout.waitForTimeout(100);
		await popout.mouse.move(2, 2);
		await popout.waitForTimeout(100);
		assert.equal(await popout.evaluate(() => document.querySelectorAll('.iw-image-hover').length), 0, 'fuori dall’editor: nessuna regione segnata');
		assert.equal(await obsidian.page.evaluate(() => document.querySelectorAll('.iw-image-hover').length), 0, 'nella finestra principale nulla');
	} finally { await detachWorkspaceWindow(popout); }
});

test('finestra separata: la maniglia sposta una riga', async () => {
	const popout = await openPopoutNote();
	let down = false;
	try {
		await popout.evaluate(() => { document.querySelector('.cm-scroller').scrollTop = 0; });
		await popout.waitForTimeout(300);
		const row = popout.locator('.iw-row-preview').first();
		await row.hover();
		const handle = await row.locator('.iw-row-toolbar .mod-move').boundingBox();
		const due = await popout.locator('.cm-line', { hasText: /^Due\.$/ }).boundingBox();
		const scrollerTop = await popout.evaluate(() => document.querySelector('.cm-scroller').getBoundingClientRect().top);
		assert.ok(handle.y - scrollerTop > 40, `maniglia fuori dalla zona di scorrimento automatico: ${Math.round(handle.y - scrollerTop)} px dal bordo dell'editor`);
		await popout.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await popout.mouse.down(); down = true;
		for (let step = 1; step <= 10; step++) {
			await popout.mouse.move(handle.x + (due.x + 40 - handle.x) * step / 10, handle.y + (due.y + due.height - 2 - handle.y) * step / 10);
			await popout.waitForTimeout(40);
		}
		await popout.mouse.up(); down = false;
		await popout.waitForTimeout(500);
		const text = await popout.evaluate(() => window.app.workspace.activeEditor?.editor?.getValue() ?? '');
		await popout.screenshot({ path: join(shots, 'finestra-separata.png') });
		assert.ok(text.startsWith('Uno.\n\nDue.\n\n![[a.png|200]] ![[b.png|150]]'), `riga spostata nella finestra separata: ${JSON.stringify(text.slice(0, 60))}`);
	} finally {
		if (down) await popout.mouse.up().catch(() => {});
		await detachWorkspaceWindow(popout);
	}
});

async function wrapResizeContext() {
	const { page } = obsidian;
	await open('Ridimensiona.md', 'live');
	const scope = container('live');
	const before = await editorText();
	const wraps = page.locator(`${scope} .iw-preview:not(.iw-row-preview)`);
	return { page, scope, before, wraps };
}
async function dragWrap(context, index, dx, release = true) {
	const { page, wraps } = context;
		const image = wraps.nth(index).locator('.image-embed').first();
		await image.hover();
		const handle = await image.locator('.iw-wrap-handle').boundingBox();
		assert.ok(handle, 'maniglia sull’immagine del wrap');
		const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		for (let step = 1; step <= 8; step++) { await page.mouse.move(x + dx * step / 8, y); await page.waitForTimeout(40); }
		if (release === true) await page.mouse.up();
		else if (release === 'escape') { await page.keyboard.press('Escape'); await page.mouse.up(); }
		await page.waitForTimeout(400);
	}
const wrapWidth = (text, file) => Number(new RegExp(`${file}\\|(\\d+)`).exec(text)?.[1]);
const countWraps = context => context.page.evaluate(selector => {
	window.iwWrapsCreated = 0;
	window.iwWrapObserver?.disconnect();
	window.iwWrapObserver = new MutationObserver(records => {
		for (const record of records) for (const node of record.addedNodes) {
			if (node.nodeType === 1 && (node.matches('.iw-preview:not(.iw-row-preview)') || node.querySelector('.iw-preview:not(.iw-row-preview)'))) window.iwWrapsCreated++;
		}
	});
	window.iwWrapObserver.observe(document.querySelector(`${selector} .cm-content`), { childList: true, subtree: true });
}, context.scope);
const wrapsCreated = context => context.page.evaluate(() => { window.iwWrapObserver?.disconnect(); delete window.iwWrapObserver; return window.iwWrapsCreated; });

test('resize wrap: pressione e gesto restano stabili senza salti o tooltip', async () => {
	const context = await wrapResizeContext();
	const { page, before, wraps } = context;
	// Pressing the handle alone changes nothing on screen (0.26.11 jumped to the maximum).
	{
		const image = wraps.first().locator('.image-embed').first();
		await image.hover();
		const handle = await image.locator('.iw-wrap-handle').boundingBox();
		const before = await image.evaluate(el => el.getBoundingClientRect().width);
		await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await page.mouse.down();
		await page.waitForTimeout(150);
		const pressed = await image.evaluate(el => el.getBoundingClientRect().width);
		await page.keyboard.press('Escape');
		await page.mouse.up();
		assert.ok(Math.abs(pressed - before) <= 1, `alla pressione: ${before} → ${pressed} px`);
	}
	// No Obsidian tooltip over the gesture, not even the one already on its way
	// from the hover before the press; none left after it.
	{
		const image = wraps.first().locator('.image-embed').first();
		await image.hover();
		const handle = await image.locator('.iw-wrap-handle').boundingBox();
		const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		for (let step = 1; step <= 4; step++) { await page.mouse.move(x - 5 * step, y); await page.waitForTimeout(40); }
		await page.waitForTimeout(1300);
		const during = await visibleTooltips(page);
		await page.mouse.up();
		await page.mouse.move(x - 20, y + 1);
		await page.waitForTimeout(1200);
		const after = await visibleTooltips(page);
		await undo();
		assert.deepEqual(during, [], 'nessun suggerimento durante il gesto');
		assert.deepEqual(after, [], 'nessun suggerimento dopo il rilascio, con il mouse fermo');
	}
	assert.equal(await editorText(), before, 'il gesto di prova viene annullato');
});

test('resize wrap: limite massimo, feedback, salvataggio e singolo Undo', async () => {
	const context = await wrapResizeContext();
	const { page, before, wraps } = context;
	const column = await wraps.first().locator('.iw-preview-content').evaluate(el => el.getBoundingClientRect().width);
	const max = Math.floor(column * 0.45);
	// Wider than the limit: it stops there and says why, only while pressed.
	let down = false;
	try {
		await dragWrap(context, 0, 500, false); down = true;
		const shown = await wraps.first().locator('.image-embed').first().evaluate(el => el.getBoundingClientRect().width);
		assert.ok(Math.abs(shown - max) <= 1, `anteprima durante il gesto: ${shown} px, attesi ${max}`);
		const hint = await page.locator('.iw-drop-rejection').textContent().catch(() => null);
		assert.match(hint ?? '', /Maximum image width in a wrap: 45% of the column/);
		await page.screenshot({ path: join(shots, 'ridimensiona-wrap-limite.png') });
	} finally { if (down) await page.mouse.up().catch(() => {}); }
	await page.locator('.iw-drop-rejection').waitFor({ state: 'detached' });
	assert.equal(await page.locator('.iw-drop-rejection').count(), 0, 'l’avviso non resta dopo il rilascio');
	assert.equal(wrapWidth(await editorText(), 'c\\.png'), max, `larghezza massima salvata (${max} px)`);
	await undo();
	assert.equal(await editorText(), before, 'un solo passo di Annulla');
});

test('resize wrap: resize ordinario, Escape e direzione sul lato destro', async () => {
	const context = await wrapResizeContext();
	const { page, before, wraps } = context;
	// Narrower: saved as it is, shown at once, and the wrap is updated in place
	// (not drawn again from scratch). Escape: nothing changes.
	await countWraps(context);
	await dragWrap(context, 0, -80);
	assert.equal(await wrapsCreated(context), 0, 'wrap aggiornato senza essere ridisegnato');
	const saved = wrapWidth(await editorText(), 'c\\.png');
	assert.ok(Math.abs(saved - 120) <= 2, await editorText().then(t => t.split('\n')[4]));
	const shownAfter = await wraps.first().locator('.image-embed').first().evaluate(el => el.getBoundingClientRect().width);
	assert.ok(Math.abs(shownAfter - saved) <= 1, `mostrata ${shownAfter} px, salvata ${saved}`);
	await undo();
	await dragWrap(context, 0, 60, 'escape');
	assert.equal(await editorText(), before, 'Esc annulla il gesto');
	// Image on the right: the handle is on its left edge, and dragging left enlarges.
	await dragWrap(context, 1, -60);
	assert.ok(wrapWidth(await editorText(), 'a\\.png') > 240, await editorText().then(t => t.split('\n').find(l => l.includes('a.png'))));
	await page.waitForTimeout(600);
	assert.ok(await heightDrift() <= 1, 'numeri di riga allineati dopo il ridimensionamento');
	await page.screenshot({ path: join(shots, 'ridimensiona-wrap.png') });
	await undo();
	assert.equal(await editorText(), before);
});

test('wrap: cambio lato aggiorna in-place maniglia e float', async () => {
	const context = await wrapResizeContext();
	const { page, before, wraps } = context;
	// Change side from the bar: the image moves over, the wrap is not drawn again.
	await wraps.first().hover();
	await countWraps(context);
	await wraps.first().locator('.iw-wrap-toolbar button').nth(1).click();
	await page.waitForFunction(selector => {
		const image = document.querySelector(`${selector} .iw-preview:not(.iw-row-preview) .image-embed`);
		return image && getComputedStyle(image).float === 'right' && image.querySelector('.iw-wrap-handle')?.classList.contains('mod-left');
	}, context.scope);
	assert.equal(await wrapsCreated(context), 0, 'cambio di lato senza ridisegno');
	const moved = await wraps.first().locator('.image-embed').first().evaluate(el => ({ float: getComputedStyle(el).float, handleLeft: el.querySelector('.iw-wrap-handle')?.classList.contains('mod-left') }));
	assert.deepEqual(moved, { float: 'right', handleLeft: true });
	await undo();
	assert.equal(await editorText(), before);
});

test('stili del plugin: una sola copia dopo ogni ricarica, nessuna a plugin spento', async () => {
	const { page } = obsidian;
	await open('Righe.md', 'live');
	// Stylesheets holding the plugin's rules (styles.css; before 0.26.12 also
	// CodeMirror copies of a theme that piled up at each reload).
	const count = () => page.evaluate(() => [...document.styleSheets].filter(sheet => {
		try { return [...sheet.cssRules].some(rule => rule.cssText.includes('.iw-row')); } catch { return false; }
	}).length);
	const cycles = [];
	try {
		for (let i = 0; i < 3; i++) {
			await page.evaluate(() => window.app.plugins.disablePlugin('image-rows-and-wraps'));
			await page.waitForFunction(() => !window.app.plugins.plugins['image-rows-and-wraps']
				&& [...document.styleSheets].every(sheet => { try { return ![...sheet.cssRules].some(rule => rule.cssText.includes('.iw-row')); } catch { return true; } }));
			const off = await count();
			await page.evaluate(() => window.app.plugins.enablePlugin('image-rows-and-wraps'));
			await page.waitForFunction(() => Boolean(window.app.plugins.plugins['image-rows-and-wraps'])
				&& [...document.styleSheets].filter(sheet => { try { return [...sheet.cssRules].some(rule => rule.cssText.includes('.iw-row')); } catch { return false; } }).length === 1);
			cycles.push([off, await count()]);
		}
	} finally {
		await page.evaluate(async () => { if (!window.app.plugins.plugins['image-rows-and-wraps']) await window.app.plugins.enablePlugin('image-rows-and-wraps'); window.dispatchEvent(new FocusEvent('focus')); });
	}
	assert.deepEqual(cycles, [[0, 1], [0, 1], [0, 1]]);
	// And the rows are laid out again after the reloads.
	await page.waitForFunction(selector => document.querySelector(`${selector} .iw-row-preview p.iw-row`), container('live'), { timeout: 5000 });
});

test('una finestra di scelta aperta si chiude quando il plugin viene disattivato', async () => {
	const { page } = obsidian;
	await openNote(page, 'Palette.md', 'live');
	const before = await editorText();
	await page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(2, 3));
	await page.evaluate(() => window.app.commands.executeCommandById('image-rows-and-wraps:row-set-align'));
	await page.locator('.prompt-input').waitFor();
	let left;
	try {
		await page.evaluate(() => window.app.plugins.disablePlugin('image-rows-and-wraps'));
		await page.locator('.prompt-input').waitFor({ state: 'detached' });
		// Before 0.26.41 the dialog stayed, and a choice made in it still edited the note.
		left = await page.locator('.prompt-input').count();
		if (left) await page.keyboard.press('Escape');
	} finally {
		await page.evaluate(async () => { if (!window.app.plugins.plugins['image-rows-and-wraps']) await window.app.plugins.enablePlugin('image-rows-and-wraps'); });
		await page.waitForFunction(() => Boolean(window.app.plugins.plugins['image-rows-and-wraps']));
	}
	assert.equal(left, 0, 'finestra chiusa');
	assert.equal(await editorText(), before);
});

async function imageDragContext() {
	const { page } = obsidian;
	await open('Trascina.md', 'live');
	const scope = container('live');
	const before = await editorText();
	const image = () => page.locator(`${scope} .iw-row-preview img`).nth(1);
	// Drags the second image of the row to (x, y), in small steps like a hand.
	// The caret at the end scrolled the note: the row can sit under the view
	// header. Bring the image into view and press its centre.
	const pressPoint = async () => {
		await image().evaluate(el => el.scrollIntoView({ block: 'center' }));
		await page.waitForTimeout(300);
		const box = await image().boundingBox();
		const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point), 'IMG', 'si preme proprio l’immagine');
		return point;
	};
	const drag = async (target, check) => {
		const { x: sx, y: sy } = await pressPoint();
		const { x, y } = await target();
		let down = false;
		try {
			await page.mouse.move(sx, sy);
			await page.mouse.down(); down = true;
			for (let step = 1; step <= 10; step++) { await page.mouse.move(sx + (x - sx) * step / 10, sy + (y - sy) * step / 10); await page.waitForTimeout(40); }
			await page.waitForTimeout(100);
			const seen = check ? await check() : undefined;
			await page.mouse.up(); down = false;
			await page.waitForTimeout(400);
			return seen;
		} finally { if (down) await page.mouse.up().catch(() => {}); }
	};
	return { page, scope, before, pressPoint, drag };
}

test('drag immagine: la destinazione nel wrap viene rifiutata con il motivo', async () => {
	const { page, scope, before, drag } = await imageDragContext();
	// Into the wrap's text: refused, with the reason next to the pointer.
	const refused = await drag(async () => {
		const text = await page.locator(`${scope} .iw-preview:not(.iw-row-preview) .iw-first-paragraph`).boundingBox();
		return { x: text.x + 60, y: text.y + Math.min(40, text.height / 2) };
	}, () => page.locator('.iw-drop-rejection').textContent({ timeout: 2000 }).catch(() => ''));
	assert.match(refused ?? '', /wrap/);
	assert.equal(await editorText(), before, 'rilascio nel wrap rifiutato');
});

test('drag immagine: spostamento valido con un solo Undo', async () => {
	const { page, scope, before, drag } = await imageDragContext();
	// Between "Due." and "Tre.": the image leaves the row and becomes a row of its own.
	await drag(async () => {
		const due = await page.locator(`${scope} .cm-line`, { hasText: /^Due\.$/ }).boundingBox();
		return { x: due.x + 40, y: due.y + due.height - 2 };
	});
	assert.equal(await editorText(), before.replace('![[a.png|200]] ![[b.png|150]]\n\nDue.\n\n', '![[a.png|200]]\n\nDue.\n\n![[b.png|150]]\n\n'));
	await undo();
	assert.equal(await editorText(), before, 'un solo passo di Annulla');
	await page.evaluate(() => document.querySelectorAll('.notice').forEach(notice => notice.remove()));
});

test('immagine gestita: un clic apre il Markdown senza modificare la nota', async () => {
	const { page, before, pressPoint } = await imageDragContext();
	await page.evaluate(() => { const editor = window.app.workspace.activeEditor.editor; editor.setCursor(editor.lastLine(), 0); });
	await page.waitForTimeout(500);
	// A press without a move is a click: the caret goes into the image's link.
	const point = await pressPoint();
	await page.mouse.click(point.x, point.y);
	await page.waitForFunction(expected => {
		const editor = window.app.workspace.activeEditor.editor;
		return editor.posToOffset(editor.getCursor()) === expected;
	}, before.indexOf('![[b.png|150]]'));
	const caret = await page.evaluate(() => { const e = window.app.workspace.activeEditor.editor; return e.posToOffset(e.getCursor()); });
	assert.equal(caret, before.indexOf('![[b.png|150]]'), 'il clic apre il Markdown sull’immagine');
	assert.equal(await editorText(), before);
});

test('nota lunga con 100 righe (live)', async () => {
	const { page } = obsidian;
	const started = performance.now();
	await openNote(page, 'Lunga.md', 'live');
	await page.waitForFunction(selector => document.querySelectorAll(`${selector} .iw-row`).length > 0, container('live'));
	const opened = performance.now() - started;
	// Scroll one screen per frame pair until the bottom stops moving (heights change as rows render).
	const { scrolled, screens } = await page.evaluate(async () => {
		const scroller = document.querySelector('.workspace-leaf.mod-active .cm-scroller');
		const start = performance.now();
		let screens = 0;
		while (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1 && screens < 2000) {
			scroller.scrollTop += scroller.clientHeight;
			screens++;
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		}
		return { scrolled: performance.now() - start, screens };
	});
	await page.getByText('FINE DELLA NOTA').waitFor({ timeout: 10000 });
	console.log(`# nota lunga: apertura ${Math.round(opened)} ms, ${screens} schermate di scorrimento in ${Math.round(scrolled)} ms (${Math.round(scrolled / screens)} ms l'una)`);
	await page.screenshot({ path: join(shots, 'lunga-live.png') });
	assert.ok(opened < 5000, 'apertura sotto 5 s');
	assert.ok(scrolled / screens < 100, 'meno di 100 ms per schermata');
});

// Native sections must retain measurable boxes in embeds and hover previews:
// Obsidian uses those heights to virtualize the note while scrolling.
test('Wrap compatti: incorporamento coerente fra Live Preview e Lettura', async () => {
 const { page } = obsidian;
 const measurements = [];
 for (const mode of ['live', 'reading']) {
  await openNote(page, 'IncorporaCompatto.md', mode);
  await page.waitForSelector(`${container(mode)} .markdown-embed .iw-reading-section`, { state: 'attached' });
  await page.waitForTimeout(1200);
  measurements.push(await page.evaluate(selector => {
   const view = document.querySelector(`${selector} .markdown-embed .markdown-preview-view`);
   const root = view.querySelector('.markdown-preview-sizer');
   const top = root.getBoundingClientRect().top;
   return { height: root.getBoundingClientRect().height, width: root.getBoundingClientRect().width,
    positions: [...root.querySelectorAll('p, h2, li, img')].map(el => ({text: el.textContent, y: el.getBoundingClientRect().top - top, height: el.getBoundingClientRect().height})),
    zeroSections: [...root.querySelectorAll('div.iw-reading-section')].filter(el => !el.getBoundingClientRect().height).length };
  }, container(mode)));
  record({kind: 'measurement', context: `compact-embed-${mode}`, ...measurements.at(-1)});
 }
 assert.equal(measurements[0].zeroSections, 0, 'sezioni incorporate misurabili in Live Preview');
 assert.equal(measurements[1].zeroSections, 0, 'sezioni incorporate misurabili in Lettura');
 assert.ok(Math.abs(measurements[0].height - measurements[1].height) < 0.1, JSON.stringify(measurements));
 assert.equal(measurements[0].positions.length, measurements[1].positions.length);
 for (let i = 0; i < measurements[0].positions.length; i++) {
  assert.ok(Math.abs(measurements[0].positions[i].y - measurements[1].positions[i].y) < 0.1, `blocco ${i}: ${JSON.stringify(measurements)}`);
 }
});

test('Wrap compatti: anteprima al passaggio scorre senza perdere altezza', async () => {
 const { page } = obsidian;
 await openNote(page, 'IncorporaCompatto.md', 'reading');
 const link = page.locator('.workspace-leaf.mod-active a.internal-link[data-href="Compatto"]').first();
 await page.keyboard.down('Control');
 await link.hover();
 await page.waitForTimeout(300);
 await link.hover({ position: { x: 3, y: 3 } });
 await page.keyboard.up('Control');
 const selector = '.popover.hover-popover .markdown-embed .markdown-preview-view';
 await page.waitForSelector(`${selector} .iw-reading-section`);
 await page.locator(selector).hover();
 await page.waitForTimeout(1200);
 const steps = [];
 for (let i = 0; i < 40; i++) {
  const before = await page.locator(selector).evaluate(view => {
   const result = { top: view.scrollTop, height: view.scrollHeight, client: view.clientHeight };
   view.scrollTop += 80;
   return result;
  });
  await page.waitForTimeout(250);
  const after = await page.locator(selector).evaluate(view => ({top: view.scrollTop, height: view.scrollHeight, client: view.clientHeight}));
  steps.push({before, after});
  assert.ok(after.height >= before.height - 2, `altezza persa: ${JSON.stringify(steps)}`);
  assert.ok(after.top >= before.top - 1, `scorrimento indietro: ${JSON.stringify(steps)}`);
  if (after.top + after.client >= after.height - 1) break;
 }
 assert.ok(steps.length > 3, 'anteprima realmente scorsa');
 const last = steps.at(-1).after;
 assert.ok(last.top + last.client >= last.height - 1, 'raggiunto il fondo');
 await page.keyboard.press('Escape');
});

test('MarkdownRenderer: blocchi diretti senza sezioni el-p', async () => {
 const { page } = obsidian;
 for (const mode of ['live', 'reading']) {
  await openNote(page, 'Wrap.md', mode);
  if (mode === 'live') await page.evaluate(() => { const e = window.app.workspace.activeEditor.editor; e.setCursor(e.lastLine(), 0); });
  await page.waitForSelector('.iw-preview-content > p', { state: 'attached' });
  const dom = await page.locator('.iw-preview-content').first().evaluate(root => ({children: [...root.children].map(el => el.tagName), sections: root.querySelectorAll('.el-p').length}));
  assert.ok(dom.children.includes('P'), JSON.stringify(dom));
  assert.equal(dom.sections, 0, JSON.stringify(dom));
 }
});

test('Wrap compatti: sezioni misurabili nella finestra separata', async () => {
 const { page } = obsidian;
 const opened = page.context().waitForEvent('page');
 await page.evaluate(async () => {
  const leaf = window.app.workspace.openPopoutLeaf();
  await leaf.openFile(window.app.vault.getFileByPath('IncorporaCompatto.md'), {state: {mode: 'source', source: false}});
 });
 const popout = await opened;
 try {
  for (const mode of ['live', 'reading']) {
   await openNote(popout, 'IncorporaCompatto.md', mode);
   await popout.waitForSelector(`${container(mode)} .markdown-embed .iw-reading-section`, {state: 'attached'});
   await popout.waitForTimeout(800);
   const heights = await popout.locator(`${container(mode)} .markdown-embed div.iw-reading-section`).evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
   assert.ok(heights.length >= 7 && heights.every(height => height > 0), JSON.stringify(heights));
  }
 } finally { await detachWorkspaceWindow(popout); await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus'))); }
});

test('PDF: wrap compatto conserva l’avviso di formato senza impaginazione', async () => {
 const { printed } = await exportPdf('Compatto.md', 'compatto.pdf', view => ({
  warning: [...document.querySelectorAll('.notice')].map(el => el.textContent).join('\n'), floats: [...view.querySelectorAll('.image-embed')].map(el => getComputedStyle(el).float),
 }));
 assert.ok(printed.warning.includes('markers touch the text'), printed.warning);
 assert.ok(printed.floats.length >= 2 && printed.floats.every(value => value === 'none'), JSON.stringify(printed));
});

test('Wrap separati: incorporamenti in Live Preview e Lettura mantengono il float', async () => {
 const {page} = obsidian;
 for (const mode of ['live', 'reading']) {
  await openNote(page, 'IncorporaWrap.md', mode);
  const selector = `${container(mode)} .markdown-embed .iw-preview-content`;
  await page.waitForSelector(`${selector} img`);
  const state = await page.locator(selector).evaluate(root => {
   const image = root.querySelector('.iw-left');
   const box = image.getBoundingClientRect();
   const parent = root.getBoundingClientRect();
   return {float: getComputedStyle(image).float, width: box.width, contained: box.bottom <= parent.bottom + 1, sections: root.querySelectorAll('.el-p').length};
  });
  assert.equal(state.float, 'left');
  assert.ok(state.width > 0 && state.contained, JSON.stringify(state));
  assert.equal(state.sections, 0);
 }
});

test('DOM di stampa: nota incorporata con wrap separato, primo paragrafo allineato all’immagine', async () => {
 const {printed} = await exportPdf('IncorporaWrap.md', 'incorpora-wrap.pdf', view => {
  const embed = view.querySelector('.markdown-embed .image-embed.iw-left');
  const image = embed?.querySelector('img');
  const carrier = embed?.parentElement;
  const next = carrier?.nextElementSibling;
  const imageBox = image?.getBoundingClientRect();
  const textBox = next?.getBoundingClientRect();
  return {found: {embed: Boolean(embed), image: Boolean(image),
   carrier: Boolean(carrier?.matches('div.iw-image-carrier.iw-export-block')),
   paragraph: Boolean(next?.matches('p.iw-export-after-carrier.iw-first-paragraph'))},
   src: embed?.getAttribute('src'), text: next?.textContent,
   float: embed ? getComputedStyle(embed).float : null, loaded: Boolean(image?.complete && image.naturalWidth > 0),
   imageWidth: imageBox?.width, imageHeight: imageBox?.height,
   imageTop: imageBox?.top, textTop: textBox?.top,
   delta: imageBox && textBox ? textBox.top - imageBox.top : null};
 });
 record({kind: 'measurement', context: 'pdf-embedded-wrap', ...printed});
 assert.deepEqual(printed.found, {embed: true, image: true, carrier: true, paragraph: true}, 'elementi attesi nel wrap incorporato');
 assert.equal(printed.src, 'b.png', 'immagine della fixture incorporata');
 assert.ok(printed.text?.startsWith('Testo accanto all’immagine.'), 'primo paragrafo della fixture incorporata');
 assert.equal(printed.float, 'left');
 assert.equal(printed.loaded, true, 'immagine caricata');
 assert.ok(printed.imageWidth > 0 && printed.imageHeight > 0, 'immagine caricata e misurabile');
 assert.ok(Number.isFinite(printed.imageTop) && Number.isFinite(printed.textTop), 'coordinate superiori numeriche e finite');
 assert.equal(typeof printed.delta, 'number', 'misura del disallineamento presente e numerica');
 assert.ok(Number.isFinite(printed.delta), 'misura del disallineamento finita');
 // CSS pixels in the print DOM, not glyph baselines or coordinates in the PDF.
 // Allow subpixel layout (including the carrier's 1/64 px padding), up to
 // half a CSS pixel; a full-pixel displacement must never pass.
 assert.ok(Math.abs(printed.delta) <= 0.5, `primo paragrafo allineato all’immagine entro 0,5 px CSS: ${JSON.stringify(printed)}`);
});

// Reads an exported PDF with the pdf.js Obsidian loads for its own viewer
// (present once a PDF has been opened): per page, its text and images.
async function pdfPages(pdf, name) {
 const {page} = obsidian;
 await copyFile(pdf, join(vault, name));
 await page.waitForFunction(path => window.app.vault.getFileByPath(path) !== null, name, {timeout: 10000});
 if (!await page.evaluate(() => Boolean(window.pdfjsLib))) {
  await page.evaluate(async path => { await window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath(path)); }, name);
  await page.waitForFunction(() => Boolean(window.pdfjsLib), null, {timeout: 15000});
 }
 return page.evaluate(async path => {
  const lib = window.pdfjsLib;
  const doc = await lib.getDocument({data: new Uint8Array(await window.app.vault.adapter.readBinary(path))}).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
   const pdfPage = await doc.getPage(n);
   const text = (await pdfPage.getTextContent()).items.map(item => item.str).filter(str => str.trim());
   const ops = await pdfPage.getOperatorList();
   pages.push({text, images: ops.fnArray.filter(fn => fn === lib.OPS.paintImageXObject || fn === lib.OPS.paintInlineImageXObject).length});
  }
  await doc.destroy();
  return pages;
 }, name);
}

test('PDF: nota incorporata che inizia sotto il proprio titolo anche al confine di un’immagine', async () => {
 const {page} = obsidian;
 const outcomes = [];
 const exportAt = async offset => {
  const note = `ConfineIncorporato${outcomes.length}`;
  await writeFile(join(vault, `${note}.md`), `${confineSpacer(offset)}\n\nNota incorporata di confronto.\n\n![[ConfineCasi]]\n\nFine.\n`);
  await page.waitForFunction(path => window.app.vault.getFileByPath(path) !== null, `${note}.md`, {timeout: 10000});
  const {pdf} = await exportPdf(`${note}.md`, `${note}.pdf`, view => view.querySelectorAll('.image-embed').length);
  const pages = await pdfPages(pdf, `${note}.pdf`);
  const pageOf = text => pages.findIndex(page => page.text.some(str => str.startsWith(text))) + 1;
  // The fifth image is the right-heading wrap's: the page it starts on.
  let seen = 0;
  const o = {offset, pages: pages.length, title: pageOf('ConfineCasi'), first: pageOf('PRIMA left-heading'), headingPage: pageOf('Titolo right-heading'), imagePage: pages.findIndex(page => (seen += page.images) >= 5) + 1};
  // fits: the image on page 1 beside its heading; split: the image alone on
  // the next page (a known limit, not this fix's); pushed: the whole embedded
  // note after its title, the defect.
  o.state = o.first > o.title ? 'pushed'
   : o.first !== o.title || o.headingPage !== o.title ? 'other'
   : o.imagePage === o.headingPage ? 'fits' : o.imagePage === o.headingPage + 1 ? 'split' : 'other';
  outcomes.push(o);
  return o;
 };
 // Sentinel: the image must fit at the low end and not at the high end, then
 // a bisection finds where it stops fitting to within CONFINE_STEP. The first
 // export past that point is inside the window where the defect sends the
 // note on. A fixture moved so far that the search cannot find that point
 // fails here, apart from the defect.
 let [fits, past] = CONFINE_RANGE;
 const low = await exportAt(fits), high = await exportAt(past);
 let found = low.state === 'fits' && ['split', 'pushed'].includes(high.state);
 while (found && past - fits > CONFINE_STEP) {
  const middle = (fits + past) / 2;
  const o = await exportAt(middle);
  if (o.state === 'fits') fits = middle;
  else if (o.state === 'other') found = false;
  else past = middle;
 }
 record({kind: 'measurement', context: 'pdf-embedded-page-boundary', range: CONFINE_RANGE, step: CONFINE_STEP, fits, past, outcomes});
 assert.ok(found, `sentinella: la fixture non incontra più il confine dell’immagine in ${JSON.stringify(CONFINE_RANGE)} px: ${JSON.stringify(outcomes)}`);
 assert.deepEqual(outcomes.filter(o => o.state === 'pushed'), [], 'contenuto incorporato sotto il proprio titolo');
});

test('Wrap separati: anteprima al passaggio contiene immagine e testo', async () => {
 const {page} = obsidian;
 await openNote(page, 'IncorporaWrap.md', 'reading');
 const link = page.locator(`${container('reading')} a.internal-link[data-href="Wrap"]`).first();
 await page.keyboard.down('Control');
 await link.hover();
 await page.waitForTimeout(300);
 await link.hover({position: {x: 3, y: 3}});
 await page.keyboard.up('Control');
 const preview = page.locator('.hover-popover .iw-preview-content');
 await preview.waitFor();
 const geometry = await preview.evaluate(root => {
  const image = root.querySelector('.iw-left');
  return {float: getComputedStyle(image).float, contained: image.getBoundingClientRect().bottom <= root.getBoundingClientRect().bottom + 1, sections: root.querySelectorAll('.el-p').length};
 });
 assert.equal(geometry.float, 'left');
 assert.ok(geometry.contained);
 assert.equal(geometry.sections, 0);
 await page.keyboard.press('Escape');
});

test('Wrap compatti: nota diretta in Live Preview e Lettura', async () => {
 const {page} = obsidian;
 for (const mode of ['live', 'reading']) {
  await openNote(page, 'Compatto.md', mode);
  if (mode === 'live') await page.evaluate(() => {const e = window.app.workspace.activeEditor.editor; e.setCursor(e.lastLine(), 0);});
  await page.waitForSelector(`${container(mode)} .image-embed.iw-left`);
  const geometry = await page.locator(`${container(mode)} .image-embed.iw-left`).first().evaluate(image => ({float: getComputedStyle(image).float, width: image.getBoundingClientRect().width}));
  assert.equal(geometry.float, 'left');
  assert.ok(geometry.width > 0);
 }
});

// Real clicks need the pointer's target free. An earlier test can leave the
// pointer over a link, and Obsidian's hover preview then covers the editor and
// takes the clicks: move the pointer off it and wait until no preview is open.
async function pointerAway() {
	const { page } = obsidian;
	await page.mouse.move(0, 0);
	await page.waitForFunction(() => !document.querySelector('.popover.hover-popover'), null, { timeout: 5000 });
}

// What a real click at `point` would reach: it must be inside `selector`.
async function assertHits(point, selector, what) {
	const hit = await obsidian.page.evaluate(({ x, y, selector }) => {
		const element = document.elementFromPoint(x, y);
		return { inside: Boolean(element?.closest(selector)), element: element && `${element.tagName}.${[...element.classList].join('.')}` };
	}, { x: point.x, y: point.y, selector });
	assert.ok(hit.inside, `${what}: il punto del clic è coperto da ${hit.element}`);
}

test('wrap: clic sotto il Markdown mantiene gutter e secondo clic allineati', async () => {
 const {page} = obsidian;
 const states = [];
 const snapshot = async label => {
  const data = await page.evaluate(() => {
   const view = window.app.workspace.activeEditor.editor.cm;
   const geometry = element => {
    const rect = element.getBoundingClientRect();
    return {top: rect.top, height: rect.height};
   };
   const lines = [...view.dom.querySelectorAll('.cm-line')].map(geometry);
   const gutters = [...view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
    .filter(element => element.getBoundingClientRect().height > 0).map(geometry);
   const wrap = view.dom.querySelector('.iw-preview:not(.iw-row-preview)');
   return {lines, gutters, wrap: wrap ? geometry(wrap) : null, cursor: view.state.selection.main.head};
  });
  states.push({label, ...data});
  return data;
 };
 const below = async () => page.evaluate(() => {
  const lines = [...document.querySelectorAll('.workspace-leaf.mod-active .cm-line')];
  const marker = lines.find(line => line.textContent.includes('[wrap:end]'));
  const wrap = lines.find(line => line.querySelector('.iw-preview:not(.iw-row-preview)'));
  const rect = (marker ?? wrap).nextElementSibling.getBoundingClientRect();
  return {x: rect.left + 60, y: rect.top + rect.height / 2};
 });
 await page.evaluate(() => window.app.vault.setConfig('showLineNumber', true));
 try {
  await open('GutterUscita.md', 'live');
  await pointerAway();
  await snapshot('initial');
  const heading = await page.locator('.workspace-leaf.mod-active .iw-preview-content h2').boundingBox();
  const entry = { x: heading.x + heading.width / 2, y: heading.y + heading.height / 2 };
  await assertHits(entry, '.workspace-leaf.mod-active .iw-preview-content h2', 'ingresso');
  await page.mouse.click(entry.x, entry.y);
  await page.waitForTimeout(200);
  assert.equal((await snapshot('source')).wrap, null, 'il clic entra nel Markdown');
  const point = await below();
  await assertHits(point, '.workspace-leaf.mod-active .cm-content', 'uscita');
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);
  const exit = await snapshot('exit');
  assert.ok(exit.wrap, 'il primo clic chiude il Markdown');
  assert.equal(exit.lines.length, exit.gutters.length);
  assert.ok(exit.lines.every((line, index) => Math.abs(line.top - exit.gutters[index].top) <= 1), JSON.stringify(exit));
  assert.ok(Math.abs(exit.wrap.height - exit.gutters[2].height) <= 1, 'cella del wrap misurata all’altezza reale');
  const secondPoint = await below();
  await assertHits(secondPoint, '.workspace-leaf.mod-active .cm-content', 'secondo clic');
  await page.mouse.click(secondPoint.x, secondPoint.y);
  await page.waitForTimeout(200);
  const second = await snapshot('second');
  assert.ok(second.wrap, 'il secondo clic resta fuori dal Markdown');
  assert.equal(second.cursor, exit.cursor);
  assert.ok(second.lines.every((line, index) => Math.abs(line.top - second.gutters[index].top) <= 1));
 } finally {
  record({kind: 'environment', case: 'wrap-gutter-exit', states});
  await page.evaluate(() => window.app.vault.setConfig('showLineNumber', false));
 }
});

// Leaving a block's Markdown with a real click, measured at every frame from
// before the click: the clicked line keeps its place (above the block
// CodeMirror keeps the top still), line numbers stay on their lines in every
// frame, and the block is drawn once (a widget drawn again repeats its
// intermediate layout). Far from the note's ends, where the rule holds.
async function exitAndMeasure(block, clicked, enter, top) {
	const { page } = obsidian;
	// The block `top` px below the editor's top: near it for an exit below
	// (its Markdown then fits), lower for an exit above.
	// Again until measured: a block far away is placed by estimated heights.
	for (let i = 0; i < 4; i++) {
		await page.evaluate(({ block, top }) => {
			const view = window.app.workspace.activeEditor.editor.cm;
			const from = view.state.doc.toString().indexOf(block);
			view.scrollDOM.scrollTop += view.documentTop + view.lineBlockAt(from).top - view.scrollDOM.getBoundingClientRect().top - top;
		}, { block, top });
		await page.waitForTimeout(250);
	}
	const target = await page.evaluate(({ block, enter }) => {
		const view = window.app.workspace.activeEditor.editor.cm;
		const from = view.state.doc.toString().indexOf(block);
		const root = [...view.contentDOM.querySelectorAll('.iw-preview')].find(e => view.posAtDOM(e) === from);
		const element = root?.querySelector(enter) ?? root;
		const r = element?.getBoundingClientRect();
		if (!r) return null;
		const point = enter ? { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 30) } : { x: r.right - 20, y: r.top + r.height / 2 };
		const hit = document.elementFromPoint(point.x, point.y);
		return { ...point, hit: hit && `${hit.tagName}.${[...hit.classList].join('.')}` };
	}, { block, enter });
	assert.ok(target, `${block}: blocco disegnato`);
	await assertHits(target, '.workspace-leaf.mod-active .cm-content .iw-preview', `${block}: ingresso`);
	await page.mouse.click(target.x, target.y);
	await page.waitForTimeout(600);
	const point = await page.evaluate(({ block, clicked }) => {
		const view = window.app.workspace.activeEditor.editor.cm;
		const text = view.state.doc.toString();
		const from = text.indexOf(block);
		if ([...view.contentDOM.querySelectorAll('.iw-preview')].some(e => view.posAtDOM(e) === from)) return { open: false };
		const at = text.indexOf(clicked);
		const c = view.coordsAtPos(at);
		const box = view.scrollDOM.getBoundingClientRect();
		return { open: true, x: c.left + 25, y: (c.top + c.bottom) / 2, visible: c.top > box.top + 10 && c.bottom < box.bottom - 10 };
	}, { block, clicked });
	assert.ok(point.open, `${block}: il clic apre il Markdown (colpito ${target.hit})`);
	assert.ok(point.visible, `${clicked}: riga da cliccare visibile (${JSON.stringify(point)})`);
	await page.evaluate(({ block, clicked }) => {
		const view = window.app.workspace.activeEditor.editor.cm;
		const text = view.state.doc.toString();
		const from = text.indexOf(block), at = text.indexOf(clicked);
		const gutter = () => {
			let worst = 0;
			for (const element of view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')) {
				const n = Number(element.textContent);
				const r = element.getBoundingClientRect();
				if (!n || r.height === 0 || n > view.state.doc.lines) continue;
				const node = view.domAtPos(view.state.doc.line(n).from).node;
				const line = (node.nodeType === 1 ? node : node.parentElement)?.closest('.cm-line');
				if (!line) continue;
				const l = line.getBoundingClientRect();
				if (l.bottom < 0 || l.top > innerHeight) continue;
				worst = Math.max(worst, Math.abs(l.top - r.top), Math.abs(l.height - r.height));
			}
			return worst;
		};
		// Distinct drawn elements: CodeMirror may also move a line it keeps.
		const seen = new Set();
		const probe = window.iwExitProbe = { frames: [], drawn: 0 };
		const mine = node => { try { return node.nodeType === 1 && node.matches('.iw-preview') && view.posAtDOM(node) === from; } catch { return false; } };
		const note = node => { if (mine(node) && !seen.has(node)) { seen.add(node); probe.drawn++; } };
		probe.observer = new MutationObserver(records => {
			for (const record of records) for (const node of record.addedNodes) {
				if (node.nodeType !== 1) continue;
				note(node);
				for (const inner of node.querySelectorAll('.iw-preview')) note(inner);
			}
		});
		probe.observer.observe(view.contentDOM, { childList: true, subtree: true });
		const t0 = performance.now();
		const tick = () => {
			probe.frames.push({ drawn: [...view.contentDOM.querySelectorAll('.iw-preview')].some(e => { try { return view.posAtDOM(e) === from; } catch { return false; } }),
				line: view.coordsAtPos(at)?.top ?? null, gutter: gutter() });
			if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else probe.observer.disconnect();
		};
		requestAnimationFrame(tick);
	}, { block, clicked });
	// A few frames of the Markdown before the click, the reference for the line.
	await page.waitForFunction(() => window.iwExitProbe.frames.length >= 3);
	await assertHits(point, '.workspace-leaf.mod-active .cm-content', `${clicked}: uscita`);
	await page.mouse.click(point.x, point.y);
	await page.waitForTimeout(1100);
	const { frames, drawn } = await page.evaluate(() => window.iwExitProbe);
	const before = frames.filter(f => !f.drawn).at(-1), after = frames.filter(f => f.drawn);
	return { frames: frames.length, after: after.length, drawn, shift: before && after.length ? Math.max(...after.map(f => Math.abs(f.line - before.line))) : null,
		gutter: Math.max(...frames.map(f => f.gutter)), gutterFrames: frames.filter(f => f.gutter > 1).length };
}

test('uscita col clic: riga cliccata ferma, numeri di riga allineati in ogni fotogramma, blocco disegnato una volta', async () => {
	const { page } = obsidian;
	await page.evaluate(() => window.app.vault.setConfig('showLineNumber', true));
	const results = [];
	try {
		// Not open(): its caret at the last line leaves these blocks off screen.
		await openNote(page, 'UscitaTitoli.md', 'live');
		await pointerAway();
		await page.evaluate(() => window.app.workspace.activeEditor.editor.setCursor(0, 0));
		await page.waitForTimeout(800);
		const cases = [
			['H2 sinistra, sotto', '[wrap:start] %%iw-wrap side=left%%\n\n![[gutter-tall.png|167]]\n\n## Titolo due', 'Sotto wrap H2.', 'h2', 3],
			['H2 sinistra, sopra', '[wrap:start] %%iw-wrap side=left%%\n\n![[gutter-tall.png|167]]\n\n## Titolo due', 'Sopra wrap H2.', 'h2', 1],
			['H3 destra, sotto', '[wrap:start] %%iw-wrap side=right%%', 'Sotto wrap H3.', 'h3', 2],
			['H3 destra, sopra', '[wrap:start] %%iw-wrap side=right%%', 'Sopra wrap H3.', 'h3', 1],
			['senza titolo, sotto', '[wrap:start] %%iw-wrap side=left%%\n\n![[gutter-tall.png|167]]\n\nParagrafo', 'Sotto wrap semplice.', '.iw-first-paragraph', 1],
			['riga di immagini, sotto', '![[a.png|180]] ![[gutter-tall.png|180]]', 'Sotto riga.', null, 1],
		];
		for (const [name, block, clicked, enter, cycles] of cases) for (let cycle = 1; cycle <= cycles; cycle++) {
			const result = { name, cycle, ...await exitAndMeasure(block, clicked, enter, name.endsWith('sopra') ? 480 : 20) };
			results.push(result);
		}
	} finally {
		record({ kind: 'environment', case: 'exit-click-frames', results });
		await page.evaluate(() => window.app.vault.setConfig('showLineNumber', false));
	}
	const failures = results.filter(r => !(r.after > 20 && r.shift !== null && r.shift <= 1 && r.gutter <= 1 && r.drawn === 1));
	assert.deepEqual(failures, [], JSON.stringify(results));
});

test('nessun errore o avviso del plugin nella console di Obsidian', async () => {
	// Kept in a file even when empty (and in the registry, which keeps every
	// run): a rare error must not get lost in the output.
	const lines = [...obsidian.errors.map(e => ({ ...e, level: 'error' })), ...obsidian.warnings.map(w => ({ ...w, level: 'warning' }))];
	await writeFile(join(shots, 'errori-console.txt'), lines.map(e => `[${e.level}] [${e.source}] [${e.test}]\n${e.text}`).join('\n---\n'));
	const outcome = consoleOutcome(obsidian.errors, obsidian.warnings);
	const toReview = [outcome.reviewWarnings.length && `${outcome.reviewWarnings.length} avvisi esterni/incerti`,
		outcome.reviewErrors.length && `${outcome.reviewErrors.length} errori esterni di chiusura di una finestra`].filter(Boolean);
	const review = toReview.length ? `; da revisionare: ${toReview.join(', ')}` : '; console pulita';
	console.log(`# console: ${outcome.blockingErrors.length} errori bloccanti, ${outcome.pluginWarnings.length} avvisi del plugin${review}; registro in ${registryFile()}`);
	assert.deepEqual(outcome.blocking.map(e => `[${e.source}] [${e.test}] ${e.text}${e.frames?.length ? ` (${e.frames.join(' ← ')})` : ''}`), []);
});
