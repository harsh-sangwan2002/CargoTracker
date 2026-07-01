import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const QUEUE_KEY = 'ct_offline_queue';

interface QueuedOp {
  id: string;
  type: string;
  payload: any;
  createdAt: number;
}

type Handler = (payload: any) => Promise<void>;

const handlers: Record<string, Handler> = {};
let flushing = false;

// Screens register how to replay a queued operation once connectivity returns
// (e.g. handlers.startTrip = (payload) => tripService.startTrip(payload.tripId)).
export const registerOfflineHandler = (type: string, handler: Handler) => {
  handlers[type] = handler;
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

// Replays queued ops in order, stopping at the first failure (assumed still offline)
// so later writes don't apply out of order ahead of an earlier one that didn't.
export const flushOfflineQueue = async (): Promise<void> => {
  if (flushing) return;
  flushing = true;
  try {
    let queue = await readQueue();
    while (queue.length > 0) {
      const op = queue[0];
      const handler = handlers[op.type];
      if (!handler) {
        // No handler registered (e.g. app just launched, screen not mounted yet) —
        // leave it queued rather than dropping it.
        break;
      }
      try {
        await handler(op.payload);
      } catch {
        break;
      }
      queue = queue.slice(1);
      await writeQueue(queue);
    }
  } finally {
    flushing = false;
  }
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
