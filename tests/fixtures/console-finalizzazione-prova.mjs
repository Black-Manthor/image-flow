// Intentional reports: only executed in isolated copies and registries.
import { test, after } from 'node:test';
import { inspect } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
if (process.env.IW_OBSERVED) await import('../console-node.mjs');
const mode = process.env.IW_FINAL_CASE;
if (mode === 'hooks' || mode === 'hooks-fail') {
	test('ordinary test', () => {});
	after(() => console.warn('final hook sync'));
	after(async () => { await new Promise(resolve => setTimeout(resolve, 5)); console.error('final hook async'); });
	if (mode === 'hooks-fail') after(() => { throw new Error('final hook native failure'); });
} else if (mode === 'late' || mode === 'late-rejection') {
	test('late origin', () => { setTimeout(() => {
		if (mode === 'late-rejection') void Promise.reject(new Error('late native reason'));
		else throw new Error('late native reason');
	}, 5); });
	test('hold open', () => new Promise(resolve => setTimeout(resolve, 20)));
} else if (mode === 'replacement' || mode === 'replacement-restored') {
	test('replaced console', async () => {
		const prior = console.warn;
		console.warn = (...args) => process.stderr.write(args.join(' ') + '\n');
		console.warn('replacement gap');
		if (mode === 'replacement-restored') { await new Promise(resolve => setTimeout(resolve, 150)); console.warn = prior; }
	});
} else if (mode === 'marker-blocked') {
	test('blocked marker cleanup', () => {
		if (process.env.IW_CONSOLE_NODE) {
			mkdirSync(`${process.env.IW_CONSOLE_NODE}.complete`);
			writeFileSync(`${process.env.IW_CONSOLE_NODE}.complete/blocked`, 'isolated obstruction');
		}
		console.warn('blocked marker report');
	});
} else if (mode === 'inspect') {
	test('custom formatting', () => {
		let count = 0;
		const value = { [inspect.custom]() { return `custom rendering ${++count}`; } };
		console.warn('custom value', value);
		let conversions = 0, json = 0;
		console.warn('%s %j', { [Symbol.toPrimitive]() { conversions++; return 'native coercion'; } }, { toJSON() { json++; return 'native JSON'; } });
		process.stdout.write(`coercions ${conversions}, JSON ${json}\n`);
		let bigintCalls = 0;
		const previous = Object.getOwnPropertyDescriptor(BigInt.prototype, 'toJSON');
		try {
			Object.defineProperty(BigInt.prototype, 'toJSON', { configurable: true, value() { bigintCalls++; return 'native bigint'; } });
			console.warn('%j', 42n);
		} finally {
			if (previous) Object.defineProperty(BigInt.prototype, 'toJSON', previous);
			else delete BigInt.prototype.toJSON;
		}
		process.stdout.write(`bigint JSON ${bigintCalls}\n`);
		const hostile = { [inspect.custom]() { throw new Error('native inspection throws'); } };
		try { console.error(hostile); } catch (error) { process.stdout.write(`${error.message}\n`); }
		process.stdout.write(`inspections ${count}\n`);
	});
}
