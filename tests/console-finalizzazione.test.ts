import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { analyze } from './registro-analisi.mjs';

const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['NODE_TEST_CONTEXT', 'IW_CONSOLE_NODE', 'IW_COPERTURA', 'NODE_V8_COVERAGE', 'IW_SUITE'].includes(key)));
const lines = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];

for (const mode of ['hooks', 'hooks-fail', 'late', 'late-rejection', 'replacement', 'replacement-restored', 'marker-blocked', 'inspect']) test(`console finalization: ${mode} in the actual compiled runner matches native behavior`, () => {
	const dir = mkdtempSync(join(tmpdir(), 'iw-console-final-'));
	try {
		cpSync('tests', join(dir, 'tests'), { recursive: true });
		cpSync('src/i18n', join(dir, 'src/i18n'), { recursive: true });
		symlinkSync(join(process.cwd(), 'node_modules'), join(dir, 'node_modules'), 'dir');
		for (const name of readdirSync(join(dir, 'tests'))) if (name.endsWith('.test.ts')) rmSync(join(dir, 'tests', name));
		writeFileSync(join(dir, 'tests/final.test.ts'), "import './fixtures/console-finalizzazione-prova.mjs';\n");
		const env = { ...cleanEnv, IW_FINAL_CASE: mode, IW_REGISTRO: join(dir, 'registry') };
		const native = spawnSync(process.execPath, ['--test-reporter=spec', '--test-reporter-destination=stdout', 'tests/fixtures/console-finalizzazione-prova.mjs'], { cwd: dir, env, encoding: 'utf8', timeout: 10000 });
		const observed = spawnSync(process.execPath, ['tests/run.mjs'], { cwd: dir, env, encoding: 'utf8', timeout: 10000 });
		assert.equal(observed.error, undefined);
		assert.equal(observed.status, native.status);
		assert.equal(observed.signal, native.signal);
		assert.equal(observed.stderr, native.stderr, 'console terminal behavior stays native');
		const records = readdirSync(env.IW_REGISTRO).flatMap(file => lines(join(env.IW_REGISTRO, file)));
		const end = records.find(entry => entry.kind === 'end');
		assert.ok(end);
		if (mode.startsWith('hooks')) {
			for (const text of ['final hook sync', 'final hook async']) assert.equal(records.filter(entry => entry.kind === 'console' && entry.text === text).length, 1);
			assert.equal(end.consoleNode.closed, true);
			assert.equal(end.consoleNode.transferComplete, true);
			assert.equal(end.consoleNode.coverageComplete, true);
			if (mode === 'hooks-fail') assert.ok(records.some(entry => entry.kind === 'result' && entry.error === 'final hook native failure'));
		}
		if (mode.startsWith('late')) {
			assert.equal(observed.status, 1);
			assert.equal(end.nativeSuccess, false);
			const diagnostic = records.find(entry => entry.kind === 'diagnostic' && entry.message.includes('late native reason'));
			assert.ok(diagnostic);
			assert.match(diagnostic.message, /late origin/);
			assert.match(diagnostic.message, /console-finalizzazione-prova.mjs:|final.test.ts:/);
			assert.equal(diagnostic.test, undefined, 'no association inferred from diagnostic prose');
			assert.equal(diagnostic.message, diagnostic.native.message);
			assert.ok(diagnostic.message.includes(mode === 'late' ? 'uncaughtException' : 'unhandledRejection'));
			assert.equal(analyze(records).runs[0].diagnostics.length > 0, true);
			const summary = spawnSync(process.execPath, ['tests/registro-riepilogo.mjs', '--storia'], { cwd: dir, env, encoding: 'utf8' });
			assert.equal(summary.status, 0);
			assert.ok(summary.stdout.includes('late native reason'), 'the registry summary explains the native failure');
		}
		if (mode.startsWith('replacement')) {
			assert.equal(end.consoleNode.closed, true);
			assert.equal(end.consoleNode.transferComplete, true);
			assert.equal(end.consoleNode.coverageComplete, false);
			assert.equal(end.consoleNode.incomplete, true);
			assert.equal(analyze(records).runs[0].scope, 'partial');
			assert.ok(existsSync(end.consoleNode.recovery));
			assert.equal(existsSync(`${end.consoleNode.recovery}.complete`), false);
		}
		if (mode === 'marker-blocked') {
			assert.equal(end.consoleNode.closed, true, 'storage trouble does not erase the observed closure');
			assert.equal(end.consoleNode.coverageComplete, true);
			assert.equal(end.consoleNode.transferComplete, false);
			assert.equal(end.consoleNode.incomplete, true);
			assert.ok(end.consoleNode.transferError);
			assert.ok(existsSync(end.consoleNode.recovery), 'an old/blocked marker must never authorize deleting incomplete input');
			assert.equal(analyze(records).runs[0].scope, 'partial');
		}
		if (mode === 'inspect') {
			assert.ok(observed.stdout.includes('inspections 1'));
			assert.ok(native.stdout.includes('inspections 1'));
			const nativeCoercions = native.stdout.match(/coercions \d+, JSON \d+/)?.[0];
			assert.ok(nativeCoercions);
			assert.ok(observed.stdout.includes(nativeCoercions));
			assert.ok(native.stdout.includes('bigint JSON 1'));
			assert.ok(observed.stdout.includes('bigint JSON 1'));
			assert.ok(observed.stdout.includes('native inspection throws'));
			const entry = records.find(entry => entry.kind === 'console' && entry.text.startsWith('custom value'));
			assert.equal(entry.representation, 'prudent');
			assert.ok(!entry.text.includes('custom rendering'), 'does not execute custom inspection again');
		}
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an incomplete re-finalization revokes an earlier complete marker', () => {
	const dir = mkdtempSync(join(tmpdir(), 'iw-console-marker-'));
	try {
		cpSync('tests', join(dir, 'tests'), { recursive: true });
		// Execute the recovery module as source: its existing CLI guard is not
		// intended for an import bundled into the test entry point.
		const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
			import assert from 'node:assert/strict';
			import {writeFileSync,existsSync} from 'node:fs';
			import {resolve} from 'node:path';
			import {transfer} from './tests/registro-console-node.mjs';
			import {currentRun} from './tests/registro.mjs';
			const file=resolve('console.jsonl');
			const reader=transfer(file,currentRun('node'));
			const identity=(await import('node:fs')).readFileSync(file,'utf8');
			const summary=JSON.stringify({journalId:reader.info.journalId,summary:true,calls:0,lost:0,restored:[],coverageComplete:true});
			writeFileSync(file,identity+summary+'\\n');
			assert.equal(reader.finish().incomplete,undefined);
			assert.ok(existsSync(file+'.complete'));
			writeFileSync(file,identity+summary+'\\n{partial');
			assert.equal(reader.finish().incomplete,true);
			assert.equal(existsSync(file+'.complete'),false);
		`], { cwd: dir, env: { ...cleanEnv, IW_REGISTRO: join(dir, 'isolated-registry') }, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stdout + result.stderr);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
