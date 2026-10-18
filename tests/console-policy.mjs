// Console policy shared by the real-app capture, its final oracle and the
// registry analysis. Attribution is structural: message text is never used.
// After a secondary window the tests opened has closed, Electron sometimes
// reports uncaught exceptions with neither a stack nor a location, also with
// the plugin disabled (seen 14–42 ms after the close). Such an event is
// external only when all of these hold together: an uncaught exception (not a
// console message), no stack frame and no location at all, and at most
// TEARDOWN_WINDOW_MS after a secondary window of the tests has closed. Its
// text plays no part. A plugin frame always wins (consoleSource).
export const TEARDOWN_WINDOW_MS = 200;
const hasLocation = text => /(?:https?|file|app|node|electron|chrome-extension|plugin):|:\d+(?::\d+)?\)?\s*$/m.test(text);
/** @param {{ event?: string, where?: string, stack?: string, sinceSecondaryClose?: number }} evidence */
export function windowTeardownError({ event, where = '', stack = '', sinceSecondaryClose }) {
	const frames = String(stack).split('\n').slice(1).filter(line => line.trim());
	return event === 'pageerror' && !where && !frames.length && !hasLocation(String(stack))
		&& Number.isFinite(sinceSecondaryClose) && sinceSecondaryClose >= 0 && sinceSecondaryClose <= TEARDOWN_WINDOW_MS;
}

// A location is evidence only when it names a script, or a line of a page. The
// page alone with no line, or line 0 (`app://obsidian.md/index.html:0:0`,
// `about:blank:0:0`), is where the browser puts an event no script raised, a
// ResizeObserver loop among them: it says nothing about who caused it.
function placeOf(where) {
	const [, url = '', line] = /^(.*?)(?::(\d+)(?::\d+)?)?$/.exec(String(where ?? '').trim()) ?? [];
	if (!url) return '';
	const page = /^about:/.test(url) || /\.html?(?:[?#].*)?$/i.test(url);
	return page && !(Number(line) > 0) ? '' : where;
}
// The frames of a stack, not its first line: that one is the message.
const stackFrames = stack => String(stack ?? '').split('\n').filter(line => /^\s*at\s/.test(line)).join('\n');

// The technical source of an observation, never its proven cause: `plugin` when
// a frame or a location leads to the plugin's code, `external` only when a
// frame or a location leads elsewhere (or windowTeardownError holds),
// `uncertain` otherwise. An error object (`hasError`) is accepted with the
// other metadata but proves nothing by itself: only the frames of its stack do.
/** @param {{ frames?: string[], where?: string, stack?: string, pluginId?: string, bundleUrls?: string[], event?: string, sinceSecondaryClose?: number, hasError?: boolean }} evidence */
export function consoleSource({ frames = [], where = '', stack = '', pluginId = 'image-rows-and-wraps', bundleUrls = [], event, sinceSecondaryClose }) {
	if (frames.some(frame => frame.startsWith('src/'))) return 'plugin';
	const location = `${where}\n${stack}`;
	if (bundleUrls.some(url => url && location.includes(url))) return 'plugin';
	const escapedId = pluginId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	if (new RegExp(`(?:plugins[\\\\/]+${escapedId}[\\\\/]|plugin:${escapedId}(?:[\\s/:]|$))`).test(location)) return 'plugin';
	if (placeOf(where) || /(?:https?|file|app|node|electron|chrome-extension):\/\/|(?:^|[\s(])\/?(?:[^\s():]+\/)+[^\s():]+:\d+/m.test(stackFrames(stack))) return 'external';
	if (frames.length === 0 && windowTeardownError({ event, where, stack, sinceSecondaryClose })) return 'external';
	return 'uncertain';
}

// Every error blocks, whatever its source, except an external one recognized
// by windowTeardownError (`teardown`): reviewed like external warnings.
export function consoleOutcome(errors, warnings) {
	const reviewErrors = errors.filter(entry => entry.source === 'external' && entry.teardown === true);
	const blockingErrors = errors.filter(entry => !reviewErrors.includes(entry));
	const pluginWarnings = warnings.filter(entry => entry.source === 'plugin');
	const reviewWarnings = warnings.filter(entry => entry.source !== 'plugin');
	const state = blockingErrors.length ? 'failed-error'
		: pluginWarnings.length ? 'failed-plugin-warning'
			: reviewWarnings.length || reviewErrors.length ? 'passed-with-review-warnings' : 'passed-clean';
	return { state, errors, blockingErrors, reviewErrors, pluginWarnings, reviewWarnings, blocking: [...blockingErrors, ...pluginWarnings] };
}

export function consoleReviewLabel(outcome) {
	const errors = outcome.reviewErrors?.length ? ` e ${outcome.reviewErrors.length} errori esterni di chiusura di una finestra` : '';
	if (outcome.reviewWarnings.length) return `⚠ ${outcome.reviewWarnings.length} avvisi esterni/incerti${errors} da revisionare`;
	if (errors) return `⚠ ${outcome.reviewErrors.length} errori esterni di chiusura di una finestra da revisionare`;
	return outcome.state === 'passed-clean' ? 'console pulita' : '';
}
