import { handle } from "@astrojs/cloudflare/handler";

// Re-export the Workflow class so wrangler can discover it and bind
// MY_WORKFLOW to the DemoWorkflow class declared in wrangler.jsonc.
export { DemoWorkflow } from "./workflows/demo-workflow";

export default {
	async fetch(request, env, ctx) {
		return handle(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
