// Path-between two articles. Delegates BFS to a Web Worker (so the UI
// stays responsive) and keeps fetching frontier articles until the
// shortest path is found or the reachable subgraph is exhausted.

import { parseWikiUrl } from './api.js';

export class PathFinder {
    constructor({ store, explorer, getLang, onStatus }) {
        this.store = store;
        this.explorer = explorer;
        this.getLang = getLang;
        this.onStatus = onStatus;
        this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        this.pending = new Map();
        this.nextId = 1;
        this.worker.onmessage = (e) => {
            const { id, result, type } = e.data;
            if (type !== 'path-result') return;
            const cb = this.pending.get(id);
            if (cb) {
                this.pending.delete(id);
                cb(result);
            }
        };
    }

    askWorker(a, b) {
        const id = this.nextId++;
        return new Promise(resolve => {
            this.pending.set(id, resolve);
            this.worker.postMessage({
                type: 'path',
                id,
                a,
                b,
                snapshot: this.store.snapshot(),
            });
        });
    }

    async find(aInput, bInput) {
        const aParsed = parseWikiUrl(aInput);
        const bParsed = parseWikiUrl(bInput);
        const aTitle = aParsed.ok ? aParsed.title : aInput.trim();
        const bTitle = bParsed.ok ? bParsed.title : bInput.trim();
        if (!aTitle || !bTitle) return { ok: false, reason: 'bad-input' };

        if (!this.store.has(aTitle)) {
            this.store.addPage(aTitle, 0);
            await this.explorer.exploreLevel([aTitle], 0);
        }
        if (!this.store.has(bTitle)) {
            this.store.addPage(bTitle, 0);
            await this.explorer.exploreLevel([bTitle], 0);
        }

        let round = 0;
        while (true) {
            round++;
            this.onStatus?.(`Searching for shortest path (round ${round})...`);
            // Yield so the UI can paint between rounds.
            await new Promise(r => setTimeout(r, 0));
            const result = await this.askWorker(aTitle, bTitle);
            if (result.ok) return result;
            if (result.reason !== 'not-found' || !result.need?.length) return result;
            const toFetch = result.need.filter(t => {
                const e = this.store.get(t);
                return e && !e.fetched;
            });
            if (toFetch.length === 0) return { ok: false, reason: 'exhausted' };
            this.onStatus?.(`Expanding ${toFetch.length} frontier articles...`);
            const depth = Math.max(
                ...toFetch.map(t => this.store.get(t)?.depth ?? 0)
            );
            await this.explorer.exploreLevel(toFetch, depth);
        }
    }
}
