import { useCallback, useEffect, useRef, useState } from "react";

// The names here MUST match the step names in src/workflows/demo-workflow.ts.
const STEPS = [
	{ key: "initialize", label: "1. Initialize", description: "step.do" },
	{
		key: "wait-for-event",
		label: "2. Wait for event",
		description: "step.waitForEvent",
	},
	{
		key: "process-event",
		label: "3. Process event",
		description: "step.do",
	},
	{ key: "sleep-step", label: "4. Sleep 10s", description: "step.sleep" },
	{
		key: "unreliable-step",
		label: "5. Unreliable step",
		description: "step.do (retries)",
	},
	{ key: "finalize", label: "6. Finalize", description: "step.do" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

type WorkflowStatusValue =
	| "queued"
	| "running"
	| "paused"
	| "errored"
	| "terminated"
	| "complete"
	| "waiting"
	| "waitingForPause"
	| "unknown";

type StatusResponse = {
	instanceId: string;
	status: WorkflowStatusValue;
	error?: { name: string; message: string };
	output?: unknown;
};

type LogEntry = {
	id: string;
	at: string;
	message: string;
	tone: "info" | "success" | "warning" | "error";
};

const STORAGE_KEY = "workflows-explorer:instanceId";
const POLL_INTERVAL_MS = 1000;

const STATUS_STYLES: Record<WorkflowStatusValue, string> = {
	queued: "bg-slate-200 text-slate-800",
	running: "bg-blue-500 text-white animate-pulse",
	paused: "bg-amber-200 text-amber-900",
	waiting: "bg-amber-400 text-amber-950",
	waitingForPause: "bg-amber-300 text-amber-900",
	complete: "bg-emerald-500 text-white",
	errored: "bg-rose-500 text-white",
	terminated: "bg-slate-500 text-white",
	unknown: "bg-slate-300 text-slate-800",
};

const TONE_STYLES: Record<LogEntry["tone"], string> = {
	info: "text-slate-300",
	success: "text-emerald-300",
	warning: "text-amber-300",
	error: "text-rose-300",
};

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

export default function WorkflowExplorer() {
	const [instanceId, setInstanceId] = useState<string | null>(null);
	const [status, setStatus] = useState<StatusResponse | null>(null);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [eventMessage, setEventMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const previousStatusRef = useRef<WorkflowStatusValue | null>(null);

	const appendLog = useCallback(
		(message: string, tone: LogEntry["tone"] = "info") => {
			setLogs((prev) => [...prev, newLogEntry(message, tone)]);
		},
		[],
	);

	// Restore last instance id from localStorage on mount.
	useEffect(() => {
		const saved = window.localStorage.getItem(STORAGE_KEY);
		if (saved) {
			setInstanceId(saved);
			appendLog(`Recovered instance ${saved} from storage`, "info");
		}
	}, [appendLog]);

	// Persist instanceId.
	useEffect(() => {
		if (instanceId) {
			window.localStorage.setItem(STORAGE_KEY, instanceId);
		} else {
			window.localStorage.removeItem(STORAGE_KEY);
		}
	}, [instanceId]);

	// Poll status every second while we have an instance and it isn't terminal.
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
							`Status changed: ${prev} -> ${next.status}`,
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
			} catch (err) {
				if (!cancelled) {
					appendLog(
						`Network error while polling: ${(err as Error).message}`,
						"error",
					);
				}
			}
		};

		// Reset transition tracking for the new instance.
		previousStatusRef.current = null;
		void poll();
		const id = window.setInterval(poll, POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(id);
		};
	}, [instanceId, appendLog]);

	const startWorkflow = async () => {
		setBusy(true);
		setLogs([]);
		setStatus(null);
		previousStatusRef.current = null;
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

	const sendEvent = async () => {
		if (!instanceId) return;
		const message = eventMessage.trim() || "hello from the UI";
		setBusy(true);
		try {
			const res = await fetch("/api/workflow/send-event", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					instanceId,
					type: "user-input",
					payload: { message },
				}),
			});
			const body = (await res.json()) as { ok?: boolean; error?: string };
			if (!res.ok || body.error) {
				appendLog(`sendEvent failed: ${body.error ?? res.status}`, "error");
				return;
			}
			appendLog(`Event sent: { message: "${message}" }`, "success");
			setEventMessage("");
		} catch (err) {
			appendLog(`Network error: ${(err as Error).message}`, "error");
		} finally {
			setBusy(false);
		}
	};

	const isWaiting = status?.status === "waiting";
	const isTerminal =
		status?.status === "complete" ||
		status?.status === "errored" ||
		status?.status === "terminated";

	return (
		<div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
			{/* Control Panel */}
			<section className="rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl lg:col-span-2">
				<div className="flex flex-wrap items-center gap-4">
					<button
						type="button"
						onClick={startWorkflow}
						disabled={busy}
						className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white shadow hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{instanceId ? "Restart workflow" : "Start workflow"}
					</button>

					<div className="flex flex-1 flex-wrap items-center gap-2">
						<input
							type="text"
							value={eventMessage}
							onChange={(e) => setEventMessage(e.target.value)}
							placeholder="Event message (defaults to 'hello from the UI')"
							disabled={!isWaiting || busy}
							className="min-w-[260px] flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 disabled:opacity-50"
						/>
						<button
							type="button"
							onClick={sendEvent}
							disabled={!isWaiting || busy}
							className="rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white shadow hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Send event
						</button>
					</div>
				</div>

				<dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
					<div>
						<dt className="text-slate-400">Instance ID</dt>
						<dd className="font-mono text-slate-100 break-all">
							{instanceId ?? "—"}
						</dd>
					</div>
					<div>
						<dt className="text-slate-400">Status</dt>
						<dd>
							{status ? (
								<span
									className={`inline-block rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide ${STATUS_STYLES[status.status]}`}
								>
									{status.status}
								</span>
							) : (
								<span className="text-slate-500">—</span>
							)}
						</dd>
					</div>
				</dl>

				{status?.error && (
					<div className="mt-4 rounded border border-rose-700 bg-rose-950/60 p-3 text-sm text-rose-200">
						<strong>{status.error.name}:</strong> {status.error.message}
					</div>
				)}

				{isWaiting && (
					<p className="mt-4 text-sm text-amber-300">
						Workflow is paused — send an event to wake it up.
					</p>
				)}
				{isTerminal && (
					<p className="mt-4 text-sm text-slate-400">
						Workflow has finished. Click <em>Restart workflow</em> to run again.
					</p>
				)}
			</section>

			{/* Status Timeline */}
			<section className="rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl">
				<h2 className="mb-4 text-lg font-semibold text-slate-100">Steps</h2>
				<ol className="space-y-3">
					{STEPS.map((step, idx) => (
						<StepRow
							key={step.key}
							index={idx}
							label={step.label}
							description={step.description}
							stepKey={step.key}
							workflowStatus={status?.status ?? null}
						/>
					))}
				</ol>
			</section>

			{/* Event Log */}
			<section className="rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl">
				<h2 className="mb-4 text-lg font-semibold text-slate-100">Event log</h2>
				<div className="h-[420px] overflow-y-auto rounded-md border border-slate-800 bg-slate-950 p-3 font-mono text-xs">
					{logs.length === 0 ? (
						<p className="text-slate-500">No events yet.</p>
					) : (
						logs.map((entry) => (
							<div key={entry.id} className={TONE_STYLES[entry.tone]}>
								<span className="text-slate-500">[{entry.at}]</span>{" "}
								{entry.message}
							</div>
						))
					)}
				</div>
			</section>

			{status?.status === "complete" && status.output != null && (
				<section className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-6 shadow-xl lg:col-span-2">
					<h2 className="mb-2 text-lg font-semibold text-emerald-200">
						Final output
					</h2>
					<pre className="overflow-auto rounded bg-slate-950 p-3 text-xs text-emerald-100">
						{JSON.stringify(status.output, null, 2)}
					</pre>
				</section>
			)}
		</div>
	);
}

