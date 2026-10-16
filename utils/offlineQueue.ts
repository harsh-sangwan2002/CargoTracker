import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

export const QUEUE_KEY = 'ct_offline_queue';

// An op that keeps failing while the device is online (e.g. the trip was deleted)
// is dropped after this many attempts so it can't block everything queued after it.
const MAX_ATTEMPTS = 5;

interface QueuedOp {
  id: string;
  type: string;
  payload: any;
  createdAt: number;
  attempts?: number;
}

type Handler = (payload: any) => Promise<void>;

const handlers: Record<string, Handler> = {};
let currentFlush: Promise<void> | null = null;
let flushRequested = false;
let replayingOpCreatedAt: number | null = null;

// The time a write should be attributed to: while a queued op is being replayed
// this is when the driver actually tapped (e.g. "Start trip" hours earlier while
// offline), otherwise it's now.
export const effectiveNow = (): Date => new Date(replayingOpCreatedAt ?? Date.now());

// Registers how to replay a queued operation once connectivity returns
// (see utils/offlineHandlers.ts). Ops queued before their handler existed (e.g.
// from a previous app session) are replayed as soon as it is registered.
export const registerOfflineHandler = (type: string, handler: Handler) => {
  handlers[type] = handler;
  flushOfflineQueue().catch(() => {});
};

// PostgREST/Postgres errors carry a code (e.g. 42501 for an RLS/trigger refusal);
// those will fail identically on every retry, unlike a dropped connection.
const isPermanentFailure = (error: any) => typeof error?.code === 'string' && error.code.length > 0;

const readQueue = async (): Promise<QueuedOp[]> => {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const writeQueue = async (queue: QueuedOp[]) => {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
};

export const enqueueOfflineOp = async (type: string, payload: any): Promise<void> => {
  const queue = await readQueue();
  queue.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, type, payload, createdAt: Date.now() });
  await writeQueue(queue);
};

export const getPendingOfflineCount = async (): Promise<number> => (await readQueue()).length;

const isOnline = async () => {
  try {
    const state = await NetInfo.fetch();
    return !!state.isConnected && state.isInternetReachable !== false;
  } catch {
    return false;
  }
};

// Replays queued ops in order, stopping at the first failure while offline so
// later writes don't apply ahead of an earlier one that didn't.
export const flushOfflineQueue = (): Promise<void> => {
  if (currentFlush) {
    // e.g. a handler registered mid-flush: run again once this pass finishes,
    // and let this caller await that same flush.
    flushRequested = true;
    return currentFlush;
  }
  currentFlush = runFlush().finally(() => { currentFlush = null; });
  return currentFlush;
};

const runFlush = async (): Promise<void> => {
  try {
    do {
      flushRequested = false;
      let queue = await readQueue();
      while (queue.length > 0) {
        const op = queue[0];
        const handler = handlers[op.type];
        if (!handler) {
          // No handler registered yet — leave it queued rather than dropping it.
          break;
        }
        try {
          replayingOpCreatedAt = op.createdAt;
          await handler(op.payload);
        } catch (error) {
          if (isPermanentFailure(error)) {
            // The server rejected it (e.g. trip already closed by a manager); a
            // permanently failing op would otherwise block every op behind it.
            console.warn(`Dropping offline ${op.type} op rejected by the server`, error);
          } else {
            if (!(await isOnline())) break;
            // Failing while online without a server error code: retry a few times,
            // then drop it so it can't block everything queued after it.
            const attempts = (op.attempts ?? 0) + 1;
            if (attempts < MAX_ATTEMPTS) {
              await writeQueue([{ ...op, attempts }, ...queue.slice(1)]);
              break;
            }
          }
        } finally {
          replayingOpCreatedAt = null;
        }
        queue = queue.slice(1);
        await writeQueue(queue);
      }
    } while (flushRequested);
  } finally {
    flushRequested = false;
  }
};

// Called on sign-out so one user's unsynced writes are never replayed under the
// next user's session on a shared device.
export const clearOfflineQueue = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(QUEUE_KEY);
  } catch {}
};

let unsubscribeNetInfo: (() => void) | null = null;

// Call once at app startup: flushes on launch and whenever connectivity is restored.
export const initOfflineQueueSync = () => {
  if (unsubscribeNetInfo) return;
  flushOfflineQueue().catch(() => {});
  unsubscribeNetInfo = NetInfo.addEventListener(state => {
    if (state.isConnected && state.isInternetReachable !== false) {
      flushOfflineQueue().catch(() => {});
    }
  });
};
