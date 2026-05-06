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
	{ key: "finalize", label: "Finalize", description: "step.do" },
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
	state: "active" | "completed" | "failed" | "retrying";
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
	| "finalize";

export type ProgressDoc = {
	currentStep: StepKey | null;
	currentProceedGate: ProceedGate | null;
	steps: StepEntry[];
	updatedAt: string;
};

export type StatusResponse = {
	instanceId: string;
	status: WorkflowStatusValue;
	error?: { name: string; message: string };
	output?: unknown;
	progress?: ProgressDoc | null;
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
	| "failed";

export type ResolvedStep = {
	state: ResolvedStepState;
	attempt?: number;
	maxAttempts?: number;
	error?: string;
};

const POLL_INTERVAL_MS = 1000;

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
				else if (stepKey === "wait-for-approval") state = "waiting";
				else state = "active";
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

		const poll = async () => {
			try {
				const res = await fetch(
					`/api/workflow/status?id=${encodeURIComponent(instanceId)}`,
				);
				if (!res.ok) {
					const body = await res.json().catch(() => ({}));
					if (!cancelled) {
						appendLog(
							`Status fetch failed: ${(body as { error?: string }).error ?? res.status}`,
							"error",
						);
						// 404 = instance doesn't exist (stale localStorage). Clear it so
						// the user can start fresh.
						if (res.status === 404) {
							setInstanceId(null);
							setStatus(null);
						}
					}
					return;
				}
				const next = (await res.json()) as StatusResponse;
				if (cancelled) return;
				setStatus(next);

				const prev = previousStatusRef.current;
				if (prev !== next.status) {
					if (prev !== null) {
						appendLog(
							`Workflow status: ${prev} → ${next.status}`,
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

				if (next.progress?.steps) {
					for (const entry of next.progress.steps) {
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
								appendLog(`✓ ${stepLabel} completed${attemptSuffix}`, "success");
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
						}
					}
				}
			} catch (err) {
				if (!cancelled) {
					appendLog(
						`Network error while polling: ${(err as Error).message}`,
						"error",
					);
				}
			}
		};

		previousStatusRef.current = null;
		seenEntriesRef.current = new Set();

		// Self-rescheduling polling: each tick only starts AFTER the previous
		// fetch completes. Using setInterval here would allow overlapping
		// fetches to resolve out of order and overwrite fresh data with stale
		// data — visible as a UI flicker (e.g. the approval modal briefly
		// reappearing after the user clicks YES).
		let timeoutId: number | undefined;
		const scheduleNext = () => {
			if (cancelled) return;
			timeoutId = window.setTimeout(async () => {
				if (cancelled) return;
				await poll();
				scheduleNext();
			}, POLL_INTERVAL_MS);
		};
		void poll().then(scheduleNext);

		return () => {
			cancelled = true;
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
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
		type: "user-decision" | "user-proceed",
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

	const isTerminal =
		status?.status === "complete" ||
		status?.status === "errored" ||
		status?.status === "terminated";
	const currentStep = status?.progress?.currentStep ?? null;

	// Trust the progress data, not the runtime status field — the local
	// Workflows emulator reports "running" during step.waitForEvent hibernation
	// even though the workflow is genuinely paused. The KV-backed progress doc
	// is the source of truth.
	const isWaitingForApproval =
		status?.progress?.steps?.some(
			(s) => s.key === "wait-for-approval" && s.state === "active",
		) ?? false;

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
		currentStep,
		currentProceedGate,
		startWorkflow,
		approve,
		reject,
		proceed,
	};
}
