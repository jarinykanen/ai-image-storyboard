# AI Concept Studio

AI Concept Studio is a local-first application for developing visual concepts, consistent storyboard imagery, and publishing artwork from a general creative brief. Music-video projects remain fully supported, including optional lyrics and SUNO context. It is designed for non-technical users: normal workflows expose creative choices and clear generation actions rather than prompts, seeds, or provider payloads.

The application currently supports still-image production. Song upload, audio analysis, animatic playback, and image-to-video generation are not implemented yet.

## Current workflow

1. Create a general concept or music-video project manually. Only a title is required; creative brief, visual direction, lyrics, SUNO context, format, and generation defaults can be added now or later.
2. Optionally paste a response from another AI. Use it directly as the creative brief without an AI call, or explicitly ask the studio to analyze arbitrary prose, Markdown, lists, or JSON into an editable project draft.
3. Generate text-only visual concepts, create one manually, or paste a complete response from another AI in any format. The configured text AI analyzes it into one editable concept without generating an image; an existing concept can use the same flow to update its direction.
4. Select a concept. Each concept has an independent visual identity, storyboard, images, and artwork workspace.
5. Define and lock the visual style, characters, and locations. Reference images can be generated or uploaded.
6. Generate, manually build, or import a storyboard response from another AI in any format, then optionally run a consistency review before spending image-generation credits.
7. Generate images for one shot, selected shots, or all genuinely missing shots.
8. Compare versions, refine or regenerate images, upload alternatives, and approve the chosen result.
9. Render approved shots at the Final tier and export the project for Canva.

## Implemented features

### Projects and creative direction

- Manual local project creation and deletion without requiring an AI provider
- General creative briefs plus an optional specialized music-video workflow
- Optional AI-assisted normalization of arbitrary content copied from another AI into an editable project draft
- Editable project type, creative brief, visual direction, publishing targets, and generation settings
- Preserved lyrics and optional SUNO song context for music-video projects
- Landscape (16:9), vertical (9:16), and square (1:1) project formats
- Publishing targets and a primary visual format
- Narrative, performance, abstract, and mixed storyboard approaches
- AI-generated, manually created, externally imported (including prose, Markdown, lists, JSON, and mixed AI responses), editable, and removable visual concepts
- Independent workspaces for each concept, with explicit concept selection
- Generated and uploaded concept preview images, including multi-image variant generation

### Visual identity

- Shared visual-style, character, and location references
- Editable structured descriptions used by storyboard and image generation (character and location descriptions support up to 10,000 characters)
- AI-assisted character and location descriptions with configurable detail and optional project-context grounding; manual direction takes priority, and generated text remains editable and is not saved automatically
- Generated or uploaded JPEG, PNG, and WebP reference images
- Character and location image generation treats the saved reference description as authoritative; visual-style text supplies compatible aesthetics without importing scene content from a style image
- Reference-image version history, activation, download, and non-destructive clearing
- Locking for visual style, characters, and locations
- Outdated-image indicators when the associated description changes
- Direct reference-image input when the selected provider and model support it; text descriptions remain available as a fallback

### Storyboard planning and review

- AI-generated storyboards with configurable shot count and detail level
- Externally imported storyboard shots: arbitrary prose, Markdown, lists, JSON, and mixed AI responses are analyzed into editable structured shots without generating images
- Timed, ordered shots with section, description, action, shot type, camera, mood, character, and location fields
- Manual shot insertion before or after existing shots
- Shot editing, deletion, and AI regeneration of an individual shot plan
- AI consistency review with scored, categorized issues that can be resolved or ignored
- Stale-review detection after storyboard or project context changes

### Image generation and review

- Explicit generation for one shot, selected shots, or all missing shots
- Multiple Draft variants for inexpensive exploration
- Batch progress polling, provider-aware concurrency, per-shot failure isolation, and immediate persistence of successful results
- Draft, Standard, and Final generation tiers with pre-generation model, resolution, and available cost estimates
- Per-project provider, model, tier, and resolution defaults
- Image refinement when the selected provider supports image editing
- Uploaded storyboard images as an alternative to paid generation
- Image-version comparison, activation, download, and deletion
- Per-shot approval controls
- Final-tier rendering for one approved shot or all approved shots that still need a current Final image
- Existing versions are retained when a new image is generated

Every paid image-generation action requires explicit confirmation. Batch confirmation shows the exact number of images that will be created.

### Artwork and export

