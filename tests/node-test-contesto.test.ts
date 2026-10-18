import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const fixture = 'tests/fixtures/node-test-contesto-prova.mjs';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['NODE_TEST_CONTEXT', 'IW_CONSOLE_NODE', 'IW_COPERTURA', 'NODE_V8_COVERAGE'].includes(key)));

function compare(mode: string, flags: string[] = [], declarations = true) {
	const dir = mkdtempSync(join(tmpdir(), 'iw-native-context-'));
	try {
		const run = (module: string) => {
			const cwd = join(dir, module);
			cpSync('tests', join(cwd, 'tests'), { recursive: true });
			const events = join(cwd, 'events.jsonl'), consoleFile = join(cwd, 'console.jsonl'), exports = join(cwd, 'exports.json');
			const result = spawnSync(process.execPath, ['--test', ...flags, '--test-reporter=./tests/fixtures/node-test-contesto-reporter.mjs', `--test-reporter-destination=${events}`, fixture],
				{ cwd, encoding: 'utf8', timeout: 10000, env: { ...env, IW_NODE_MODULE: module, IW_NODE_CASE: mode, IW_CONSOLE_NODE: consoleFile, IW_NODE_EXPORTS: exports, IW_REGISTRO: join(cwd, 'registry') } });
			assert.equal(result.error, undefined, String(result.error));
			const lines = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
			return { result, events: lines(events), console: lines(consoleFile).filter(entry => !entry.summary), exports: mode === 'exports' ? JSON.parse(readFileSync(exports, 'utf8')) : undefined };
		};
		const original = run('native'), wrapped = run('wrapped');
		assert.equal(original.result.status, ['failures', 'hook failures', 'late'].includes(mode) ? 1 : 0, original.result.stderr);
		if (mode !== 'exports') assert.ok(original.events.length > 0, 'native runner produced outcomes');
		const normalize = (events: Array<Record<string, unknown>>) => events.map(entry => ({ ...entry, ...(typeof entry.file === 'string' ? { file: declarations ? entry.file.slice(entry.file.indexOf('/tests/') + 1) : undefined, line: declarations ? entry.line : undefined, column: declarations ? entry.column : undefined } : {}) }));
		assert.equal(wrapped.result.status, original.result.status, JSON.stringify(wrapped.events));
		assert.equal(wrapped.result.signal, original.result.signal);
		assert.equal(wrapped.result.stdout, original.result.stdout);
		assert.equal(wrapped.result.stderr, original.result.stderr);
		// Native output and outcomes are independent streams: their interleaving
		// and output chunk boundaries are not execution semantics.
		const outcomes = (events: Array<Record<string, unknown>>) => events.filter(entry => entry.type === 'test:pass' || entry.type === 'test:fail');
		assert.deepEqual(normalize(outcomes(wrapped.events)), normalize(outcomes(original.events)), 'native outcomes and declaration sites');
		for (const type of ['test:stdout', 'test:stderr']) {
			const output = (events: Array<Record<string, unknown>>) => events.filter(entry => entry.type === type).map(entry => entry.message).join('');
			assert.equal(output(wrapped.events), output(original.events), type);
		}
		if (mode === 'exports') assert.deepEqual(wrapped.exports, original.exports, 'all named/default exports are the native objects');
		// Return detached observations; the isolated copies and files are cleaned.
		return wrapped;
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

test('node:test compatibility: all named/default exports and aliases stay native', () => { compare('exports'); });

for (const mode of ['success', 'concurrency', 'failures', 'hook failures']) test(`node:test compatibility: ${mode}, hooks, groups, done and declaration sites`, () => { compare(mode); });

for (const flags of [[], ['--test-name-pattern=selected'], ['--test-only']]) test(`node:test compatibility: selection ${flags.join(' ') || 'all'}`, () => { compare('selection', flags); });

test('native context: t.test and concurrent children have their own origin', () => {
	const seen = compare('concurrency', [], false).console;
	for (const [message, name] of [['context: first starts', 'first'], ['context: second starts', 'second']]) {
		const entry = seen.find(entry => entry.text === message)!;
		assert.equal(entry.test, name); assert.equal(entry.afterEnd, undefined);
	}
});

test('native context: asynchronous calls after timeout/cancellation retain their origin and afterEnd', () => {
	const seen = compare('late', [], false).console;
	for (const [message, name] of [['late timeout', 'timed out'], ['late callback timeout', 'callback timeout'], ['late cancellation', 'cancelled'], ['late child', 'cancelled child']]) {
		const entry = seen.find(entry => entry.text === `context: ${message}`)!;
		assert.ok(entry, message);
		assert.equal(entry.test, name); assert.equal(entry.afterEnd, true, JSON.stringify(entry));
	}
});


test('native context: root hooks and unobserved hook spans never borrow the test then running', () => {
	const seen = compare('success').console;
	for (const message of ['root before', 'beforeEach parent', 'afterEach child']) {
		const entry = seen.find(entry => entry.text === `context: ${message}`)!;
		assert.ok(entry, message);
		assert.equal(entry.test, undefined);
		assert.equal(entry.afterEnd, undefined);
		assert.ok(entry.outsideTest === true || entry.contextUnavailable === true);
	}
	for (const [message, name] of [['parent before', 'parent'], ['child this=true', 'child'], ['callback child', 'callback child'], ['group before', 'group']]) {
		assert.equal(seen.find(entry => entry.text === `context: ${message}`)!.test, name);
	}
	const rootName = seen.find(entry => entry.text === 'context: user root name')!;
	assert.equal(rootName.test, undefined);
	assert.equal(rootName.contextUnavailable, true);
});
