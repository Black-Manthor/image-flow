// Harmless stand-in for tests/banco-errori.mjs, started by the bench's starter
// in banco-errori.test.ts. It writes what it saw of its environment to
// IW_PROVA_VISTO, then passes, fails, or waits for a signal as the error bench
// does with the app open (end of the run recorded, then exit 130 or 143).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { record } from '../registro.mjs';

const mode = process.env.IW_PROVA_BANCO;
const seen = { pid: process.pid, IW_REGISTRO: process.env.IW_REGISTRO, IW_BANCO: process.env.IW_BANCO, IW_SUITE: process.env.IW_SUITE };

if (mode === 'attende') {
	const interrupted = signal => {
		record({ kind: 'end', interrupted: signal });
		process.exit(signal === 'SIGINT' ? 130 : 143);
	};
	process.once('SIGINT', interrupted);
	process.once('SIGTERM', interrupted);
}

test('prova del banco', async () => {
	writeFileSync(process.env.IW_PROVA_VISTO, JSON.stringify(seen));
	if (mode === 'fallisce') assert.fail('fallimento della prova');
	if (mode === 'attende') await new Promise(() => setInterval(() => {}, 1000));
});
