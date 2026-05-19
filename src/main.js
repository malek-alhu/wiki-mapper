// Entry point: wires DOM to modules.

import { parseWikiUrl } from './api.js';
import { GraphStore, normalizeTitle } from './store.js';
import { Explorer } from './explorer.js';
import { GraphView } from './graph-view.js';
import { PathFinder } from './path.js';
import { debounce, findMatches } from './search.js';

const $ = id => document.getElementById(id);

const els = {
    modeExplore: $('modeExplore'),
    modePath: $('modePath'),
    exploreForm: $('exploreForm'),
    pathForm: $('pathForm'),
    wikiLink: $('wikiLink'),
    depth: $('depth'),
    concurrency: $('concurrency'),
    linksPerPage: $('linksPerPage'),
    renderBudget: $('renderBudget'),
    startBtn: $('startBtn'),
    proceedBtn: $('proceedBtn'),
    cancelBtn: $('cancelBtn'),
    resetBtn: $('resetBtn'),
    pathA: $('pathA'),
    pathB: $('pathB'),
    pathBtn: $('pathBtn'),
    clearPathBtn: $('clearPathBtn'),
    searchInput: $('searchInput'),
    minDepth: $('minDepth'),
    maxDepth: $('maxDepth'),
    minDegree: $('minDegree'),
    applyFiltersBtn: $('applyFiltersBtn'),
    status: $('status'),
    progressBar: $('progressBar'),
    progressFill: $('progressFill'),
    statNodes: $('statNodes'),
    statEdges: $('statEdges'),
    statHives: $('statHives'),
    statCache: $('statCache'),
    container: $('graph-container'),
    fabBtn: $('fabBtn'),
    sheetOverlay: $('sheetOverlay'),
    drawerControls: $('drawerControls'),
};

const state = {
    store: new GraphStore(),
    view: null,
    explorer: null,
    pathFinder: null,
    lang: 'en',
    mode: 'explore', // 'explore' | 'path'
    maxDepth: 2,
    currentDepth: 0,
    pendingNext: [],
    appState: 'idle', // 'idle' | 'processing' | 'finished'
    cacheHits: 0,
    cacheMisses: 0,
    pathSearchActive: false,
    fetchFailures: 0,
};

function setStatus(msg, isError = false) {
    els.status.textContent = msg;
    els.status.className = isError ? 'status-error' : '';
}

function setProgress(done, total) {
    if (!total) {
        els.progressBar.style.display = 'none';
        return;
    }
    els.progressBar.style.display = 'block';
    els.progressFill.style.width = `${Math.round((done / total) * 100)}%`;
}

function refreshStats() {
    els.statNodes.textContent = state.store.size();
    els.statEdges.textContent = state.view ? state.view.edges.length : 0;
    els.statHives.textContent = state.view ? state.view.clusteredDepths.size : 0;
    els.statCache.textContent = `${state.cacheHits}/${state.cacheHits + state.cacheMisses}`;
}

function setAppState(next) {
    state.appState = next;
    const busy = next === 'processing';
    els.startBtn.disabled = busy;
    els.pathBtn.disabled = busy;
    els.cancelBtn.disabled = !busy;
    els.resetBtn.disabled = busy;
    const canProceed = next === 'idle'
        && state.mode === 'explore'
        && state.currentDepth > 0
        && state.currentDepth < state.maxDepth
        && state.pendingNext.length > 0;
    els.proceedBtn.style.display = canProceed ? 'inline-block' : 'none';
}

function setMode(mode) {
    state.mode = mode;
    els.modeExplore.classList.toggle('active', mode === 'explore');
    els.modePath.classList.toggle('active', mode === 'path');
    els.exploreForm.style.display = mode === 'explore' ? '' : 'none';
    els.pathForm.style.display = mode === 'path' ? '' : 'none';
    if (mode === 'explore') state.view?.clearPathHighlight();
}

function openSheet() {
    els.drawerControls?.classList.add('open');
    els.sheetOverlay?.classList.add('open');
    document.body.classList.add('sheet-open');
}

function closeSheet() {
    els.drawerControls?.classList.remove('open');
    els.sheetOverlay?.classList.remove('open');
    document.body.classList.remove('sheet-open');
}

function fitGraph() {
    if (!state.view?.network) return;
    try {
        state.view.network.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
    } catch {}
}

function initView() {
    state.view = new GraphView({
        container: els.container,
        lang: state.lang,
        renderBudget: parseInt(els.renderBudget.value, 10) || 200,
        onRecenter: (title) => recenterFrom(title),
    });
}