/**
 * Approximates step-level state from the overall workflow status.
 *
 * The Workflow REST API does not expose per-step status, so we infer the
 * "current" step from the workflow's overall status combined with whether
 * earlier steps must already have run. This is good enough for a visual demo.
 */
function StepRow(props: {
	index: number;
	label: string;
	description: string;
	stepKey: StepKey;
	workflowStatus: WorkflowStatusValue | null;
}) {
	const state = inferStepState(props.stepKey, props.workflowStatus);

	const stateStyles: Record<typeof state, string> = {
		pending: "bg-slate-800 text-slate-400 border-slate-700",
		active: "bg-blue-600 text-white border-blue-500 animate-pulse",
		waiting: "bg-amber-500 text-amber-950 border-amber-400",
		sleeping: "bg-purple-500 text-white border-purple-400",
		retrying: "bg-orange-500 text-white border-orange-400",
		completed: "bg-emerald-600 text-white border-emerald-500",
		failed: "bg-rose-600 text-white border-rose-500",
	};

	return (
		<li
			className={`rounded-md border px-4 py-3 transition-colors ${stateStyles[state]}`}
		>
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="font-semibold">{props.label}</p>
					<p className="text-xs opacity-80">{props.description}</p>
				</div>
				<span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
					{state}
				</span>
			</div>
		</li>
	);
}

