// Native test outcomes and incremental Node console persistence. No test API
// or console output is adapted; the spec reporter remains responsible for output.
import { relative } from 'node:path';
import { currentRun, describeError, record as registryRecord, runHasEnded } from './registro.mjs';
import { transfer } from './registro-console-node.mjs';

// Preloaded by the Node runner: transfer and signal observation start before
// test modules, even when the reporter stream has not yielded its first event.
const observation = startObservation();
const record = entry => registryRecord(entry, observation?.reader.info.destination);
function startObservation() {
	if (process.env.IW_SUITE !== 'node' || !process.env.IW_CONSOLE_NODE) return;
	const run = currentRun(), reader = transfer(process.env.IW_CONSOLE_NODE, run);
	const timer = setInterval(() => reader.drain(), 50); timer.unref();
	const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => {
		reader.drain();
		if (process.listenerCount(signal) === 1) {
			process.removeListener(signal, handlers.get(signal));
			process.emit('iw:console-node:close', false);
			try { const consoleNode = reader.finish(); if (!runHasEnded()) record({ kind: 'end', interrupted: signal, consoleNode }); state.terminal = true; } catch { /* raw journal remains recoverable */ }
			process.kill(process.pid, signal);
		}
	}]));
	const state = { reader, terminal: false, stop() { clearInterval(timer); for (const [signal, handler] of handlers) process.removeListener(signal, handler); process.removeListener('exit', onExit); } };
	const onExit = code => {
		process.emit('iw:console-node:close', false);
		if (!state.terminal) { try { const consoleNode = reader.finish(); if (!runHasEnded()) record({ kind: 'end', interrupted: `exit before reporter completion (${code})`, consoleNode }); state.terminal = true; } catch { /* retain raw journal and identity */ } }
	};
	for (const [signal, handler] of handlers) process.prependListener(signal, handler);
	process.on('exit', onExit);
	return state;
}

export default async function* registro(source) {
	currentRun();
	const consoleReader = observation?.reader;
	const totals = { superato: 0, fallito: 0, saltato: 0 };
	const started = Date.now(), stack = [];
	let nextId = 0, terminal = false, nativeCounts, nativeSuccess, interrupted;
	const finish = reason => {
		if (terminal || observation?.terminal) return;
		process.emit('iw:console-node:close', !reason && Boolean(nativeCounts));
		const consoleNode = consoleReader?.finish();
		if (!runHasEnded()) record({ kind: 'end', ...totals, ms: Date.now() - started, ...(nativeCounts ? { nativeCounts, nativeSuccess } : {}), ...(reason ? { interrupted: reason } : {}), ...(consoleNode ? { consoleNode } : {}) });
		terminal = true;
		if (observation) observation.terminal = true;
	};
	try {
		for await (const event of source) {
			consoleReader?.drain();
			const data = event.data;
			if (event.type === 'test:diagnostic') {
				// Preserve the payload and its message; names/locations embedded only
				// in prose stay prose, not a guessed association with the active test.
				record({ kind: 'diagnostic', event: event.type, message: data.message, native: data,
					...(typeof data.name === 'string' ? { test: data.name } : {}),
					...(data.file ? { declaration: { file: data.file, line: data.line, column: data.column } } : {}) });
				continue;
			}
			if (event.type === 'test:summary') { nativeCounts = data.counts; nativeSuccess = data.success; continue; }
			if (event.type === 'test:interrupted') { interrupted = 'native test interruption'; continue; }
			if (event.type === 'test:start') {
				stack.length = data.nesting;
				const parent = stack[data.nesting - 1];
				if (parent) parent.hasChildren = true;
				stack[data.nesting] = { id: ++nextId, name: data.name, path: [...(parent?.path ?? []), data.name], parentId: parent?.id };
				continue;
			}
			if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
			const { name, nesting, details, file, line, column, skip, todo } = data;
			const hierarchyKnown = stack[nesting]?.name === name;
			const node = hierarchyKnown ? stack[nesting] : { id: ++nextId, path: [name] };
			const failureType = details?.error?.failureType;
			const result = skip || todo ? 'saltato' : event.type === 'test:fail' ? 'fallito' : 'superato';
			const container = details?.type === 'suite';
			if (!container) totals[result]++;
			const place = file && !relative(process.cwd(), file).startsWith('..') ? `${relative(process.cwd(), file)}${line ? `:${line}` : ''}` : undefined;
			record({ kind: container ? 'container' : 'result', test: name, result, nativeStatus: event.type === 'test:fail' ? 'failed' : 'passed', nesting,
				testId: node.id, ...(!hierarchyKnown || (nesting > 0 && !node.parentId) ? { hierarchyIncomplete: true } : {}), ...(node.parentId ? { parentId: node.parentId } : {}), path: node.path, fullName: node.path.join(' › '),
				...(node.hasChildren ? { hasChildren: true } : {}), ...(skip ? { skip } : {}), ...(todo ? { todo } : {}),
				...(failureType ? { failureType, ...(failureType === 'subtestsFailed' ? { propagated: true } : {}) } : {}),
				ms: Math.round(details?.duration_ms ?? 0), ...(place ? { file: place } : {}),
				...(file ? { declaration: { file, line, column } } : {}), ...(event.type === 'test:fail' ? describeError(details?.error) : {}) });
		}
		finish(interrupted);
	} finally {
		observation?.stop();
		if (!terminal) finish('reporter stream stopped before completion');
	}
}
