import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, appendFileSync, utimesSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';

const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['NODE_TEST_CONTEXT', 'IW_CONSOLE_NODE', 'IW_SUITE', 'IW_COPERTURA', 'NODE_V8_COVERAGE'].includes(key)));
function setup(partial = false, journalCase?: string) {
	const dir = mkdtempSync(join(tmpdir(), 'iw-recovery-integrity-'));
	cpSync('tests', join(dir, 'tests'), { recursive: true });
	mkdirSync(join(dir, 'journal'));
	const file = join(dir, 'journal', 'console.jsonl'), registry = join(dir, 'registry');
	const env = { ...clean, IW_REGISTRO: registry, IW_CONSOLE_NODE: file, ...(partial ? { IW_RECOVERY_PARTIAL: '1' } : {}), ...(journalCase ? { IW_JOURNAL_CASE: journalCase } : {}) };
	const created = spawnSync(process.execPath, [journalCase ? 'tests/fixtures/registro-node-prefisso.mjs' : 'tests/fixtures/registro-node-integrita.mjs'], { cwd: dir, env, encoding: 'utf8' });
	assert.equal(created.status, 0, created.stderr);
	const info = JSON.parse(readFileSync(file + '.run.json', 'utf8'));
	return { dir, file, env, info, registry, output: created.stdout };
}
type Case = ReturnType<typeof setup>;
const recover = (c: Case) => spawnSync(process.execPath, ['tests/registro-console-node.mjs', c.file], { cwd: c.dir, env: c.env, encoding: 'utf8', timeout: 15000 });
const records = (c: Case) => readdirSync(c.registry).flatMap(name => readFileSync(join(c.registry, name), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)));
const observations = (c: Case) => records(c).filter(entry => entry.channel === 'console-node' && entry.seq);
function ownerLock(c: Case, pid: number) {
	mkdirSync(c.file + '.recover.lock');
	writeFileSync(join(c.file + '.recover.lock', 'owner.json'), JSON.stringify({ pid, host: hostname(), token: randomUUID(), journal: c.file, identity: createHash('sha256').update(JSON.stringify(c.info)).digest('hex') }));
}

test('simultaneous recovery refuses the second owner; killed recovery resumes without duplicates', async () => {
	const c = setup();
	let child: ReturnType<typeof spawn> | undefined;
	try {
		child = spawn(process.execPath, ['--import=./tests/fixtures/registro-node-integrita.mjs', 'tests/registro-console-node.mjs', c.file], { cwd: c.dir, env: { ...c.env, IW_RECOVERY_PAUSE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
		const closed = new Promise(resolve => child!.on('close', resolve));
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('recovery did not reach crash point')), 12000);
			let output = '';
			child!.stdout!.on('data', data => { output += data.toString(); if (output.includes('RECOVERY LOCKED')) { clearTimeout(timeout); resolve(); } });
			child!.once('error', reject);
		});
		assert.equal(observations(c).length, 1);
		const second = recover(c);
		assert.equal(second.status, 1, second.stdout + second.stderr);
		assert.match(second.stderr, /lock active/);
		assert.equal(observations(c).length, 1);
		assert.equal(records(c).filter(entry => entry.kind === 'end').length, 0);
		child.kill('SIGKILL'); await closed;
		for (let replay = 0; replay < 2; replay++) {
			const result = recover(c);
			assert.equal(result.status, 0, result.stderr);
			assert.equal(JSON.parse(result.stdout).collected, 3);
		}
		assert.equal(observations(c).length, 3);
		assert.equal(records(c).filter(entry => entry.kind === 'end').length, 1);
		assert.ok(records(c).find(entry => entry.kind === 'end').interrupted);
	} finally { child?.kill('SIGKILL'); rmSync(c.dir, { recursive: true, force: true }); }
});

