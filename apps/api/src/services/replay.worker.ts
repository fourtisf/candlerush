import { parentPort } from 'node:worker_threads';
import { runReplay, type ReplayRequest } from '@candle-rush/engine';

/**
 * One replay per message. Lives in a worker thread so a pathological tape can be killed
 * with a hard timeout instead of taking the event loop down with it.
 */
if (!parentPort) throw new Error('replay.worker must be started as a worker thread');

parentPort.on('message', (msg: { id: number; req: ReplayRequest }) => {
  try {
    parentPort!.postMessage({ id: msg.id, result: runReplay(msg.req) });
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, threw: err instanceof Error ? err.message : String(err) });
  }
});
