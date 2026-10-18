// The real-app bench's own check of what it collects: errors provoked on
// purpose, in the main window and in a separate one, must reach the bench
// through every channel that carries them, without merging occurrences.
// Started by tests/banco-errori-avvio.mjs (`npm run test:obsidian`, before the
// suite), never on its own: in an environment of its own, with its own vault,
// Obsidian profile and registry (tests/banco-errori-ambiente.mjs), so that
// the provoked errors are never mixed with those of the plugin's scenarios,
// never written to the registry of the project, and every run's results stay.
import { benchEnvironmentProblem, benchPaths, runEntries } from './banco-errori-ambiente.mjs';

// The variables are read when the modules load: wrong ones, and nothing is
// started, nothing written.
const paths = benchPaths();
const problem = benchEnvironmentProblem(paths);
if (problem) throw new Error(`${problem}: il controllo si avvia con node tests/banco-errori-avvio.mjs (npm run test:obsidian).`);
const { test, before, after, beforeEach, afterEach } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { mkdir } = await import('node:fs/promises');
const { join } = await import('node:path');
const { currentRun, registry } = await import('./registro.mjs');
const { bench, launchObsidian, prepareVault, record } = await import('./obsidian-app.mjs');
const { detachWorkspaceWindow } = await import('./obsidian-window.mjs');
if (registry !== paths.registry || bench !== paths.environment) {
	throw new Error(`ambiente del banco errori non applicato: registro ${registry}, ambiente ${bench}.`);
}

const LOOP = 'ResizeObserver loop completed with undelivered notifications.';
let obsidian;
before(async () => {
	await prepareVault({ 'Prova.md': 'Una nota.\n' }, []);
	obsidian = await launchObsidian();
});
after(async () => { await obsidian?.app.close(); });

// What the app writes is tagged with the test in progress.
beforeEach(t => { if (obsidian) obsidian.state.current = t.name; });
// A failed test leaves the app as it was in fallimenti/, never overwritten
// (the time and this run's id in the name), and its path in the registry.
afterEach(async t => {
	if (!obsidian || t.passed !== false) return;
	const name = t.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80);
	const failure = join(paths.failures, `${new Date().toISOString().replace(/[:.]/g, '-')}-${currentRun().run.slice(-4)}-${name}.png`);
	await mkdir(paths.failures, { recursive: true });
	try {
		await obsidian.page.screenshot({ path: failure });
		record({ kind: 'screenshot', test: t.name, path: failure });
	} catch (error) {
		record({ kind: 'screenshot', test: t.name, missing: true, reason: String(error?.message ?? error).split('\n')[0] });
	}
});

// A box that changes its own width from its ResizeObserver notification, a few
// frames long, then removed: the browser reports the loop on the window.
const provokeLoop = () => {
	const win = window.iwProvaFinestra ?? window;
	const box = win.document.body.createDiv();
	box.setAttr('style', 'position:fixed;left:0;top:0;width:10px;height:10px');
	let width = 10;
	const observer = new win.ResizeObserver(() => { width += 1; box.style.width = `${width}px`; });
	observer.observe(box);
	return new Promise(resolve => win.setTimeout(() => { observer.disconnect(); box.remove(); resolve(); }, 300));
};
const found = text => obsidian.errors.filter(entry => entry.text.includes(text));
const foundWarnings = text => obsidian.warnings.filter(entry => entry.text.includes(text));
// A separate window opened by a test, once the bench has given it its number.
const openSeparate = async () => {
	const opened = obsidian.page.context().waitForEvent('page');
	await obsidian.page.evaluate(() => {
		const leaf = window.app.workspace.openPopoutLeaf();
		window.iwProvaFoglia = leaf;
		// The separate window itself (the leaf's view may still belong to the main one).
		window.iwProvaFinestra = leaf.getContainer().win;
	});
	await opened;
	await obsidian.page.waitForFunction(() => window.iwProvaFinestra !== window && window.iwProvaFinestra.document.readyState === 'complete' && window.iwProvaFinestra.document.body);
	await obsidian.page.waitForFunction(() => Number.isInteger(window.iwProvaFinestra.iwBenchWindowId));
	await obsidian.page.waitForTimeout(500);
	return obsidian.page.evaluate(() => window.iwProvaFinestra.iwBenchWindowId);
};
const closeSeparate = async () => {
	await obsidian.page.evaluate(() => { window.iwProvaFoglia?.detach(); delete window.iwProvaFoglia; delete window.iwProvaFinestra; });
	await obsidian.page.waitForTimeout(300);
};
// Code run by a script of the separate window, in that window's own context.
const inSeparate = code => obsidian.page.evaluate(code => {
	const win = window.iwProvaFinestra;
	const script = win.document.createElement('script');
	script.textContent = code;
	win.document.head.append(script);
}, code);

