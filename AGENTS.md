# AGENTS.md

## Project

AI Music Video Studio is a simple AI-assisted music video production application for non-technical users.

The product should hide technical details such as prompts, model parameters, API payloads, seeds, and workflow internals unless explicitly exposed in an advanced view.

Primary workflow:

1. Create a project
2. Add song and lyrics
3. Generate visual concepts
4. Define and lock visual identity
5. Generate storyboard shots
6. Generate images for one, selected, or all missing shots
7. Review, edit, approve, or regenerate shots
8. Export approved assets

Future scope may include image-to-video generation and editing assistance.

---

## General Rules

* Keep implementations simple and maintainable.
* Prefer the smallest change that fully solves the task.
* Do not introduce new frameworks, libraries, abstractions, or infrastructure without a clear need.
* Do not refactor unrelated code while implementing a feature.
* Do not modify generated files manually.
* Reuse existing patterns before creating new ones.
* Avoid duplicate helpers, hooks, components, services, and API logic.
* Search the codebase before introducing functionality that may already exist.
* Preserve backward compatibility unless the task explicitly requires a breaking change.
* Never expose API keys or secrets to the browser.
* Before implementation, create a short "preservation checklist" of the existing functionality in the files/views being modified. Use it as regression acceptance criteria.

If requirements conflict with the current implementation, explain the conflict before making a destructive or architectural change.

---

## UX Principles

The target user is not expected to understand AI tooling or software development.

Prefer:

* clear actions
* visual previews
* sensible defaults
* progressive disclosure
* simple language
* automatic persistence
* recoverable actions

Avoid exposing by default:

* raw prompts
* JSON
* model IDs
* seeds
* API request parameters
* token usage
* provider-specific configuration

Normal user actions should use wording such as:

* Generate
* Regenerate
* Approve
* Edit
* Generate selected
* Generate all missing

Technical configuration belongs in Settings or an Advanced section.

---

## AI Provider Architecture

AI providers must remain replaceable.

Do not couple business logic directly to OpenAI or xAI-specific response formats.

Use provider interfaces or adapters for functionality such as:

* text generation
* image generation
* image editing
* reference-image handling

Provider-specific code should stay inside provider implementations.

The rest of the application should operate on internal application models.

Supported providers currently include:

* OpenAI
* xAI / Grok

Do not assume both providers support identical features.

Handle capability differences explicitly.

---

## Image Generation

Storyboard image generation must support:

* one shot
* selected shots
* all missing shots
* regeneration of an existing shot

Batch generation should:

* avoid regenerating completed shots unless explicitly requested
* respect provider concurrency and rate limits
* surface progress to the UI
* isolate failures so one failed shot does not fail the entire batch
* allow retrying failed shots
* persist successful results immediately

Do not require the frontend to orchestrate provider requests individually.

---

## Visual Consistency

Visual consistency is a core product requirement.

Reusable project-level references may include:

* characters
* locations
* environments
* visual style
* wardrobe
* important props

Storyboard generation and image generation should use these references when available.

Do not duplicate character or location descriptions independently across shots if a shared reference model exists.

---

## Data Model

Project data should be the source of truth.

Prefer structured application models over storing critical workflow state only inside generated prompts.

Typical entities may include:

* Project
* Song
* VisualConcept
* VisualIdentity
* CharacterReference
* LocationReference
* Storyboard
* Shot
* GeneratedImage

A shot should contain structured creative information such as:

* start time
* end time
* section
* description
* action
* shot type
* camera direction
* mood
* references
* generation status
* approval status

Do not store information in free text when the application needs to query or modify it independently.

---

## Backend

The backend is responsible for:

* persistence
* AI provider communication
* API keys and secrets
* prompt construction
* batch orchestration
* provider-specific normalization
* generation status
* failure handling

Keep controllers/routes thin.

Business logic belongs in services.

Provider-specific API logic belongs in provider adapters/services.

Do not leak provider SDK types into shared domain models.

---

## Frontend

Keep UI components focused and reusable.

Separate:

* presentation
* data fetching
* mutations
* workflow logic

Avoid large components containing API calls, state orchestration, and rendering together.

Use existing project conventions for:

* routing
* server state
* local state
* forms
* styling
* notifications

Do not introduce a second solution for an existing concern.

Every asynchronous user action must account for:

* loading state
* success state
* failure state

Destructive actions require clear user intent.

---

## Prompts

Prompt construction belongs in the backend.

Do not scatter prompt strings throughout controllers or UI components.

Prefer reusable prompt builders with explicit inputs.

Separate:

* global project style
* visual identity
* shot intent
* provider-specific instructions

Do not make the prompt itself the application's source of truth.

---

## Files

Generated assets should use predictable project-based organization.

Prefer stable identifiers over user-entered names for internal filenames.

Do not overwrite generated assets unless regeneration explicitly replaces a previous version.

Keep enough metadata to identify:

* project
* shot
* generation version
* provider
* generation time

---

## Errors

User-facing errors should explain what happened and what the user can do next.

Do not expose raw provider responses, stack traces, or internal exceptions to normal users.

Log enough backend detail for debugging.

Batch operations should report failures per item.

---

## Verification

