// A test file for tests/console-node.test.ts, run in a child process with its
// own registry: console calls made on purpose, from tests, after a test ended,
// outside any test, with circular and unrepresentable values. Never part of
// the Node suite.
import '../console-node.mjs';
import { test } from '../node-test-contesto.mjs';

// A callback made outside any test: a poller started here, at module level.
let outside;
const poller = setInterval(() => {
	if (!outside) return;
	console.error('prova: fuori dai test');
	outside();
	clearInterval(poller);
}, 5);

let lateDone;
const late = new Promise(resolve => { lateDone = resolve; });

test('prova: avvisi ed errori', () => {
	console.warn('prova: avviso ripetuto');
	console.warn('prova: avviso ripetuto');
	console.error('prova: errore', new Error('prova: oggetto errore'));
});

test('prova: valori difficili', () => {
	const circular = { name: 'circolare' };
	circular.self = circular;
	console.error('prova: circolare', circular);
	const hostile = { [Symbol.for('nodejs.util.inspect.custom')]() { throw new Error('ispezione rifiutata'); } };
	let thrown;
	try { console.warn('prova: ostile %s', hostile); } catch (error) { thrown = error; }
	if (!thrown) console.warn('prova: la console non ha rifiutato il valore');
	console.warn(`prova: lungo ${'x'.repeat(3000)}`);
});

test('prova: asincrono', async () => {
	setTimeout(() => { console.warn('prova: dopo la fine del test'); lateDone(); }, 20);
	await new Promise(resolve => setTimeout(resolve, 1));
	console.warn('prova: dopo un await');
});

test('prova: successivo', async () => {
	await late;
	await new Promise(resolve => { outside = resolve; });
});

test('prova: sostituzione altrui', () => {
	const before = console.warn;
	console.warn = () => {};
	console.warn('prova: non raccolto, console sostituita dal test');
	console.warn = before;
	console.warn('prova: di nuovo raccolto');
});

test('prova: callback', (t, done) => {
	setTimeout(() => { console.warn('prova: prima di done'); done(); }, 1);
});
