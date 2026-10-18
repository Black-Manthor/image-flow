// Runs build, latest-API checking, the two lints and the type check of the
// tests without changing their output, and records their outcome in the common
// diagnostic registry. Set
// IW_REGISTRO_COMANDI=0 only when an enclosing check already records the
// command, or when running in an isolated disposable copy.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { currentRun, record } from './registro.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const executable = path => fileURLToPath(new URL(path, import.meta.url));

export const commands = {
	build: [
		{ phase: 'type-check', executable: process.execPath, args: [executable('../node_modules/typescript/bin/tsc'), '-noEmit', '-skipLibCheck'] },
		// esbuild writes its counts of errors and warnings (esbuild.config.mjs).
		{ phase: 'bundle', executable: process.execPath, args: [fileURLToPath(new URL('../esbuild.config.mjs', import.meta.url)), 'production'], structured: true },
	],
	'check:latest': [
		{ phase: 'type-check latest', executable: process.execPath, args: [executable('../node_modules/typescript/bin/tsc'), '-noEmit', '-skipLibCheck', '-p', 'tsconfig.latest.json'] },
	],
	// ESLint's usual report, with its counts written by tests/eslint-formato.mjs:
	// warnings alone exit 0.
	lint: [
		{ phase: 'lint', executable: process.execPath, args: [executable('../node_modules/eslint/bin/eslint.js'), '.', '--format', executable('./eslint-formato.mjs')], structured: true },
	],
	// Stylelint prints its report on stderr, and only when it finds problems:
	// warnings alone exit 0, so the record keeps whether a report was printed.
	'lint:css': [
		{ phase: 'lint css', executable: process.execPath, args: [executable('../node_modules/stylelint/bin/stylelint.mjs'), 'styles.css'], reportOnStderr: true },
	],
	// The type check of the tests, before the Node suite (`npm test`): when it
	// fails, the suite does not start.
	'check:tests': [
		{ phase: 'type-check tests', executable: process.execPath, args: [executable('../node_modules/typescript/bin/tsc'), '-p', 'tsconfig.tests.json'] },
	],
};

// A `structured` step gets, in IW_DIAGNOSTICHE, a file of its own where its
// tool writes how many errors and warnings it found ({ tool, errors, warnings });
// read once the step has ended. No file (the tool stopped before writing it)
// leaves the counts unknown, said as such. Any other step runs without the
// variable, whatever the environment says.
const diagnosticsFile = () => {
	const dir = mkdtempSync(join(tmpdir(), 'iw-diagnostiche-'));
	return { file: join(dir, 'conteggi.json'), remove: () => rmSync(dir, { recursive: true, force: true }) };
};
// With the counts, the tool's own details of each problem (`items`: severity,
// rule or id, message, file, line, column), at most DETAILS of them: the tool
// counts the others in `omitted`, and so does this reader if a tool wrote more.
export const DETAILS = 100;
const readCounts = file => {
	try {
		const { tool, errors, warnings, items, omitted } = JSON.parse(readFileSync(file, 'utf8'));
		if (!Number.isInteger(errors) || !Number.isInteger(warnings)) return { unreadable: true };
		const listed = Array.isArray(items) ? items.filter(item => item && typeof item === 'object') : undefined;
		const extra = (Number.isInteger(omitted) ? omitted : 0) + Math.max(0, (listed?.length ?? 0) - DETAILS);
		return { tool: String(tool), errors, warnings, ...(listed ? { items: listed.slice(0, DETAILS) } : {}), ...(extra ? { omitted: extra } : {}) };
	} catch (error) { return error?.code === 'ENOENT' ? { missing: true } : { unreadable: true }; }
};

