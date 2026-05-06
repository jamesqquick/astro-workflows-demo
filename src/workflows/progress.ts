/**
 * Shared progress shape written to KV during workflow execution and read
 * by the status API. The Workflows runtime only exposes one overall status
 * value per instance, so we track per-step progress ourselves.
 */

export type StepKey =
	| "initialize"
	| "wait-for-approval"
	| "process-approval"
	| "sleep-step"
	| "unreliable-step"
	| "finalize";

/**
 * Names of the tutorial-gate `step.waitForEvent` calls. The UI uses
 * `currentProceedGate` to decide which TutorialModal to render.
 */
export type ProceedGate =
	| "initialize"
	| "wait-for-approval"
	| "sleep-step"
	| "unreliable-step"
	| "finalize";

export type StepEntry = {
	key: StepKey;
	state: "active" | "completed" | "failed" | "retrying";
	attempt?: number;
	maxAttempts?: number;
	error?: string;
	at: string;
};

export type ProgressDoc = {
	currentStep: StepKey | null;
	/** When set, the workflow is paused on a "proceed" tutorial gate. */
	currentProceedGate: ProceedGate | null;
	steps: StepEntry[];
	updatedAt: string;
};

export const progressKey = (instanceId: string) =>
	`progress:${instanceId}`;

export async function readProgress(
	kv: KVNamespace,
	instanceId: string,
): Promise<ProgressDoc | null> {
	return kv.get<ProgressDoc>(progressKey(instanceId), "json");
}

export async function writeProgress(
	kv: KVNamespace,
	instanceId: string,
	doc: ProgressDoc,
): Promise<void> {
	await kv.put(progressKey(instanceId), JSON.stringify(doc), {
		expirationTtl: 60 * 60 * 24, // 24h
	});
}

export function appendStep(
	doc: ProgressDoc | null,
	entry: StepEntry,
): ProgressDoc {
	const now = new Date().toISOString();
	const base: ProgressDoc = doc ?? {
		currentStep: null,
		currentProceedGate: null,
		steps: [],
		updatedAt: now,
	};

	const existingIdx = base.steps.findIndex(
		(s) =>
			s.key === entry.key &&
			(s.attempt ?? null) === (entry.attempt ?? null),
	);

	const nextSteps =
		existingIdx >= 0
			? base.steps.map((s, i) => (i === existingIdx ? entry : s))
			: [...base.steps, entry];

	return {
		currentStep: entry.state === "completed" ? base.currentStep : entry.key,
		// Any step state change clears the proceed gate — if a real step is
		// running, we are no longer waiting on the user to acknowledge a tutorial.
		currentProceedGate: null,
		steps: nextSteps,
		updatedAt: now,
	};
}

export function setProceedGate(
	doc: ProgressDoc | null,
	gate: ProceedGate | null,
): ProgressDoc {
	const now = new Date().toISOString();
	const base: ProgressDoc = doc ?? {
		currentStep: null,
		currentProceedGate: null,
		steps: [],
		updatedAt: now,
	};
	return {
		...base,
		currentProceedGate: gate,
		updatedAt: now,
	};
}
