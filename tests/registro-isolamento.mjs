// Assert that a collector's intentional page events stayed out of its run's
// registry. Read-only: historical records are evidence, never cleanup targets.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const known = value => typeof value === 'string' && value.trim() !== '' && value !== 'non disponibile';

export function assertNoRunConsole(entries, identity) {
	assert.ok(known(identity?.run) && known(identity?.suite), 'Identità della run corrente mancante');
	const headers = new Map();
	for (const [index, entry] of entries.entries()) {
		assert.ok(entry && known(entry.run) && known(entry.suite), `Identità del record ${index} mancante`);
		if (entry.kind === 'run') {
			const group = headers.get(entry.run) ?? [];
			group.push(entry);
			headers.set(entry.run, group);
		}
	}
	const own = headers.get(identity.run) ?? [];
	assert.equal(own.length, 1, 'Metadati della run corrente mancanti o ambigui');
	assert.equal(own[0].suite, identity.suite, 'Suite della run corrente contraddittoria');
	const escaped = [];
	for (const entry of entries) {
		if (entry.run === identity.run) assert.equal(entry.suite, identity.suite, 'Suite di un record corrente contraddittoria');
		if (entry.kind !== 'console') continue;
		// Only a uniquely identified foreign run proves that an event is foreign.
		const group = headers.get(entry.run) ?? [];
		assert.equal(group.length, 1, 'Metadati di un evento mancanti o ambigui');
		assert.equal(group[0].suite, entry.suite, 'Suite di un evento contraddittoria');
		if (entry.run === identity.run) escaped.push(entry);
	}
	assert.deepEqual(escaped, [], 'Segnalazioni console sfuggite nella run corrente');
}

export async function assertRunConsoleIsolation(directory, identity) {
	assert.ok(known(identity?.run) && known(identity?.suite), 'Identità della run corrente mancante');
	const day = /^(\d{4}-\d{2}-\d{2})T/.exec(identity.run)?.[1];
	assert.ok(day && Number.isFinite(Date.parse(`${day}T00:00:00.000Z`)), 'Giorno della run corrente non disponibile');
	// The writer names files by UTC day. Like runEntries in the bench, include
	// the run's first day and all later days, never unrelated legacy days.
	const first = `${day}.jsonl`;
	const files = (await readdir(directory)).filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name >= first).sort();
	const entries = [];
	for (const file of files) {
		const lines = (await readFile(join(directory, file), 'utf8')).split('\n');
		for (const [index, line] of lines.entries()) {
			if (!line.trim()) continue;
			try { entries.push(JSON.parse(line)); }
			catch (cause) { throw new Error(`Registro non leggibile: ${file}:${index + 1}`, { cause }); }
		}
	}
	assertNoRunConsole(entries, identity);
}