test('console multiriga: ogni messaggio originale rimane intero e distinto dallo stack di attribuzione', async () => {
	const raw = [];
	const onConsole = message => { if (['error', 'warning'].includes(message.type())) raw.push(message.text()); };
	obsidian.page.on('console', onConsole);
	const run = currentRun().run;
	try {
		await obsidian.page.evaluate(() => {
			console.warn('banco: multiriga\nDETTAGLIO UNICO\n' + 'x'.repeat(3000));
			console.error(new Error('banco: oggetto multiriga\nDETTAGLIO ERRORE'));
		});
		await obsidian.page.waitForTimeout(300);
		const records = (await runEntries(paths.registry, run)).filter(entry => entry.kind === 'console' && !entry.event && (entry.text.startsWith('banco: multiriga') || entry.text.startsWith('Error: banco: oggetto multiriga')));
		assert.deepEqual(records.map(entry => entry.text), raw);
		assert.ok(records[0].text.length > 3000);
		assert.ok(records.every(entry => typeof entry.attributionStack === 'string'));
	} finally { obsidian.page.off('console', onConsole); }
});

test('un ciclo di ResizeObserver nella finestra principale arriva al banco come evento error della finestra', async () => {
	await obsidian.page.evaluate(provokeLoop);
	await obsidian.page.waitForTimeout(300);
	const loops = found(LOOP);
	assert.ok(loops.length > 0, `nessuna segnalazione raccolta; errori: ${JSON.stringify(obsidian.errors)}`);
	assert.ok(loops.every(entry => entry.event === 'window-error' && entry.window === 'principale'), JSON.stringify(loops));
	assert.ok(loops.every(entry => entry.source !== 'plugin'), 'mai attribuita al plugin');
});

test('un’eccezione lanciata nella finestra principale conserva entrambi i canali', async () => {
	const text = 'banco: eccezione di prova nella finestra principale';
	await obsidian.page.evaluate(message => { window.setTimeout(() => { throw new Error(message); }); }, text);
	await obsidian.page.waitForTimeout(300);
	const seen = found(text);
	assert.equal(seen.length, 2, JSON.stringify(seen));
	assert.equal(seen.filter(entry => entry.event === 'pageerror').length, 1);
	assert.equal(seen.filter(entry => entry.event === 'window-error' && entry.window === 'principale').length, 1);
});

test('reportError e valori lanciati: ogni evento della finestra principale resta raccolto', async () => {
	const raw = [];
	const observations = [];
	const pageErrors = [];
	const onPageError = error => pageErrors.push(error);
	obsidian.page.on('pageerror', onPageError);
	await obsidian.page.exposeBinding('iwBenchRawError', (_source, report) => raw.push(report));
	await obsidian.page.evaluate(() => {
		window.iwBenchRawListener = event => window.iwBenchRawError({ trusted: event.isTrusted, absent: event.error == null });
		window.addEventListener('error', window.iwBenchRawListener);
	});
	try {
		for (const kind of ['error', 'string', 'object', 'zero', 'false', 'null', 'undefined']) {
			for (const method of ['report', 'throw']) {
				const before = obsidian.errors.length;
				const rawBefore = raw.length, pageBefore = pageErrors.length;
				await obsidian.page.evaluate(({ kind, method }) => {
					const values = { error: new Error('banco: valore ripetuto'), string: 'banco: stringa',
						object: { message: 'banco: oggetto' }, zero: 0, false: false, null: null, undefined: undefined };
					const value = values[kind];
					if (method === 'report') window.reportError(value);
					else window.setTimeout(() => { throw value; });
				}, { kind, method });
				await obsidian.page.waitForTimeout(300);
				const seen = obsidian.errors.slice(before);
				const windows = seen.filter(entry => entry.event === 'window-error');
				assert.equal(raw.length - rawBefore, 1, `${method} ${kind}: un evento nativo`);
				assert.equal(raw.at(-1).trusted, true, `${method} ${kind}: evento del browser`);
				observations.push({ method, kind, windowEvents: raw.length - rawBefore, pageErrors: pageErrors.length - pageBefore,
					collectedWindows: windows.length, collected: seen.length });
			}
		}
		console.log(JSON.stringify(observations));
		for (const entry of observations) {
			assert.equal(entry.collectedWindows, entry.windowEvents, `${entry.method} ${entry.kind}: evento perso`);
			assert.equal(entry.collected, entry.windowEvents + entry.pageErrors, JSON.stringify(entry));
		}
	} finally {
		obsidian.page.off('pageerror', onPageError);
		await obsidian.page.evaluate(() => { window.removeEventListener('error', window.iwBenchRawListener); delete window.iwBenchRawListener; });
	}
});

