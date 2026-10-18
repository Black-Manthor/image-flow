import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { analyze } from './registro-analisi.mjs';

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['NODE_TEST_CONTEXT', 'IW_CONSOLE_NODE', 'IW_COPERTURA', 'NODE_V8_COVERAGE'].includes(key)));
const lines = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const entries = (dir: string) => existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.jsonl')).flatMap(name => lines(join(dir, name))) : [];
function setup(mode: string) {
	const dir = mkdtempSync(join(tmpdir(), 'iw-reporter-case-'));
	cpSync('tests', join(dir, 'tests'), { recursive: true });
	return { dir, registry: join(dir, 'registry'), consoleFile: join(dir, 'console.jsonl'), env: { ...env, IW_SUITE: 'node', IW_REPORT_CASE: mode, IW_REGISTRO: join(dir, 'registry'), IW_CONSOLE_NODE: join(dir, 'console.jsonl') } };
}

test('registry reporter keeps nested native outcomes, hierarchy, reasons and counts', () => {
	const c = setup('nested');
	try {
		const native = join(c.dir, 'native.jsonl');
		const result = spawnSync(process.execPath, ['--test-reporter=./tests/fixtures/registro-node-native.mjs', `--test-reporter-destination=${native}`, '--test-reporter=./tests/registro-reporter.mjs', '--test-reporter-destination=stderr', 'tests/fixtures/registro-node-prova.mjs'], { cwd: c.dir, env: c.env, encoding: 'utf8' });
		assert.equal(result.status, 1);
		const seen = entries(c.registry), outcomes = seen.filter(entry => ['result', 'container'].includes(entry.kind));
		const expected = lines(native).filter(entry => ['test:pass', 'test:fail'].includes(entry.type));
		assert.equal(outcomes.length, expected.length, 'each native outcome exactly once');
		for (const raw of expected) {
			const found = outcomes.find(entry => entry.test === raw.name && entry.nesting === raw.nesting);
			assert.ok(found, raw.name);
			assert.equal(found.nativeStatus, raw.type === 'test:pass' ? 'passed' : 'failed');
			assert.equal(found.failureType, raw.failureType);
			if (raw.reason) assert.equal(found.error, raw.reason);
		}
		const broken = outcomes.find(entry => entry.test === 'broken child');
		assert.deepEqual(broken.path, ['group', 'broken child']);
		assert.equal(broken.error, 'nested reason');
		assert.equal(broken.file, 'tests/fixtures/registro-node-prova.mjs:11');
		assert.equal(outcomes.find(entry => entry.test === 'skipped child').skip, 'skip reason');
		assert.equal(outcomes.find(entry => entry.test === 'todo child').todo, 'todo reason');
		assert.ok(outcomes.some(entry => entry.test === 'cancelled by parent' && entry.failureType));
		const summary = lines(native).filter(entry => entry.type === 'test:summary').at(-1);
		assert.deepEqual(seen.find(entry => entry.kind === 'end').nativeCounts, summary.counts);
		assert.equal(seen.filter(entry => entry.kind === 'result').length, summary.counts.tests);
		assert.equal(seen.filter(entry => entry.kind === 'container').length, summary.counts.suites);
		const report = analyze(seen, { now: Date.now() + 600000 });
		assert.equal(report.runs[0].status, 'fallita');
		assert.equal(report.runs[0].totalsConsistent, true);
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) test(`registry persists warning before ${signal} without changing the native exit`, async () => {
	const c = setup('interrupt');
	try {
		const args = ['--import=./tests/registro-reporter.mjs', '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=./tests/registro-reporter.mjs', '--test-reporter-destination=stderr', 'tests/fixtures/registro-node-prova.mjs'];
		const execute = async (args: string[]) => {
			const child = spawn(process.execPath, args, { cwd: c.dir, env: c.env, stdio: ['ignore', 'pipe', 'pipe'] });
			let output = '';
			const closed = new Promise<{ code: number | null; signal: string | null }>(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
			await new Promise<void>((resolve, reject) => {
				const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('fixture not ready')); }, 10000);
				const read = (data: Buffer) => { output += data.toString(); if (output.includes('READY')) { clearTimeout(deadline); resolve(); } };
				child.stdout.on('data', read); child.stderr.on('data', read);
			});
			child.kill(signal);
			return await closed;
		};
		const native = await execute(args.filter(arg => !arg.startsWith('--import=') && !arg.startsWith('--test-reporter=./') && arg !== '--test-reporter-destination=stderr'));
		rmSync(c.consoleFile, { force: true });
		const exit = await execute(args);
		assert.deepEqual(exit, native, 'exit code and terminating signal match the native runtime');
		assert.ok(exit.signal === signal || exit.code !== 0, JSON.stringify(exit));
		const seen = entries(c.registry);
		assert.equal(seen.filter(entry => entry.kind === 'console' && entry.text === 'warning before interruption').length, 1);
		const report = analyze(seen, { now: Date.now() + 600000 });
		assert.ok(['interrotta', 'fallita'].includes(report.runs[0].status));
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});

test('console journal recovers partial lines and blocked writes, deduplicates replay and retains corrupt input', () => {
	const c = setup('recovery');
	try {
		const result = spawnSync(process.execPath, ['tests/fixtures/registro-node-recupero.mjs'], { cwd: c.dir, env: c.env, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /RECOVERY OK/);
		for (let replay = 0; replay < 2; replay++) {
			const recovered = spawnSync(process.execPath, ['tests/registro-console-node.mjs', c.consoleFile], { cwd: c.dir, env: c.env, encoding: 'utf8' });
			assert.equal(recovered.status, 1, recovered.stderr);
			assert.equal(JSON.parse(recovered.stdout).collected, 3);
		}
		assert.equal(entries(c.registry).filter(entry => entry.channel === 'console-node' && entry.seq).length, 3);
		assert.equal(entries(c.registry).filter(entry => entry.kind === 'end').length, 1);
		const counts = join(c.dir, 'counts.jsonl');
		const countResult = spawnSync(process.execPath, ['tests/fixtures/registro-node-recupero.mjs'], { cwd: c.dir, env: { ...c.env, IW_REPORT_CASE: 'counts', IW_CONSOLE_NODE: counts }, encoding: 'utf8' });
		assert.equal(countResult.status, 0, countResult.stdout + countResult.stderr);
		assert.match(countResult.stdout, /COUNTS OK/);
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});


test('SIGKILL leaves available console input recoverable without claiming automatic cleanup', async () => {
	const c = setup('interrupt');
	try {
		const child = spawn(process.execPath, ['--import=./tests/registro-reporter.mjs', '--test-reporter=./tests/registro-reporter.mjs', '--test-reporter-destination=stderr', 'tests/fixtures/registro-node-prova.mjs'], { cwd: c.dir, env: c.env, stdio: ['ignore', 'pipe', 'pipe'] });
		const closed = new Promise(resolve => child.on('close', resolve));
		await new Promise<void>((resolve, reject) => {
			const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('fixture not ready')); }, 10000);
			child.stdout!.on('data', data => { if (data.toString().includes('READY')) { clearTimeout(deadline); resolve(); } });
		});
		child.kill('SIGKILL'); await closed;
		assert.ok(existsSync(c.consoleFile));
		const run = entries(c.registry).find(entry => entry.kind === 'run');
		assert.ok(run);
		for (let i = 0; i < 2; i++) {
			const recovered = spawnSync(process.execPath, ['tests/registro-console-node.mjs', c.consoleFile], { cwd: c.dir, env: c.env, encoding: 'utf8' });
			assert.equal(recovered.status, 1, recovered.stderr);
			assert.equal(JSON.parse(recovered.stdout).incomplete, true);
		}
		const seen = entries(c.registry);
		assert.equal(seen.filter(entry => entry.kind === 'console' && entry.text === 'warning before interruption').length, 1);
		assert.equal(seen.filter(entry => entry.kind === 'end').length, 1);
		assert.equal(analyze(seen, { now: Date.now() + 600000 }).runs[0].status, 'interrotta');
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});

test('the compiled runner retains the console journal outside its temporary bundle after termination', async () => {
	const c = setup('interrupt');
	try {
		cpSync('src/i18n', join(c.dir, 'src/i18n'), { recursive: true });
		symlinkSync(join(process.cwd(), 'node_modules'), join(c.dir, 'node_modules'), 'dir');
		for (const name of readdirSync(join(c.dir, 'tests'))) if (name.endsWith('.test.ts')) rmSync(join(c.dir, 'tests', name));
		writeFileSync(join(c.dir, 'tests/interrupt.test.ts'), "import './fixtures/registro-node-prova.mjs';\n");
		const child = spawn(process.execPath, ['tests/run.mjs'], { cwd: c.dir, env: c.env, stdio: ['ignore', 'pipe', 'pipe'] });
		const closed = new Promise<number | null>(resolve => child.on('close', resolve));
		let output = '';
		await new Promise<void>((resolve, reject) => {
			const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('runner not ready')); }, 10000);
			child.stdout!.on('data', data => { output += data.toString(); if (output.includes('READY')) { clearTimeout(deadline); resolve(); } });
		});
		const journals = `${c.registry}-console-node`;
		const file = join(journals, readdirSync(journals)[0]!, 'console.jsonl');
		const metadata = JSON.parse(readFileSync(`${file}.run.json`, 'utf8'));
		process.kill(metadata.pid, 'SIGTERM');
		assert.equal(await closed, 1);
		assert.ok(existsSync(file));
		assert.ok(!existsSync(`${file}.complete`));
		assert.equal(entries(c.registry).filter(entry => entry.kind === 'console' && entry.text === 'warning before interruption').length, 1);
		assert.ok(entries(c.registry).find(entry => entry.kind === 'end').interrupted);
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});