// A step with `reportOnStderr` has its stderr passed on byte for byte as it
// arrives (stdout stays inherited, so a tool's terminal detection is unchanged)
// and returns whether anything was written there. If the reader of our stderr
// goes away (a closed pipe), the output can no longer be shown, but the command
// still ends and is recorded.
let stderrGone = false;
const markStderrGone = () => { stderrGone = true; };
const passOnStderr = chunk => {
	if (!process.stderr.listeners('error').includes(markStderrGone)) process.stderr.on('error', markStderrGone);
	if (!stderrGone) process.stderr.write(chunk);
};
const runStep = (step, onChild) => new Promise(resolve => {
	let settled = false;
	let reported = false;
	const counts = step.structured ? diagnosticsFile() : undefined;
	const finish = result => {
		if (settled) return;
		settled = true;
		let diagnostics;
		if (counts) {
			diagnostics = { phase: step.phase, ...readCounts(counts.file) };
			counts.remove();
		}
		resolve({ ...result, ...(step.reportOnStderr ? { reported } : {}), ...(diagnostics ? { diagnostics } : {}) });
	};
	let child;
	try {
		const env = { ...(step.env ?? process.env) };
		delete env.IW_DIAGNOSTICHE;
		if (counts) env.IW_DIAGNOSTICHE = counts.file;
		child = spawn(step.executable, step.args, { cwd: step.cwd ?? project, env, stdio: step.reportOnStderr ? ['inherit', 'inherit', 'pipe'] : 'inherit' });
		onChild(child);
		child.stderr?.on('data', chunk => { reported = true; passOnStderr(chunk); });
		child.once('error', error => finish({ code: null, signal: null, error }));
		// With a pipe, 'close' comes after the last stderr chunk; 'exit' may not.
		child.once(step.reportOnStderr ? 'close' : 'exit', (code, signal) => finish({ code, signal, error: undefined }));
	} catch (error) {
		finish({ code: null, signal: null, error });
	}
});

/** Run command steps in order. Exported so tests can use harmless fixtures. */
export async function runRegisteredCommand(command, steps, { registry = process.env.IW_REGISTRO_COMANDI !== '0' } = {}) {
	if (registry) currentRun(`comando:${command}`);
	const started = Date.now();
	let child;
	let requestedSignal;
	const interrupt = signal => {
		requestedSignal ??= signal;
		if (child && child.exitCode === null && child.signalCode === null) child.kill(signal);
	};
	const onSigint = () => interrupt('SIGINT');
	const onSigterm = () => interrupt('SIGTERM');
	process.once('SIGINT', onSigint);
	process.once('SIGTERM', onSigterm);
	let result = { code: 0, signal: null, error: undefined };
	let reported;
	const diagnostics = [];
	let phase = steps[0]?.phase ?? command;
	try {
		for (const step of steps) {
			phase = step.phase;
			if (requestedSignal) { result = { code: null, signal: requestedSignal, error: undefined }; break; }
			result = await runStep(step, running => { child = running; });
			child = undefined;
			if (result.reported !== undefined) reported = Boolean(reported) || result.reported;
			// Errors or warnings counted by the tool are a report, whatever the exit.
			if (result.diagnostics) {
				diagnostics.push(result.diagnostics);
				if (Number.isInteger(result.diagnostics.errors)) reported = Boolean(reported) || result.diagnostics.errors + result.diagnostics.warnings > 0;
			}
			if (result.code !== 0 || result.signal || result.error) break;
		}
	} finally {
		process.removeListener('SIGINT', onSigint);
		process.removeListener('SIGTERM', onSigterm);
	}
	const signal = requestedSignal ?? result.signal ?? undefined;
	const interrupted = Boolean(signal);
	const entry = {
		kind: 'command', command, phase, ok: !interrupted && !result.error && result.code === 0,
		exitCode: result.code, ms: Date.now() - started, status: interrupted ? 'interrupted' : 'completed',
		...(signal ? { signal, interrupted: true } : {}),
		...(reported !== undefined ? { reported } : {}),
		...(diagnostics.length ? { diagnostics } : {}),
		...(result.error ? { diagnostic: String(result.error.message ?? result.error).slice(0, 1000) } : {}),
	};
	if (registry) record(entry);
	return entry;
}

export function finishLikeChild(entry) {
	if (entry.signal) {
		// Restore the operating system's signal exit semantics after the record is
		// safely appended. The fallback matters only on platforms that cannot
		// deliver this signal to the current process.
		try { process.kill(process.pid, entry.signal); } catch { process.exitCode = entry.signal === 'SIGINT' ? 130 : 143; }
		return;
	}
	process.exitCode = entry.exitCode ?? 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
	const command = process.argv[2];
	if (!commands[command]) {
		process.stderr.write(`Comando diagnostico sconosciuto: ${command ?? ''}\n`);
		process.exitCode = 2;
	} else {
		finishLikeChild(await runRegisteredCommand(command, commands[command]));
	}
}
