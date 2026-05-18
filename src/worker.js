// Web Worker: bidirectional BFS over a graph snapshot.

function normalize(t) {
    return String(t).replace(/_/g, ' ').trim().toLowerCase();
}

function bfsPath(snapshot, aKey, bKey, maxHops = 6) {
    if (!snapshot[aKey] || !snapshot[bKey]) {
        return { ok: false, reason: 'missing-endpoint' };
    }
    if (aKey === bKey) return { ok: true, path: [snapshot[aKey].title] };

    const visitedA = new Map([[aKey, null]]);
    const visitedB = new Map([[bKey, null]]);
    let frontierA = [aKey];
    let frontierB = [bKey];
    let hops = 0;
    const need = new Set();

    const expand = (frontier, visited, other) => {
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

    while (frontierA.length && frontierB.length && hops < maxHops) {
        const a = expand(frontierA, visitedA, visitedB);
        if (a.meet) return reconstruct(a.meet, visitedA, visitedB, snapshot);
        frontierA = a.next;
        hops++;
        if (hops >= maxHops) break;
        const b = expand(frontierB, visitedB, visitedA);
        if (b.meet) return reconstruct(b.meet, visitedA, visitedB, snapshot);
        frontierB = b.next;
        hops++;
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
