import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertNoRunConsole, assertRunConsoleIsolation } from './registro-isolamento.mjs';

const identity = { run: '2026-10-16T00:00:00.000Z-aaaa', suite: 'collector' };
const header = { kind: 'run', ...identity };
const foreign = { run: '2026-10-15T00:00:00.000Z-bbbb', suite: 'foreign' };
const foreignHeader = { kind: 'run', ...foreign };
function fixture(t: TestContext) {
	const dir = mkdtempSync(join(tmpdir(), 'iw-registro-isolamento-'));
	t.after(() => {
		const evidence = process.env.IW_ISOLAMENTO_EVIDENZE;
		if (evidence) { mkdirSync(evidence, { recursive: true }); cpSync(dir, join(evidence, basename(dir)), { recursive: true, errorOnExist: true }); }
		rmSync(dir, { recursive: true, force: true });
	});
	return dir;
}
function child(dir: string, action: string) {
	const result = spawnSync(process.execPath, ['tests/fixtures/registro-isolamento-prova.mjs', action], {
		encoding: 'utf8', timeout: 20000, env: { ...process.env, IW_REGISTRO: dir },
	});
	writeFileSync(join(dir, `child-${action}.json`), JSON.stringify(result, null, 2));
	assert.equal(result.error, undefined);
	return result;
}

test('collector isolation: a real foreign run with an intentional message does not fail the current run', t => {
	const dir = fixture(t);
	assert.equal(child(dir, 'foreign').status, 0);
	const result = child(dir, 'clean');
	assert.equal(result.status, 0, result.stderr);
});

test('collector isolation: an event actually written by the current page collector fails, without a message-prefix filter', t => {
	const dir = fixture(t), result = child(dir, 'leak');
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /Segnalazioni console sfuggite nella run corrente/);
	const entries = readdirSync(dir).filter(n => n.endsWith('.jsonl')).flatMap(n => readFileSync(join(dir, n), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
	const run = entries.find(e => e.kind === 'run');
	const event = entries.find(e => e.kind === 'console');
	assert.equal(event.run, run.run);
	assert.equal(event.suite, run.suite);
	assert.equal(event.text, 'evento corrente senza prefisso convenzionale');
	assert.equal(entries.at(-1).kind, 'end');
});

for (const action of ['missing', 'ambiguous']) test(`collector isolation: ${action} persisted identity fails closed`, t => {
	const result = child(fixture(t), action);
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /Identità del record|Metadati della run corrente/);
});

test('collector isolation: absent, empty and unavailable expected identities are never success', () => {
	for (const missing of [undefined, {}, { run: identity.run }, { ...identity, run: '' }, { ...identity, suite: 'non disponibile' }]) {
		assert.throws(() => assertNoRunConsole([header], missing), /Identità della run corrente/);
	}
});

test('collector isolation: missing or duplicate current headers, including exact duplicates, fail closed', () => {
	for (const entries of [[], [{ kind: 'result', ...identity }], [header, header], [header, { ...header, suite: 'different' }]]) {
		assert.throws(() => assertNoRunConsole(entries, identity), /Metadati della run corrente/);
	}
});

test('collector isolation: a foreign result quoting a message is not a console event, even in the current run', () => {
	assert.doesNotThrow(() => assertNoRunConsole([header, foreignHeader,
		{ kind: 'result', ...foreign, error: 'prova: a historical failure' },
		{ kind: 'result', ...identity, error: 'prova: a quoted assertion' },
		{ kind: 'console', ...foreign, text: 'prova: a foreign event' }], identity));
});

test('collector isolation: unbound events and contradictory or ambiguous foreign identities are not discarded', () => {
	for (const entries of [
		[header, { kind: 'console', ...foreign }],
		[header, foreignHeader, foreignHeader, { kind: 'console', ...foreign }],
		[header, foreignHeader, { kind: 'console', ...foreign, suite: 'wrong' }],
		[header, { kind: 'console', suite: identity.suite }],
		[header, { kind: 'console', ...identity, suite: 'wrong' }],
	]) assert.throws(() => assertNoRunConsole(entries, identity));
});

test('collector isolation: every current console channel fails, including messages without the old sentinel', () => {
	for (const event of [undefined, 'pageerror', 'window-error', 'unhandledrejection']) {
		assert.throws(() => assertNoRunConsole([header, { kind: 'console', ...identity, event, text: 'no conventional prefix' }], identity), /Segnalazioni console sfuggite/);
	}
});

test('collector isolation: the reader follows run identity across daily files and preserves bytes', async t => {
	const dir = fixture(t);
	const first = join(dir, '2026-10-16.jsonl'), next = join(dir, '2026-10-17.jsonl');
	writeFileSync(first, JSON.stringify(header) + '\n');
	writeFileSync(next, JSON.stringify({ kind: 'console', ...identity, text: 'next day' }) + '\n');
	const before = [readFileSync(first), readFileSync(next)];
	await assert.rejects(assertRunConsoleIsolation(dir, identity), /Segnalazioni console sfuggite/);
	assert.deepEqual([readFileSync(first), readFileSync(next)], before);
});

test('collector isolation: missing files, absent header and malformed records cannot become a clean result', async t => {
	const dir = fixture(t);
	await assert.rejects(assertRunConsoleIsolation(join(dir, 'absent'), identity));
	await assert.rejects(assertRunConsoleIsolation(dir, identity), /Metadati della run corrente/);
	writeFileSync(join(dir, '2026-10-16.jsonl'), JSON.stringify(header) + '\n{broken\n');
	await assert.rejects(assertRunConsoleIsolation(dir, identity), /Registro non leggibile/);
});


test('collector isolation: earlier legacy days are foreign; missing identity on a relevant day still fails', async t => {
	const dir = fixture(t);
	const historical = join(dir, '2026-10-15.jsonl');
	writeFileSync(historical, JSON.stringify({kind: 'result', run: foreign.run, error: 'prova: legacy result without suite'}) + '\n');
	const before = readFileSync(historical);
	writeFileSync(join(dir, '2026-10-16.jsonl'), JSON.stringify(header) + '\n');
	await assertRunConsoleIsolation(dir, identity);
	assert.deepEqual(readFileSync(historical), before);
	writeFileSync(join(dir, '2026-10-17.jsonl'), JSON.stringify({kind: 'console', suite: identity.suite}) + '\n');
	await assert.rejects(assertRunConsoleIsolation(dir, identity), /Identità del record/);
});