- Publishing artwork for YouTube, YouTube Shorts, TikTok, Spotify, and generic landscape, vertical, or square targets
- Generated artwork variants using the selected concept and visual identity
- Custom creative direction and title treatment
- Storyboard images as linked artwork sources without copying or regenerating them
- Artwork version download and deletion
- Canva ZIP export with configurable storyboard images, alternative versions, references, lyrics, and SUNO context, plus current platform artwork, CSV and HTML guides, and a JSON manifest

### Providers and storage

- OpenAI and xAI / Grok image-provider adapters
- OpenAI text generation for optional project-import analysis, concepts, storyboards, and consistency reviews
- Provider capability checks so unsupported reference-image or editing operations are not assumed
- Provider connection setup and testing in the Settings page
- SQLite persistence for project and workflow data
- Generated and uploaded images stored as project-organized local files
- API keys kept on the local backend and never returned to the browser

## Provider support

| Capability | OpenAI | xAI / Grok |
| --- | --- | --- |
| Text concepts and storyboards | Yes | Not implemented |
| Image generation | Yes | Yes |
| Direct reference-image input | Supported models only | Not implemented |
| Image refinement/editing | Supported models only | Not implemented |

The application resolves provider capabilities at runtime. Model availability, supported tiers, resolutions, reference limits, and price estimates are defined in `server/src/provider-settings.ts`.

## Setup

Requirements:

- Node.js 20 or newer
- The `zip` command-line utility for Canva ZIP exports
- An OpenAI and/or xAI API key for the corresponding generation features

Install dependencies:

```bash
npm run install:all
```

Start the application:

```bash
npm run dev
```

Open the Vite URL shown in the terminal, normally <http://localhost:5173>. Provider credentials are optional for manual project creation and editing. Configure and test them from **Settings** when you want to use the corresponding AI actions.

Environment variables can be used as local-development credential fallbacks:

```bash
OPENAI_API_KEY=your-key
XAI_API_KEY=your-key
```

## Development commands

```bash
npm run dev          # Run the API and web application in watch mode
npm run typecheck    # Type-check the server and web application
npm run build        # Type-check everything and build the web application
```

There is currently no automated test or lint script.

## Architecture and local data

- `web/`: React, Vite, TypeScript, and Mantine user interface
- `server/`: Express and TypeScript API
- `server/src/providers.ts`: provider-specific text and image adapters behind normalized application interfaces
- `server/src/project-context.ts`: shared general and music-video creative-context normalization
- `server/src/project-import.ts`: optional extraction of arbitrary external-AI content into an editable project draft
- `server/data/studio.sqlite`: local project database (created automatically)
- `server/data/projects/`: generated and uploaded project images
- `server/src/storyboard.ts`: storyboard planning and generation
- `server/src/image-generation.ts`: image requests, versions, batch orchestration, and generation status
- `server/src/visual-identity.ts`: project references and reference images
- `server/src/visual-reference-prompts.ts`: AI-assisted character and location text prompts
- `server/src/storyboard-review.ts`: consistency review
- `server/src/artwork.ts`: publishing artwork generation and refinement
- `server/src/canva-export.ts`: Canva-oriented ZIP export

The backend owns persistence, prompt construction, provider communication, asset storage, and batch orchestration. The browser does not receive API keys or orchestrate provider requests individually.

## Provider API keys

Keys entered in Settings are sent only to the local backend and stored in `server/data/studio.sqlite`; they are never returned by the API or saved in browser storage. This local storage is not encrypted at rest, so protect the database and do not use it on a shared machine with untrusted users. `OPENAI_API_KEY` and `XAI_API_KEY` are supported only as local-development fallbacks.

## AI prompt debug logging

Prompt logging is disabled by default. To print each final prompt immediately before it is sent to an external AI provider, start the application with:

```bash
AI_PROMPT_DEBUG=true npm run dev
```

Each entry includes the provider, model, operation, and relevant project or target identifiers. API keys, image bytes, provider responses, and complete request payloads are not logged. Prompts can contain lyrics and other project content, so enable this option only in a trusted development environment.

## Known gaps and likely next steps

The most useful next product layer is audio-aware planning and playback:

1. Upload a song and derive duration, waveform, sections, and beat markers.
2. Edit shot timing on a visual timeline.
3. Preview the storyboard as an animatic synchronized to the song.
4. Track structured continuity details such as wardrobe, props, lighting, and screen direction.
5. Export approved shots to editing timelines and, later, add explicit image-to-video generation.
