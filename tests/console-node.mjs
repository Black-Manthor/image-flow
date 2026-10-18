// The console of the Node suite (`npm test`): `console.warn` and `console.error`
// called while the tests run, kept for the registry. tests/run.mjs bundles this
// module first and names, in IW_CONSOLE_NODE, a file of its own where each call
// becomes one JSON line; the registry's reporter (tests/registro-reporter.mjs),
// which owns the run, transfers them incrementally. The original method is
// called once with the same this and arguments, returning its value. Objects
// are not inspected again for the journal. Nothing becomes a test failure.
//
// Attribution reads the public native context, without adapting test APIs or
// subscribing to tracing. The native signal marks late calls after completion,
// timeout or cancellation. Unavailable/root contexts never invent a test name.
import { hostname } from 'node:os';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { getTestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

function attribution() {
	const context = getTestContext();
	if (!context) return { outsideTest: true };
	// Root hooks have a native context too, but it is not a user test. A user
	// test named <root> is deliberately left uncertain rather than confused.
	if (context.name === '<root>' || typeof context.name !== 'string' || typeof context.filePath !== 'string') return { contextUnavailable: true };
	return { test: context.name, ...(context.signal.aborted ? { afterEnd: true } : {}) };
}

export const TEXT_LIMIT = 2000;
const STACK_LINES = 12;
// The runner's working directory is the project; import.meta.url belongs to
// its temporary bundle, while --enable-source-maps points stacks at sources.
const root = resolve(process.cwd());
// This collection's own frames, and those of the test wrapper, are not the caller.
const own = [fileURLToPath(import.meta.url), ...['console-node.mjs', 'node-test-contesto.mjs'].map(name => join(root, 'tests', name))];

// Objects/functions are placeholders; bigint is converted without JSON:
// even a primitive bigint can run a custom prototype toJSON through %j.
// The native console alone inspects/coerces/serializes the original arguments.
export function describeCall(args) {
	const prudent = args.some(value => value !== null && ['object', 'function', 'bigint'].includes(typeof value));
	const safe = args.map(value => value !== null && typeof value === 'object' ? '(oggetto non ispezionato)' : typeof value === 'function' ? '(funzione non ispezionata)' : typeof value === 'bigint' ? `${value}n` : value);
	let text;
	try { text = format(...safe); } catch (error) {
		try { text = `(valore non rappresentabile: ${String(error?.message ?? error)})`; } catch { text = '(valore non rappresentabile)'; }
	}
	return { text: text.slice(0, TEXT_LIMIT), ...(text.length > TEXT_LIMIT ? { truncated: text.length } : {}), ...(prudent ? { representation: 'prudent' } : {}) };
}

// The caller's place: the stack without the collection's own frames, and the
// project's frames (src/ or tests/), innermost first.
function place() {
	const lines = String(new Error().stack ?? '').split('\n').slice(1).filter(line => !own.some(file => line.includes(file)));
	const frames = [];
	for (const line of lines) {
		const match = /\(?((?:file:\/\/)?\/[^()\s]*?):(\d+):\d+\)?\s*$/.exec(line.trim());
		if (!match) continue;
		const path = match[1].startsWith('file:') ? fileURLToPath(match[1]) : match[1];
		const projectPath = relative(root, path).replaceAll(sep, '/');
		if (!/^(?:src|tests)\//.test(projectPath)) continue;
		const where = `${projectPath}:${match[2]}`;
		if (!frames.includes(where)) frames.push(where);
		if (frames.length >= 6) break;
	}
	return { frames, stack: lines.slice(0, STACK_LINES).map(line => line.trim()).join('\n') };
}

// `plugin` when the innermost frame of ours is in src/, `test` when in tests/,
// `uncertain` with no frame of ours (a library, Node itself): where the call
// technically comes from, not its cause.
const sourceOf = frames => frames[0]?.startsWith('src/') ? 'plugin' : frames[0]?.startsWith('tests/') ? 'test' : 'uncertain';

/**
 * Wraps `target.warn` and `target.error` and writes each call to `file`.
 * Returns how to undo it: a method another tool replaced meanwhile is left as
 * it is (the wrapper then records nothing more), and said so.
 */
export function install({ file, target = console, write = line => appendFileSync(file, line) }) {
	let seq = 0, active = true, lost = 0;
	const restored = [];
	const gaps = new Set();
	const methods = [['warn', 'warning'], ['error', 'error']].map(([method, level]) => {
		const original = target[method];
		const wrapper = function (...args) {
			if (active) {
				try {
					check();
					const { frames, stack } = place();
					write(`${JSON.stringify({
						seq: ++seq, level, ...describeCall(args), observedAt: new Date().toISOString(),
						...attribution(),
						source: sourceOf(frames), ...(frames.length ? { frames } : {}), ...(stack ? { stack } : {}),
					})}\n`);
				} catch { lost++; }
			}
			return original.apply(this, args);
		};
		target[method] = wrapper;
		return { method, original, wrapper };
	});
	// Known gaps remain known even when another tool later restores a wrapper.
	const check = () => {
		if (!active) return;
		for (const { method, wrapper } of methods) {
			try { if (target[method] !== wrapper) gaps.add(`console.${method}`); }
			catch { gaps.add(`console.${method}`); }
		}
	};
	return {
		check,
		uninstall() {
			check();
			active = false;
			for (const { method, original, wrapper } of methods) {
				if (target[method] === wrapper) { target[method] = original; restored.push(`console.${method} ripristinato`); }
				else restored.push(`console.${method} sostituito da altri nel frattempo: lasciato com'è`);
			}
			return { restored, lost, calls: seq, gaps: [...gaps] };
		},
	};
}

// The reporter closes after the native stream (including final hooks), not
// in a root after hook. On an early exit the raw journal remains incomplete.
// Without a co-located reporter, exit persists what was observed but cannot
// attest native completion. An earlier beforeExit is not such proof.
if (process.env.IW_CONSOLE_NODE) {
	appendFileSync(process.env.IW_CONSOLE_NODE, `${JSON.stringify({ writer: true, pid: process.pid, host: hostname() })}\n`);
	const write = line => {
		const metadata = `${process.env.IW_CONSOLE_NODE}.run.json`;
		const journalId = existsSync(metadata) ? JSON.parse(readFileSync(metadata, 'utf8')).journalId : undefined;
		appendFileSync(process.env.IW_CONSOLE_NODE, `${JSON.stringify({ ...JSON.parse(line), ...(journalId ? { journalId } : {}) })}\n`);
	};
	const collection = install({ file: process.env.IW_CONSOLE_NODE, write });
	// Sampling observes lasting replacements, not arbitrary changes between
	// samples. It never replaces another tool's methods or keeps Node alive.
	const sampling = setInterval(() => collection.check(), 50);
	sampling.unref();
	let closed = false;
	const close = completed => {
		if (closed) return;
		closed = true;
		clearInterval(sampling);
		process.removeListener('exit', onExit);
		process.removeListener('iw:console-node:close', close);
		const summary = collection.uninstall();
		const coverageComplete = completed === true && summary.lost === 0 && summary.gaps.length === 0 && summary.restored.every(line => line.endsWith('ripristinato'));
		try { write(`${JSON.stringify({ summary: true, ...summary, coverageComplete })}\n`); }
		catch { /* No closure record: transfer detects incomplete persistence. */ }
	};
	const onExit = () => close(false);
	process.prependOnceListener('exit', onExit);
	process.on('iw:console-node:close', close);
}