After making changes, run the relevant checks available in the repository.

At minimum, when applicable:

* install dependencies if required
* typecheck
* build
* lint
* tests
* run relevant application paths

Do not claim verification succeeded unless it was actually executed successfully.

If verification cannot be completed, state exactly what was not verified and why.

---

## Codex Workflow

For non-trivial tasks:

1. Inspect relevant existing code first.
2. Identify existing patterns and reusable functionality.
3. State the intended change briefly.
4. Implement only the requested scope.
5. Run relevant verification.
6. Summarize:

   * what changed
   * important architectural decisions
   * verification performed
   * remaining issues

If the task is ambiguous but can be safely resolved from existing project patterns, use those patterns instead of asking unnecessary questions.

Do not expand the task into unrelated improvements.

---

## Priorities

When tradeoffs are required, prioritize in this order:

1. Correctness
2. Simple user experience
3. Visual consistency
4. Maintainability
5. Provider independence
6. Performance
7. Additional features

## Paid Generation Safety

Image and video generation must never happen implicitly.

Any operation that can consume paid generation credits must require an explicit user action containing a clear generation intent, such as:

* Generate
* Regenerate
* Generate selected
* Generate all missing

The following actions must never trigger image or video generation automatically:

* creating data
* editing data
* saving forms
* selecting concepts
* selecting providers
* locking/unlocking references
* opening pages
* navigating between workflow steps
* changing storyboard metadata
* changing project settings

Text-generation actions may be automatic only when explicitly requested by the user through an AI-assistance action.

Paid generation must remain separate from CRUD operations and normal workflow navigation.

Before any multi-image generation action, show the exact number of images that will be generated and require confirmation.

Never create automatic regeneration loops.

## Non-Regression and Feature Preservation

Existing working functionality must be preserved unless the task explicitly requests its removal or replacement.

When implementing a new feature, redesign, refactor, or architecture change:

- Do not remove existing features merely because they are not mentioned in the current task.
- Do not replace existing functionality with a simpler implementation unless explicitly requested.
- Do not remove buttons, actions, settings, workflows, data fields, API endpoints, provider capabilities, exports, uploads, downloads, versioning, approval states, or user controls without explicit instruction.
- Do not interpret UI redesigns as permission to reduce functionality.
- Do not interpret refactors as permission to change product behavior.
- Preserve backward compatibility with existing project data wherever practical.
- Preserve existing API behavior unless the task explicitly requires a breaking change.
- Preserve existing generated/uploaded assets and user data.

Before modifying an existing view or workflow:

1. Inspect the current implementation.
2. Identify all existing user-facing functionality in that area.
3. Treat that functionality as required acceptance criteria for the change.
4. Implement the requested change while retaining those capabilities.
5. Verify the existing workflow still works afterward.

If the requested change conflicts with existing functionality:

- do not silently remove the existing behavior
- report the conflict
- choose the least destructive compatible implementation
- ask for clarification only if the conflict cannot reasonably be resolved

### UI Redesign Rule

A UI redesign is a presentation/layout change unless otherwise stated.

It must preserve:

- existing actions
- existing settings
- existing editing capabilities
- existing generation options
- existing upload/download actions
- existing version/history behavior
- existing approval/review functionality
- existing provider/model controls
- existing navigation destinations

Controls may be moved, grouped, collapsed, or placed in menus, but they must not disappear unless explicitly requested.

### Refactoring Rule

When refactoring shared components or architecture:

- preserve observable behavior
- preserve supported workflows
- reuse existing business logic where possible
- do not delete code until all existing consumers have been migrated
- verify that replacement components support the complete feature set of the components they replace

Do not perform opportunistic cleanup that removes apparently unused functionality without confirming that it is truly obsolete.

### Data Model Rule

Schema changes must be additive by default.

Prefer:

- adding optional fields
- migrations with safe defaults
- compatibility layers

Avoid:

- dropping fields
- deleting tables
- changing meanings of existing fields
- destructive migrations

unless explicitly required by the task.

### API Rule

Existing API endpoints are part of the product contract.

Do not:

- delete endpoints
- rename endpoints
- remove response fields
- make optional fields required
- change semantics

unless explicitly requested.

If a better endpoint is introduced, keep the existing endpoint working where practical until migration is complete.

### Verification Rule

Every implementation task that touches existing functionality must verify both:

1. the new requested behavior
2. the relevant existing behavior

At the end of the task, report:

- new functionality added
- existing functionality preserved
- any behavior intentionally changed
- any behavior removed, with explicit reason
- regression checks performed

If any existing feature could not be preserved, clearly report it rather than silently omitting it.

## UI Component Library

Mantine is the application's primary UI component library.

For standard UI primitives, use Mantine components instead of creating custom or native equivalents.

Examples include buttons, inputs, selects, dialogs, menus, tabs, badges, tooltips, cards, layout primitives, loading states, and form controls.

Application-specific components such as StoryboardCard, ImageCard, GenerationSettings, or WorkspaceHeader should remain domain components, but should use Mantine primitives internally where appropriate.

Do not introduce another general-purpose UI component library without explicit instruction.

Do not replace working application functionality merely to make it fit a Mantine component. Adapt the presentation while preserving behavior.
