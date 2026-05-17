// In-memory graph store + IndexedDB persistence.
// Single source of truth; rendering decides what's visible.

const DB_NAME = 'wiki-mapper';
const STORE_NAME = 'pages';
const DB_VERSION = 1;
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 1 week

export function normalizeTitle(t) {
    return String(t).replace(/_/g, ' ').trim().toLowerCase();
}

let dbPromise = null;
function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function idbGet(key) {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

async function idbPut(value) {
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(value);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // ignore — cache is best-effort
    }
}

export class GraphStore {
    constructor() {
        this.pages = new Map(); // normTitle -> { title, depth, outLinks: Set, inLinks: Set, fetched }
    }

    addPage(title, depth) {
        const key = normalizeTitle(title);
        const existing = this.pages.get(key);
        if (existing) {
            if (depth < existing.depth) existing.depth = depth;
            return existing;
        }
        const entry = { title, depth, outLinks: new Set(), inLinks: new Set(), fetched: false };
        this.pages.set(key, entry);
        return entry;
    }

    has(title) {
        return this.pages.has(normalizeTitle(title));
    }

    get(title) {
        return this.pages.get(normalizeTitle(title));
    }

    markFetched(title) {
        const entry = this.get(title);
        if (entry) entry.fetched = true;
    }

    addLink(fromTitle, toTitle) {
        const fromKey = normalizeTitle(fromTitle);
        const toKey = normalizeTitle(toTitle);
        const from = this.pages.get(fromKey);
        const to = this.pages.get(toKey);
        if (!from || !to) return;
        from.outLinks.add(toKey);
        to.inLinks.add(fromKey);
    }

    titles() {
        return [...this.pages.values()].map(p => p.title);
    }

    size() {
        return this.pages.size;
    }

    snapshot() {
        const out = {};
        for (const [key, entry] of this.pages) {
            out[key] = {
                title: entry.title,
                depth: entry.depth,
                outLinks: [...entry.outLinks],
            };
        }
        return out;
    }

    async loadCachedLinks(lang, title) {
        const key = `${lang}:${normalizeTitle(title)}`;
        const record = await idbGet(key);
        if (!record) return null;
        if (Date.now() - record.timestamp > TTL_MS) return null;
        return record.links;
    }

    async saveCachedLinks(lang, title, links) {
        const key = `${lang}:${normalizeTitle(title)}`;
        await idbPut({ key, title, links, timestamp: Date.now() });
    }
}
