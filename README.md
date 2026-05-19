# Loomspace

A glassy spatial workspace for side streams you can stitch back into the main line.

## What’s in this slice

- React + TypeScript app shell
- local event log persisted in `localStorage`
- draggable canvas nodes
- typed links for supports / promotes / contradicts / links
- provenance inspector for every selected node
- density overlay + basic fabric metrics
- thread spawn, stitch promotion, contradiction marking

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Model

- **Loom**: workspace
- **Warp**: primary stream
- **Thread**: side stream
- **Stitch**: promoted pair or decision anchor
- **Evidence**: provenance-bearing node
- **Fabric**: the graph and its visible state

## Design rule

If an object exists, the inspector should be able to answer why.
