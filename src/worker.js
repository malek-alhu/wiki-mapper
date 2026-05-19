// Web Worker: directed bidirectional BFS over a graph snapshot.
// Forward search from A follows out-edges; reverse search from B follows
// in-edges, built on the fly from the same snapshot. Paths are valid in
// the original directed sense: each consecutive pair (u, v) has u -> v.

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

function bfsPath(snapshot, aKey, bKey, maxHops = 6) {
    if (!snapshot[aKey] || !snapshot[bKey]) {
        return { ok: false, reason: 'missing-endpoint' };
    }
    if (aKey === bKey) return { ok: true, path: [snapshot[aKey].title] };

    const reverse = buildReverse(snapshot);
    const visitedA = new Map([[aKey, null]]);
    const visitedB = new Map([[bKey, null]]);
    let frontierA = [aKey];
    let frontierB = [bKey];
    let hops = 0;
    const need = new Set();

    const expandForward = (frontier, visited, other) => {
        const next = [];
        for (const key of frontier) {
            const entry = snapshot[key];
            if (!entry) continue;
            if (!entry.fetched) { need.add(key); continue; }
            for (const out of entry.outLinks) {
                if (visited.has(out)) continue;
                visited.set(out, key);
                if (other.has(out)) return { meet: out, next };
                next.push(out);
            }
        }
        return { meet: null, next };
    };

    const expandReverse = (frontier, visited, other) => {
        const next = [];
        for (const key of frontier) {
            const preds = reverse[key];
            if (!preds) continue;
            for (const inKey of preds) {
                if (visited.has(inKey)) continue;
                visited.set(inKey, key);
                if (other.has(inKey)) return { meet: inKey, next };
                next.push(inKey);
            }
        }
        return { meet: null, next };
    };

    while (hops < maxHops && (frontierA.length || frontierB.length)) {
        if (frontierA.length) {
            const a = expandForward(frontierA, visitedA, visitedB);
            if (a.meet) return reconstruct(a.meet, visitedA, visitedB, snapshot);
            frontierA = a.next;
            hops++;
            if (hops >= maxHops) break;
        }
        if (frontierB.length) {
            const b = expandReverse(frontierB, visitedB, visitedA);
            if (b.meet) return reconstruct(b.meet, visitedA, visitedB, snapshot);
            frontierB = b.next;
            hops++;
        }
    }

    const needTitles = [...need]
        .map(k => snapshot[k]?.title)
        .filter(Boolean)
        .slice(0, 30);
    return { ok: false, reason: 'not-found', need: needTitles };
}

function reconstruct(meet, visitedA, visitedB, snapshot) {
    const left = [];
    let cur = meet;
    while (cur !== null) {
        left.push(snapshot[cur].title);
        cur = visitedA.get(cur);
    }
    left.reverse();
    const right = [];
    cur = visitedB.get(meet);
    while (cur !== null && cur !== undefined) {
        right.push(snapshot[cur].title);
        cur = visitedB.get(cur);
    }
    return { ok: true, path: [...left, ...right] };
}

self.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'path') {
        const aKey = normalize(msg.a);
        const bKey = normalize(msg.b);
        const result = bfsPath(msg.snapshot, aKey, bKey, msg.maxHops ?? 6);
        self.postMessage({ type: 'path-result', id: msg.id, result });
    }
};
