// Coalesce changes of each note separately. The second check has a bounded
// delay even while typing; an editor in another note cannot postpone it.
type RefreshClock = { setTimeout: (handler: () => void, delay: number) => number; clearTimeout: (id: number) => void };

export class ReadingRefreshQueue {
	private pending = new Map<string, { early?: number; late: number }>();
	private stopped = false;
	constructor(private refresh: (path: string) => void,
		private clock: RefreshClock = {
			setTimeout: (handler, delay) => window.setTimeout(handler, delay),
			clearTimeout: id => window.clearTimeout(id),
		}) {}

	schedule(path: string): void {
		if (this.stopped) return;
		let timers = this.pending.get(path);
		if (!timers) {
			timers = { late: this.clock.setTimeout(() => {
				this.cancel(path);
				this.refresh(path);
			}, 500) };
			this.pending.set(path, timers);
		}
		if (timers.early !== undefined) this.clock.clearTimeout(timers.early);
		timers.early = this.clock.setTimeout(() => {
			timers.early = undefined;
			this.refresh(path);
		}, 50);
	}

	cancel(path: string): void {
		const timers = this.pending.get(path);
		if (!timers) return;
		if (timers.early !== undefined) this.clock.clearTimeout(timers.early);
		this.clock.clearTimeout(timers.late);
		this.pending.delete(path);
	}

	stop(): void {
		this.stopped = true;
		for (const path of this.pending.keys()) this.cancel(path);
	}
}
