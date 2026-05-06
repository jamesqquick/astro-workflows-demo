import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { readProgress } from "../../../workflows/progress";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const id = url.searchParams.get("id");
	if (!id) {
		return Response.json(
			{ error: "Missing id query parameter" },
			{ status: 400 },
		);
	}

	try {
		const instance = await env.MY_WORKFLOW.get(id);
		const status = await instance.status();
		const progress = await readProgress(env.JQQ_WORKFLOWS_DEMO_KV, id);
		return Response.json({ instanceId: id, ...status, progress });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		return Response.json({ error: message }, { status: 404 });
	}
};
