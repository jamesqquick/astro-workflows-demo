import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const id = url.searchParams.get("id");
	if (!id) {
		return Response.json({ error: "Missing id query parameter" }, { status: 400 });
	}

	try {
		const instance = await env.MY_WORKFLOW.get(id);
		const status = await instance.status();
		return Response.json({ instanceId: id, ...status });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		return Response.json({ error: message }, { status: 404 });
	}
};