for (const mode of ['text', 'lost', 'finish-during']) test(`changed consumed journal: ${mode} retains evidence and historical records`, () => {
	const c = setup(false, mode);
	try {
		const { first, second } = JSON.parse(c.output);
		assert.equal(first.transferComplete, true);
		assert.equal(first.coverageComplete, true);
		assert.equal(second.incomplete, true);
		assert.equal(second.transferComplete, false);
		assert.equal(second.coverageComplete, false);
		assert.match(second.transferError, /journal.*changed/);
		assert.equal(existsSync(`${c.file}.complete`), false);
		const before = records(c), originalEnd = before.find(entry => entry.kind === 'end');
		assert.deepEqual(originalEnd.consoleNode, first, 'the historical end is not rewritten');
		assert.equal(observations(c)[0].text, 'original');
		assert.ok(before.some(entry => entry.kind === 'collection' && entry.incomplete), 'incoherence is recorded');
		const bytes = readFileSync(c.file), sidecar = readFileSync(`${c.file}.run.json`);
		const cleanup = spawnSync(process.execPath, ['--input-type=module', '-e', `import {cleanup} from './tests/registro-console-node.mjs'; console.log(cleanup(${JSON.stringify(c.file)}));`], { cwd: c.dir, env: c.env, encoding: 'utf8' });
		assert.equal(cleanup.status, 0, cleanup.stderr);
		assert.equal(cleanup.stdout.trim(), 'false');
		for (let replay = 0; replay < 2; replay++) {
			const recovered = recover(c);
			assert.equal(recovered.status, 1, recovered.stdout + recovered.stderr);
			assert.equal(JSON.parse(recovered.stdout).incomplete, true);
			assert.equal(existsSync(`${c.file}.complete`), false);
			assert.equal(observations(c).length, 1);
			assert.deepEqual(records(c).filter(entry => entry.kind === 'end'), [originalEnd]);
		}
		assert.deepEqual(readFileSync(c.file), bytes);
		assert.deepEqual(readFileSync(`${c.file}.run.json`), sidecar);
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});

test('an unchanged consumed prefix permits append-only finalization and repeated replay', () => {
	const c = setup(false, 'append');
	try {
		const { first, second } = JSON.parse(c.output);
		assert.equal(first.collected, 2);
		assert.deepEqual(second, first);
		assert.equal(second.incomplete, undefined);
		for (let replay = 0; replay < 2; replay++) assert.equal(recover(c).status, 0);
		assert.equal(observations(c).length, 2);
		assert.equal(records(c).filter(entry => entry.kind === 'end').length, 1);
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});

for (const timing of ['before', 'during']) test(`a journal changed ${timing} cleanup is retained`, () => {
	const c = setup(false, 'append');
	try {
		const before = records(c), sidecar = readFileSync(`${c.file}.run.json`);
		if (timing === 'before') writeFileSync(c.file, readFileSync(c.file, 'utf8').replace('original', 'modified'));
		const args = timing === 'during' ? ['tests/fixtures/registro-node-prefisso.mjs'] : ['--input-type=module', '-e', `import {cleanup} from './tests/registro-console-node.mjs'; console.log(JSON.stringify({cleaned:cleanup(${JSON.stringify(c.file)})}));`];
		const result = spawnSync(process.execPath, args, { cwd: c.dir, env: { ...c.env, IW_JOURNAL_CASE: 'cleanup-during' }, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		assert.equal(JSON.parse(result.stdout).cleaned, false);
		assert.match(readFileSync(c.file, 'utf8'), /modified/);
		assert.deepEqual(readFileSync(`${c.file}.run.json`), sidecar);
		const after = records(c);
		assert.deepEqual(after.slice(0, before.length), before, 'cleanup does not rewrite registry data');
		assert.ok(after.some(entry => entry.kind === 'collection' && entry.incomplete));
		assert.ok(after.some(entry => entry.transferNotice && entry.text.includes('journal changed before cleanup')));
		assert.equal(existsSync(`${c.file}.complete`), false);
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});

for (const mode of ['active', 'stale', 'partial', 'repeated'] as const) test(`recovery: ${mode} lock or replay`, () => {
	const c = setup(mode === 'partial');
	try {
		if (mode === 'active') { ownerLock(c, process.pid); utimesSync(join(c.file + '.recover.lock', 'owner.json'), new Date(0), new Date(0)); }
		if (mode === 'stale') ownerLock(c, c.info.pid);
		const before = observations(c).length;
		const result = recover(c);
		if (mode === 'active') {
			assert.equal(result.status, 1); assert.match(result.stderr, /lock active/);
			assert.equal(observations(c).length, before);
			assert.ok(existsSync(c.file + '.recover.lock'));
		} else {
			assert.equal(result.status, 0, result.stderr);
			assert.equal(recover(c).status, 0);
			assert.equal(observations(c).length, 3);
			assert.equal(records(c).filter(entry => entry.kind === 'end').length, 1);
			if (mode === 'partial') assert.equal(before, 1);
		}
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});

for (const mode of ['sidecar-run', 'destination', 'pid', 'missing', 'corrupt', 'header', 'foreign-row', 'symlink', 'registry-symlink', 'registry-corrupt', 'missing-run-record'] as const) test(`uncertain ${mode} refuses recovery and retains material`, () => {
	const c = setup();
	try {
		const before = JSON.stringify(records(c));
		const sidecar = c.file + '.run.json';
		if (mode === 'sidecar-run') writeFileSync(sidecar, JSON.stringify({ ...c.info, run: 'foreign-run' }));
		if (mode === 'destination') writeFileSync(sidecar, JSON.stringify({ ...c.info, destination: join(c.dir, 'foreign.jsonl') }));
		if (mode === 'pid') writeFileSync(sidecar, JSON.stringify({ ...c.info, pid: 0 }));
		if (mode === 'missing') rmSync(sidecar);
		if (mode === 'corrupt') writeFileSync(sidecar, '{broken');
		if (mode === 'missing-run-record') writeFileSync(sidecar, JSON.stringify({ ...c.info, runRecord: undefined }));
		if (mode === 'registry-corrupt') appendFileSync(c.info.destination, '{broken}\n');
		if (mode === 'header') writeFileSync(c.file, readFileSync(c.file, 'utf8').split('\n').filter(line => !line.includes('"journal":true')).join('\n'));
		if (mode === 'foreign-row') appendFileSync(c.file, JSON.stringify({ seq: 4, level: 'warning', text: 'foreign', run: 'foreign-run' }) + '\n');
		if (mode === 'symlink') { const target = join(c.dir, 'foreign-meta'); writeFileSync(target, JSON.stringify(c.info)); rmSync(sidecar); symlinkSync(target, sidecar); }
		if (mode === 'registry-symlink') { const original = c.info.destination; const target = join(c.dir, 'foreign-registry'); writeFileSync(target, readFileSync(original)); rmSync(original); symlinkSync(target, original); }
		const bytesBefore = readFileSync(c.info.destination);
		const result = recover(c);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.ok(result.stderr.trim());
		if (mode !== 'registry-corrupt') assert.equal(JSON.stringify(records(c)), before);
		assert.deepEqual(readFileSync(c.info.destination), bytesBefore);
		assert.ok(existsSync(c.file));
		assert.equal(existsSync(join(c.dir, 'foreign.jsonl')), false);
		assert.equal(existsSync(c.file + '.complete'), false);
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});

test('a changed journal revokes completion; cleanup refuses foreign files and stale markers', () => {
	const c = setup();
	try {
		assert.equal(recover(c).status, 0);
		appendFileSync(c.file, '{partial');
		const incomplete = recover(c);
		assert.equal(incomplete.status, 1, incomplete.stderr);
		assert.equal(JSON.parse(incomplete.stdout).pendingBytes, 8);
		assert.equal(existsSync(c.file + '.complete'), false);
		const foreign = join(dirname(c.file), 'other-run.jsonl'); writeFileSync(foreign, 'foreign evidence\n');
		writeFileSync(c.file + '.complete', 'transferred\n');
		const attempt = spawnSync(process.execPath, ['--input-type=module', '-e', `const module=await import('./tests/registro-console-node.mjs');
			const fs=await import('node:fs'), promises=await import('node:fs/promises');
			const source=fs.readFileSync('tests/run.mjs','utf8');
			const start=source.indexOf('async function journalComplete');
			const prior=source.slice(start,source.indexOf('const directory',start));
			const decision=module.cleanup ? module.cleanup(${JSON.stringify(c.file)}) : await new Function('consoleFile','existsSync','readFile',prior+';return journalComplete();')(${JSON.stringify(c.file)},fs.existsSync,promises.readFile);
			console.log(decision);`], { cwd: c.dir, env: c.env, encoding: 'utf8' });
		assert.equal(attempt.stdout.trim(), 'false');
		assert.equal(readFileSync(foreign, 'utf8'), 'foreign evidence\n'); assert.ok(existsSync(c.file));
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});

for (const mode of ['clean', 'foreign-file', 'foreign-marker', 'wrong-registry', 'uncertain-lock'] as const) test(`cleanup and destination isolation: ${mode}`, () => {
	const c = setup();
	try {
		if (mode === 'wrong-registry') {
			const result = spawnSync(process.execPath, ['tests/registro-console-node.mjs', c.file], { cwd: c.dir, env: { ...c.env, IW_REGISTRO: join(c.dir, 'other-registry') }, encoding: 'utf8' });
			assert.equal(result.status, 1); assert.equal(observations(c).length, 0);
			assert.equal(existsSync(join(c.dir, 'other-registry')), false); return;
		}
		if (mode === 'uncertain-lock') {
			mkdirSync(c.file + '.recover.lock'); writeFileSync(join(c.file + '.recover.lock', 'owner.json'), '{broken');
			assert.equal(recover(c).status, 1); assert.equal(observations(c).length, 0); return;
		}
		assert.equal(recover(c).status, 0);
		if (mode === 'foreign-file') writeFileSync(join(dirname(c.file), 'other-run.jsonl'), 'retain');
		if (mode === 'foreign-marker') writeFileSync(c.file + '.complete', JSON.stringify({ identity: 'foreign', closed: true, transferComplete: true, coverageComplete: true }));
		const result = spawnSync(process.execPath, ['--input-type=module', '-e', `const module=await import('./tests/registro-console-node.mjs'); console.log(module.cleanup ? module.cleanup(${JSON.stringify(c.file)}) : 'unsupported');`], { cwd: c.dir, env: c.env, encoding: 'utf8' });
		assert.equal(result.stdout.trim(), mode === 'clean' ? 'true' : 'false', result.stderr);
		assert.equal(existsSync(c.file), mode !== 'clean');
		if (mode === 'foreign-file') assert.equal(readFileSync(join(dirname(c.file), 'other-run.jsonl'), 'utf8'), 'retain');
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});

for (const material of ['journal', 'sidecar'] as const) test(`swapped ${material} never transfers another run`, () => {
	const a = setup(), b = setup();
	try {
		const originalA = readFileSync(a.file), registryA = JSON.stringify(records(a)), registryB = JSON.stringify(records(b));
		if (material === 'journal') writeFileSync(b.file, originalA);
		else writeFileSync(b.file + '.run.json', readFileSync(a.file + '.run.json'));
		const result = recover(b);
		assert.equal(result.status, 1); assert.ok(result.stderr.trim());
		assert.equal(JSON.stringify(records(a)), registryA); assert.equal(JSON.stringify(records(b)), registryB);
		assert.deepEqual(readFileSync(a.file), originalA); assert.ok(existsSync(b.file));
	} finally { rmSync(a.dir, { recursive: true, force: true }); rmSync(b.dir, { recursive: true, force: true }); }
});

test('a foreign completion marker is retained and never authorizes completeness', () => {
	const c = setup();
	try {
		const marker = JSON.stringify({ identity: 'foreign-run', closed: true, transferComplete: true, coverageComplete: true });
		writeFileSync(c.file + '.complete', marker);
		const result = recover(c);
		assert.equal(result.status, 1, result.stderr);
		assert.equal(JSON.parse(result.stdout).transferComplete, false);
		assert.equal(JSON.parse(result.stdout).incomplete, true);
		assert.equal(readFileSync(c.file + '.complete', 'utf8'), marker);
		assert.equal(observations(c).length, 3);
		assert.ok(records(c).some(entry => entry.kind === 'collection' && entry.incomplete));
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});

for (const mode of ['unknown-run', 'second-journal'] as const) test(`initial binding refuses ${mode} without changing the registry`, () => {
	const c = setup();
	try {
		const destinationBefore = readFileSync(c.info.destination), other = join(dirname(c.file), 'other.jsonl');
		const run = mode === 'unknown-run' ? { run: 'unknown-run', suite: 'node' } : { run: c.info.run, suite: c.info.suite };
		const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; import {transfer} from './tests/registro-console-node.mjs'; assert.throws(()=>transfer(${JSON.stringify(other)},${JSON.stringify(run)}));`], { cwd: c.dir, env: c.env, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(readFileSync(c.info.destination), destinationBefore);
		assert.equal(existsSync(other), false); assert.equal(existsSync(other + '.run.json'), false);
	} finally { rmSync(c.dir, { recursive: true, force: true }); }
});
