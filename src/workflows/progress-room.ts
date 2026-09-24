import { DurableObject } from "cloudflare:workers";
import {
	appendStep,
	EMPTY_PROGRESS,
	setProceedGate,
	type ProceedGate,
	type ProgressDoc,
	type StepEntry,
	type StepKey,
} from "./progress";

const STORAGE_KEY = "progress";
const UNRELIABLE_MAX_ATTEMPTS = 3;

type WsMessage =
	| { type: "progress"; progress: ProgressDoc }
	| { type: "hello"; progress: ProgressDoc };

/**
 * One ProgressRoom per workflow instance. Maintains the canonical progress
 * doc in DO storage, and broadcasts every change to all subscribed WebSocket
 * clients in real time. Replaces the previous KV-based polling architecture.
 *
 * - Workflow code calls the RPC methods (recordActive, recordComplete, etc.)
 *   to update progress; each call atomically writes storage and broadcasts.
 * - Browsers connect via fetch() with an Upgrade: websocket header. The DO
 *   uses the Hibernation WebSocket API so it can sleep while clients stay
 *   connected.
 * - On connect, the DO immediately pushes the current progress so the client
 *   doesn't need a separate snapshot fetch.
 */
export class ProgressRoom extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname.endsWith("/ws")) {
			if (request.headers.get("Upgrade") !== "websocket") {
				return new Response("Expected Upgrade: websocket", { status: 426 });
			}
			return this.handleWebSocket();
		}
		return new Response("Not found", { status: 404 });
	}

	private async handleWebSocket(): Promise<Response> {
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

		// Hibernation API: tells the runtime this DO can be evicted while
		// holding open WebSockets. Messages will reconstruct the DO.
		this.ctx.acceptWebSocket(server);

		// Push the current progress immediately so the client has a snapshot
		// without a separate HTTP fetch.
		const progress = await this.read();
		this.safeSend(server, { type: "hello", progress });

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer) {
		// Clients are read-only subscribers. Ignore any inbound payloads.
	}

	async webSocketClose(
		_ws: WebSocket,
		_code: number,
		_reason: string,
		_wasClean: boolean,
	) {
		// No-op. With web_socket_auto_reply_to_close (default for recent
		// compat dates), the runtime handles graceful close on its own.
	}

	async webSocketError(_ws: WebSocket, _error: unknown) {
		// No-op. Hibernation runtime cleans up dead sockets automatically.
	}

	// ---- RPC methods called by the workflow --------------------------------

	async recordActive(key: StepKey, attempt?: number): Promise<void> {
		const prev = await this.read();
		const next = appendStep(prev, {
			key,
			state: "active",
			attempt,
			maxAttempts:
				key === "unreliable-step" ? UNRELIABLE_MAX_ATTEMPTS : undefined,
			at: new Date().toISOString(),
		});
		await this.writeAndBroadcast(next);
	}

	async recordComplete(key: StepKey, attempt?: number): Promise<void> {
		const prev = await this.read();
		const next = appendStep(prev, {
			key,
			state: "completed",
			attempt,
			maxAttempts:
				key === "unreliable-step" ? UNRELIABLE_MAX_ATTEMPTS : undefined,
			at: new Date().toISOString(),
		});
		await this.writeAndBroadcast(next);
	}

	async recordRetrying(
		key: StepKey,
		attempt: number,
		error: string,
	): Promise<void> {
		const prev = await this.read();
		const next = appendStep(prev, {
			key,
			state: "retrying",
			attempt,
			maxAttempts:
				key === "unreliable-step" ? UNRELIABLE_MAX_ATTEMPTS : undefined,
			error,
			at: new Date().toISOString(),
		});
		await this.writeAndBroadcast(next);
	}

	async recordFailed(key: StepKey, error: string): Promise<void> {
		const prev = await this.read();
		const next = appendStep(prev, {
			key,
			state: "failed",
			error,
			at: new Date().toISOString(),
		});
		await this.writeAndBroadcast(next);
	}

	/**
	 * Mark a previously-completed step as rolling back. Called from a step's
	 * rollback handler while Workflows unwinds the saga in reverse order. Each
	 * call appends a "rolling-back" entry, which becomes the latest entry for
	 * that step so the UI flips it to the rollback state in real time.
	 */
	async recordRollback(key: StepKey): Promise<void> {
		const prev = await this.read();
		const next = appendStep(prev, {
			key,
			state: "rolling-back",
			at: new Date().toISOString(),
		});
		await this.writeAndBroadcast(next);
	}

	async setGate(gate: ProceedGate | null): Promise<void> {
		const prev = await this.read();
		const next = setProceedGate(prev, gate);
		await this.writeAndBroadcast(next);
	}

	async getProgress(): Promise<ProgressDoc> {
		return this.read();
	}

	/**
	 * Append an arbitrary step entry. Useful for retry log entries written
	 * after a step has succeeded (the demo workflow back-fills these for the
	 * unreliable step).
	 */
	async appendEntry(entry: StepEntry): Promise<void> {
		const prev = await this.read();
		const next = appendStep(prev, entry);
		await this.writeAndBroadcast(next);
	}

	// ---- Internals ----------------------------------------------------------

	private async read(): Promise<ProgressDoc> {
		const stored = await this.ctx.storage.get<ProgressDoc>(STORAGE_KEY);
		return stored ?? { ...EMPTY_PROGRESS };
	}

	private async writeAndBroadcast(doc: ProgressDoc): Promise<void> {
		await this.ctx.storage.put(STORAGE_KEY, doc);
		this.broadcast({ type: "progress", progress: doc });
	}

	private broadcast(message: WsMessage): void {
		const payload = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets()) {
			this.safeSendRaw(ws, payload);
		}
	}

	private safeSend(ws: WebSocket, message: WsMessage): void {
		this.safeSendRaw(ws, JSON.stringify(message));
	}

	private safeSendRaw(ws: WebSocket, payload: string): void {
		try {
			ws.send(payload);
		} catch {
			// Socket might have been closed between getWebSockets() and send().
			// Hibernation runtime will reap it; nothing we can do.
		}
	}
}
