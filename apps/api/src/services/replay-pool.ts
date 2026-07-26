import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';
import { runReplay, type ReplayRequest, type ReplayResult } from '@candle-rush/engine';
import { env } from '../env.js';

/**
 * A pool of replay workers with a hard wall-clock timeout.
 *
 * A full 90-second session replays in single-digit milliseconds, so this is not about
 * throughput. It is about blast radius: a malformed or adversarial tape must never be
 * able to hang the API, and a worker that overruns gets terminated and replaced rather
 * than waited on.
 */

interface Job {
  resolve: (r: ReplayResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  worker: Slot;
}

interface Slot {
  worker: Worker;
  busy: boolean;
}

export class ReplayTimeoutError extends Error {
  constructor(ms: number) {
    super(`replay exceeded ${ms}ms`);
    this.name = 'ReplayTimeoutError';
  }
}

// Same directory as this module, matching extension: .ts under tsx, .js under node dist.
const workerUrl = new URL(`./replay.worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);

export class ReplayPool {
  private slots: Slot[] = [];
  private jobs = new Map<number, Job>();
  private queue: Array<() => void> = [];
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly size = env().REPLAY_WORKERS,
    private readonly timeoutMs = env().REPLAY_TIMEOUT_MS,
  ) {}

  private spawn(): Slot {
    const worker = new Worker(workerUrl, { execArgv: process.execArgv });
    const slot: Slot = { worker, busy: false };
    worker.on('message', (msg: { id: number; result?: ReplayResult; threw?: string }) => {
      const job = this.jobs.get(msg.id);
      if (!job) return;
      this.jobs.delete(msg.id);
      clearTimeout(job.timer);
      job.worker.busy = false;
      if (msg.threw) job.reject(new Error(msg.threw));
      else job.resolve(msg.result!);
      this.pump();
    });
    worker.on('error', (err) => this.failSlot(slot, err));
    worker.on('exit', (code) => {
      if (!this.closed && code !== 0) this.failSlot(slot, new Error(`replay worker exited ${code}`));
    });
    worker.unref();
    return slot;
  }

  private failSlot(slot: Slot, err: Error): void {
    for (const [id, job] of this.jobs) {
      if (job.worker !== slot) continue;
      this.jobs.delete(id);
      clearTimeout(job.timer);
      job.reject(err);
    }
    this.slots = this.slots.filter((s) => s !== slot);
    void slot.worker.terminate();
    if (!this.closed) this.slots.push(this.spawn());
    this.pump();
  }

  private free(): Slot | undefined {
    const idle = this.slots.find((s) => !s.busy);
    if (idle) return idle;
    if (this.slots.length < this.size) {
      const slot = this.spawn();
      this.slots.push(slot);
      return slot;
    }
    return undefined;
  }

  private pump(): void {
    while (this.queue.length && this.slots.some((s) => !s.busy)) this.queue.shift()!();
  }

  run(req: ReplayRequest): Promise<ReplayResult> {
    if (this.closed) return Promise.reject(new Error('replay pool is closed'));
    return new Promise<ReplayResult>((resolve, reject) => {
      const dispatch = () => {
        const slot = this.free();
        if (!slot) {
          this.queue.push(dispatch);
          return;
        }
        slot.busy = true;
        const id = this.nextId++;
        const timer = setTimeout(() => {
          this.jobs.delete(id);
          reject(new ReplayTimeoutError(this.timeoutMs));
          this.failSlot(slot, new ReplayTimeoutError(this.timeoutMs));
        }, this.timeoutMs);
        this.jobs.set(id, { resolve, reject, timer, worker: slot });
        slot.worker.postMessage({ id, req });
      };
      dispatch();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.jobs.values()) clearTimeout(job.timer);
    this.jobs.clear();
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
    this.slots = [];
  }
}

/**
 * Escape hatch for tests and single-process dev: run the replay inline. Same function,
 * same result — it just gives up the timeout isolation.
 */
export class InlineReplayPool {
  run(req: ReplayRequest): Promise<ReplayResult> {
    return Promise.resolve(runReplay(req));
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

export type AnyReplayPool = Pick<ReplayPool, 'run' | 'close'>;

export function createReplayPool(): AnyReplayPool {
  return process.env.REPLAY_INLINE === '1' ? new InlineReplayPool() : new ReplayPool();
}
