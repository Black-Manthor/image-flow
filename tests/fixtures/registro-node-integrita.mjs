// Isolated producer and deterministic crash point, never a normal suite run.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
if (process.env.IW_RECOVERY_PAUSE) {
	const append = fs.appendFileSync;
	fs.appendFileSync = function (file, data, ...args) {
		const result = append.call(this, file, data, ...args);
		if (typeof data === 'string' && data.includes('"channel":"console-node"') && data.includes('"seq":1')) {
			process.stdout.write('RECOVERY LOCKED\n');
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
		}
		return result;
	};
	syncBuiltinESMExports();
} else {
	const { currentRun } = await import('../registro.mjs');
	const { transfer } = await import('../registro-console-node.mjs');
	const file = process.env.IW_CONSOLE_NODE;
	const reader = transfer(file, currentRun('node'));
	for (let seq = 1; seq <= 3; seq++) {
		fs.appendFileSync(file, JSON.stringify({ journalId: reader.info.journalId, seq, level: 'warning', text: `isolated integrity ${seq}` }) + '\n');
		if (seq === 1 && process.env.IW_RECOVERY_PARTIAL) reader.drain();
	}
	fs.appendFileSync(file, JSON.stringify({ journalId: reader.info.journalId, summary: true, calls: 3, lost: 0, restored: [], coverageComplete: true }) + '\n');
}
