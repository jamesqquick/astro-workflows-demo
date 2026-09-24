import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

type SendEventBody = {
	instanceId: string;
	type: string;
	payload: unknown;
};

const EVENT_TYPES = new Set([
	"user-decision",
	"user-proceed",
	"user-custom-event",
	"user-rollback-decision",
]);

const PROCEED_GATES = new Set([
	"initialize",
	"wait-for-approval",
	"sleep-step",
	"unreliable-step",
	"wait-for-custom-event",
	"finalize",
	"trigger-failure",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isValidPayload(type: string, payload: unknown): boolean {
	if (!isRecord(payload)) return false;

	switch (type) {
		case "user-decision":
			return payload.decision === "approve" || payload.decision === "reject";
		case "user-proceed":
			return typeof payload.for === "string" && PROCEED_GATES.has(payload.for);
		case "user-custom-event":
			return typeof payload.sentAt === "string";
		case "user-rollback-decision":
			return payload.choice === "fail" || payload.choice === "complete";
		default:
			return false;
	}
}

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

	if (!EVENT_TYPES.has(body.type) || !isValidPayload(body.type, body.payload)) {
		return Response.json(
			{ error: "Unsupported event type or invalid payload" },
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
