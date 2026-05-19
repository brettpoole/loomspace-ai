# Loomspace

A woven thread canvas for project ideas and AI chats.

## Run locally

```bash
npm install
npm run build
npm run start
```

For UI-only dev:

```bash
npm run dev
```

If you want AI replies locally, run the server too and set `OPENAI_API_KEY`.

## DigitalOcean App Platform

Use `app.yaml` as a single web service.

- build: `npm ci && npm run build`
- run: `npm run start`
- set `OPENAI_API_KEY` as a secret
- optional model override: `OPENAI_MODEL`

## Current slice

- title node at the top of each thread
- editable thread titles
- first chat node generated under the title
- new request/response pairs become new nodes
- right sidebar shows the active thread chat
- canvas threadlines are flowchart-like and vertical
