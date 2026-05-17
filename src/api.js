// MediaWiki API client + Wikipedia URL parsing.

const inflight = new Map();

export function parseWikiUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { ok: false, reason: 'empty' };
    }
    let url;
    try {
        url = new URL(rawUrl.trim());
    } catch {
        return { ok: false, reason: 'malformed' };
    }
    const host = url.hostname.toLowerCase();
    const match = host.match(/^([a-z-]+)\.(m\.)?wikipedia\.org$/);
    if (!match) return { ok: false, reason: 'not-wikipedia' };
    const lang = match[1];

    let title = null;
    const pathMatch = url.pathname.match(/\/wiki\/(.+)$/);
    if (pathMatch) {
        title = decodeURIComponent(pathMatch[1]);
    } else if (url.searchParams.has('title')) {
        title = url.searchParams.get('title');
    }
    if (!title) return { ok: false, reason: 'no-title' };

    title = title.replace(/_/g, ' ').trim();
    if (!title) return { ok: false, reason: 'no-title' };
    return { ok: true, lang, title };
}

export function articleUrl(lang, title) {
    return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export async function fetchLinks({ lang, title, signal, maxLinks = 500 }) {
    const cacheKey = `${lang}:${title}`;
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);

    const promise = (async () => {
        const collected = [];
        let plcontinue = null;
        while (collected.length < maxLinks) {
            const params = new URLSearchParams({
                action: 'query',
                titles: title,
                prop: 'links',
                pllimit: 'max',
                plnamespace: '0',
                format: 'json',
                origin: '*',
            });
            if (plcontinue) params.set('plcontinue', plcontinue);
            const url = `https://${lang}.wikipedia.org/w/api.php?${params}`;
            const res = await fetch(url, { signal });
            if (!res.ok) throw new Error(`HTTP ${res.status} for "${title}"`);
            const data = await res.json();
            const pages = data?.query?.pages;
            if (!pages) break;
            const page = Object.values(pages)[0];
            if (page?.missing !== undefined) break;
            const links = page?.links ?? [];
            for (const l of links) {
                if (!l.title.includes(':')) collected.push(l.title);
                if (collected.length >= maxLinks) break;
            }
            if (data.continue?.plcontinue && collected.length < maxLinks) {
                plcontinue = data.continue.plcontinue;
            } else {
                break;
            }
        }
        return collected;
    })();

    inflight.set(cacheKey, promise);
    try {
        return await promise;
    } finally {
        inflight.delete(cacheKey);
    }
}