let nodeBuffer = [];
let edgeBuffer = [];
let flushScheduled = false;
function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    requestAnimationFrame(() => {
        flushScheduled = false;
        if (nodeBuffer.length) {
            state.view.batchAddNodes(nodeBuffer);
            nodeBuffer = [];
        }
        if (edgeBuffer.length) {
            state.view.batchAddEdges(edgeBuffer);
            edgeBuffer = [];
        }
    });
}

function initExplorer() {
    state.explorer = new Explorer({
        store: state.store,
        lang: state.lang,
        maxLinksPerPage: parseInt(els.linksPerPage.value, 10) || 40,
        concurrency: parseInt(els.concurrency.value, 10) || 5,
        onPageDone: (title, count, fromCache, failed) => {
            if (failed) state.fetchFailures++;
            if (fromCache) state.cacheHits++;
            else state.cacheMisses++;
            refreshStats();
        },
        onLinkAdded: (from, to, isNew, childDepth) => {
            // While a Find Path search is in flight, frontier articles
            // are an internal detail of BFS -- skipping the render keeps
            // the canvas (and physics solver) idle so the UI stays
            // responsive. The store is still updated upstream.
            if (state.pathSearchActive) return;
            if (isNew) nodeBuffer.push({ title: to, depth: childDepth });
            edgeBuffer.push({ from, to });
            scheduleFlush();
        },
        onProgress: ({ done, total, currentTitle }) => {
            setProgress(done, total);
            if (currentTitle) setStatus(`Fetched ${done}/${total} (last: "${currentTitle}")`);
        },
    });
}

function initPathFinder() {
    state.pathFinder = new PathFinder({
        store: state.store,
        explorer: state.explorer,
        getLang: () => state.lang,
        onStatus: (msg) => setStatus(msg),
    });
}

async function runExploration(initialTitle) {
    state.currentDepth = 0;
    state.pendingNext = [initialTitle];
    state.store.addPage(initialTitle, 0);
    state.view.addNode(initialTitle, 0);
    await processNextLevel();
}

async function processNextLevel() {
    if (state.appState === 'processing') return;
    if (state.pendingNext.length === 0) return;
    setAppState('processing');
    state.currentDepth++;
    const toProcess = state.pendingNext;
    state.pendingNext = [];
    setStatus(`Starting depth ${state.currentDepth}/${state.maxDepth}, ${toProcess.length} articles...`);
    state.view.kickPhysics();
    const before = new Set(state.store.pages.keys());

    let completed = false;
    try {
        completed = await state.explorer.exploreLevel(toProcess, state.currentDepth - 1);
    } catch (err) {
        console.error(err);
        setStatus(`Error: ${err.message}`, true);
    }

    for (const [key, entry] of state.store.pages) {
        if (!before.has(key) && entry.depth === state.currentDepth) {
            state.pendingNext.push(entry.title);
        }
    }

    if (nodeBuffer.length || edgeBuffer.length) {
        if (nodeBuffer.length) state.view.batchAddNodes(nodeBuffer);
        if (edgeBuffer.length) state.view.batchAddEdges(edgeBuffer);
        nodeBuffer = [];
        edgeBuffer = [];
    }
    state.view.enforceBudget(state.currentDepth);
    state.view.settleLayout();
    refreshStats();
    setProgress(0, 0);

    if (!completed) {
        setStatus('Cancelled.');
        setAppState('idle');
    } else if (state.currentDepth >= state.maxDepth) {
        setStatus(`Done. Reached max depth ${state.maxDepth}. Store: ${state.store.size()} pages.`);
        setAppState('finished');
    } else if (state.pendingNext.length === 0) {
        setStatus(`Done. No more new articles at depth ${state.currentDepth}.`);
        setAppState('finished');
    } else {
        setStatus(`Depth ${state.currentDepth} done. ${state.pendingNext.length} new articles ready for next level.`);
        setAppState('idle');
    }
}

async function recenterFrom(title) {
    if (state.appState === 'processing') return;
    setStatus(`Recentering on "${title}"...`);
    state.view.reset();
    state.currentDepth = 0;
    state.pendingNext = [title];
    state.store.addPage(title, 0);
    state.view.addNode(title, 0);
    await processNextLevel();
}

function resetAll() {
    state.store = new GraphStore();
    state.view.reset();
    state.currentDepth = 0;
    state.pendingNext = [];
    state.cacheHits = 0;
    state.cacheMisses = 0;
    setProgress(0, 0);
    setStatus('Reset.');
    refreshStats();
    initExplorer();
    initPathFinder();
    setAppState('idle');
}

