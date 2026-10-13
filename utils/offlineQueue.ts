import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const QUEUE_KEY = 'ct_offline_queue';

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
let flushing = false;
let flushRequested = false;

// Registers how to replay a queued operation once connectivity returns
// (see utils/offlineHandlers.ts). Ops queued before their handler existed are
// replayed as soon as it is registered.
export const registerOfflineHandler = (type: string, handler: Handler) => {
  handlers[type] = handler;
  flushOfflineQueue().catch(() => {});
};

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

export const clearOfflineQueue = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(QUEUE_KEY);
  } catch {}
};

const isOnline = async () => {
  try {
    const state = await NetInfo.fetch();
    return !!state.isConnected && state.isInternetReachable !== false;
  } catch {
    return false;
  }
};

// Replays queued ops in order, stopping at the first failure so later writes don't
// apply ahead of an earlier one that didn't.
export const flushOfflineQueue = async (): Promise<void> => {
  if (flushing) {
    // e.g. a handler was registered mid-flush: run again once this pass finishes
    flushRequested = true;
    return;
  }
  flushing = true;
  flushRequested = false;
  try {
    let queue = await readQueue();
    while (queue.length > 0) {
      const op = queue[0];
      const handler = handlers[op.type];
      if (!handler) {
        // No handler registered yet — leave it queued rather than dropping it.
        break;
      }
      try {
        await handler(op.payload);
      } catch {
        if (!(await isOnline())) break;
        const attempts = (op.attempts ?? 0) + 1;
        queue = attempts >= MAX_ATTEMPTS ? queue.slice(1) : [{ ...op, attempts }, ...queue.slice(1)];
        await writeQueue(queue);
        if (attempts < MAX_ATTEMPTS) break;
        continue;
      }
      queue = queue.slice(1);
      await writeQueue(queue);
    }
  } finally {
    flushing = false;
  }
  if (flushRequested) await flushOfflineQueue();
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
