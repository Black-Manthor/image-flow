import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { codeState } from './registro.mjs';

const harness = 'tests/fixtures/registro-comando-runner.mjs';
// The children record in `registry` whatever the environment running the tests
// says (a publication check runs them with IW_REGISTRO_COMANDI=0, for
// instance). Only the test of that switch sets it to 0 itself.
const childEnv = (registry: string, extra: NodeJS.ProcessEnv = {}) => ({ ...process.env, IW_REGISTRO: registry, IW_REGISTRO_COMANDI: '1', ...extra });
const registryEntries = (registry: string) => existsSync(registry) ? readdirSync(registry)
	.flatMap(file => readFileSync(join(registry, file), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))) : [];

function run(mode: string, value?: string, extraEnv: NodeJS.ProcessEnv = {}) {
	const registry = mkdtempSync(join(tmpdir(), 'iw-comando-'));
	const result = spawnSync(process.execPath, [harness, mode, ...(value === undefined ? [] : [value])], {
		encoding: 'utf8', env: childEnv(registry, extraEnv),
	});
	return { registry, result, lines: registryEntries(registry) };
}

test('a successful command keeps inherited output and records its Git state and terminal result', () => {
	const dir = mkdtempSync(join(tmpdir(), 'iw-comando-output-'));
	const registry = join(dir, 'registro'), stdoutFile = join(dir, 'stdout'), stderrFile = join(dir, 'stderr');
	try {
		const stdout = openSync(stdoutFile, 'w'), stderr = openSync(stderrFile, 'w');
		const result = spawnSync(process.execPath, [harness, 'output'], { env: childEnv(registry), stdio: ['ignore', stdout, stderr] });
		closeSync(stdout); closeSync(stderr);
		assert.equal(result.status, 0);
		assert.equal(readFileSync(stdoutFile, 'utf8'), 'stdout diretto\n');
		assert.equal(readFileSync(stderrFile, 'utf8'), 'stderr diretto\n');
		const lines = registryEntries(registry);
		const start = lines.find(line => line.kind === 'run');
		assert.equal(start.suite, 'comando:fixture');
		assert.equal(typeof start.commit, 'string');
		assert.equal(typeof start.branch, 'string');
		// The code where the tests run: a Git state in a repository, «non disponibile»
		// outside one (the isolated copy of a publication is not a repository).
		const here = codeState();
		assert.equal(start.state, here.state);
		assert.equal(start.content, here.content);
		assert.equal(typeof start.node, 'string');
		assert.equal(typeof start.platform, 'string');
		const command = lines.find(line => line.kind === 'command');
		assert.equal(command.command, 'fixture');
		assert.equal(command.phase, 'fixture');
		assert.equal(command.ok, true);
		assert.equal(command.exitCode, 0);
		assert.equal(command.status, 'completed');
		assert.equal(typeof command.ms, 'number');
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a report on stderr is passed on unchanged and recorded, so exit 0 with warnings is not a clean pass', () => {
	const reporting = run('report');
	const silent = run('report-silent');
	try {
		assert.equal(reporting.result.status, 0);
		assert.equal(reporting.result.stdout, 'stdout diretto\n');
		assert.equal(reporting.result.stderr, 'stderr diretto\n');
		const command = reporting.lines.find(line => line.kind === 'command');
		assert.equal(command.ok, true);
		assert.equal(command.reported, true);
		assert.equal(silent.result.status, 0);
		assert.equal(silent.result.stderr, '');
		assert.equal(silent.lines.find(line => line.kind === 'command').reported, false);
		// Commands without a report to watch keep their records as they were.
		const plain = run('output');
		try { assert.equal('reported' in plain.lines.find(line => line.kind === 'command'), false); }
		finally { rmSync(plain.registry, { recursive: true, force: true }); }
	} finally {
		rmSync(reporting.registry, { recursive: true, force: true });
		rmSync(silent.registry, { recursive: true, force: true });
	}
});

test('the summary shows a pass with reports as such, and a silent pass as a plain pass', () => {
	const summary = (mode: string) => {
		const registry = mkdtempSync(join(tmpdir(), 'iw-comando-riepilogo-'));
		try {
			const ran = spawnSync(process.execPath, [harness, mode], { encoding: 'utf8', env: childEnv(registry, { IW_FIXTURE_COMMAND: 'lint:css' }) });
			assert.equal(ran.status, 0, ran.stderr);
			const shown = spawnSync(process.execPath, ['tests/registro-riepilogo.mjs'], { encoding: 'utf8', env: { ...process.env, IW_REGISTRO: registry } });
			assert.equal(shown.status, 0, shown.stderr);
			return shown.stdout.split('\n').find(line => line.startsWith('lint:css:')) ?? '';
		} finally { rmSync(registry, { recursive: true, force: true }); }
	};
	assert.match(summary('report'), /^lint:css: superato con segnalazioni \(vedere il suo output\),/);
	assert.match(summary('report-silent'), /^lint:css: superato,/);
});

test('when the reader of stderr goes away, the report cannot be shown but the command still ends and is recorded', async () => {
	const registry = mkdtempSync(join(tmpdir(), 'iw-comando-pipe-'));
	try {
		const runner = spawn(process.execPath, [harness, 'report'], { env: childEnv(registry), stdio: ['ignore', 'ignore', 'pipe'] });
		// Closed before the runner starts: every write it passes on fails (EPIPE).
		runner.stderr.destroy();
		const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(resolve => runner.once('exit', (code, signal) => resolve([code, signal])));
		assert.deepEqual([code, signal], [0, null], 'the runner ends like its command, not on the write error');
		const command = registryEntries(registry).find(line => line.kind === 'command');
		assert.ok(command, 'the terminal record is written');
		assert.equal(command.ok, true);
		assert.equal(command.status, 'completed');
		assert.equal(command.reported, true, 'something did reach the watched stderr');
	} finally { rmSync(registry, { recursive: true, force: true }); }
});

test('lint:css runs Stylelint on styles.css with its own configuration and watches its stderr report', () => {
	// Read in a child: bundled into the test file, the module would take itself
	// for the script being run.
	const listed = spawnSync(process.execPath, ['--input-type=module', '-e',
		"const { commands } = await import('./tests/registro-comando.mjs'); process.stdout.write(JSON.stringify(commands['lint:css']));"], { encoding: 'utf8' });
	assert.equal(listed.status, 0, listed.stderr);
	const [step, ...others] = JSON.parse(listed.stdout) as Array<{ args: string[]; reportOnStderr?: boolean }>;
	assert.equal(others.length, 0);
	assert.ok(step);
	assert.match(step.args[0] ?? '', /node_modules[\\/]stylelint[\\/]bin[\\/]stylelint\.mjs$/);
	assert.deepEqual(step.args.slice(1), ['styles.css'], 'no option that hides, filters or ignores problems');
	assert.equal(step.reportOnStderr, true);
});

test('a failed command preserves its exit code and the build stops at the failing phase', () => {
	const markerDir = mkdtempSync(join(tmpdir(), 'iw-comando-marker-'));
	const marker = join(markerDir, 'bundle');
	const { registry, result, lines } = run('build-fail', '7', { IW_FIXTURE_MARKER: marker });
	try {
		assert.equal(result.status, 7);
		assert.equal(existsSync(marker), false, 'the bundle phase did not run');
		const command = lines.find(line => line.kind === 'command');
		assert.equal(command.ok, false);
		assert.equal(command.exitCode, 7);
		assert.equal(command.phase, 'type-check');
		assert.equal(command.status, 'completed');
	} finally {
		rmSync(registry, { recursive: true, force: true });
		rmSync(markerDir, { recursive: true, force: true });
	}
});

// A child still alive when a test ends (an assertion failed, the run never
// started) is stopped with SIGTERM, which the runner forwards to its own child,
// so none is left behind to keep the suite from ending; SIGKILL only if the
// runner does not end within a few seconds. The test's own error stays.
async function stopChild(child: ChildProcess | undefined) {
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
	child.kill('SIGTERM');
	let timer: NodeJS.Timeout | undefined;
	const late = new Promise<'late'>(resolve => { timer = setTimeout(() => resolve('late'), 5000); });
	if (await Promise.race([exited, late]) === 'late') {
		child.kill('SIGKILL');
		await exited;
	}
	clearTimeout(timer);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) test(`${signal} is forwarded, recorded and remains a signal termination`, async () => {
	const registry = mkdtempSync(join(tmpdir(), 'iw-comando-signal-'));
	let child: ChildProcess | undefined;
	try {
		const running = spawn(process.execPath, [harness, 'wait'], { env: childEnv(registry), stdio: 'ignore' });
		child = running;
		await new Promise<void>((resolve, reject) => {
			running.once('error', reject);
			const deadline = Date.now() + 3000;
			const poll = () => {
				if (registryEntries(registry).some(line => line.kind === 'run')) setTimeout(resolve, 100);
				else if (Date.now() >= deadline) reject(new Error('the command run did not start'));
				else setTimeout(poll, 20);
			};
			poll();
		});
		const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => running.once('exit', (code, exitedSignal) => resolve({ code, signal: exitedSignal })));
		running.kill(signal);
		const outcome = await exited;
		assert.equal(outcome.code, null);
		assert.equal(outcome.signal, signal);
		const command = registryEntries(registry).find(line => line.kind === 'command');
		assert.equal(command.status, 'interrupted');
		assert.equal(command.interrupted, true);
		assert.equal(command.signal, signal);
		assert.equal(command.ok, false);
	} finally {
		await stopChild(child);
		rmSync(registry, { recursive: true, force: true });
	}
});