function wire() {
    els.modeExplore.addEventListener('click', () => setMode('explore'));
    els.modePath.addEventListener('click', () => setMode('path'));

    els.exploreForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (state.appState === 'processing') return;
        closeSheet();
        const parsed = parseWikiUrl(els.wikiLink.value);
        if (!parsed.ok) {
            setStatus(`Invalid Wikipedia URL (${parsed.reason}).`, true);
            return;
        }
        state.lang = parsed.lang;
        state.view.setLang(parsed.lang);
        state.maxDepth = Math.max(1, Math.min(5, parseInt(els.depth.value, 10) || 2));
        state.view.reset();
        state.store = new GraphStore();
        initExplorer();
        initPathFinder();
        await runExploration(parsed.title);
    });

    els.proceedBtn.addEventListener('click', () => {
        if (state.currentDepth < state.maxDepth) processNextLevel();
    });

    els.cancelBtn.addEventListener('click', () => {
        state.explorer?.cancel();
    });

    els.resetBtn.addEventListener('click', resetAll);

    els.pathForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (state.appState === 'processing') return;
        closeSheet();
        const a = els.pathA.value;
        const b = els.pathB.value;
        const aParsed = parseWikiUrl(a);
        const bParsed = parseWikiUrl(b);
        const newLang = (aParsed.ok && aParsed.lang)
            || (bParsed.ok && bParsed.lang)
            || state.lang;
        if (newLang !== state.lang) {
            state.lang = newLang;
            state.view.setLang(newLang);
            initExplorer();
            initPathFinder();
        }
        setAppState('processing');
        setStatus('Looking for path...');

        // Collapse the current graph into hives and freeze physics so
        // the canvas stays still while BFS + fetch rounds run.
        const failuresBefore = state.fetchFailures;
        state.view.enforceBudget(Math.max(state.currentDepth, 5));
        state.view.network.setOptions({ physics: { enabled: false } });
        state.pathSearchActive = true;

        let result;
        try {
            result = await state.pathFinder.find(a, b);
        } finally {
            state.pathSearchActive = false;
        }

        if (result.ok) {
            setStatus(`Path found: ${result.path.length - 1} hops.`);
            for (const t of result.path) {
                if (!state.view.nodes.get(normalizeTitle(t))) {
                    state.view.addNode(t, state.store.get(t)?.depth ?? 1);
                }
            }
            const path = result.path;
            for (let i = 0; i < path.length - 1; i++) {
                state.view.addEdge(path[i], path[i + 1]);
            }
            state.view.kickPhysics();
            setTimeout(() => state.view.highlightPath(path), 400);
        } else {
            const newFailures = state.fetchFailures - failuresBefore;
            let msg;
            if (result.reason === 'fetch-blocked' || (newFailures > 0 && result.reason === 'not-found')) {
                msg = `Wikipedia API blocked (${newFailures} failed fetches). Check network / CORS.`;
            } else if (result.reason === 'exhausted') {
                msg = 'No path found (graph exhausted).';
            } else if (result.reason === 'bad-input') {
                msg = 'No path found (bad input).';
            } else {
                msg = `No path found (${result.reason}).`;
            }
            setStatus(msg, true);
        }
        refreshStats();
        setAppState('idle');
    });

    els.clearPathBtn.addEventListener('click', () => state.view.clearPathHighlight());

    const onSearch = debounce(() => {
        const q = els.searchInput.value;
        state.view.highlightSearch(q);
        if (q.trim()) {
            const hits = findMatches(state.store, q);
            setStatus(`Search "${q}": ${hits.length} match${hits.length === 1 ? '' : 'es'} in store.`);
        }
    }, 120);
    els.searchInput.addEventListener('input', onSearch);

    els.applyFiltersBtn.addEventListener('click', () => {
        state.view.applyFilters({
            minDepth: parseInt(els.minDepth.value, 10) || 0,
            maxDepth: parseInt(els.maxDepth.value, 10) || 99,
            minDegree: parseInt(els.minDegree.value, 10) || 0,
        }, state.store);
    });

    els.concurrency.addEventListener('change', () => {
        if (state.explorer) state.explorer.concurrency = parseInt(els.concurrency.value, 10) || 5;
    });
    els.linksPerPage.addEventListener('change', () => {
        if (state.explorer) state.explorer.maxLinksPerPage = parseInt(els.linksPerPage.value, 10) || 200;
    });
    els.renderBudget.addEventListener('change', () => {
        if (state.view) state.view.renderBudget = parseInt(els.renderBudget.value, 10) || 200;
    });

    els.fabBtn?.addEventListener('click', openSheet);
    els.sheetOverlay?.addEventListener('click', closeSheet);

    const onResize = debounce(() => {
        state.view?.network?.redraw();
        if (state.store.size() > 1) fitGraph();
    }, 150);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
}

document.addEventListener('DOMContentLoaded', () => {
    initView();
    initExplorer();
    initPathFinder();
    wire();
    setMode('explore');
    refreshStats();
    setStatus('Ready. Paste a Wikipedia URL and click Start.');
});