test('explicit process.exit keeps its native code and already collected console before stream startup', () => {
	const c = setup('exit');
	try {
		const result = spawnSync(process.execPath, ['--import=./tests/registro-reporter.mjs', '--test-reporter=./tests/registro-reporter.mjs', '--test-reporter-destination=stderr', 'tests/fixtures/registro-node-prova.mjs'], { cwd: c.dir, env: c.env, encoding: 'utf8' });
		assert.equal(result.status, 23);
		const seen = entries(c.registry);
		assert.equal(seen.filter(entry => entry.kind === 'console' && entry.text === 'warning before explicit exit').length, 1);
		assert.equal(seen.filter(entry => entry.kind === 'end').length, 1);
		assert.ok(seen.find(entry => entry.kind === 'end').interrupted);
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});


test('a native one-shot signal handler can ignore the first signal; the next keeps its default exit and console', async () => {
	const c = setup('handled-signal');
	try {
		const execute = async (observed: boolean) => {
			rmSync(c.consoleFile, { force: true });
			const child = spawn(process.execPath, [...(observed ? ['--import=./tests/registro-reporter.mjs', '--test-reporter=./tests/registro-reporter.mjs', '--test-reporter-destination=stderr'] : []), 'tests/fixtures/registro-node-prova.mjs'], { cwd: c.dir, env: c.env, stdio: ['ignore', 'pipe', 'pipe'] });
			const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
			let output = '';
			const waitFor = async (text: string) => {
				const deadline = Date.now() + 10000;
				while (!output.includes(text) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
				if (!output.includes(text)) { child.kill('SIGKILL'); assert.fail(text); }
			};
			child.stdout!.on('data', data => { output += data.toString(); });
			await waitFor('READY'); child.kill('SIGTERM'); await waitFor('HANDLED');
			assert.equal(child.signalCode, null, 'the first signal was handled without stopping');
			child.kill('SIGTERM'); return await closed;
		};
		const native = await execute(false), observed = await execute(true);
		assert.deepEqual(observed, native);
		const seen = entries(c.registry);
		for (const text of ['warning before interruption', 'warning after handled signal']) assert.equal(seen.filter(entry => entry.kind === 'console' && entry.text === text).length, 1);
		assert.equal(seen.filter(entry => entry.kind === 'end').length, 1);
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});
