# Wiki Mapper

Interactive force-directed graph explorer for Wikipedia article links.

Live: https://wiki-mapper.netlify.app/

## Features

- BFS exploration from any Wikipedia URL (any language wiki)
- Parallel fetching with a configurable concurrency pool
- IndexedDB cache so repeat queries hit local storage instead of the network
- Full link graph stored in memory; canvas only renders a budget of nodes
- Excess depths auto-collapse into "hive" cluster nodes (click to expand)
- Live search across the full store, not just visible nodes
- Filter visible nodes by depth and degree
- "Find Path" mode: shortest path between two articles, computed in a Web Worker
- Click a node to open the article; double-click to recenter exploration

## Run locally

It's a static site. Any HTTP server works (modules need a real origin, `file://` won't):

```
python3 -m http.server
```

Then open http://localhost:8000.
