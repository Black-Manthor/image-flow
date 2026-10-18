import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { benchPaths, runEntries } from './banco-errori-ambiente.mjs';

// The error bench's environment, its starter and its registry, without the
// app: the real check runs in `npm run test:obsidian`.
const starter = 'tests/banco-errori-avvio.mjs';
const standIn = 'tests/fixtures/banco-errori-prova.mjs';
const appModule = pathToFileURL(resolve('tests/obsidian-app.mjs')).href;
// The children start from an environment with none of the bench's variables
// (nor the coverage's, which would make the bench look for another build).
const { IW_BANCO: _bench, IW_REGISTRO: _registry, IW_SUITE: _suite, IW_COPERTURA: _coverage, NODE_V8_COVERAGE: _v8, ...plain } = process.env;
const entries = (registry: string) => existsSync(registry) ? readdirSync(registry).sort()
	.flatMap(file => readFileSync(join(registry, file), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))) : [];
const temporary = (name: string) => mkdtempSync(join(tmpdir(), `iw-banco-${name}-`));

// tests/obsidian-app.mjs loaded by another process, from `cwd` with `env`
// (loading it starts nothing): `code` runs with the module as `m`.
function withApp(cwd: string, env: NodeJS.ProcessEnv, code: string) {
	const result = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(appModule)});\n${code}`],
		{ cwd, env, encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	return result.stdout;
}
const appPaths = (cwd: string, env: NodeJS.ProcessEnv) => JSON.parse(withApp(cwd, env,
	'console.log(JSON.stringify({ root: m.root, bench: m.bench, vault: m.vault, config: m.config, mapDir: m.mapDir }))'));

test('without IW_BANCO the bench keeps its paths; with it only vault, profile and source map move', () => {
	const dir = temporary('percorsi');
	try {
		const root = join(dir, '.obsidian-test');
		assert.deepEqual(appPaths(dir, plain), { root, bench: root, vault: join(root, 'vault'), config: join(root, 'config'), mapDir: join(root, 'mappa') });
		const { environment } = benchPaths(join(root, 'banco-errori'));
		// The Obsidian runtimes are looked for in `root`: still the shared one.
		assert.deepEqual(appPaths(dir, { ...plain, IW_BANCO: environment }), { root, bench: environment,
			vault: join(environment, 'vault'), config: join(environment, 'config'), mapDir: join(environment, 'mappa') });
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the error bench recreates only its own environment, and the suite only its own', () => {
	const dir = temporary('ambienti');
	try {
		for (const file of ['main.js', 'manifest.json', 'styles.css']) writeFileSync(join(dir, file), `/* ${file} */\n`);
		const root = join(dir, '.obsidian-test');
		const suiteFiles = { 'vault/Nota.md': 'della suite\n', 'config/obsidian.json': '{"suite":true}', 'mappa/main.js': 'mappa della suite' };
		for (const [file, text] of Object.entries(suiteFiles)) {
			mkdirSync(join(root, file, '..'), { recursive: true });
			writeFileSync(join(root, file), text);
		}
		const { environment } = benchPaths(join(root, 'banco-errori'));
		withApp(dir, { ...plain, IW_BANCO: environment }, 'await m.prepareVault({ \'Prova.md\': \'Una nota.\\n\' }, []);');
		for (const [file, text] of Object.entries(suiteFiles)) assert.equal(readFileSync(join(root, file), 'utf8'), text, `${file} della suite intatto`);
		assert.equal(readFileSync(join(environment, 'vault', 'Prova.md'), 'utf8'), 'Una nota.\n');
		assert.equal(readFileSync(join(environment, 'vault', '.obsidian', 'plugins', 'image-rows-and-wraps', 'main.js'), 'utf8'), '/* main.js */\n');
		const profile = JSON.parse(readFileSync(join(environment, 'config', 'obsidian.json'), 'utf8'));
		assert.deepEqual(Object.values(profile.vaults).map(entry => (entry as { path: string }).path), [join(environment, 'vault')]);

		withApp(dir, plain, 'await m.prepareVault({ \'Prova.md\': \'Della suite.\\n\' }, []);');
		assert.equal(existsSync(join(root, 'vault', 'Nota.md')), false, 'the suite recreates its own vault as before');
		assert.equal(readFileSync(join(root, 'vault', 'Prova.md'), 'utf8'), 'Della suite.\n');
		assert.equal(readFileSync(join(environment, 'vault', 'Prova.md'), 'utf8'), 'Una nota.\n', 'the error bench left alone');
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a bench app left running is recognized by its exact profile folder only', { skip: process.platform !== 'linux' && 'pgrep: Linux only' }, async () => {
	// Characters that mean something in a regular expression, in the path too.
	const dir = mkdtempSync(join(tmpdir(), 'iw banco.[x]+('));
	const own = join(dir, 'config');
	const lookalike = own.replace('iw banco.', 'iw bancoX');
	const processes: ChildProcess[] = [];
	const start = async (...args: string[]) => {
		const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', ...args], { stdio: 'ignore' });
		processes.push(child);
		await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
		return child.pid;
	};
	try {
		const expected = [await start(`--user-data-dir=${own}`), await start(`--user-data-dir=${own}`, '--altro')];
		await start(`--user-data-dir=${own}-altra`);
		await start(`--user-data-dir=${join(dir, 'banco-errori', 'ambiente', 'config')}`);
		await start(`--user-data-dir=${lookalike}`);
		const found = JSON.parse(withApp(dir, { ...plain, IW_PROVA_PROFILO: own }, 'console.log(JSON.stringify(m.benchProcesses(process.env.IW_PROVA_PROFILO)));'));
		assert.deepEqual(found.sort(), expected.sort());
	} finally {
		for (const child of processes) child.kill('SIGKILL');
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the starter sets the bench\'s variables before the check starts and keeps every run\'s results', () => {
	const dir = temporary('esiti');
	try {
		const paths = benchPaths(join(dir, 'banco'));
		// The caller's registry, as `npm run test:obsidian` would have the project's.
		const project = join(dir, 'progetto');
		const run = (mode: string) => {
			const seen = join(dir, `visto-${mode}.json`);
			const result = spawnSync(process.execPath, [starter, standIn, paths.dir], { encoding: 'utf8',
				env: { ...plain, IW_REGISTRO: project, IW_PROVA_BANCO: mode, IW_PROVA_VISTO: seen } });
			return { status: result.status, signal: result.signal, seen: JSON.parse(readFileSync(seen, 'utf8')) };
		};
		const passed = run('passa');
		assert.equal(passed.status, 0);
		assert.deepEqual({ ...passed.seen, pid: undefined }, { pid: undefined, IW_REGISTRO: paths.registry, IW_BANCO: paths.environment, IW_SUITE: 'banco-errori' });
		const failed = run('fallisce');
		assert.equal(failed.status, 1, 'a failure stops the chain');

		const lines = entries(paths.registry);
		const runs = lines.filter(line => line.kind === 'run');
		assert.equal(runs.length, 2, 'the earlier run is kept');
		assert.ok(runs.every(line => line.suite === 'banco-errori'), 'the suite was known when the reporter started');
		const [first, second] = runs.map(line => lines.filter(other => other.run === line.run));
		assert.deepEqual(first!.filter(line => line.kind === 'result').map(line => [line.test, line.result]), [['prova del banco', 'superato']]);
		assert.deepEqual(first!.filter(line => line.kind === 'end').map(line => [line.superato, line.fallito]), [[1, 0]]);
		const failure = second!.find(line => line.kind === 'result');
		assert.equal(failure.result, 'fallito');
		assert.match(failure.error, /fallimento della prova/);
		assert.deepEqual(second!.filter(line => line.kind === 'end').map(line => [line.superato, line.fallito]), [[0, 1]]);
		assert.equal(existsSync(project), false, 'nothing in the caller\'s registry');
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) test(`${signal} to the starter reaches the check once, is recorded, and remains a signal termination`, async () => {
	const dir = temporary('segnale');
	const paths = benchPaths(join(dir, 'banco'));
	const seen = join(dir, 'visto.json');
	let running: ChildProcess | undefined, standInPid: number | undefined;
	const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
	try {
		running = spawn(process.execPath, [starter, standIn, paths.dir], { stdio: 'ignore',
			env: { ...plain, IW_REGISTRO: join(dir, 'progetto'), IW_PROVA_BANCO: 'attende', IW_PROVA_VISTO: seen } });
		const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => running!.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal })));
		const deadline = Date.now() + 10000;
		while (!existsSync(seen) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
		assert.ok(existsSync(seen), 'the stand-in started');
		standInPid = JSON.parse(readFileSync(seen, 'utf8')).pid;
		running.kill(signal);
		assert.deepEqual(await exited, { code: null, signal });
		const end = entries(paths.registry).filter(line => line.kind === 'end');
		assert.deepEqual(end.map(line => line.interrupted), [signal], 'one end, recorded by the check itself');
		const gone = Date.now() + 3000;
		while (alive(standInPid!) && Date.now() < gone) await new Promise(resolve => setTimeout(resolve, 50));
		assert.equal(alive(standInPid!), false, 'the check is not left running');
		assert.equal(existsSync(join(dir, 'progetto')), false);
	} finally {
		if (running && running.exitCode === null && running.signalCode === null) running.kill('SIGKILL');
		if (standInPid && alive(standInPid)) process.kill(standInPid, 'SIGKILL');
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the check started on its own, or pointed at the project\'s registry, stops before starting or writing anything', () => {
	const dir = temporary('protezione');
	try {
		const check = resolve('tests/banco-errori.mjs');
		const root = join(dir, '.obsidian-test');
		const paths = benchPaths(join(root, 'banco-errori'));
		const reporter = ['--test-reporter=spec', `--test-reporter=${resolve('tests/registro-reporter.mjs')}`, '--test-reporter-destination=stdout', '--test-reporter-destination=stderr'];
		const cases: Array<[string[], NodeJS.ProcessEnv]> = [
			[[check], plain],
			[[...reporter, check], plain],
			[[...reporter, check], { ...plain, IW_REGISTRO: join(root, 'registro'), IW_BANCO: paths.environment, IW_SUITE: 'banco-errori' }],
			[[check], { ...plain, IW_REGISTRO: paths.registry, IW_SUITE: 'banco-errori' }],
		];
		for (const [args, env] of cases) {
			const result = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8' });
			assert.notEqual(result.status, 0, `${args.join(' ')}: ${result.stdout}`);
			assert.match(`${result.stdout}${result.stderr}`, /banco-errori-avvio\.mjs/);
			assert.equal(existsSync(root), false, 'no registry, no vault, no profile');
		}
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a run\'s lines are read from every day it wrote into, and only its own', async () => {
	const registry = temporary('giorni');
	try {
		const run = '2026-10-07T23:59:58.000Z-abcd';
		const line = (id: string, kind: string, extra: object = {}) => JSON.stringify({ run: id, kind, ...extra });
		const loop = (id: string, window: string) => line(id, 'console', { text: 'ciclo', window });
		writeFileSync(join(registry, '2026-10-06.jsonl'), [loop('2026-10-06T10:00:00.000Z-0001', 'principale')].join('\n') + '\n');
		writeFileSync(join(registry, '2026-10-07.jsonl'), [line('2026-10-07T20:00:00.000Z-0002', 'run'), loop('2026-10-07T20:00:00.000Z-0002', 'principale'),
			loop('2026-10-07T20:00:00.000Z-0002', 'separata'), line(run, 'run'), loop(run, 'principale')].join('\n') + '\n');
		writeFileSync(join(registry, '2026-10-08.jsonl'), [loop(run, 'separata'), line(run, 'end'), loop('2026-10-08T00:10:00.000Z-0003', 'separata')].join('\n') + '\n');
		const found = await runEntries(registry, run);
		assert.deepEqual(found.map(entry => [entry.run, entry.kind, entry.window]),
			[[run, 'run', undefined], [run, 'console', 'principale'], [run, 'console', 'separata'], [run, 'end', undefined]]);
	} finally { rmSync(registry, { recursive: true, force: true }); }
});

test('test:obsidian starts the suite only after the build, the latest-API check and a passed error bench', () => {
	const steps = JSON.parse(readFileSync('package.json', 'utf8')).scripts['test:obsidian'].split(' && ');
	assert.deepEqual(steps.slice(0, 3), ['npm run build', 'npm run check:latest', 'node tests/banco-errori-avvio.mjs']);
	assert.equal(steps.length, 4);
	assert.match(steps[3], / tests\/obsidian\.mjs$/);
	assert.ok(steps.every((step: string) => !/[;|&]/.test(step)), 'every step depends on the one before');
});
