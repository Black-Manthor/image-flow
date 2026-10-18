// The environment of the real-app bench's own check (tests/banco-errori.mjs),
// under .obsidian-test/banco-errori/:
//   ambiente/    its vault, Obsidian profile and source map, recreated when the
//                check starts and left as they are until its next run;
//   registro/    its registry: every run kept, with its results and its end;
//   fallimenti/  the app as each failed test left it, never overwritten.
// Only the Obsidian runtimes of .obsidian-test/ are shared, and only read. The
// errors it provokes on purpose stay there, out of the project's registry.
// Started by tests/banco-errori-avvio.mjs; no side effect when imported.
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const SUITE = 'banco-errori';
export const CHECK = 'tests/banco-errori.mjs';

/** Where the check keeps its environment, its registry and its failures. */
export function benchPaths(dir = join(process.cwd(), '.obsidian-test', 'banco-errori')) {
	const base = resolve(dir);
	return { dir: base, environment: join(base, 'ambiente'), registry: join(base, 'registro'), failures: join(base, 'fallimenti') };
}

/** `env` with the variables the check reads when its modules load. */
export function benchEnvironment(paths = benchPaths(), env = process.env) {
	return { ...env, IW_REGISTRO: paths.registry, IW_BANCO: paths.environment, IW_SUITE: SUITE };
}

/** Which of those variables `env` lacks or sets otherwise, or undefined. */
export function benchEnvironmentProblem(paths = benchPaths(), env = process.env) {
	const wrong = Object.entries(benchEnvironment(paths, {})).filter(([name, value]) => env[name] !== value).map(([name]) => name);
	return wrong.length ? `ambiente del banco errori non impostato (${wrong.join(', ')})` : undefined;
}

/**
 * One run's lines of a registry, in order. Its files are named after the UTC
 * day: a run that goes past midnight writes into two of them, so every file
 * from the day the run started on is read, and only that run's lines kept.
 * @param {string} registry the registry folder
 * @param {string} run the run's id, which starts with its ISO time
 */
export async function runEntries(registry, run) {
	const first = `${run.slice(0, 10)}.jsonl`;
	const files = (await readdir(registry)).filter(file => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file) && file >= first).sort();
	const entries = [];
	for (const file of files) {
		for (const line of (await readFile(join(registry, file), 'utf8')).split('\n')) {
			if (!line) continue;
			const entry = JSON.parse(line);
			if (entry.run === run) entries.push(entry);
		}
	}
	return entries;
}

/**
 * Runs the check (`file`, a node:test file) with the bench's variables set
 * before it starts, so that every module, the registry's reporter included,
 * sees them from its first line. In a process group of its own: a Ctrl+C
 * reaches it once, forwarded from here (twice, it could cut its own record of
 * the interruption short), as does a signal sent to this process only.
 * Resolves to how it ended: its exit code, or the signal that stopped it.
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null, error?: Error }>}
 */
export function runBench({ file = CHECK, paths = benchPaths() } = {}) {
	return new Promise(done => {
		let requested, settled = false;
		const child = spawn(process.execPath, ['--test-reporter=spec', '--test-reporter-destination=stdout',
			'--test-reporter=./tests/registro-reporter.mjs', '--test-reporter-destination=stderr', file],
		{ stdio: 'inherit', env: benchEnvironment(paths), detached: true });
		const forward = signal => {
			if (requested) return;
			requested = signal;
			if (child.exitCode === null && child.signalCode === null) child.kill(signal);
		};
		const finish = outcome => {
			if (settled) return;
			settled = true;
			process.removeListener('SIGINT', forward);
			process.removeListener('SIGTERM', forward);
			done(outcome);
		};
		process.on('SIGINT', forward);
		process.on('SIGTERM', forward);
		child.once('error', error => finish({ code: null, signal: requested ?? null, error }));
		child.once('exit', (code, signal) => finish({ code, signal: requested ?? signal }));
	});
}

/** How the starter ends, for finishLikeChild (tests/registro-comando.mjs). */
export const benchEnding = outcome => ({ exitCode: outcome.error ? 1 : outcome.code, signal: outcome.signal ?? undefined });
