// vis-network rendering, hive clustering, click handlers.

import { articleUrl } from './api.js';
import { normalizeTitle } from './store.js';

const DEPTH_COLORS = ['#ff6347', '#1e90ff', '#32cd32', '#ffaf40', '#9d4edd', '#ff77c6'];

export class GraphView {
    constructor({ container, lang, renderBudget = 200, onRecenter }) {
        this.container = container;
        this.lang = lang;
        this.renderBudget = renderBudget;
        this.onRecenter = onRecenter;
        this.nodes = new vis.DataSet();
        this.edges = new vis.DataSet();
        this.clusteredDepths = new Set();
        this.pathHighlight = new Set();

        this.network = new vis.Network(container, { nodes: this.nodes, edges: this.edges }, {
            nodes: { shape: 'dot', size: 16, font: { size: 12, color: '#333' } },
            edges: {
                width: 0.5,
                color: { inherit: 'from' },
                smooth: { type: 'continuous' },
                arrows: { to: { enabled: true, scaleFactor: 0.5 } },
            },
            physics: {
                enabled: true,
                solver: 'barnesHut',
                barnesHut: { gravitationalConstant: -10000, springConstant: 0.04, springLength: 160, damping: 0.15 },
                stabilization: { iterations: 400, updateInterval: 25 },
            },
            interaction: { hover: true, tooltipDelay: 200, multiselect: false },
        });

        this.network.on('stabilizationIterationsDone', () => {
            this.network.setOptions({ physics: { enabled: false } });
        });

        this.network.on('click', params => this.handleClick(params));
        this.network.on('doubleClick', params => this.handleDoubleClick(params));
    }

    setLang(lang) {
        this.lang = lang;
    }

    handleClick({ nodes }) {
        if (nodes.length !== 1) return;
        const id = nodes[0];
        if (this.network.isCluster(id)) {
            const match = String(id).match(/^hive-d(\d+)$/);
            this.network.openCluster(id);
            if (match) this.clusteredDepths.delete(Number(match[1]));
            return;
        }
        const node = this.nodes.get(id);
        if (!node) return;
        window.open(articleUrl(this.lang, node.title), '_blank', 'noopener');
    }

    handleDoubleClick({ nodes }) {
        if (nodes.length !== 1) return;
        const id = nodes[0];
        if (this.network.isCluster(id)) return;
        const node = this.nodes.get(id);
        if (node) this.onRecenter?.(node.title);
    }

    kickPhysics() {
        this.network.setOptions({ physics: { enabled: true } });
        this.network.stabilize(80);
    }

    addNode(title, depth) {
        const key = normalizeTitle(title);
        if (this.nodes.get(key)) return;
        this.nodes.add({
            id: key,
            label: title,
            title: title,
            color: DEPTH_COLORS[depth % DEPTH_COLORS.length],
            size: depth === 0 ? 26 : 16,
            level: depth,
        });
    }

    addEdge(fromTitle, toTitle) {
        const fromKey = normalizeTitle(fromTitle);
        const toKey = normalizeTitle(toTitle);
        const edgeId = `${fromKey}${toKey}`;
        if (this.edges.get(edgeId)) return;
        if (!this.nodes.get(fromKey) || !this.nodes.get(toKey)) return;
        this.edges.add({ id: edgeId, from: fromKey, to: toKey });
    }

    visibleCount() {
        return this.nodes.length - this.countClustered() + this.clusteredDepths.size;
    }

    enforceBudget(maxDepthSeen) {
        for (let d = maxDepthSeen; d >= 1; d--) {
            if (this.visibleCount() <= this.renderBudget) return;
            if (this.clusteredDepths.has(d)) continue;
            if (this.countByDepth(d) === 0) continue;
            this.clusterDepth(d);
            this.clusteredDepths.add(d);
        }
    }

    countByDepth(depth) {
        return this.nodes.get({ filter: n => n.level === depth }).length;
    }

