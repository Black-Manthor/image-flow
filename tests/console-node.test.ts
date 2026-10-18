import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { describeCall, install, TEXT_LIMIT } from './console-node.mjs';
import { registryFile } from './registro.mjs';

// The fixture's calls are made on purpose, in a child process with a registry
// and a console file of its own: never in this suite's console nor in the
// project's registry.
const withoutTestContext = (env: NodeJS.ProcessEnv) => Object.fromEntries(Object.entries(env).filter(([name]) => name !== 'NODE_TEST_CONTEXT'));

test('the actual Node runner bundle maps plugin and test callers, excludes collection frames, and leaves insufficient evidence uncertain', () => {
	const dir = mkdtempSync(join(tmpdir(), 'iw-console-bundle-'));
	try {
		mkdirSync(join(dir, 'tests'));
		mkdirSync(join(dir, 'src'));
		for (const file of ['run.mjs', 'console-node.mjs', 'node-test-contesto.mjs', 'node-dom.ts', 'registro-reporter.mjs', 'registro-console-node.mjs', 'registro.mjs', 'copertura-mappa.mjs']) {
			cpSync(join('tests', file), join(dir, 'tests', file));
		}
		cpSync('src/i18n', join(dir, 'src/i18n'), { recursive: true });
		symlinkSync(join(process.cwd(), 'node_modules'), join(dir, 'node_modules'), 'dir');
		// Only this isolated copy has a synthetic plugin caller and intentional reports.
		writeFileSync(join(dir, 'src/caller.ts'), "export function report() {\n console.error('bundle: plugin');\n}\n");
		writeFileSync(join(dir, 'tests/caller.test.ts'), [
			"import { test } from 'node:test';",
			"import { report } from '../src/caller';",
			"test('bundle callers', () => { console.warn('bundle: test'); report();",
			" const limit = Error.stackTraceLimit; try { Error.stackTraceLimit = 0; console.warn('bundle: unknown'); } finally { Error.stackTraceLimit = limit; }",
			"});",
		].join('\n'));
		const env = withoutTestContext(process.env);
		delete env.IW_COPERTURA;
		delete env.NODE_V8_COVERAGE;
		const registry = join(dir, 'registro');
		const result = spawnSync(process.execPath, ['tests/run.mjs'], { cwd: dir, encoding: 'utf8', env: { ...env, IW_REGISTRO: registry } });
		assert.equal(result.status, 0, result.stdout + result.stderr);
		const entries = readdirSync(registry).flatMap(file => readFileSync(join(registry, file), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
		const calls = entries.filter(entry => entry.kind === 'console');
		const one = (text: string) => calls.find(entry => entry.text === text);
		assert.equal(calls.length, 3, JSON.stringify(calls));
		for (const [text, source, frame] of [['bundle: plugin', 'plugin', 'src/caller.ts:2'], ['bundle: test', 'test', 'tests/caller.test.ts:3']]) {
			const entry = one(text!);
			assert.equal(entry.source, source, JSON.stringify(entry));
			assert.equal(entry.frames[0], frame);
			assert.match(entry.stack, new RegExp(frame!.replaceAll('.', '\\.')));
			assert.doesNotMatch(entry.stack, /console-node\.mjs|node-test-contesto\.mjs/);
			assert.ok(entry.frames.every((where: string) => !/console-node\.mjs|node-test-contesto\.mjs/.test(where)));
		}
		assert.equal(one('bundle: unknown').source, 'uncertain');
		assert.equal(one('bundle: unknown').frames, undefined);
		assert.equal(one('bundle: unknown').stack, undefined);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

function runFixture() {
	const dir = mkdtempSync(join(tmpdir(), 'iw-console-node-'));
	const registry = join(dir, 'registro');
	const result = spawnSync(process.execPath, ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=./tests/registro-reporter.mjs',
		'--test-reporter-destination=stderr', 'tests/fixtures/console-node-prova.mjs'], {
		// Its own test run: not a child of this one's (NODE_TEST_CONTEXT).
		encoding: 'utf8', env: { ...withoutTestContext(process.env), IW_SUITE: 'node', IW_REGISTRO: registry, IW_CONSOLE_NODE: join(dir, 'console.jsonl') },
	});
	const lines = existsSync(registry) ? readdirSync(registry).flatMap(file => readFileSync(join(registry, file), 'utf8').trim().split('\n').map(line => JSON.parse(line))) : [];
	rmSync(dir, { recursive: true, force: true });
	return { result, lines, console: lines.filter(line => line.kind === 'console') };
}

test('the Node suite\'s console: each warning and error kept with its test, level, place and run, repeats included, output unchanged', () => {
	const { result, lines, console: seen } = runFixture();
	assert.equal(result.status, 0, result.stdout + result.stderr);
	const run = lines.find(line => line.kind === 'run');
	assert.ok(seen.every(line => line.run === run.run && line.suite === 'node' && line.channel === 'console-node'));
	const byText = (text: string) => seen.filter(line => line.text.startsWith(text));
	const repeated = byText('prova: avviso ripetuto');
	assert.equal(repeated.length, 2, 'the same text twice stays two');
	assert.notEqual(repeated[0].seq, repeated[1].seq);
	assert.ok(repeated.every(line => line.level === 'warning' && line.test === 'prova: avvisi ed errori' && line.source === 'test'));
	assert.equal(repeated[0].frames[0], 'tests/fixtures/console-node-prova.mjs:21', 'the caller, not the collection nor its wrapper');
	assert.ok(repeated.every(line => !line.frames.some((frame: string) => /console-node\.mjs|node-test-contesto\.mjs/.test(frame))));
	const error = byText('prova: errore')[0];
	assert.equal(error.level, 'error');
	assert.equal(error.text, 'prova: errore (oggetto non ispezionato)');
	assert.equal(error.representation, 'prudent');
	assert.ok(typeof error.stack === 'string' && error.stack.length > 0);
	assert.ok(typeof error.observedAt === 'string');
	// The terminal still shows what the console printed.
	for (const text of ['prova: avviso ripetuto', 'prova: circolare <ref *1>', 'prova: dopo la fine del test', 'prova: fuori dai test']) assert.ok((result.stdout + result.stderr).includes(text), text);
	// Nothing reached the project's registry.
	const project = registryFile();
	if (existsSync(project)) {
		const entries = readFileSync(project, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
		assert.ok(!entries.some(entry => entry.kind === 'console' && entry.text === 'prova: avviso ripetuto'),
			'no intentional console call in the caller registry; a failed assertion may quote its text');
	}
});

test('objects stay uninspected in the journal, primitive text is limited, and the native console still throws', () => {
	const { console: seen } = runFixture();
	assert.equal(seen.find(line => line.text.startsWith('prova: circolare'))!.representation, 'prudent');
	assert.ok(seen.some(line => line.text === 'prova: ostile (oggetto non ispezionato)' && line.representation === 'prudent' && line.test === 'prova: valori difficili'));
	assert.ok(!seen.some(line => line.text === 'prova: la console non ha rifiutato il valore'), 'the console itself still throws, as before');
	const long = seen.find(line => line.text.startsWith('prova: lungo'))!;
	assert.equal(long.text.length, TEXT_LIMIT);
	assert.equal(long.truncated, 'prova: lungo '.length + 3000);
	assert.deepEqual(describeCall(['a', { b: 1 }]), { text: 'a (oggetto non ispezionato)', representation: 'prudent' });
});

test('asynchronous calls keep their test, after its end too; calls without a native context name none and never borrow a running test', () => {
	const { console: seen } = runFixture();
	const one = (text: string) => seen.find(line => line.text === text)!;
	assert.equal(one('prova: dopo un await').test, 'prova: asincrono');
	assert.equal(one('prova: dopo un await').afterEnd, undefined);
	assert.equal(one('prova: dopo la fine del test').test, 'prova: asincrono', 'its own test, not the one running then');
	assert.equal(one('prova: dopo la fine del test').afterEnd, true);
	const outside = one('prova: fuori dai test');
	assert.equal(outside.test, '');
	assert.equal(outside.outsideTest, true);
	assert.equal(outside.runningTest, undefined, 'no tracing subscription or guessed running test');
	assert.equal(one('prova: prima di done').test, 'prova: callback');
	assert.equal(one('prova: prima di done').afterEnd, undefined, 'a callback test ends at done');
	// A test's own replacement of the console is left alone, then collection resumes.
	assert.ok(!seen.some(line => line.text.includes('non raccolto')));
	assert.equal(one('prova: di nuovo raccolto').test, 'prova: sostituzione altrui');
	// The collection closed cleanly: no warning of the bench about it.
	assert.ok(!seen.some(line => line.source === 'banco'));
	const { lines } = runFixture();
	assert.deepEqual(lines.find(line => line.kind === 'end').consoleNode, { collected: lines.filter(line => line.kind === 'console').length, closed: true, transferComplete: true, coverageComplete: true });
});

test('the wrapper calls the original with the same this and arguments, returns its value, and is undone without touching another replacement', () => {
	const written: string[] = [];
	const calls: unknown[][] = [];
	const target = {
		warn(...args: unknown[]) { calls.push([this, ...args]); return 'valore'; },
		error(...args: unknown[]) { calls.push([this, ...args]); return 'altro'; },
	};
	const originalError = target.error;
	const collection = install({ target, write: (line: string) => written.push(line) } as never);
	assert.equal(target.warn('uno', 2), 'valore');
	assert.deepEqual(calls[0], [target, 'uno', 2]);
	const theirs = () => 'loro';
	target.warn = theirs;
	const { restored, calls: count } = collection.uninstall();
	assert.deepEqual(restored, ['console.warn sostituito da altri nel frattempo: lasciato com\'è', 'console.error ripristinato']);
	assert.equal(target.warn, theirs);
	assert.equal(target.error, originalError);
	assert.equal(count, 1);
	target.error('dopo');
	assert.equal(written.length, 1, 'nothing written once undone');
	assert.equal(JSON.parse(written[0]!).text, 'uno 2');
});