test('un evento con valore lanciato senza pageerror e i messaggi di console restano raccolti', async () => {
	const text = 'banco: evento senza pageerror';
	const before = obsidian.errors.length;
	await obsidian.page.evaluate(message => {
		window.dispatchEvent(new ErrorEvent('error', { message, error: new Error(message) }));
		console.error('banco: console error');
		console.warn('banco: console warning');
	}, text);
	await obsidian.page.waitForTimeout(300);
	const seen = obsidian.errors.slice(before).filter(entry => entry.text.includes(text));
	assert.equal(seen.length, 1, JSON.stringify(seen));
	assert.equal(seen[0].event, 'window-error');
	assert.equal(found('banco: console error').length, 1);
	assert.equal(obsidian.warnings.filter(entry => entry.text === 'banco: console warning').length, 1);
});

test('due eccezioni con lo stesso messaggio conservano ogni occorrenza e canale', async () => {
	const text = 'banco: due occorrenze identiche';
	await obsidian.page.evaluate(message => {
		for (let index = 0; index < 2; index++) window.setTimeout(() => { throw new Error(message); });
	}, text);
	await obsidian.page.waitForTimeout(300);
	const seen = found(text);
	assert.equal(seen.length, 4, JSON.stringify(seen));
	assert.equal(seen.filter(entry => entry.event === 'pageerror').length, 2);
	assert.equal(seen.filter(entry => entry.event === 'window-error').length, 2);
});

test('in una finestra separata arrivano il ciclo di ResizeObserver e un’eccezione del suo contesto, su entrambi i canali', async () => {
	const windowId = await openSeparate();
	try {
		// A ResizeObserver of the separate window with a callback of the main
		// one, as the plugin's widgets do: the loop is reported to the separate window.
		await obsidian.page.evaluate(provokeLoop);
		const text = 'banco: eccezione di prova nella finestra separata';
		await inSeparate(`setTimeout(() => { throw new Error(${JSON.stringify(text)}); });`);
		await obsidian.page.waitForTimeout(300);
		const loops = found(LOOP).filter(entry => entry.window === 'separata');
		assert.ok(loops.length > 0, `ciclo nella finestra separata non raccolto; errori: ${JSON.stringify(obsidian.errors)}`);
		assert.ok(loops.every(entry => entry.event === 'window-error' && entry.windowId === windowId), JSON.stringify(loops));
		// Thrown by a script of the separate window: its page's pageerror and
		// its own `error` event, once each, both with that window's number.
		const thrown = found(text);
		assert.equal(thrown.length, 2, JSON.stringify(thrown));
		assert.deepEqual(thrown.map(entry => entry.event).sort(), ['pageerror', 'window-error']);
		assert.ok(thrown.every(entry => entry.window === 'separata' && entry.windowId === windowId), JSON.stringify(thrown));
		assert.ok([...loops, ...thrown].every(entry => entry.source !== 'plugin'), 'mai attribuite al plugin');
	} finally {
		await closeSeparate();
	}
});

test('console error e warning di una finestra separata arrivano con la finestra e il suo numero', async () => {
	const windowId = await openSeparate();
	try {
		assert.ok(windowId > 0, `numero della finestra: ${windowId}`);
		await inSeparate("console.error('banco: console error nella separata'); console.warn('banco: console warning nella separata');");
		await obsidian.page.waitForTimeout(300);
		const logged = [...found('banco: console error nella separata'), ...foundWarnings('banco: console warning nella separata')];
		assert.equal(logged.length, 2, JSON.stringify(logged));
		assert.ok(logged.every(entry => entry.event === undefined && entry.window === 'separata' && entry.windowId === windowId), JSON.stringify(logged));
		assert.ok(found('banco: console warning nella separata').length === 0, 'un warning resta un warning');
	} finally {
		await closeSeparate();
	}
});

