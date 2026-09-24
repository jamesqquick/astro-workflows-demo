# Cloudflare Workflows Explorer

An interactive Astro + Cloudflare Workers demo that visualises Cloudflare
Workflows and Durable Objects working together:

1. `step.do` – durable, replayable steps
2. `step.waitForEvent` + `instance.sendEvent` – pause for external input (human-in-the-loop)
3. `step.sleep` – durable hibernation that resumes at the exact step
4. Step-level retry with `ctx.attempt` – only the failing step retries
5. Durable Object WebSockets – push progress to the browser without polling
6. Rollback handlers – compensate completed steps in reverse order after failure

## Stack

- Astro on Cloudflare Workers (`@astrojs/cloudflare`)
- React island for the UI (`@astrojs/react`)
- Tailwind CSS v4 for styling
- Cloudflare Workflows binding (`MY_WORKFLOW`)

## Project layout

```
src/
  worker.ts                  # Worker entry: re-exports DemoWorkflow + Astro handler
  workflows/demo-workflow.ts # WorkflowEntrypoint definition
  pages/
    index.astro              # Page that mounts the React UI
    api/workflow/
      create.ts              # POST: env.MY_WORKFLOW.create()
      status.ts              # GET:  instance.status()
      send-event.ts          # POST: instance.sendEvent({ type, payload })
  components/Explorer.tsx          # Control panel, step timeline, event log
```

## Scripts

```bash
pnpm install
pnpm cf-typegen          # generate Env types from wrangler.jsonc
pnpm build               # production build
pnpm preview             # build + run local wrangler dev
pnpm deploy              # build + wrangler deploy
```

> Workflows aren't supported in `astro dev`, and they explicitly cannot be used
> as remote bindings or with `wrangler dev --remote`. Use `pnpm preview`, which
> builds Astro then runs `wrangler dev` (local). Press `e` in the terminal (or
> open `http://localhost:8787/cdn-cgi/explorer`) to open the Workflows
> [Local Explorer](https://developers.cloudflare.com/workflows/build/local-development/)
> for inspecting instance state.

## How the demo flows

1. Click **Start workflow** – creates a new instance via `env.MY_WORKFLOW.create()`.
2. The browser connects to the per-instance `ProgressRoom` WebSocket.
3. Step 1 (`initialize`) runs and the workflow enters `waiting` for an event.
4. Type a message and click **Send event** – the workflow wakes up via `sendEvent`.
5. Step 4 sleeps for 10 seconds; the instance returns to `waiting`.
6. Step 5 (`unreliable-step`) deliberately fails on attempts 1 and 2 and
   succeeds on attempt 3, demonstrating step-level retry.
7. The workflow waits for a custom event, then `finalize` returns a summary.
8. The final decision can complete normally or trigger the rollback handlers.

Progress updates flow through a WebSocket connected to a `ProgressRoom` Durable
Object selected by the Workflow instance ID. The Durable Object persists the
latest progress document before broadcasting it, so a reconnecting browser gets
an immediate snapshot. The UI separately polls `/api/workflow/status` every two
seconds for the Workflow runtime status (`running`, `waiting`, `complete`, or
`errored`); step progress itself does not rely on polling. The active instance ID
is persisted in `localStorage` so refreshes resume the view.

## Real-time architecture

The browser starts a Workflow and receives its instance ID. The same ID routes
the browser's WebSocket connection to one `ProgressRoom` Durable Object:

```
Browser -> Worker -> Workflow -> ProgressRoom Durable Object -> WebSocket -> Browser
```

The Workflow calls Durable Object RPC methods as each step changes state. The
Durable Object writes the canonical progress document to storage, then
broadcasts the update to connected clients. On reconnect, it sends the persisted
snapshot before waiting for another update.

The demo intentionally has no authentication, rate limiting, or multi-user
instance management. Treat a public deployment as a teaching prop, not a
production API.
