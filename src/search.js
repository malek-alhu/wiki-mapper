// Debounced search + filter helpers.

export function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

export function findMatches(store, query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const entry of store.pages.values()) {
        if (entry.title.toLowerCase().includes(q)) out.push(entry.title);
        if (out.length >= 50) break;
    }
    return out;
}
