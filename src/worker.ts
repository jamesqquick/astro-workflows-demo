import { handle } from "@astrojs/cloudflare/handler";

// Re-export the Workflow class so wrangler can discover it and bind
// MY_WORKFLOW to the DemoWorkflow class declared in wrangler.jsonc.
export { DemoWorkflow } from "./workflows/demo-workflow";
// Re-export the per-instance progress Durable Object.
export { ProgressRoom } from "./workflows/progress-room";

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		// Forward WebSocket upgrade requests directly to the per-instance
		// ProgressRoom Durable Object so clients receive real-time progress
		// updates without polling.
		if (url.pathname === "/api/workflow/ws") {
			const id = url.searchParams.get("id");
			if (!id) {
				return new Response("Missing id query parameter", { status: 400 });
			}
			if (request.headers.get("Upgrade") !== "websocket") {
				return new Response("Expected Upgrade: websocket", { status: 426 });
			}
			const stub = env.PROGRESS_ROOM.getByName(id);
			// The DO's fetch handler matches paths ending in /ws.
			return stub.fetch(
				new Request(new URL("https://do/ws"), request),
			);
		}

		return handle(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