test('una promessa rifiutata senza gestore nella principale e in una separata arriva all’evento unhandledrejection della sua finestra', async () => {
	const main = 'banco: promessa rifiutata nella principale';
	await obsidian.page.evaluate(message => { window.setTimeout(() => { Promise.reject(new Error(message)); }); }, main);
	await obsidian.page.waitForTimeout(300);
	const inMain = found(main);
	const mainRejections = inMain.filter(entry => entry.event === 'unhandledrejection');
	assert.equal(mainRejections.length, 1, JSON.stringify(inMain));
	assert.ok(mainRejections[0].window === 'principale' && mainRejections[0].windowId === 0, JSON.stringify(mainRejections));
	const windowId = await openSeparate();
	try {
		const separate = 'banco: promessa rifiutata nella separata';
		await inSeparate(`setTimeout(() => { Promise.reject(new Error(${JSON.stringify(separate)})); });`);
		await obsidian.page.waitForTimeout(300);
		const inSeparateWindow = found(separate);
		const rejections = inSeparateWindow.filter(entry => entry.event === 'unhandledrejection');
		assert.equal(rejections.length, 1, JSON.stringify(inSeparateWindow));
		assert.ok(rejections[0].window === 'separata' && rejections[0].windowId === windowId, JSON.stringify(rejections));
		// Each also reaches its page's pageerror: two observations of one event,
		// in the same window, kept apart by channel and never merged away.
		assert.deepEqual(inMain.map(entry => entry.event).sort(), ['pageerror', 'unhandledrejection']);
		assert.deepEqual(inSeparateWindow.map(entry => entry.event).sort(), ['pageerror', 'unhandledrejection']);
		assert.ok(inMain.every(entry => entry.window === 'principale' && entry.windowId === 0), JSON.stringify(inMain));
		assert.ok(inSeparateWindow.every(entry => entry.window === 'separata' && entry.windowId === windowId), JSON.stringify(inSeparateWindow));
	} finally {
		await closeSeparate();
	}
});

test('una finestra chiusa perde i suoi ascolti; dopo una ricarica della principale gli ascolti ripartono, anche per le finestre già aperte', async () => {
	const before = await obsidian.listening();
	assert.deepEqual(before, { pages: 0, windows: 1 }, 'solo la principale prima della prova');
	await openSeparate();
	assert.deepEqual(await obsidian.listening(), { pages: 1, windows: 2 }, 'principale e separata ascoltate');
	await closeSeparate();
	assert.deepEqual(await obsidian.listening(), { pages: 0, windows: 1 }, 'gli ascolti della separata tolti alla chiusura');
	// A separate window left open across a reload of the main one.
	await openSeparate();
	await obsidian.page.evaluate(() => window.app.workspace.requestSaveLayout?.());
	await obsidian.page.waitForTimeout(1500);
	await obsidian.page.reload();
	await obsidian.page.waitForFunction(() => window.app?.workspace?.layoutReady && typeof window.iwWindowErrors === 'function', null, { timeout: 60000 });
	await obsidian.page.waitForTimeout(1000);
	const after = await obsidian.listening();
	const present = await obsidian.page.evaluate(() => (window.app.workspace.floatingSplit?.children ?? []).map(split => split.win.iwBenchWindowId ?? null));
	const pages = obsidian.page.context().pages().filter(other => other !== obsidian.page && !other.isClosed()).length;
	// A window open before the reload that the workspace no longer has (seen on
	// Linux: the app reopens the separate window and the old one stays open):
	// still followed as a page, with its number, for its console and exceptions.
	const orphans = [];
	for (const other of obsidian.page.context().pages()) {
		if (other === obsidian.page || other.isClosed()) continue;
		const id = await other.evaluate(() => window.iwBenchWindowId).catch(() => null);
		if (!present.includes(id)) orphans.push({ other, id });
	}
	console.log(JSON.stringify({ after, present, pages, orphans: orphans.map(({ other, id }) => ({ id, url: other.url() })) }));
	// Every window of the app after the reload is listened, with a number.
	assert.equal(after.pages, pages, 'ogni pagina secondaria seguita');
	assert.equal(after.windows, 1 + present.length, 'ogni finestra con gli ascolti nella pagina');
	assert.ok(present.every(id => Number.isInteger(id) && id > 0), JSON.stringify(present));
	const text = 'banco: eccezione dopo la ricarica';
	await obsidian.page.evaluate(message => { window.setTimeout(() => { throw new Error(message); }); }, text);
	await obsidian.page.waitForTimeout(300);
	assert.deepEqual(found(text).map(entry => `${entry.event} ${entry.window} ${entry.windowId}`).sort(), ['pageerror principale 0', 'window-error principale 0']);
	if (present.length) {
		// A window already open when the listening started again.
		const restored = 'banco: eccezione in una finestra già aperta';
		await obsidian.page.evaluate(message => {
			const win = window.app.workspace.floatingSplit.children[0].win;
			const script = win.document.createElement('script');
			script.textContent = `setTimeout(() => { throw new Error(${JSON.stringify(message)}); });`;
			win.document.head.append(script);
		}, restored);
		await obsidian.page.waitForTimeout(300);
		assert.deepEqual(found(restored).map(entry => `${entry.event} ${entry.window} ${entry.windowId}`).sort(),
			[`pageerror separata ${present[0]}`, `window-error separata ${present[0]}`]);
	}
	for (const { other, id } of orphans) {
		assert.ok(Number.isInteger(id) && id > 0, `finestra rimasta senza numero: ${id}`);
		const orphan = `banco: console error in una finestra rimasta aperta ${id}`;
		await other.evaluate(message => { console.error(message); }, orphan);
		await obsidian.page.waitForTimeout(300);
		assert.deepEqual(found(orphan).map(entry => `${entry.window} ${entry.windowId}`), [`separata ${id}`]);
	}
	await obsidian.page.evaluate(() => {
		const leaves = [];
		window.app.workspace.iterateAllLeaves(leaf => { if (leaf.getContainer().win !== window) leaves.push(leaf); });
		for (const leaf of leaves) leaf.detach();
	});
	for (const { other, id } of orphans) {
  if (other.isClosed()) continue;
  const owned = await other.evaluate(() => {
   let count = 0;
   window.app?.workspace?.iterateAllLeaves(leaf => { if (leaf.getContainer().doc === document) count++; });
   return count;
  });
  if (owned) await detachWorkspaceWindow(other);
  else {
   // Intentionally adverse: the workspace no longer owns this window.
   // Keep the close marker and every collected event; never claim native cleanup.
   record({kind: 'environment', case: 'post-reload-orphan-forced-close', windowId: id, url: other.url()});
   await other.close();
  }
 }
	await obsidian.page.waitForTimeout(500);
	assert.deepEqual(await obsidian.listening(), { pages: 0, windows: 1 }, 'dopo la chiusura resta solo la principale');
});

