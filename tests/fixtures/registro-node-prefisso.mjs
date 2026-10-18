// Changed journals and deterministic storage interleavings, in isolated copies.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { currentRun, record } from '../registro.mjs';
import { transfer, cleanup } from '../registro-console-node.mjs';

const file = process.env.IW_CONSOLE_NODE;
const mode = process.env.IW_JOURNAL_CASE;
const change = () => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('original', 'modified'));

if (mode === 'cleanup-during') {
	const identity = fs.statSync(file);
	const read = fs.readFileSync;
	let reads = 0;
	fs.readFileSync = function (target, ...args) {
		const stat = typeof target === 'number' ? fs.fstatSync(target) : undefined;
		const result = read.call(this, target, ...args);
		// The first marker/hash check gets the old bytes. Change them before
		// writer checks and the final decision, without a timing-dependent timer.
		if (stat?.ino === identity.ino && stat.dev === identity.dev && ++reads === 4) change();
		return result;
	};
	syncBuiltinESMExports();
	process.stdout.write(JSON.stringify({ cleaned: cleanup(file), reads }) + '\n');
} else {
	const reader = transfer(file, currentRun('node'));
	const line = entry => JSON.stringify({ journalId: reader.info.journalId, ...entry }) + '\n';
	fs.appendFileSync(file, line({ seq: 1, level: 'warning', text: 'original' }));
	if (mode === 'append') {
		reader.drain();
		fs.appendFileSync(file, line({ seq: 2, level: 'warning', text: 'appended' }));
	}
	fs.appendFileSync(file, line({ summary: true, calls: mode === 'append' ? 2 : 1, lost: 0, restored: [], coverageComplete: true }));
	const first = reader.finish();
	record({ kind: 'end', consoleNode: first }, reader.info.destination);
	if (mode === 'text') change();
	if (mode === 'lost') fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"lost":0', '"lost":1'));
	if (mode === 'finish-during') {
		const remove = fs.rmSync;
		fs.rmSync = function (target, ...args) {
			const result = remove.call(this, target, ...args);
			if (target === `${file}.complete`) change();
			return result;
		};
		syncBuiltinESMExports();
	}
	const second = reader.finish();
	process.stdout.write(JSON.stringify({ first, second }) + '\n');
}
