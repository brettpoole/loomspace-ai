# Loomspace

A woven thread canvas for project ideas and AI chats.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## DigitalOcean App Platform

Use `app.yaml` as a static site.

- build: `npm ci && npm run build`
- output: `dist`
- fallback: `index.html`

## Current slice

- editable title node at the top of each thread
- first chat node beneath the title node
- request/response pairs append as new nodes
- active thread context stays with that lane
- browser-saved OpenAI API key + model in the settings panel
- bounded pan/zoom viewport on the canvas
- threadlines stay anchored to the title/chat nodes
- mobile layout keeps the viewport inside the screen

## Security

No HTML is injected from user content. API settings stay in browser storage only.
