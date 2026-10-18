// Incremental console transfer and explicit recovery of an interrupted journal.
// The raw JSONL and its run identity stay recoverable until transfer is complete.
import { appendFileSync as appendUnchecked, existsSync, readFileSync as readUnchecked, writeFileSync as writeUnchecked, openSync, readSync, closeSync, statSync, rmSync, lstatSync, mkdirSync, renameSync, readdirSync, rmdirSync, constants, fstatSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, resolve, parse, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registry, registryFile } from './registro.mjs';

// Validate every component, including ancestors. Recovery never follows links.
function checked(file, optional = false) {
	const absolute = resolve(file);
	if (absolute !== file) throw new Error('non-canonical journal path');
	let path = parse(absolute).root;
	for (const part of absolute.slice(path.length).split('/').filter(Boolean)) {
		path = join(path, part);
		let stat;
		try { stat = lstatSync(path); } catch (error) { if (optional && path === absolute && error.code === 'ENOENT') return; throw error; }
		if (stat.isSymbolicLink()) throw new Error(`symbolic link refused: ${path}`);
		if (path !== absolute && !stat.isDirectory()) throw new Error(`invalid ancestor: ${path}`);
		if (path === absolute && (!stat.isFile() || stat.nlink !== 1)) throw new Error(`regular unshared file required: ${path}`);
		if (path === absolute) return stat;
	}
}
function withFile(file, flags, operation) {
	const before = checked(file, Boolean(flags & constants.O_CREAT));
	const fd = openSync(file, flags | constants.O_NOFOLLOW, 0o600);
	try {
		const opened = fstatSync(fd), after = checked(file);
		if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== after.dev || opened.ino !== after.ino
			|| (before && (opened.dev !== before.dev || opened.ino !== before.ino))) throw new Error('journal path changed; retained');
		return operation(fd);
	} finally { closeSync(fd); }
}
const readFileSync = (file, ...args) => withFile(file, constants.O_RDONLY, fd => readUnchecked(fd, ...args));
const appendFileSync = (file, data) => withFile(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, fd => appendUnchecked(fd, data));
const writeFileSync = (file, data, options) => {
	if (options?.flag !== 'wx') throw new Error('exclusive journal creation required');
	return withFile(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, fd => writeUnchecked(fd, data));
};
const digest = value => createHash('sha256').update(value).digest('hex');
const metadataDigest = info => digest(JSON.stringify(info));
function alive(pid) {
	if (!Number.isInteger(pid) || pid < 1) throw new Error('invalid process identity');
	try { process.kill(pid, 0); return true; }
	catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
}
function lock(file) {
	checked(file);
	const path = `${file}.recover.lock`;
	const owner = { pid: process.pid, host: hostname(), token: randomUUID(), journal: file, identity: metadataDigest(validate(file)) };
	const staging = `${path}-${owner.token}`;
	mkdirSync(staging);
	writeFileSync(join(staging, 'owner.json'), JSON.stringify(owner), { flag: 'wx' });
	try {
		for (;;) {
			if (!existsSync(path)) {
				try { renameSync(staging, path); break; }
				catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
			}
			if (readdirSync(path).length !== 1) throw new Error('uncertain recovery lock contents; retained');
			checked(join(path, 'owner.json'));
			const old = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8'));
			if (old.journal !== file || old.identity !== owner.identity || old.host !== hostname() || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(old.token)) throw new Error('uncertain recovery lock; retained');
			if (alive(old.pid)) throw new Error('recovery lock active; recovery refused');
			// A nonempty deterministic tombstone prevents delayed reclaimers from
			// moving a new owner's lock after the first stale-owner replacement.
			try { renameSync(path, `${path}-${old.token}`); }
			catch (error) { if (!['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
		}
	} catch (error) {
		rmSync(join(staging, 'owner.json')); rmdirSync(staging); throw error;
	}
	return () => {
		checked(join(path, 'owner.json'));
		const actual = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8'));
		if (actual.token !== owner.token || actual.pid !== owner.pid) throw new Error('recovery lock ownership changed');
		renameSync(path, staging);
		return staging;
	};
}
function validate(file) {
	checked(file); checked(`${file}.run.json`);
	const info = JSON.parse(readFileSync(`${file}.run.json`, 'utf8'));
	const run = info.runRecord;
	if (info.version !== 2 || info.host !== hostname() || info.journal !== file || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(info.journalId)
		|| !Number.isInteger(info.pid) || info.pid < 1 || info.suite !== 'node' || typeof info.run !== 'string' || !info.run
		|| run?.kind !== 'run' || run.run !== info.run || run.suite !== info.suite || typeof run.time !== 'string' || !Number.isFinite(Date.parse(run.time))
		|| info.destination !== registryFile(new Date(run.time)) || dirname(info.destination) !== registry)
		throw new Error('incoherent or missing console journal metadata; retained');
	checked(info.destination, true);
	const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
	if (rows.filter(entry => entry?.summary === true).length > 1 || rows.some(entry => entry?.summary === true && (!Number.isInteger(entry.calls) || entry.calls < 0 || !Number.isInteger(entry.lost) || entry.lost < 0 || !Array.isArray(entry.restored) || entry.restored.some(value => typeof value !== 'string') || (entry.gaps !== undefined && (!Array.isArray(entry.gaps) || entry.gaps.some(value => typeof value !== 'string'))) || (entry.coverageComplete !== undefined && typeof entry.coverageComplete !== 'boolean')))) throw new Error('corrupt console closure; retained');
	if (rows.some(entry => entry?.journal !== true && entry?.writer !== true && entry?.journalId !== info.journalId)) throw new Error('unbound console observation; retained');
	if (rows.some(entry => entry?.summary !== undefined && entry.summary !== true)) throw new Error('invalid console closure marker; retained');
	const identities = rows.filter(entry => entry?.journal === true);
	if (identities.length !== 1 || identities[0].identity !== metadataDigest(info)) throw new Error('journal identity contradicts metadata; retained');
	if (rows.some(entry => !entry || typeof entry !== 'object' || (entry.run !== undefined && entry.run !== info.run)
		|| (entry.suite !== undefined && entry.suite !== info.suite) || (entry.journalId !== undefined && entry.journalId !== info.journalId)))
		throw new Error('foreign or invalid journal record; retained');
	const records = readRecords(info.destination);
	const own = records.filter(entry => entry.run === info.run);
	const transferred = own.filter(entry => entry.channel === 'console-node' && Number.isInteger(entry.seq));
	if (transferred.some(entry => entry.journalId !== info.journalId) || new Set(transferred.map(entry => entry.seq)).size !== transferred.length || own.filter(entry => entry.kind === 'end').length > 1) throw new Error('duplicate registry records; retained');
	if (!records.some(entry => entry.kind === 'run' && entry.run === info.run) || !records.some(entry => entry.run === info.run && entry.journalIdentity === metadataDigest(info))) throw new Error('registry binding missing; retained');
	if (records.some(entry => entry.run === info.run && ((entry.kind === 'run' && JSON.stringify(entry) !== JSON.stringify(run))
		|| (entry.journalIdentity !== undefined && entry.journalIdentity !== metadataDigest(info)))))
		throw new Error('registry identity contradicts journal; retained');
	return info;
}
function revokeMarker(file, info) {
	const marker = `${file}.complete`;
	checked(marker, true);
	if (!existsSync(marker)) return;
	const value = JSON.parse(readFileSync(marker, 'utf8'));
	if (value?.identity !== metadataDigest(info)) throw new Error('foreign or uncertain completion marker; retained');
	rmSync(marker);
}
function readRecords(file, damaged = false) {
	checked(file, true);
	if (!existsSync(file)) return [];
	return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => {
		try {
			const entry = JSON.parse(line);
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid record');
			return [entry];
		} catch {
			if (!damaged) throw new Error('unreadable registry data; retained');
			return [];
		}
	});
}
function append(file, entry) {
	checked(file, true);
	let prefix = '';
	if (existsSync(file) && statSync(file).size) {
		withFile(file, constants.O_RDONLY, fd => {
			const byte = Buffer.alloc(1); readSync(fd, byte, 0, 1, fstatSync(fd).size - 1);
			if (byte[0] !== 10) prefix = '\n';
		});
	}
	// Keep a damaged tail as its own unreadable line, never concatenate a new record.
	appendFileSync(file, `${prefix}${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
}
function incompleteNotice(info, details, problems) {
	const notice = JSON.stringify(problems);
	if (readRecords(info.destination).some(entry => entry.run === info.run && entry.transferNotice === notice)) return;
	const write = entry => append(info.destination, { ...entry, run: info.run, suite: info.suite });
	write({ kind: 'collection', channel: 'console-node', ...details, problems });
	write({ kind: 'console', level: 'warning', source: 'banco', test: '', text: `console dei test Node: ${problems.join('; ')}`, transferNotice: notice });
}
export function transfer(file, run) {
	file = resolve(file);
	const metadata = `${file}.run.json`;
	let info;
	if (run) {
		checked(file, true); checked(metadata, true);
		const records = readRecords(registryFile());
		const runRecord = records.find(entry => entry.kind === 'run' && entry.run === run.run);
		if (!runRecord || run.suite !== 'node' || runRecord.suite !== run.suite || records.some(entry => entry.run === run.run && entry.journalIdentity !== undefined))
			throw new Error('missing run identity or run already bound to another journal; retained');
		info = { ...run, version: 2, journalId: randomUUID(), journal: file, host: hostname(), destination: registryFile(), pid: process.pid, runRecord };
		if (!existsSync(file)) writeFileSync(file, '', { flag: 'wx' });
		writeFileSync(metadata, JSON.stringify(info) + '\n', { flag: 'wx' });
		append(file, { journal: true, identity: metadataDigest(info) });
		append(info.destination, { ...run, kind: 'collection', channel: 'console-node', phase: 'identity', journalIdentity: metadataDigest(info) });
	}
	info = validate(file);
	const prior = readRecords(info.destination);
	const fingerprint = entry => JSON.stringify([entry.level, entry.text, entry.test ?? '', entry.source, entry.observedAt, entry.frames, entry.stack, entry.truncated, Boolean(entry.afterEnd), Boolean(entry.outsideTest), Boolean(entry.contextUnavailable), entry.representation]);
	const payloads = new Map(prior.filter(entry => entry.run === info.run && entry.channel === 'console-node' && Number.isInteger(entry.seq)).map(entry => [entry.seq, fingerprint(entry)]));
	const seen = new Set(prior.filter(entry => entry.run === info.run && entry.channel === 'console-node' && Number.isInteger(entry.seq)).map(entry => entry.seq));
	let offset = 0, summary, unreadable = 0, pendingBytes = 0, error;
	let prefixHash = digest(''), snapshotHash, integrityError;
	const write = entry => append(info.destination, { ...entry, run: info.run, suite: info.suite });
	const verifySnapshot = () => {
		if (digest(readFileSync(file)) !== snapshotHash) {
			integrityError = 'console journal changed after transfer verification; retained';
			throw new Error(integrityError);
		}
	};
	return {
		drain() {
			try {
				if (integrityError) throw new Error(integrityError);
				if (!existsSync(file)) {
					if (offset || summary) throw new Error('console journal disappeared');
					return;
				}
				validate(file);
				const bytes = readFileSync(file);
				if (bytes.length < offset) throw new Error('console journal was truncated');
				if (digest(bytes.subarray(0, offset)) !== prefixHash) {
					integrityError = 'console journal consumed bytes changed; retained';
					throw new Error(integrityError);
				}
				// Bind the final marker to this read, not to a later unchecked read.
				snapshotHash = digest(bytes);
				try {
					let end;
					while ((end = bytes.indexOf(10, offset)) !== -1) {
						const line = bytes.subarray(offset, end).toString('utf8');
						let entry;
						if (!line) { offset = end + 1; continue; }
						try { entry = JSON.parse(line); } catch { unreadable++; offset = end + 1; continue; }
						if (entry.journal === true || entry.writer === true) { offset = end + 1; continue; }
						if (entry.summary) summary = entry;
						else if (!Number.isInteger(entry.seq) || entry.seq < 1 || !['warning', 'error'].includes(entry.level) || typeof entry.text !== 'string') unreadable++;
						else if (!seen.has(entry.seq)) {
							const { text, summary: ignored, ...fields } = entry;
							write({ ...fields, kind: 'console', test: entry.test ?? '', text, channel: 'console-node' });
							seen.add(entry.seq); payloads.set(entry.seq, fingerprint(entry));
						}
						else if (payloads.get(entry.seq) !== fingerprint(entry)) unreadable++;
						offset = end + 1;
					}
					pendingBytes = bytes.length - offset;
					error = undefined;
				} finally {
					// A failed append may follow successfully consumed lines. Keep
					// their identity too, so retry checks them before continuing.
					prefixHash = digest(bytes.subarray(0, offset));
				}
			} catch (failure) { error = String(failure.message ?? failure); }
		},
		finish() {
			this.drain();
			// A previous finalization is not proof about bytes observed now.
			let markerError;
			try { revokeMarker(file, info); }
			catch (failure) { markerError = String(failure.message ?? failure); }
			if (!error) {
				try { verifySnapshot(); }
				catch (failure) { error = String(failure.message ?? failure); }
			}
			const countsMismatch = Boolean(summary) && (!Number.isInteger(summary.calls) || summary.calls !== seen.size);
			const gaps = [...(summary?.restored ?? []).filter(line => !line.endsWith('ripristinato')), ...(summary?.gaps ?? []).map(method => `${method}: intercettazione persa durante la raccolta`)];
			const transferComplete = Boolean(summary) && !countsMismatch && pendingBytes === 0 && unreadable === 0 && !error && !markerError;
			const coverageComplete = !integrityError && summary?.coverageComplete === true && !summary.lost && gaps.length === 0;
			const incomplete = !transferComplete || !coverageComplete;
			const result = { collected: seen.size, closed: Boolean(summary), transferComplete, coverageComplete, ...(incomplete ? { incomplete: true, recovery: file } : {}), ...(countsMismatch ? { countsMismatch: true, reportedCalls: summary.calls } : {}), ...(pendingBytes ? { pendingBytes } : {}), ...(unreadable ? { unreadable } : {}), ...(error || markerError ? { transferError: [error, markerError].filter(Boolean).join('; ') } : {}), ...(summary?.lost ? { lost: summary.lost } : {}) };
			const problems = [...(countsMismatch ? ['conteggio della raccolta discordante'] : []), ...(unreadable ? [`${unreadable} righe illeggibili`] : []), ...(pendingBytes ? ['riga finale incompleta'] : []), ...(error ? [`trasferimento incompleto: ${error}`] : []), ...(markerError ? [`marcatore di cleanup non revocabile: ${markerError}`] : []), ...(!summary ? ['raccolta senza chiusura'] : []), ...(summary && !coverageComplete ? ['copertura della raccolta incompleta o non attestata'] : []), ...(summary?.lost ? [`${summary.lost} chiamate non scritte`] : []), ...gaps];
			try {
				if (problems.length) incompleteNotice(info, { closed: Boolean(summary), transferComplete, coverageComplete, incomplete, recovery: file }, problems);
				if (!incomplete) {
					verifySnapshot();
					writeFileSync(`${file}.complete`, JSON.stringify({ identity: metadataDigest(info), journalHash: snapshotHash, closed: true, transferComplete: true, coverageComplete: true }) + '\n', { flag: 'wx' });
				}
			} catch (failure) {
				Object.assign(result, { transferComplete: false, ...(integrityError ? { coverageComplete: false } : {}), incomplete: true, recovery: file, transferError: String(failure.message ?? failure) });
				try { revokeMarker(file, info); } catch { /* Retain the reported storage failure. */ }
				if (integrityError) {
					try { incompleteNotice(info, result, [integrityError]); } catch { /* The result retains the failure even if notice storage fails. */ }
				}
			}
			return result;
		},
		write,
		info,
	};
}
export function recover(file) {
	file = resolve(file);
	validate(file); // Refuse uncertain paths before creating any lock.
	const release = lock(file);
	try {
		const info = validate(file);
		const writers = readRecords(file, true).filter(entry => entry.writer === true);
		if (writers.some(entry => entry.host !== hostname() || alive(entry.pid))) throw new Error('journal writer still exists or is uncertain; recovery refused');
		if (alive(info.pid)) throw new Error('journal owner still exists; recovery refused');
				const reader = transfer(file);
		const result = reader.finish();
		const records = readRecords(info.destination).filter(entry => entry.run === info.run);
		if (!records.some(entry => entry.kind === 'end')) reader.write({ kind: 'end', interrupted: 'recovery after stopped process', consoleNode: result });
		return result;
	} finally { const retired = release(); rmSync(join(retired, 'owner.json')); rmdirSync(retired); }
}
// Only the launcher owns cleanup. Unknown files and lock material are retained;
// no recursive deletion can reach another run's files.
export function cleanup(file) {
	file = resolve(file);
	let release;
	try {
		validate(file);
		release = lock(file);
		const info = validate(file);
		checked(`${file}.complete`);
		const markerBytes = readFileSync(`${file}.complete`, 'utf8');
		const marker = JSON.parse(markerBytes);
		if (marker.identity !== metadataDigest(info) || marker.closed !== true || marker.transferComplete !== true || marker.coverageComplete !== true) return false;
		const journalUnchanged = () => {
			if (marker.journalHash === digest(readFileSync(file))) return true;
			incompleteNotice(info, { incomplete: true, recovery: file }, ['console journal changed before cleanup; retained']);
			revokeMarker(file, info);
			return false;
		};
		if (!journalUnchanged()) return false;
		const records = readRecords(info.destination).filter(entry => entry.run === info.run);
		const end = records.filter(entry => entry.kind === 'end').at(-1);
		if (!end?.consoleNode?.closed || !end.consoleNode.transferComplete || !end.consoleNode.coverageComplete || end.consoleNode.incomplete
			|| records.some(entry => entry.kind === 'collection' && entry.incomplete)) return false;
		const expected = [file, `${file}.run.json`, `${file}.complete`];
		if (readdirSync(dirname(file)).some(name => !expected.includes(join(dirname(file), name)) && join(dirname(file), name) !== `${file}.recover.lock`)) return false;
		for (const path of expected) checked(path);
		// The journal owner has stopped; any recovery lock causes retention above.
		if (alive(info.pid) || readRecords(file, true).some(entry => entry.writer === true && (entry.host !== hostname() || alive(entry.pid)))) return false;
		// Recheck after the intervening registry, directory and writer checks.
		// Cooperating writers have stopped and recovery holds this lock. This
		// is not an atomic check-and-unlink against noncooperating mutation.
		if (metadataDigest(validate(file)) !== metadataDigest(info)
			|| readFileSync(`${file}.complete`, 'utf8') !== markerBytes
			|| !journalUnchanged()) return false;
		for (const path of expected) rmSync(path);
		const retired = release(); release = undefined;
		// This owner is still alive, so no stale reclaimer can hold this token.
		rmSync(join(retired, 'owner.json')); rmdirSync(retired);
		rmdirSync(dirname(file)); return true;
	} catch { return false; }
	finally { if (release) { try { const retired = release(); rmSync(join(retired, 'owner.json')); rmdirSync(retired); } catch { /* Keep uncertain lock material. */ } } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try { const result = recover(process.argv[2]); process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = result.incomplete ? 1 : 0; }
	catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
