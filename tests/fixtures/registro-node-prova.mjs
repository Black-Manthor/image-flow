import '../console-node.mjs';
import { test, describe, before } from 'node:test';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
if (process.env.IW_REPORT_CASE === 'exit') {
	console.warn('warning before explicit exit'); process.exit(23);
} else if (['interrupt', 'handled-signal'].includes(process.env.IW_REPORT_CASE)) {
	if (process.env.IW_REPORT_CASE === 'handled-signal') process.once('SIGTERM', () => { console.warn('warning after handled signal'); console.log('HANDLED'); });
	test('waiting', async () => { console.warn('warning before interruption'); console.log('READY'); await wait(60000); });
} else {
	describe('group', () => {
		test('broken child', () => { throw new Error('nested reason'); });
		test('skipped child', { skip: 'skip reason' }, () => {});
		test('todo child', { todo: 'todo reason' }, () => { throw new Error('todo reason error'); });
		describe('inner', () => test('same name', () => {}));
	});
	describe.skip('skipped suite', () => test('hidden child', () => {}));
	describe.todo('todo suite', () => test('todo nested child', () => { throw new Error('nested todo reason'); }));
	test('cancelled explicitly', { signal: AbortSignal.abort() }, () => {});
	test('parent', async t => { await t.test('same name', () => {}); await t.test('deep parent', async child => { await child.test('deep failure', () => { throw new Error('deep reason'); }); }); });
	describe('hook group', () => { before(() => { throw new Error('hook reason'); }); test('cancelled by hook', () => {}); });
	test('timeout parent', { timeout: 10 }, t => { t.test('cancelled by parent', () => new Promise(() => {})); });
	test('hold open', () => wait(70));
}
