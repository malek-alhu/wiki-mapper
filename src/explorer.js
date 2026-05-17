// BFS driver with concurrency pool. Cancellable via AbortController.

import { fetchLinks } from './api.js';

async function runPool(items, limit, worker, signal) {
    const queue = items.slice();
    let active = 0;
    let done = 0;
    return new Promise((resolve, reject) => {
        const next = () => {
            if (signal?.aborted) {
                if (active === 0) resolve();
                return;
            }
            while (active < limit && queue.length > 0) {
                const item = queue.shift();
                active++;
                worker(item).then(() => {
                    active--;
                    done++;
                    if (queue.length === 0 && active === 0) resolve();
                    else next();
                }, err => {
                    active--;
                    if (err?.name === 'AbortError') {
                        if (active === 0) resolve();
                    } else {
                        reject(err);
                    }
                });
            }
            if (queue.length === 0 && active === 0) resolve();
        };
        next();
    });
}

export class Explorer {
    constructor({ store, lang, onPageDone, onLinkAdded, onProgress, maxLinksPerPage = 200, concurrency = 5 }) {
        this.store = store;
        this.lang = lang;
        this.onPageDone = onPageDone;
        this.onLinkAdded = onLinkAdded;
        this.onProgress = onProgress;
        this.maxLinksPerPage = maxLinksPerPage;
        this.concurrency = concurrency;
        this.abortController = null;
    }

    cancel() {
        this.abortController?.abort();
    }

    async fetchOne(title, currentDepth) {
        let links = await this.store.loadCachedLinks(this.lang, title);
        let fromCache = true;
        if (!links) {
            fromCache = false;
            try {
                links = await fetchLinks({
                    lang: this.lang,
                    title,
                    signal: this.abortController.signal,
                    maxLinks: this.maxLinksPerPage,
                });
                await this.store.saveCachedLinks(this.lang, title, links);
            } catch (err) {
                if (err?.name === 'AbortError') throw err;
                console.warn(`Fetch failed for "${title}":`, err);
                links = [];
            }
        }
        this.store.markFetched(title);
        for (const target of links) {
            const isNew = !this.store.has(target);
            if (isNew) this.store.addPage(target, currentDepth + 1);
            this.store.addLink(title, target);
            this.onLinkAdded?.(title, target, isNew, currentDepth + 1);
        }
        this.onPageDone?.(title, links.length, fromCache);
        return links.length;
    }

    async exploreLevel(titles, currentDepth) {
        this.abortController = new AbortController();
        let completed = 0;
        const total = titles.length;
        this.onProgress?.({ done: 0, total, currentTitle: null });
        await runPool(titles, this.concurrency, async (title) => {
            await this.fetchOne(title, currentDepth);
            completed++;
            this.onProgress?.({ done: completed, total, currentTitle: title });
        }, this.abortController.signal);
        return !this.abortController.signal.aborted;
    }
}
