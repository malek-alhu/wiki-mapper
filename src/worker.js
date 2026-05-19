// Web Worker: directed bidirectional BFS over a graph snapshot.
// Forward search from A follows out-edges; reverse search from B follows
// in-edges, built on the fly from the same snapshot. Each side expands
// a full BFS level and, when meets are found, picks the one minimizing
// dist_A + dist_B -- which is the true shortest path length.

function normalize(t) {
    return String(t).replace(/_/g, ' ').trim().toLowerCase();
}

function buildReverse(snapshot) {
    const rev = Object.create(null);
    for (const key in snapshot) {
        const entry = snapshot[key];
        if (!entry.fetched) continue;
        for (const out of entry.outLinks) {
            (rev[out] ||= []).push(key);
        }
    }
    return rev;
}

function bfsPath(snapshot, aKey, bKey) {
    if (!snapshot[aKey] || !snapshot[bKey]) {
        return { ok: false, reason: 'missing-endpoint' };
    }
    if (aKey === bKey) return { ok: true, path: [snapshot[aKey].title] };

    const reverse = buildReverse(snapshot);
    const parentA = new Map([[aKey, null]]);
    const parentB = new Map([[bKey, null]]);
    const distA = new Map([[aKey, 0]]);
    const distB = new Map([[bKey, 0]]);
    let frontierA = [aKey];
    let frontierB = [bKey];
    let depthA = 0;
    let depthB = 0;
    const need = new Set();

    const pickBest = (meets, otherDist) => {
        let best = null, bestD = Infinity;
        for (const m of meets) {
            const d = otherDist.get(m);
            if (d < bestD) { bestD = d; best = m; }
        }
        return best;
    };

    const expandForward = () => {
        const next = [];
        const meets = [];
        depthA++;
        for (const key of frontierA) {
            const entry = snapshot[key];
            if (!entry) continue;
            if (!entry.fetched) { need.add(key); continue; }
            for (const out of entry.outLinks) {
                if (parentA.has(out)) continue;
                parentA.set(out, key);
                distA.set(out, depthA);
                if (parentB.has(out)) meets.push(out);
                else next.push(out);
            }
        }
        frontierA = next;
        return pickBest(meets, distB);
    };

    const expandReverse = () => {
        const next = [];
        const meets = [];
        depthB++;
        for (const key of frontierB) {
            const preds = reverse[key];
            if (!preds) continue;
            for (const inKey of preds) {
                if (parentB.has(inKey)) continue;
                parentB.set(inKey, key);
                distB.set(inKey, depthB);
                if (parentA.has(inKey)) meets.push(inKey);
                else next.push(inKey);
            }
        }
        frontierB = next;
        return pickBest(meets, distA);
    };

    while (frontierA.length || frontierB.length) {
        if (frontierA.length) {
            const meet = expandForward();
            if (meet) return reconstruct(meet, parentA, parentB, snapshot);
        }
        if (frontierB.length) {
            const meet = expandReverse();
            if (meet) return reconstruct(meet, parentA, parentB, snapshot);
        }
    }

    const needTitles = [...need]
        .map(k => snapshot[k]?.title)
        .filter(Boolean)
        .slice(0, 30);
    return { ok: false, reason: 'not-found', need: needTitles };
}

function reconstruct(meet, parentA, parentB, snapshot) {
    const left = [];
    let cur = meet;
    while (cur !== null) {
        left.push(snapshot[cur].title);
        cur = parentA.get(cur);
    }
    left.reverse();
    const right = [];
    cur = parentB.get(meet);
    while (cur !== null && cur !== undefined) {
        right.push(snapshot[cur].title);
        cur = parentB.get(cur);
    }
    return { ok: true, path: [...left, ...right] };
}

self.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'path') {
        const aKey = normalize(msg.a);
        const bKey = normalize(msg.b);
        const result = bfsPath(msg.snapshot, aKey, bKey);
        self.postMessage({ type: 'path-result', id: msg.id, result });
    }
};
