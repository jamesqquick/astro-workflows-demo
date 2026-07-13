import { useCallback, useEffect, useRef, useState } from "react";

// Step keys here MUST match the step names in src/workflows/demo-workflow.ts.
export const STEPS = [
	{ key: "initialize", label: "Initialize", description: "step.do" },
	{
		key: "wait-for-approval",
		label: "Wait for approval",
		description: "step.waitForEvent",
	},
	{
		key: "process-approval",
		label: "Process approval",
		description: "step.do",
	},
	{ key: "sleep-step", label: "Sleep 10s", description: "step.sleep" },
	{
		key: "unreliable-step",
		label: "Unreliable step",
		description: "step.do (retries 3x)",
	},
	{
		key: "wait-for-custom-event",
		label: "Wait for custom event",
		description: "step.waitForEvent",
	},
	{ key: "finalize", label: "Finalize", description: "step.do" },
	{
		key: "trigger-failure",
		label: "Trigger failure",
		description: "step.do (saga rollback)",
	},
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

export type WorkflowStatusValue =
	| "queued"
	| "running"
	| "paused"
	| "errored"
	| "terminated"
	| "complete"
	| "waiting"
	| "waitingForPause"
	| "unknown";

export type StepEntry = {
	key: StepKey;
	state: "active" | "completed" | "failed" | "retrying" | "rolling-back";
	attempt?: number;
	maxAttempts?: number;
	error?: string;
	at: string;
};

export type ProceedGate =
	| "initialize"
	| "wait-for-approval"
	| "sleep-step"
	| "unreliable-step"
	| "wait-for-custom-event"
	| "finalize"
	| "trigger-failure";

export type ProgressDoc = {
	currentStep: StepKey | null;
	currentProceedGate: ProceedGate | null;
	steps: StepEntry[];
	updatedAt: string;
};

/** Mirrors the `rollback` field added to InstanceStatus by the Workflows
 *  saga-rollback feature. Null until the instance enters rollback. */
export type RollbackStatus = {
	outcome: "complete" | "failed";
	error: { name: string; message: string } | null;
} | null;

export type StatusResponse = {
	instanceId: string;
	status: WorkflowStatusValue;
	error?: { name: string; message: string };
	output?: unknown;
	progress?: ProgressDoc | null;
	rollback?: RollbackStatus;
};

export type LogEntry = {
	id: string;
	at: string;
	message: string;
	tone: "info" | "success" | "warning" | "error";
};

export type ResolvedStepState =
	| "pending"
	| "active"
	| "waiting"
	| "sleeping"
	| "retrying"
	| "completed"
	| "failed"
	| "rolling-back";

export type ResolvedStep = {
	state: ResolvedStepState;
	attempt?: number;
	maxAttempts?: number;
	error?: string;
};

/** Lightweight poll just for workflow runtime status (running / waiting /
 *  complete / errored). Progress updates flow through the WebSocket and are
 *  effectively instant. */
const STATUS_POLL_INTERVAL_MS = 2000;
const WS_RECONNECT_BACKOFF_MS = [500, 1500, 4000];

function timeNow() {
	return new Date().toLocaleTimeString();
}

function newLogEntry(
	message: string,
	tone: LogEntry["tone"] = "info",
): LogEntry {
	return {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		at: timeNow(),
		message,
		tone,
	};
}

function entrySignature(entry: StepEntry): string {
	return `${entry.key}|${entry.state}|${entry.attempt ?? ""}`;
}

/**
 * Resolves a UI state for a step using progress data when available.
 * Falls back to overall workflow status heuristics.
 */
export function resolveStepState(
	stepKey: StepKey,
	progress: ProgressDoc | null,
	workflowStatus: WorkflowStatusValue | null,
): ResolvedStep {
	if (progress?.steps?.length) {
		const entries = progress.steps.filter((s) => s.key === stepKey);
		if (entries.length > 0) {
			const latest = entries[entries.length - 1];

			if (workflowStatus === "errored" && latest.state === "retrying") {
				return {
					state: "failed",
					attempt: latest.attempt,
					maxAttempts: latest.maxAttempts,
					error: latest.error,
				};
			}

			let state: ResolvedStepState;
			if (latest.state === "active") {
				if (stepKey === "sleep-step") state = "sleeping";
				else if (
					stepKey === "wait-for-approval" ||
					stepKey === "wait-for-custom-event" ||
					stepKey === "trigger-failure"
				) {
					state = "waiting";
				} else state = "active";
			} else {
				state = latest.state;
			}

			return {
				state,
				attempt: latest.attempt,
				maxAttempts: latest.maxAttempts,
				error: latest.error,
			};
		}

		if (workflowStatus === "complete") return { state: "completed" };
		return { state: "pending" };
	}

	if (workflowStatus == null) return { state: "pending" };
	if (workflowStatus === "complete") return { state: "completed" };
	if (workflowStatus === "errored") return { state: "pending" };
	if (stepKey === "initialize" && workflowStatus === "running")
		return { state: "active" };
	return { state: "pending" };
}

/** Storage key is namespaced per design version so each route is independent. */
export function useWorkflow(storageKey: string) {
	const [instanceId, setInstanceId] = useState<string | null>(null);
	const [status, setStatus] = useState<StatusResponse | null>(null);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [busy, setBusy] = useState(false);
	const previousStatusRef = useRef<WorkflowStatusValue | null>(null);
	const seenEntriesRef = useRef<Set<string>>(new Set());
	const rollbackOutcomeLoggedRef = useRef(false);

	const appendLog = useCallback(
		(message: string, tone: LogEntry["tone"] = "info") => {
			setLogs((prev) => [...prev, newLogEntry(message, tone)]);
		},
		[],
	);

	useEffect(() => {
		const saved = window.localStorage.getItem(storageKey);
		if (saved) {
			setInstanceId(saved);
			appendLog(`Recovered instance ${saved} from storage`, "info");
		}
	}, [appendLog, storageKey]);

	useEffect(() => {
		if (instanceId) {
			window.localStorage.setItem(storageKey, instanceId);
		} else {
			window.localStorage.removeItem(storageKey);
		}
	}, [instanceId, storageKey]);

	useEffect(() => {
		if (!instanceId) return;

		let cancelled = false;
		previousStatusRef.current = null;
		seenEntriesRef.current = new Set();
		rollbackOutcomeLoggedRef.current = false;

		// ----- Per-entry log emitter (called for every progress update) ------
		const emitNewLogEntries = (progress: ProgressDoc) => {
			for (const entry of progress.steps) {
				const sig = entrySignature(entry);
				if (seenEntriesRef.current.has(sig)) continue;
				seenEntriesRef.current.add(sig);

				const stepLabel =
					STEPS.find((s) => s.key === entry.key)?.label ?? entry.key;
				const attemptSuffix = entry.attempt
					? ` (attempt ${entry.attempt}${entry.maxAttempts ? `/${entry.maxAttempts}` : ""})`
					: "";

				switch (entry.state) {
					case "active":
						appendLog(`▶ ${stepLabel} started${attemptSuffix}`, "info");
						break;
					case "completed":
						appendLog(
							`✓ ${stepLabel} completed${attemptSuffix}`,
							"success",
						);
						break;
					case "retrying":
						appendLog(
							`✗ ${stepLabel} failed${attemptSuffix} — ${entry.error ?? "no error"}`,
							"warning",
						);
						appendLog(`↻ retry initiated for ${stepLabel}`, "warning");
						break;
					case "failed":
						appendLog(
							`✗ ${stepLabel} failed permanently — ${entry.error ?? "no error"}`,
							"error",
						);
						break;
					case "rolling-back":
						appendLog(
							`↩ rolling back ${stepLabel} — running compensating logic`,
							"warning",
						);
						break;
				}
			}
		};

		// ----- WebSocket subscription for real-time progress -----------------
		let ws: WebSocket | null = null;
		let reconnectAttempt = 0;
		let reconnectTimer: number | undefined;

		const connectWs = () => {
			if (cancelled) return;

			const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
			const url = `${proto}//${window.location.host}/api/workflow/ws?id=${encodeURIComponent(instanceId)}`;
			ws = new WebSocket(url);

			ws.onopen = () => {
				reconnectAttempt = 0;
			};

			ws.onmessage = (ev) => {
				if (cancelled) return;
				try {
					const msg = JSON.parse(ev.data) as
						| { type: "hello"; progress: ProgressDoc }
						| { type: "progress"; progress: ProgressDoc };
					if (msg.type === "hello" || msg.type === "progress") {
						setStatus((prev) => ({
							instanceId,
							status: prev?.status ?? "unknown",
							error: prev?.error,
							output: prev?.output,
							rollback: prev?.rollback,
							progress: msg.progress,
						}));
						emitNewLogEntries(msg.progress);
					}
				} catch {
					// ignore malformed payloads
				}
			};

			ws.onclose = () => {
				if (cancelled) return;
				ws = null;
				if (reconnectAttempt < WS_RECONNECT_BACKOFF_MS.length) {
					const delay = WS_RECONNECT_BACKOFF_MS[reconnectAttempt];
					reconnectAttempt++;
					reconnectTimer = window.setTimeout(connectWs, delay);
				} else {
					appendLog(
						"Live updates disconnected. Refresh to reconnect.",
						"error",
					);
				}
			};

			ws.onerror = () => {
				// onclose will fire too; let it handle reconnection.
			};
		};

		connectWs();

		// ----- Lightweight status poll (workflow runtime status only) --------
		// The DO doesn't track Workflows' own status field (running / waiting /
		// complete / errored); we still need a low-frequency poll for that.
		let pollTimer: number | undefined;

		const pollStatus = async () => {
			try {
				const res = await fetch(
					`/api/workflow/status?id=${encodeURIComponent(instanceId)}`,
				);
				if (!res.ok) {
					if (res.status === 404 && !cancelled) {
						setInstanceId(null);
						setStatus(null);
					}
					return;
				}
				const next = (await res.json()) as StatusResponse;
				if (cancelled) return;
				setStatus((prev) => ({
					...next,
					// Prefer the progress we already have from the WebSocket,
					// which is more current than what the API sees.
					progress: prev?.progress ?? next.progress,
				}));

				// Surface the saga-rollback outcome once it appears in the
				// instance status. This is the new `rollback` field exposed by
				// the Workflows rollback feature.
				if (next.rollback && !rollbackOutcomeLoggedRef.current) {
					rollbackOutcomeLoggedRef.current = true;
					if (next.rollback.outcome === "complete") {
						appendLog(
							"↩ Rollback complete — all compensating steps ran",
							"success",
						);
					} else {
						appendLog(
							`✗ Rollback failed — ${next.rollback.error?.message ?? "unknown error"}`,
							"error",
						);
					}
				}

				const prevStatus = previousStatusRef.current;
				if (prevStatus !== next.status) {
					if (prevStatus !== null) {
						appendLog(
							`Workflow status: ${prevStatus} → ${next.status}`,
							next.status === "errored"
								? "error"
								: next.status === "complete"
									? "success"
									: next.status === "waiting"
										? "warning"
										: "info",
						);
					}
					previousStatusRef.current = next.status;
				}
			} catch {
				// transient network errors — next tick will retry
			}
		};

		const scheduleStatusPoll = () => {
			if (cancelled) return;
			pollTimer = window.setTimeout(async () => {
				await pollStatus();
				scheduleStatusPoll();
			}, STATUS_POLL_INTERVAL_MS);
		};

		void pollStatus().then(scheduleStatusPoll);

		return () => {
			cancelled = true;
			if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
			if (pollTimer !== undefined) window.clearTimeout(pollTimer);
			if (ws) {
				try {
					ws.close();
				} catch {
					// ignore
				}
			}
		};
	}, [instanceId, appendLog]);

	const startWorkflow = async () => {
		setBusy(true);
		setLogs([]);
		setStatus(null);
		previousStatusRef.current = null;
		seenEntriesRef.current = new Set();
		try {
			const res = await fetch("/api/workflow/create", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			const body = (await res.json()) as
				| { instanceId: string; status: StatusResponse }
				| { error: string };
			if (!res.ok || "error" in body) {
				appendLog(
					`Failed to create instance: ${"error" in body ? body.error : res.status}`,
					"error",
				);
				return;
			}
			setInstanceId(body.instanceId);
			appendLog(`Instance created: ${body.instanceId}`, "success");
		} catch (err) {
			appendLog(`Network error: ${(err as Error).message}`, "error");
		} finally {
			setBusy(false);
		}
	};

	const sendWorkflowEvent = async (
		type:
			| "user-decision"
			| "user-proceed"
			| "user-custom-event"
			| "user-rollback-decision",
		payload: Record<string, unknown>,
		successLog: string,
	) => {
		if (!instanceId) return;
		setBusy(true);
		try {
			const res = await fetch("/api/workflow/send-event", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ instanceId, type, payload }),
			});
			const body = (await res.json()) as { ok?: boolean; error?: string };
			if (!res.ok || body.error) {
				appendLog(`sendEvent failed: ${body.error ?? res.status}`, "error");
				return;
			}
			appendLog(successLog, "success");
		} catch (err) {
			appendLog(`Network error: ${(err as Error).message}`, "error");
		} finally {
			setBusy(false);
		}
	};

	const approve = () =>
		sendWorkflowEvent(
			"user-decision",
			{ decision: "approve" },
			"Approved by human",
		);

	const reject = () =>
		sendWorkflowEvent(
			"user-decision",
			{ decision: "reject" },
			"Rejected by human",
		);

	const proceed = (gate: ProceedGate) =>
		sendWorkflowEvent(
			"user-proceed",
			{ for: gate },
			`Proceeded past ${gate}`,
		);

	const sendCustomEvent = () =>
		sendWorkflowEvent(
			"user-custom-event",
			{ sentAt: new Date().toISOString() },
			"Custom event sent",
		);

	const triggerFailure = () =>
		sendWorkflowEvent(
			"user-rollback-decision",
			{ choice: "fail" },
			"Triggering failure — saga rollbacks will run",
		);

	const completeNormally = () =>
		sendWorkflowEvent(
			"user-rollback-decision",
			{ choice: "complete" },
			"Completing normally — no rollback",
		);

	const isTerminal =
		status?.status === "complete" ||
		status?.status === "errored" ||
		status?.status === "terminated";
	const currentStep = status?.progress?.currentStep ?? null;

	// Trust the progress data, not the runtime status field — the local
	// Workflows emulator reports "running" during step.waitForEvent hibernation
	// even though the workflow is genuinely paused. Progress data is the
	// source of truth.
	const isWaitingForApproval =
		status?.progress?.steps?.some(
			(s) => s.key === "wait-for-approval" && s.state === "active",
		) ?? false;

	const isWaitingForCustomEvent =
		status?.progress?.steps?.some(
			(s) => s.key === "wait-for-custom-event" && s.state === "active",
		) ?? false;

	const isWaitingForRollbackDecision =
		status?.progress?.steps?.some(
			(s) => s.key === "trigger-failure" && s.state === "active",
		) ?? false;

	const rollback = status?.rollback ?? null;

	// Tutorial gate: which `proceed:*` step.waitForEvent is the workflow
	// currently paused on (if any).
	const currentProceedGate = (status?.progress?.currentProceedGate ?? null) as
		| ProceedGate
		| null;

	return {
		instanceId,
		status,
		logs,
		busy,
		isTerminal,
		isWaitingForApproval,
		isWaitingForCustomEvent,
		isWaitingForRollbackDecision,
		rollback,
		currentStep,
		currentProceedGate,
		startWorkflow,
		approve,
		reject,
		proceed,
		sendCustomEvent,
		triggerFailure,
		completeNormally,
	};
}
