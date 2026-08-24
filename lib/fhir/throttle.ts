/**
 * A sliding-window rate limiter and concurrency cap.
 *
 * The server allows 120 requests/minute and the brief makes handling `429`
 * part of the exercise. Reacting to a 429 is necessary but not sufficient: a
 * seed import is ~15 requests per patient, so an unthrottled client would earn
 * the limit rather than avoid it, and every retry lands the run further behind.
 *
 * So this throttles *proactively* to a deliberately lower ceiling, leaving
 * headroom for retries and for the fact that we cannot see other tabs of the
 * same deployment consuming the same budget. Reactive backoff (errors.ts) then
 * handles whatever still gets through.
 *
 * Pure timing logic, no network — `acquire` is the only thing the client calls.
 */

export class Throttle {
  private readonly windowMs: number;
  private readonly maxInWindow: number;
  private readonly maxConcurrent: number;

  /** Completion timestamps inside the current window. */
  private recent: number[] = [];
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(options?: {
    windowMs?: number;
    maxInWindow?: number;
    maxConcurrent?: number;
  }) {
    // 100/min against a documented 120/min: the margin is what absorbs a burst
    // of retries without turning them into more 429s.
    this.windowMs = options?.windowMs ?? 60_000;
    this.maxInWindow = options?.maxInWindow ?? 100;
    this.maxConcurrent = options?.maxConcurrent ?? 4;
  }

  /** Resolves when it is this caller's turn. Always pair with `release()`. */
  async acquire(): Promise<void> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.active += 1;

    for (;;) {
      const now = Date.now();
      this.recent = this.recent.filter((t) => now - t < this.windowMs);

      if (this.recent.length < this.maxInWindow) {
        this.recent.push(now);
        return;
      }

      // Wait exactly until the oldest request leaves the window, plus a small
      // margin so we do not immediately re-test the same boundary.
      const wait = this.windowMs - (now - this.recent[0]) + 25;
      await sleep(wait);
    }
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