type StepState =
	| "pending"
	| "active"
	| "waiting"
	| "sleeping"
	| "retrying"
	| "completed"
	| "failed";

function inferStepState(
	stepKey: StepKey,
	workflowStatus: WorkflowStatusValue | null,
): StepState {
	if (workflowStatus == null) return "pending";

	// When a workflow completes, every step is completed.
	if (workflowStatus === "complete") return "completed";

	// When errored, mark the unreliable step as failed (most likely culprit)
	// and previous ones as completed.
	if (workflowStatus === "errored") {
		const order: StepKey[] = STEPS.map((s) => s.key);
		const failedIdx = order.indexOf("unreliable-step");
		const idx = order.indexOf(stepKey);
		if (idx < failedIdx) return "completed";
		if (idx === failedIdx) return "failed";
		return "pending";
	}

	if (workflowStatus === "terminated") {
		return "pending";
	}

	// For running / waiting / paused / queued we use heuristics keyed off the
	// step name to surface which step is "current".
	if (workflowStatus === "queued") {
		return stepKey === "initialize" ? "active" : "pending";
	}

	if (workflowStatus === "waiting") {
		// "waiting" covers both step.sleep and step.waitForEvent.
		// We don't know which from the API, but the workflow only has one of each
		// and they're sequential (wait-for-event happens before sleep-step), so:
		// - while wait-for-event is the highlighted step, treat sleep as pending.
		// - once we move past wait-for-event, the next "waiting" must be sleep.
		// We can't actually distinguish without per-step status, so treat
		// wait-for-event as the more likely candidate when the user hasn't yet
		// sent an event. The UI driver keeps things clear via the event log.
		if (stepKey === "wait-for-event") return "waiting";
		if (stepKey === "sleep-step") return "sleeping";
		// Earlier than wait-for-event -> completed; later -> pending.
		const order: StepKey[] = STEPS.map((s) => s.key);
		const idx = order.indexOf(stepKey);
		const waitIdx = order.indexOf("wait-for-event");
		const sleepIdx = order.indexOf("sleep-step");
		if (idx < waitIdx) return "completed";
		if (idx > sleepIdx) return "pending";
		return "pending";
	}

	if (workflowStatus === "running") {
		return stepKey === "initialize" ? "active" : "pending";
	}

	if (workflowStatus === "paused" || workflowStatus === "waitingForPause") {
		return "pending";
	}

	return "pending";
}
