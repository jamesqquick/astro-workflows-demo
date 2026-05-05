import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

type SendEventBody = {
	instanceId: string;
	type: string;
	payload: unknown;
};

export const POST: APIRoute = async ({ request }) => {
	let body: SendEventBody;
	try {
		body = (await request.json()) as SendEventBody;
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	if (!body.instanceId || !body.type) {
		return Response.json(
			{ error: "instanceId and type are required" },
			{ status: 400 },
		);
	}

	try {
		const instance = await env.MY_WORKFLOW.get(body.instanceId);
		await instance.sendEvent({ type: body.type, payload: body.payload });
		return Response.json({ ok: true, status: await instance.status() });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		return Response.json({ error: message }, { status: 400 });
	}
};
