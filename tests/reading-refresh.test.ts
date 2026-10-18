import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReadingRefreshQueue } from '../src/rendering/reading-refresh';

function setup() {
	let now = 0, next = 0;
	const tasks = new Map<number, { at: number; run: () => void }>();
	const clock = {
		setTimeout(run: () => void, delay: number) { const id = ++next; tasks.set(id, { at: now + delay, run }); return id; },
		clearTimeout(id: number) { tasks.delete(id); },
	} as unknown as Pick<Window, 'setTimeout' | 'clearTimeout'>;
	const calls: Array<[string, number]> = [];
	const queue = new ReadingRefreshQueue(path => calls.push([path, now]), clock);
	const advance = (to: number) => {
		for (;;) {
			const due = [...tasks].filter(([, task]) => task.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
			if (!due) break;
			now = due[1].at;
			tasks.delete(due[0]);
			due[1].run();
		}
		now = to;
	};
	return { queue, calls, advance, tasks };
}

test('Reading refresh: typing in another note cannot defer either check of the changed note', () => {
	const { queue, calls, advance } = setup();
	queue.schedule('a.md');
	for (let t = 20; t <= 480; t += 20) { advance(t); queue.schedule('b.md'); }
	advance(500);
	assert.deepEqual(calls, [['a.md', 50], ['a.md', 500]]);
	advance(520);
	assert.deepEqual(calls.at(-1), ['b.md', 520]);
});

test('Reading refresh: a burst is coalesced, continuous typing still gets a check at 500 ms', () => {
	const { queue, calls, advance, tasks } = setup();
	queue.schedule('a.md');
	for (let t = 20; t <= 480; t += 20) { advance(t); queue.schedule('a.md'); }
	advance(500);
	assert.deepEqual(calls, [['a.md', 500]]);
	assert.equal(tasks.size, 0, 'the early check is not left behind the bounded check');
	queue.schedule('a.md');
	advance(550);
	advance(1000);
	assert.deepEqual(calls, [['a.md', 500], ['a.md', 550], ['a.md', 1000]]);
});

test('Reading refresh: the fallback can read a renderer that was not ready at the first check', () => {
	const { queue, calls, advance } = setup();
	queue.schedule('a.md');
	advance(50);
	advance(500);
	advance(1500);
	assert.deepEqual(calls, [['a.md', 50], ['a.md', 500]]);
});

test('Reading refresh: closing one note cancels its retries; unloading cancels all and rejects new work', () => {
	const { queue, calls, advance, tasks } = setup();
	queue.schedule('a.md'); queue.schedule('b.md');
	queue.cancel('a.md');
	advance(50);
	assert.deepEqual(calls, [['b.md', 50]]);
	queue.stop(); queue.schedule('c.md');
	advance(1000);
	assert.deepEqual(calls, [['b.md', 50]]);
	assert.equal(tasks.size, 0);
});
