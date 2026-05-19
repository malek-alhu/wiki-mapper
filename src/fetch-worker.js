// Web Worker: fetches MediaWiki pages and parses links off the main thread.

async function fetchPageLinks({ lang, title, maxLinks }) {
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
        const res = await fetch(url, {
            headers: { 'Api-User-Agent': 'WikiMapper/1.0 (https://wiki-mapper.netlify.app/)' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
}

self.onmessage = async (e) => {
    const { id, lang, title, maxLinks } = e.data;
    try {
        const links = await fetchPageLinks({ lang, title, maxLinks });
        self.postMessage({ id, ok: true, links });
    } catch (err) {
        self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
    }
};