test('le segnalazioni restano nel registro proprio del controllo, con il canale e la finestra', async () => {
	// This run's lines only, from every day it wrote into: the earlier runs stay
	// in the registry and must not satisfy the check.
	const lines = await runEntries(registry, currentRun().run);
	const loops = lines.filter(entry => entry.kind === 'console' && entry.text === LOOP);
	assert.ok(loops.some(entry => entry.window === 'principale') && loops.some(entry => entry.window === 'separata'), JSON.stringify(loops));
	assert.ok(loops.every(entry => entry.event === 'window-error' && entry.suite === 'banco-errori'), JSON.stringify(loops));
	const rejections = lines.filter(entry => entry.kind === 'console' && entry.event === 'unhandledrejection');
	assert.ok(rejections.some(entry => entry.window === 'principale') && rejections.some(entry => entry.window === 'separata'), JSON.stringify(rejections));
	const separate = lines.filter(entry => entry.kind === 'console' && entry.window === 'separata');
	assert.ok(separate.some(entry => entry.event === 'pageerror') && separate.some(entry => entry.event === undefined), 'eccezioni e console della separata');
	assert.ok(lines.filter(entry => entry.kind === 'console' && entry.event).every(entry => 'windowId' in entry && entry.observedAt), 'finestra e tempo di ogni osservazione');
	assert.equal(registry, paths.registry, 'registro proprio');
	// Nothing of this run in the project's registry.
	const project = join(process.cwd(), '.obsidian-test', 'registro');
	assert.deepEqual(await runEntries(project, currentRun().run).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), [], 'registro del progetto');
});

test('alla chiusura gli ascolti vengono tolti e nulla viene più raccolto', async () => {
	assert.deepEqual(await obsidian.stop(), { pages: 0, windows: 1 });
	assert.deepEqual(await obsidian.listening(), { pages: 0, windows: 0 });
	const before = obsidian.errors.length;
	await obsidian.page.evaluate(() => { window.setTimeout(() => { throw new Error('banco: dopo la chiusura degli ascolti'); }); });
	await obsidian.page.waitForTimeout(300);
	assert.equal(obsidian.errors.length, before, 'nessun ascolto rimasto');
});
