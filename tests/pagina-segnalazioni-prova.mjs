// Check of tests/pagina-segnalazioni.mjs, the collection of the Chromium suites,
// in the browser itself (not in Electron): errors provoked on purpose in a page
// of its own. What it collects stays in memory, never in the project's
// registry; only this file's test results go there. Run with `npm run
// test:browser`.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { currentRun, registry } from './registro.mjs';
import { assertRunConsoleIsolation } from './registro-isolamento.mjs';
import { runWithEvidence, watchPage } from './pagina-segnalazioni.mjs';

const identity = Object.freeze({ ...currentRun() });
const LOOP = 'ResizeObserver loop completed with undelivered notifications.';
let browser, page, watch, dir;
const kept = [];
const record = entry => kept.push(entry);
const run = () => 'prova-0000';
const settle = () => page.waitForTimeout(300);
const seen = text => watch.observations.filter(entry => entry.text.includes(text));
const channels = text => seen(text).map(entry => entry.event ?? 'console').sort();

before(async () => {
	browser = await chromium.launch({ headless: true });
	page = await browser.newPage();
	watch = await watchPage(page, { label: 'prova', record });
	dir = await mkdtemp(join(tmpdir(), 'iw-pagina-segnalazioni-'));
});
after(async () => {
	await browser?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

test('console error e warning: livello, pagina, test, momento, senza attribuzione inventata', async t => {
	watch.test = t.name;
	await page.evaluate(() => { console.error('prova: console error'); console.warn('prova: console warning'); });
	await settle();
	assert.equal(watch.errors.filter(entry => entry.text === 'prova: console error').length, 1);
	assert.equal(watch.warnings.filter(entry => entry.text === 'prova: console warning').length, 1);
	for (const entry of seen('prova: console')) {
		assert.equal(entry.event, undefined, 'canale della console');
		assert.equal(entry.page, 'prova');
		assert.equal(entry.test, t.name);
		assert.ok(Number.isFinite(entry.observedAt));
		// No frame of ours: its technical source stays uncertain.
		assert.equal(entry.source, 'uncertain');
	}
	const records = kept.filter(entry => entry.kind === 'console' && entry.text.startsWith('prova: console'));
	assert.equal(records.length, 2);
	assert.ok(records.every(entry => entry.page === 'prova' && entry.test === t.name && typeof entry.observedAt === 'string'), JSON.stringify(records));
});

test('console multiriga: testo originale completo e stack di attribuzione separato', async t => {
	watch.test = t.name;
	const raw = [];
	const listen = message => { if (['error', 'warning'].includes(message.type())) raw.push(message.text()); };
	page.on('console', listen);
	try {
		await page.evaluate(() => {
			console.warn('prova: multiriga\nDETTAGLIO UNICO\n' + 'x'.repeat(3000));
			console.error(new Error('prova: oggetto multiriga\nDETTAGLIO ERRORE'));
		});
		await settle();
		const records = kept.filter(entry => entry.test === t.name && !entry.event);
		assert.deepEqual(records.map(entry => entry.text), raw);
		assert.ok(records[0].text.includes('DETTAGLIO UNICO') && records[0].text.length > 3000);
		assert.ok(records[1].text.includes('DETTAGLIO ERRORE'));
		assert.ok(records.every(entry => typeof entry.attributionStack === 'string'));
	} finally { page.off('console', listen); }
});

test('un’eccezione non catturata arriva a pageerror e all’evento error della finestra, con lo stack', async t => {
	watch.test = t.name;
	await page.evaluate(() => { setTimeout(() => { throw new Error('prova: eccezione'); }); });
	await settle();
	assert.deepEqual(channels('prova: eccezione'), ['pageerror', 'window-error']);
	assert.ok(kept.filter(entry => entry.text?.includes('prova: eccezione')).every(entry => entry.stack?.includes('prova: eccezione')), 'stack conservato');
});

test('un ciclo di ResizeObserver arriva solo all’evento error della finestra, con provenienza incerta', async t => {
	watch.test = t.name;
	await page.evaluate(() => new Promise(resolve => {
		const box = document.body.appendChild(document.createElement('div'));
		box.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px';
		let width = 10;
		const observer = new ResizeObserver(() => { width += 1; box.style.width = `${width}px`; });
		observer.observe(box);
		setTimeout(() => { observer.disconnect(); box.remove(); resolve(); }, 300);
	}));
	await settle();
	const loops = seen(LOOP);
	assert.ok(loops.length > 0, JSON.stringify(watch.observations));
	assert.ok(loops.every(entry => entry.event === 'window-error' && entry.source === 'uncertain'), JSON.stringify(loops));
});

test('una promessa rifiutata senza gestore arriva all’evento unhandledrejection', async t => {
	watch.test = t.name;
	await page.evaluate(() => { setTimeout(() => { Promise.reject(new Error('prova: promessa rifiutata')); }); });
	await settle();
	const rejected = channels('prova: promessa rifiutata');
	// Chromium also reports it as an uncaught exception: two observations of one event.
	assert.deepEqual(rejected, ['pageerror', 'unhandledrejection']);
});

test('due eventi distinti con lo stesso messaggio restano due, per ogni canale', async t => {
	watch.test = t.name;
	await page.evaluate(() => { for (let index = 0; index < 2; index++) setTimeout(() => { throw new Error('prova: stesso messaggio'); }); });
	await settle();
	assert.deepEqual(channels('prova: stesso messaggio'), ['pageerror', 'pageerror', 'window-error', 'window-error']);
});

test('dopo setContent gli ascolti si riarmano, dopo una navigazione tornano da soli', async t => {
	watch.test = t.name;
	await page.setContent('<p>pagina nuova</p>');
	await page.evaluate(() => { setTimeout(() => { throw new Error('prova: dopo setContent senza riarmo'); }); });
	await settle();
	// The new document took the window's listeners with it: only pageerror.
	assert.deepEqual(channels('prova: dopo setContent senza riarmo'), ['pageerror']);
	await watch.arm();
	await page.evaluate(() => { setTimeout(() => { throw new Error('prova: riarmata dopo setContent'); }); });
	await settle();
	assert.deepEqual(channels('prova: riarmata dopo setContent'), ['pageerror', 'window-error']);
	await page.goto('data:text/html,<p>navigazione</p>');
	await page.evaluate(() => { setTimeout(() => { throw new Error('prova: dopo la navigazione'); }); });
	await settle();
	assert.deepEqual(channels('prova: dopo la navigazione'), ['pageerror', 'window-error']);
});

test('un errore della pagina fa fallire il test, e un fallimento lascia una schermata con un nome mai riusato', async t => {
	watch.test = t.name;
	const failures = join(dir, 'fallimenti');
	await assert.rejects(runWithEvidence({ page, watch, name: 'prova fallita', failures, record, run, body: async () => { throw new Error('prova: test fallito'); } }), /prova: test fallito/);
	await assert.rejects(runWithEvidence({ page, watch, name: 'prova fallita', failures, record, run, body: async () => {
		await page.evaluate(() => { setTimeout(() => { throw new Error('prova: errore durante il test'); }); });
		await settle();
	} }), /errori nella pagina: .*prova: errore durante il test/);
	const files = (await readdir(failures)).sort();
	assert.equal(files.length, 2, JSON.stringify(files));
	for (const file of files) assert.deepEqual([...(await readFile(join(failures, file))).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${file}: PNG`);
	const shots = kept.filter(entry => entry.kind === 'screenshot' && entry.test === 'prova fallita');
	assert.deepEqual(shots.map(entry => entry.path).sort(), files.map(file => join(failures, file)));
	assert.equal(watch.test, 'prova fallita', 'le osservazioni del test portano il suo nome');
});

test('alla fine gli ascolti si tolgono, nulla viene più raccolto e nulla è arrivato al registro del progetto', async t => {
	watch.test = t.name;
	assert.equal(await watch.listening(), true);
	assert.equal(await watch.stop(), true);
	assert.equal(await watch.listening(), false);
	const before = watch.observations.length;
	await page.evaluate(() => { console.error('prova: dopo la fine'); setTimeout(() => { throw new Error('prova: dopo la fine'); }); });
	await settle();
	assert.equal(watch.observations.length, before, 'nessun ascolto rimasto');
	await assertRunConsoleIsolation(registry, identity);
});
