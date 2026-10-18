import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmdirSync } from 'node:fs';
import { currentRun, registryFile } from '../registro.mjs';
import { transfer, recover } from '../registro-console-node.mjs';
const file = process.env.IW_CONSOLE_NODE;
const call = seq => ({ journalId: reader.info.journalId, seq, level: 'warning', text: `recover ${seq}`, source: 'uncertain' });
const line = value => JSON.stringify(value) + '\n';
const run = currentRun('node');
const reader = transfer(file, run);
const identity = readFileSync(file, 'utf8');
if (process.env.IW_REPORT_CASE === 'counts') {
	writeFileSync(file, identity + line(call(1)) + line({ journalId: reader.info.journalId, summary: true, calls: 2, lost: 0, restored: [] }));
	const result = reader.finish();
	assert.equal(result.countsMismatch, true); assert.equal(result.collected, 1);
	assert.equal(result.incomplete, true); assert.equal(existsSync(`${file}.complete`), false);
	process.stdout.write('COUNTS OK\n'); process.exit(0);
}
const second = line(call(2));
writeFileSync(file, identity + line(call(1)) + second.slice(0, 15));
reader.drain();
assert.equal(reader.finish().pendingBytes, 15);
assert.equal(existsSync(`${file}.complete`), false);
// A blocked destination leaves the durable raw input and identity available.
renameSync(registryFile(), `${registryFile()}.saved`); mkdirSync(registryFile());
appendFileSync(file, second.slice(15));
assert.equal(reader.finish().incomplete, true);
rmdirSync(registryFile()); renameSync(`${registryFile()}.saved`, registryFile());
reader.drain();
appendFileSync(file, line(call(1)) + line({ ...call(1), text: 'conflicting duplicate' }) + '{broken}\n' + line(call(3)));
const summary = reader.finish();
assert.equal(summary.collected, 3); assert.equal(summary.unreadable, 2);
assert.equal(summary.incomplete, true);
// Model the owner having stopped; never recover while its real PID exists.
assert.throws(() => recover(file), /owner still exists/);
process.stdout.write('RECOVERY OK\n');
