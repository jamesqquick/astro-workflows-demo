# Cloudflare Workflows Explorer

An interactive Astro + Cloudflare Workers demo that visualises four Cloudflare
Workflows features:

1. `step.do` – durable, replayable steps
2. `step.waitForEvent` + `instance.sendEvent` – pause for external input (human-in-the-loop)
3. `step.sleep` – durable hibernation that resumes at the exact step
4. Step-level retry with `ctx.attempt` – only the failing step retries

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
  components/WorkflowExplorer.tsx  # Control panel, step timeline, event log
```

## Scripts

```bash
pnpm install
pnpm cf-typegen          # generate Env types from wrangler.jsonc
pnpm build               # production build
pnpm preview             # build + run wrangler dev with remote bindings
pnpm deploy              # build + wrangler deploy
```

> Workflows aren't reliably emulated in `astro dev`. Use `pnpm preview` (which
> runs `wrangler dev --x-remote-bindings`) so the workflow binding talks to the
> real Cloudflare Workflows engine.

## How the demo flows

1. Click **Start workflow** – creates a new instance via `env.MY_WORKFLOW.create()`.
2. Step 1 (`initialize`) runs and the workflow enters `waiting` for an event.
3. Type a message and click **Send event** – the workflow wakes up via `sendEvent`.
4. Step 4 sleeps for 10 seconds; the instance returns to `waiting`.
5. Step 5 (`unreliable-step`) deliberately fails on attempts 1 and 2 and
   succeeds on attempt 3, demonstrating step-level retry.
6. Step 6 (`finalize`) returns a summary; the UI shows the final output.

The UI polls `/api/workflow/status` once per second and derives a transition
log on the client. The active instance ID is persisted in `localStorage` so
refreshes resume the view.
