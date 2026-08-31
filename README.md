# AI Music Video Studio — MVP

Local-first prototype for creating a music-video storyboard and batch-generating images with OpenAI GPT Image or xAI Grok Imagine.

## Current features

- Create local projects from lyrics + visual direction
- Choose 16:9, 9:16 or 1:1
- Choose GPT Image or Grok Imagine per project
- Generate a 12-shot AI storyboard
- Generate one image, regenerate one image, or generate all missing images
- SQLite persistence
- API keys remain on the local backend

## Setup

Requirements: Node.js 20+.

```bash
npm run install:all
```

Configure providers in the application's **Settings** page, then run:

```bash
npm run dev
```

Open the Vite URL shown in the terminal (normally http://localhost:5173).

## Architecture

- `web/`: React + Vite UI
- `server/`: Express + TypeScript API
- `server/data/studio.sqlite`: local project database (created automatically)
- `server/src/providers.ts`: image-provider abstraction
- `server/src/storyboard.ts`: AI storyboard generation

## Provider API keys

Keys are sent only to the local backend and stored in the local SQLite database (`server/data/studio.sqlite`); they are never returned by the API or saved in browser storage. This MVP local storage is not encrypted at rest, so protect the local database and do not use it on a shared machine with untrusted users. `OPENAI_API_KEY` and `XAI_API_KEY` are supported only as local-development fallbacks.

## Next implementation steps

1. Persist generated OpenAI base64 images as local files instead of data URLs.
2. Add editable shot descriptions/prompts and Approve/Needs changes state.
3. Add reference images / locked visual identity.
4. Add song upload and audio/structure analysis.
5. Add progress polling so long batch generations update live.
6. Add export ZIP / storyboard PDF.