    countClustered() {
        let n = 0;
        for (const d of this.clusteredDepths) n += this.countByDepth(d);
        return n;
    }

    clusterDepth(depth) {
        const color = DEPTH_COLORS[depth % DEPTH_COLORS.length];
        const ids = new Set();
        this.nodes.forEach(n => { if (n.level === depth) ids.add(n.id); });
        if (ids.size < 2) return;
        const count = ids.size;
        this.network.cluster({
            joinCondition: nodeOpts => ids.has(nodeOpts.id),
            clusterNodeProperties: {
                id: `hive-d${depth}`,
                label: `+${count} @ d${depth}`,
                shape: 'hexagon',
                color: color,
                size: Math.min(60, 18 + Math.sqrt(count) * 4),
                font: { size: 14, color: '#fff' },
                borderWidth: 2,
            },
        });
    }

    highlightSearch(query) {
        const q = query.trim().toLowerCase();
        const updates = [];
        this.nodes.forEach(n => {
            const match = q && n.label.toLowerCase().includes(q);
            updates.push({
                id: n.id,
                borderWidth: match ? 4 : 1,
                color: match
                    ? { background: DEPTH_COLORS[n.level % DEPTH_COLORS.length], border: '#000' }
                    : DEPTH_COLORS[n.level % DEPTH_COLORS.length],
            });
        });
        this.nodes.update(updates);
    }

    applyFilters({ minDepth, maxDepth, minDegree }, store) {
        const updates = [];
        this.nodes.forEach(n => {
            const entry = store.get(n.label);
            const degree = entry ? entry.outLinks.size + entry.inLinks.size : 0;
            const hide = n.level < minDepth || n.level > maxDepth || degree < minDegree;
            updates.push({ id: n.id, hidden: hide });
        });
        this.nodes.update(updates);
    }

    highlightPath(pathTitles) {
        this.clearPathHighlight();
        const keys = pathTitles.map(normalizeTitle);
        this.pathHighlight = new Set(keys);
        const nodeUpdates = [];
        this.nodes.forEach(n => {
            const inPath = this.pathHighlight.has(n.id);
            nodeUpdates.push({
                id: n.id,
                color: inPath
                    ? { background: '#ff1744', border: '#000' }
                    : { background: '#cccccc', border: '#999' },
                size: inPath ? 22 : 10,
            });
        });
        this.nodes.update(nodeUpdates);
        const edgeUpdates = [];
        this.edges.forEach(e => {
            let inPath = false;
            for (let i = 0; i < keys.length - 1; i++) {
                if (e.from === keys[i] && e.to === keys[i + 1]) { inPath = true; break; }
                if (e.from === keys[i + 1] && e.to === keys[i]) { inPath = true; break; }
            }
            edgeUpdates.push({
                id: e.id,
                color: inPath ? { color: '#ff1744' } : { color: '#eee', inherit: false },
                width: inPath ? 3 : 0.5,
            });
        });
        this.edges.update(edgeUpdates);
    }

    clearPathHighlight() {
        if (this.pathHighlight.size === 0) return;
        this.pathHighlight.clear();
        const nodeUpdates = [];
        this.nodes.forEach(n => {
            nodeUpdates.push({
                id: n.id,
                color: DEPTH_COLORS[n.level % DEPTH_COLORS.length],
                size: n.level === 0 ? 26 : 16,
            });
        });
        this.nodes.update(nodeUpdates);
        const edgeUpdates = [];
        this.edges.forEach(e => {
            edgeUpdates.push({ id: e.id, color: { inherit: 'from' }, width: 0.5 });
        });
        this.edges.update(edgeUpdates);
    }

    reset() {
        this.nodes.clear();
        this.edges.clear();
        this.clusteredDepths.clear();
        this.pathHighlight.clear();
        this.network.setOptions({ physics: { enabled: true } });
    }
}
