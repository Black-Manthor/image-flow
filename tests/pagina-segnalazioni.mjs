// What a Chromium test page reports, for the Chromium suites (tests/browser.mjs,
// tests/row-layout-browser.mjs): console errors and warnings, uncaught
// exceptions (`pageerror`), and the window's own `error` and
// `unhandledrejection` events, which some errors reach alone (a ResizeObserver
// loop reaches only `error`). Every observation keeps its channel (`event`: none
// for the console), the page, the test, the time it was seen, its message,
// location and stack when there are any. One event may be observed by more than
// one channel (a thrown error is a `pageerror` and an `error` event): nothing is
// merged, by message or otherwise, and nothing is prevented or filtered.
//
// `source` is where the report technically comes from, not its cause: `plugin`
// when its innermost frame of ours is in src/, `pagina` when it has a frame of
// the test page's own code, `uncertain` when it carries no frame of ours at all.
// Errors go to `errors` and warnings to `warnings`: what they mean for a test is
// up to the suite (an error fails it, a warning is recorded).
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { currentRun, ourFrames, record as registryRecord } from './registro.mjs';

const BINDING = 'iwPaginaSegnalazione';

// Runs in the page, at every new document and again by `arm` (document.open,
// used by setContent, removes the window's listeners): one listener of each
// kind, the previous ones removed first.
function listenInPage(binding) {
	window.iwPaginaAscolti?.();
	const describe = value => {
		try {
			if (value && typeof value === 'object' && typeof value.message === 'string') return value.message;
			return String(value);
		} catch { return '(valore non rappresentabile)'; }
	};
	const report = (event, text, where, stack) => { try { window[binding]({ event, text, where, stack, observedAt: Date.now() }); } catch { /* binding gone */ } };
	const onError = event => report('window-error', event.message || describe(event.error),
		event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '', typeof event.error?.stack === 'string' ? event.error.stack : '');
	const onRejection = event => report('unhandledrejection', describe(event.reason), '', typeof event.reason?.stack === 'string' ? event.reason.stack : '');
	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onRejection);
	window.iwPaginaAscolti = () => {
		window.removeEventListener('error', onError);
		window.removeEventListener('unhandledrejection', onRejection);
		delete window.iwPaginaAscolti;
	};
}

/**
 * Starts listening to `page`, before the code under test runs: call `arm()`
 * after replacing the page's document with setContent (navigations re-arm by
 * themselves), and `stop()` when done.
 * @param {import('@playwright/test').Page} page
 * @param {{ label: string | number, bundles?: object[], record?: (entry: object) => void }} options
 */
export async function watchPage(page, { label, bundles = [], record = registryRecord }) {
	const watch = { test: '', errors: [], warnings: [], observations: [] };
	const note = (level, event, text, where, stack, observedAt = Date.now()) => {
		// A location of the report itself counts like a frame (a console message, an error event's script).
		const frames = ourFrames(`${stack ?? ''}${where && /:\d+:\d+$/.test(where) && !/:0:0$/.test(where) ? `\nat (${where})` : ''}`, bundles);
		const source = frames[0]?.startsWith('src/') ? 'plugin' : frames.length ? 'pagina' : 'uncertain';
		const observation = { level, source, test: watch.test, text, where, frames, ...(event === 'console' ? {} : { event }), page: label, observedAt };
		watch.observations.push(observation);
		(level === 'error' ? watch.errors : watch.warnings).push(observation);
		record({ kind: 'console', level, source, test: watch.test, text, where, ...(frames.length ? { frames } : {}),
			...(event === 'console' ? {} : { event }), ...(stack ? event === 'console' ? { attributionStack: stack } : { stack } : {}),
			page: label, observedAt: new Date(observedAt).toISOString() });
	};
	const onPageError = error => note('error', 'pageerror', error.message, '', error.stack ?? '');
	const onConsole = message => {
		const level = message.type();
		if (level !== 'error' && level !== 'warning') return;
		const { url = '', lineNumber = 0, columnNumber = 0 } = message.location() ?? {};
		// The text may hold a stack of its own (CodeMirror logs the error it caught): its frames first.
		const text = message.text();
		const [, ...stack] = text.split('\n');
		note(level, 'console', text, url, `${stack.join('\n')}\nat (${url}:${lineNumber + 1}:${columnNumber + 1})`);
	};
	page.on('pageerror', onPageError);
	page.on('console', onConsole);
	await page.exposeBinding(BINDING, (_source, report) => note('error', report.event, report.text, report.where, report.stack, report.observedAt));
	await page.addInitScript(listenInPage, BINDING);
	watch.arm = () => page.evaluate(listenInPage, BINDING);
	// Whether the page's own listeners are there (for the check of this module).
	watch.listening = () => page.evaluate(() => typeof window.iwPaginaAscolti === 'function');
	watch.stop = async () => {
		page.off('pageerror', onPageError);
		page.off('console', onConsole);
		return page.evaluate(() => { const had = typeof window.iwPaginaAscolti === 'function'; window.iwPaginaAscolti?.(); return had; }).catch(() => false);
	};
	await watch.arm();
	return watch;
}

let shots = 0;
/**
 * The page as a failed test left it, in `dir`, never overwritten (time, run and
 * a counter in the name), and its path in the registry; if it cannot be taken,
 * why.
 */
export async function failureScreenshot(page, test, dir, { record = registryRecord, run = () => currentRun().run } = {}) {
	const name = String(test).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80);
	const path = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${run().slice(-4)}-${++shots}-${name}.png`);
	try {
		await mkdir(dir, { recursive: true });
		await page.screenshot({ path });
		record({ kind: 'screenshot', test, path });
		return path;
	} catch (failure) {
		record({ kind: 'screenshot', test, missing: true, reason: String(failure?.message ?? failure).split('\n')[0] });
		return undefined;
	}
}

/**
 * Runs a test's body on a page shared by the tests of a file: the observations
 * are tagged with the test, an error reported by the page during it fails it,
 * and a failure leaves its screenshot in `failures`.
 */
export async function runWithEvidence({ page, watch, name, body, failures, record = registryRecord, run }) {
	watch.test = name;
	const before = watch.errors.length;
	try {
		await body();
		const reported = watch.errors.slice(before);
		if (reported.length) throw new Error(`errori nella pagina: ${reported.map(entry => `${entry.event ?? 'console'}: ${entry.text}`).join('; ')}`);
	} catch (error) {
		await failureScreenshot(page, name, failures, { record, ...(run ? { run } : {}) });
		throw error;
	}
}
