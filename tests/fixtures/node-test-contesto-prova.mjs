// Identical test bodies for the native module and the compatibility module.
// Intentional failures and console calls only in the caller's isolated copy.
import nativeDefault, * as native from 'node:test';
import { writeFileSync } from 'node:fs';

const api = process.env.IW_NODE_MODULE === 'native' ? native : await import('../node-test-contesto.mjs');
if (process.env.IW_NODE_MODULE !== 'native') await import('../console-node.mjs');
const { test, it, describe, before, after, beforeEach, afterEach } = api;
const mode = process.env.IW_NODE_CASE;
const log = text => console.warn(`context: ${text}`);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

if (mode === 'exports') {
	writeFileSync(process.env.IW_NODE_EXPORTS, JSON.stringify({
		keys: Object.keys(api), defaultKeys: Reflect.ownKeys(api.default),
		same: Object.keys(native).map(key => [key, api[key] === native[key]]),
		defaultSame: api.default === nativeDefault,
	}));
} else if (mode === 'success') {
	before(() => log('root before'));
	after(() => log('root after'));
	beforeEach(t => log(`beforeEach ${t.name}`));
	afterEach(t => log(`afterEach ${t.name}`));
	test('parent', async function (t) {
		log(`parent this=${this === t}`);
		t.before(() => log('parent before'));
		t.after(() => log('parent after'));
		await t.test('child', async function (child) { await wait(1); log(`child this=${this === child}`); });
		await t.test('callback child', (child, done) => setTimeout(() => { log('callback child'); done(); }, 1));
	});
	it(function inferredName() { log('inferred'); });
	test({ concurrency: false }, function optionsName() { log('options signature'); });
	api.default('default body', () => log('default body'));
	test('<root>', () => log('user root name'));
	test('callback', (t, done) => setTimeout(() => { log('done'); done(); }, 1));
	test('thenable', () => ({ then(resolve) { setTimeout(resolve, 1); } }));
	describe('group', () => {
		before(() => log('group before'));
		after(() => log('group after'));
		test('group child', () => log('group child'));
	});
	test.skip('skip shorthand', () => log('must not run'));
	test('skip option', { skip: 'reason' }, () => log('must not run'));
	test.todo('todo shorthand', () => { throw new Error('intentional todo'); });
	test('todo option', { todo: 'reason' }, () => { throw new Error('intentional todo'); });
	describe.skip('skipped group', () => log('must not run'));
	describe.todo('todo group', () => test('todo group child', () => log('todo group child')));
	api.default.before(() => log('default before'));
	api.default.after(() => log('default after'));
} else if (mode === 'concurrency') {
	test('parallel parent', { concurrency: true }, async t => {
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		await Promise.all([
			t.test('first', async () => { log('first starts'); await gate; log('first ends'); }),
			t.test('second', async () => { log('second starts'); release(); log('second ends'); }),
		]);
	});
} else if (mode === 'selection') {
	test('selected', () => log('selected'));
	test('excluded', () => log('excluded'));
	test.only('only parent', async t => {
		t.runOnly(true);
		await t.test('ordinary child', () => log('ordinary child'));
		await t.test('only child', { only: true }, () => log('only child'));
	});
	describe.only('only group', () => it.only('only grouped child', () => log('only grouped child')));
} else if (mode === 'failures') {
	test('sync failure', () => { throw new Error('intentional sync'); });
	test('async failure', async () => { throw new Error('intentional async'); });
	test('done failure', (t, done) => done(new Error('intentional done')));
	test('promise and done', async (t, done) => { done(); });
	test('duplicate done', (t, done) => { done(); done(); });
} else if (mode === 'hook failures') {
	describe('before fails', () => { before(() => { throw new Error('intentional before'); }); test('blocked child', () => log('must not run')); });
	describe('after fails', () => { after(() => { throw new Error('intentional after'); }); test('completed child', () => log('completed child')); });
} else if (mode === 'late') {
	test('timed out', { timeout: 10 }, async () => { await wait(40); log('late timeout'); });
	test('callback timeout', { timeout: 10 }, (t, done) => { setTimeout(() => log('late callback timeout'), 40); });
	const controller = new AbortController();
	test('cancelled', { signal: controller.signal }, async () => { setTimeout(() => controller.abort(), 10); await wait(40); log('late cancellation'); });
	test('timed out parent', { timeout: 10 }, t => { t.test('cancelled child', async () => { await wait(40); log('late child'); }); });
	test('hold open', () => wait(90));
}
