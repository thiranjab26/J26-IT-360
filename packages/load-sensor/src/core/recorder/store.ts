import type { RecorderStore, SessionMeta } from './session.js';

type Rows = readonly (readonly number[])[];

/** In-memory store, for tests and for browsers where IndexedDB is unavailable. */
export class MemoryRecorderStore implements RecorderStore {
  readonly #sessions = new Map<string, SessionMeta>();
  readonly #chunks = new Map<string, Map<number, Rows>>();

  putSession(meta: SessionMeta): Promise<void> {
    this.#sessions.set(meta.id, structuredClone(meta));
    return Promise.resolve();
  }

  putChunk(sessionId: string, seq: number, rows: Rows): Promise<void> {
    let chunks = this.#chunks.get(sessionId);
    if (!chunks) {
      chunks = new Map();
      this.#chunks.set(sessionId, chunks);
    }
    chunks.set(seq, rows);
    return Promise.resolve();
  }

  getSession(sessionId: string): Promise<SessionMeta | null> {
    const meta = this.#sessions.get(sessionId);
    return Promise.resolve(meta ? structuredClone(meta) : null);
  }

  getChunks(sessionId: string): Promise<Rows[]> {
    const chunks = this.#chunks.get(sessionId) ?? new Map<number, Rows>();
    return Promise.resolve([...chunks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]));
  }

  listSessions(): Promise<SessionMeta[]> {
    return Promise.resolve([...this.#sessions.values()].map((m) => structuredClone(m)));
  }

  deleteSession(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
    this.#chunks.delete(sessionId);
    return Promise.resolve();
  }
}

const DB_NAME = 'adaptlearn-c02-study';
const DB_VERSION = 1;
const SESSIONS = 'sessions';
const CHUNKS = 'chunks';

interface ChunkRecord {
  readonly sessionId: string;
  readonly seq: number;
  readonly rows: Rows;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    };
  });
}

/**
 * IndexedDB store: on this device only, derived numbers only (never frames,
 * invariant 2). Sessions stay until the experimenter exports and deletes them.
 */
export class IndexedDbRecorderStore implements RecorderStore {
  readonly #db: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = indexedDB) {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(SESSIONS))
        db.createObjectStore(SESSIONS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CHUNKS)) {
        db.createObjectStore(CHUNKS, { keyPath: ['sessionId', 'seq'] });
      }
    };
    this.#db = request(open);
  }

  async putSession(meta: SessionMeta): Promise<void> {
    const tx = (await this.#db).transaction(SESSIONS, 'readwrite');
    tx.objectStore(SESSIONS).put(meta);
    await done(tx);
  }

  async putChunk(sessionId: string, seq: number, rows: Rows): Promise<void> {
    const tx = (await this.#db).transaction(CHUNKS, 'readwrite');
    const record: ChunkRecord = { sessionId, seq, rows };
    tx.objectStore(CHUNKS).put(record);
    await done(tx);
  }

  async getSession(sessionId: string): Promise<SessionMeta | null> {
    const tx = (await this.#db).transaction(SESSIONS, 'readonly');
    const meta = (await request(tx.objectStore(SESSIONS).get(sessionId))) as
      SessionMeta | undefined;
    return meta ?? null;
  }

  async getChunks(sessionId: string): Promise<Rows[]> {
    const tx = (await this.#db).transaction(CHUNKS, 'readonly');
    // Compound keys sort by sessionId, then seq, so this range comes back in order.
    const range = IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);
    const records = (await request(tx.objectStore(CHUNKS).getAll(range))) as ChunkRecord[];
    return records.map((r) => r.rows);
  }

  async listSessions(): Promise<SessionMeta[]> {
    const tx = (await this.#db).transaction(SESSIONS, 'readonly');
    return (await request(tx.objectStore(SESSIONS).getAll())) as SessionMeta[];
  }

  async deleteSession(sessionId: string): Promise<void> {
    const tx = (await this.#db).transaction([SESSIONS, CHUNKS], 'readwrite');
    tx.objectStore(SESSIONS).delete(sessionId);
    tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]));
    await done(tx);
  }
}
