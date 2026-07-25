/**
 * The offline sale queue (browser-only).
 *
 * A thrift shop's internet goes down. The register must not. Sales are written
 * to IndexedDB the instant they're rung up, and flushed to the server when the
 * connection returns. Every sale carries a client-generated `offlineId` and the
 * server has a unique index on it — so replaying the queue, which will happen,
 * cannot double-charge or double-count anything.
 */

export interface QueuedLine {
  itemId?: string;
  title: string;
  priceCents: number;
  retailEstimateCents?: number;
}

export interface QueuedSale {
  offlineId: string;
  lines: QueuedLine[];
  subtotalCents: number;
  taxCents: number;
  roundupCents: number;
  totalCents: number;
  tender: string;
  taxExempt: boolean;
  createdAt: string;
}

const DB_NAME = "thriftos-pos";
const STORE = "queued-sales";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "offlineId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = fn(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      })
  );
}

export function newOfflineId(): string {
  return `off_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueue(sale: QueuedSale): Promise<void> {
  await tx("readwrite", (store) => store.put(sale));
}

export async function queued(): Promise<QueuedSale[]> {
  try {
    return (await tx<QueuedSale[]>("readonly", (store) => store.getAll())) ?? [];
  } catch {
    return [];
  }
}

export async function remove(offlineId: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(offlineId));
}

export interface FlushResult {
  synced: number;
  duplicates: number;
  remaining: number;
  error?: string;
}

/**
 * Push everything queued. Only clears local rows the server confirms it took —
 * a half-failed flush leaves the rest safely on the device.
 */
export async function flush(): Promise<FlushResult> {
  const sales = await queued();
  if (sales.length === 0) return { synced: 0, duplicates: 0, remaining: 0 };

  try {
    const res = await fetch("/api/pos/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sales }),
    });

    if (!res.ok) {
      return { synced: 0, duplicates: 0, remaining: sales.length, error: `Server said ${res.status}` };
    }

    const data = (await res.json()) as { synced: number; duplicates: number };
    // Both "accepted" and "already had it" mean the device can let go.
    for (const sale of sales) await remove(sale.offlineId);

    return {
      synced: data.synced ?? 0,
      duplicates: data.duplicates ?? 0,
      remaining: (await queued()).length,
    };
  } catch (err) {
    return {
      synced: 0,
      duplicates: 0,
      remaining: sales.length,
      error: err instanceof Error ? err.message : "Couldn't reach the server",
    };
  }
}