test('IW_REGISTRO_COMANDI=0 writes nothing but still executes the command', () => {
	const dir = mkdtempSync(join(tmpdir(), 'iw-comando-disabled-'));
	const marker = join(dir, 'marker');
	const registry = join(dir, 'registro');
	try {
		const result = spawnSync(process.execPath, [harness, 'mark', marker], {
			encoding: 'utf8', env: childEnv(registry, { IW_REGISTRO_COMANDI: '0' }),
		});
		assert.equal(result.status, 0);
		assert.equal(readFileSync(marker, 'utf8'), 'eseguito\n');
		assert.equal(existsSync(registry), false);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

// Counts of errors and warnings a tool writes (ESLint, esbuild): its output is
// passed on unchanged; the record and the summary say what it counted.
const commandOf = (lines: Array<Record<string, unknown>>) => lines.find(line => line.kind === 'command') as Record<string, any>;
const summaryLine = (registry: string, name: string) => {
	const shown = spawnSync(process.execPath, ['tests/registro-riepilogo.mjs'], { encoding: 'utf8', env: { ...process.env, IW_REGISTRO: registry } });
	assert.equal(shown.status, 0, shown.stderr);
	return shown.stdout.split('\n').find(line => line.startsWith(`${name}:`)) ?? '';
};

test('exit 0 with no problems counted: a plain pass, the ordinary output unchanged and not taken for a report', () => {
	const { registry, result, lines } = run('counts', '0,0,0', { IW_FIXTURE_COMMAND: 'lint' });
	try {
		assert.equal(result.status, 0);
		assert.equal(result.stdout, 'riepilogo ordinario\n');
		assert.equal(result.stderr, 'main.js  1.0kb\n', 'the tool\'s own summary still on stderr');
		const command = commandOf(lines);
		assert.equal(command.ok, true);
		assert.equal(command.reported, false);
		assert.deepEqual(command.diagnostics, [{ phase: 'fixture', tool: 'finto', errors: 0, warnings: 0 }]);
		assert.match(summaryLine(registry, 'lint'), /^lint: superato, fase fixture,/);
	} finally { rmSync(registry, { recursive: true, force: true }); }
});

test('exit 0 with warnings counted: a pass with reports, with the counts, never a clean pass nor a failure', () => {
	const { registry, result, lines } = run('counts', '0,3,0', { IW_FIXTURE_COMMAND: 'lint' });
	try {
		assert.equal(result.status, 0);
		const command = commandOf(lines);
		assert.equal(command.ok, true);
		assert.equal(command.exitCode, 0);
		assert.equal(command.reported, true);
		assert.deepEqual(command.diagnostics, [{ phase: 'fixture', tool: 'finto', errors: 0, warnings: 3 }]);
		assert.match(summaryLine(registry, 'lint'), /^lint: superato con segnalazioni \(fixture: 0 errori, 3 avvisi; vedere il suo output\),/);
	} finally { rmSync(registry, { recursive: true, force: true }); }
});

test('a non-zero exit with problems counted stays a failure with its exit code, and keeps the counts', () => {
	const { registry, result, lines } = run('counts', '2,1,1', { IW_FIXTURE_COMMAND: 'build' });
	try {
		assert.equal(result.status, 1);
		const command = commandOf(lines);
		assert.equal(command.ok, false);
		assert.equal(command.exitCode, 1);
		assert.equal(command.reported, true);
		assert.deepEqual(command.diagnostics, [{ phase: 'fixture', tool: 'finto', errors: 2, warnings: 1 }]);
		assert.match(summaryLine(registry, 'build'), /^build: fallito \(uscita 1; fixture: 2 errori, 1 avvisi\),/);
	} finally { rmSync(registry, { recursive: true, force: true }); }
});

test('a tool that writes no counts leaves them unknown, said as such, never a clean pass by default', () => {
	const { registry, result, lines } = run('counts', '-,-,0', { IW_FIXTURE_COMMAND: 'lint' });
	try {
		assert.equal(result.status, 0);
		const command = commandOf(lines);
		assert.equal(command.ok, true);
		assert.equal('reported' in command, false);
		assert.deepEqual(command.diagnostics, [{ phase: 'fixture', missing: true }]);
		assert.match(summaryLine(registry, 'lint'), /^lint: superato, fixture: conteggio non disponibile,/);
	} finally { rmSync(registry, { recursive: true, force: true }); }
});

test('only a structured step gets IW_DIAGNOSTICHE: another step never sees one left in the environment', () => {
	const { registry, result } = run('env', undefined, { IW_DIAGNOSTICHE: '/percorso/da/non/usare' });
	try { assert.equal(result.stdout, 'IW_DIAGNOSTICHE=\n'); } finally { rmSync(registry, { recursive: true, force: true }); }
});

test('an interrupted structured step is recorded as interrupted, a signal termination, its counts unknown', async () => {
	const registry = mkdtempSync(join(tmpdir(), 'iw-comando-signal-'));
	let child: ChildProcess | undefined;
	try {
		const running = spawn(process.execPath, [harness, 'counts-wait'], { env: childEnv(registry), stdio: 'ignore' });
		child = running;
		await new Promise<void>((resolve, reject) => {
			const deadline = Date.now() + 3000;
			const poll = () => {
				if (registryEntries(registry).some(line => line.kind === 'run')) setTimeout(resolve, 100);
				else if (Date.now() >= deadline) reject(new Error('the command run did not start'));
				else setTimeout(poll, 20);
			};
			poll();
		});
		const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => running.once('exit', (code, signal) => resolve({ code, signal })));
		running.kill('SIGINT');
		assert.deepEqual(await exited, { code: null, signal: 'SIGINT' });
		const command = commandOf(registryEntries(registry));
		assert.equal(command.status, 'interrupted');
		assert.equal(command.ok, false);
		assert.deepEqual(command.diagnostics, [{ phase: 'fixture', missing: true }]);
	} finally {
		await stopChild(child);
		rmSync(registry, { recursive: true, force: true });
	}
});

test('the real ESLint with the project\'s formatter: warnings alone exit 0 and are counted, its report unchanged', () => {
	const dir = mkdtempSync(join(tmpdir(), 'iw-comando-eslint-'));
	const plain = (files: Record<string, string>) => {
		for (const name of readdirSync(dir)) rmSync(join(dir, name));
		for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
	};
	const eslint = [join(process.cwd(), 'node_modules', 'eslint', 'bin', 'eslint.js'), '--no-config-lookup', '--rule', '{"no-unused-vars":"warn","no-var":"error"}', '.'];
	const ours = (files: Record<string, string>) => {
		plain(files);
		const registry = mkdtempSync(join(tmpdir(), 'iw-comando-eslint-registro-'));
		try {
			const result = spawnSync(process.execPath, [harness, 'eslint', dir], { encoding: 'utf8', env: childEnv(registry) });
			const own = spawnSync(process.execPath, eslint, { cwd: dir, encoding: 'utf8' });
			return { result, own, command: commandOf(registryEntries(registry)) };
		} finally { rmSync(registry, { recursive: true, force: true }); }
	};
	try {
		const warned = ours({ 'a.js': 'const unused = 1;\n' });
		assert.equal(warned.result.status, 0);
		assert.equal(warned.result.stdout, warned.own.stdout, 'ESLint\'s own stylish report');
		assert.match(warned.result.stdout, /1 warning/);
		assert.equal(warned.command.ok, true);
		assert.equal(warned.command.reported, true);
		assert.deepEqual(warned.command.diagnostics, [{ phase: 'lint', tool: 'eslint', errors: 0, warnings: 1,
			items: [{ severity: 'warning', rule: 'no-unused-vars', message: '\'unused\' is assigned a value but never used.', file: 'a.js', line: 1, column: 7 }] }]);
		const clean = ours({ 'a.js': 'const used = 1;\nused;\n' });
		assert.equal(clean.result.status, 0);
		assert.equal(clean.result.stdout, '');
		assert.equal(clean.command.reported, false);
		assert.deepEqual(clean.command.diagnostics, [{ phase: 'lint', tool: 'eslint', errors: 0, warnings: 0, items: [] }]);
		const failed = ours({ 'a.js': 'var used = 1;\nused;\n' });
		assert.equal(failed.result.status, 1);
		assert.equal(failed.result.stdout, failed.own.stdout);
		assert.equal(failed.command.ok, false);
		assert.deepEqual(failed.command.diagnostics, [{ phase: 'lint', tool: 'eslint', errors: 1, warnings: 0,
			items: [{ severity: 'error', rule: 'no-var', message: 'Unexpected var, use let or const instead.', file: 'a.js', line: 1, column: 1 }] }]);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('lint and the bundle phase of build count their problems; the tests\' type check is a command of its own, before the Node suite', () => {
	const listed = spawnSync(process.execPath, ['--input-type=module', '-e',
		"const { commands } = await import('./tests/registro-comando.mjs'); process.stdout.write(JSON.stringify(commands));"], { encoding: 'utf8' });
	assert.equal(listed.status, 0, listed.stderr);
	const commands = JSON.parse(listed.stdout) as Record<string, Array<{ phase: string; args: string[]; structured?: boolean }>>;
	const [lint] = commands.lint!;
	assert.deepEqual(lint!.args.slice(1, 3), ['.', '--format'], 'no option that hides, filters or limits warnings');
	assert.match(lint!.args[3] ?? '', /tests[\\/]eslint-formato\.mjs$/);
	assert.equal(lint!.args.length, 4);
	assert.equal(lint!.structured, true);
	assert.deepEqual(commands.build!.map(step => [step.phase, Boolean(step.structured)]), [['type-check', false], ['bundle', true]]);
	assert.match(commands.build![1]!.args[0] ?? '', /esbuild\.config\.mjs$/, 'the bundle phase is esbuild');
	assert.deepEqual(commands['check:tests']!.map(step => [step.phase, step.args.slice(1)]), [['type-check tests', ['-p', 'tsconfig.tests.json']]]);
	const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;
	assert.equal(scripts.test, 'node tests/registro-comando.mjs check:tests && node tests/run.mjs');
});

test('a failed type check of the tests keeps its exit code, is recorded, and the suite after it never starts', () => {
	const dir = mkdtempSync(join(tmpdir(), 'iw-comando-tipi-'));
	const registry = join(dir, 'registro'), marker = join(dir, 'suite');
	try {
		// As `npm test` chains them: the check, then the suite only if it passed.
		const chained = spawnSync('sh', ['-c', '"$0" "$1" fail 2 && "$0" "$2" mark "$3"', process.execPath, harness, 'tests/fixtures/registro-comando-child.mjs', marker],
			{ encoding: 'utf8', env: childEnv(registry, { IW_FIXTURE_COMMAND: 'check:tests' }) });
		assert.equal(chained.status, 2);
		assert.equal(existsSync(marker), false, 'the suite did not start');
		const command = commandOf(registryEntries(registry));
		assert.equal(command.command, 'check:tests');
		assert.equal(command.ok, false);
		assert.equal(command.exitCode, 2);
		assert.match(summaryLine(registry, 'check:tests'), /^check:tests: fallito \(uscita 2\),/);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('at most 100 described problems per phase are kept, the others counted, and the summary says where the rest are', () => {
	const { registry, lines } = run('counts', '0,150,0,150', { IW_FIXTURE_COMMAND: 'lint' });
	try {
		const [entry] = commandOf(lines).diagnostics;
		assert.equal(entry.warnings, 150);
		assert.equal(entry.items.length, 100);
		assert.equal(entry.omitted, 50);
		assert.deepEqual(entry.items[0], { severity: 'warning', rule: 'finta', message: 'problema 1', file: 'a.js', line: 1, column: 1 });
		const shown = spawnSync(process.execPath, ['tests/registro-riepilogo.mjs'], { encoding: 'utf8', env: { ...process.env, IW_REGISTRO: registry } }).stdout;
		assert.match(shown, /\n {4}⚠ a\.js:1:1 problema 1 \(finta\)\n/);
		assert.match(shown, /… altre 145 segnalazioni \(le prime 100 per fase nel registro, tutte nell'output del comando\)/);
	} finally { rmSync(registry, { recursive: true, force: true }); }
});

test('the real esbuild of esbuild.config.mjs: its warning described with id, file and place, its output unchanged, the files written not taken for problems', () => {
	const dir = mkdtempSync(join(tmpdir(), 'iw-comando-esbuild-'));
	const registry = mkdtempSync(join(tmpdir(), 'iw-comando-esbuild-registro-'));
	try {
		writeFileSync(join(dir, 'esbuild.config.mjs'), readFileSync('esbuild.config.mjs'));
		symlinkSync(join(process.cwd(), 'node_modules'), join(dir, 'node_modules'), 'dir');
		mkdirSync(join(dir, 'src'));
		const build = (source: string) => {
			writeFileSync(join(dir, 'src', 'main.ts'), source);
			for (const name of readdirSync(registry)) rmSync(join(registry, name));
			const result = spawnSync(process.execPath, [harness, 'esbuild', dir], { encoding: 'utf8', env: childEnv(registry) });
			const own = spawnSync(process.execPath, ['esbuild.config.mjs', 'production'], { cwd: dir, encoding: 'utf8', env: { ...process.env, IW_DIAGNOSTICHE: '' } });
			return { result, own, command: commandOf(registryEntries(registry)) };
		};
		const warned = build('export const x = { a: 1, a: 2 };\n');
		assert.equal(warned.result.status, 0);
		assert.equal(warned.result.stderr, warned.own.stderr, 'esbuild\'s own output');
		assert.match(warned.result.stderr, /Duplicate key "a"/);
		assert.equal(warned.command.reported, true);
		assert.deepEqual(warned.command.diagnostics, [{ phase: 'bundle', tool: 'esbuild', errors: 0, warnings: 1,
			items: [{ severity: 'warning', id: 'duplicate-object-key', message: 'Duplicate key "a" in object literal', file: 'src/main.ts', line: 1, column: 25 }] }]);
		const clean = build('export const x = 1;\n');
		assert.equal(clean.result.status, 0);
		assert.equal(clean.command.reported, false);
		assert.deepEqual(clean.command.diagnostics, [{ phase: 'bundle', tool: 'esbuild', errors: 0, warnings: 0, items: [] }]);
		const failed = build('export const x = ;\n');
		assert.equal(failed.result.status, 1);
		assert.equal(failed.command.ok, false);
		const [entry] = failed.command.diagnostics;
		assert.equal(entry.errors, 1);
		assert.equal(entry.items[0].severity, 'error');
		assert.equal(entry.items[0].file, 'src/main.ts');
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(registry, { recursive: true, force: true });
	}
});
