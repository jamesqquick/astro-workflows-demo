import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	let body: { id?: string } = {};
	try {
		body = await request.json();
	} catch {
		// Empty body is fine — id is optional.
	}

	try {
		const instance = await env.MY_WORKFLOW.create({
			id: body.id,
			params: { startedAt: new Date().toISOString() },
		});

		return Response.json({
			instanceId: instance.id,
			status: await instance.status(),
		});
	} catch (error) {
		return Response.json(
			{
				error:
					error instanceof Error ? error.message : "Unable to create workflow",
			},
			{ status: 500 },
		);
	}
};
