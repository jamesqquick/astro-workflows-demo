/**
 * Shared types and pure mutator helpers for workflow progress tracking.
 * Storage and broadcasting now live in the ProgressRoom Durable Object.
 */

export type StepKey =
	| "initialize"
	| "wait-for-approval"
	| "process-approval"
	| "sleep-step"
	| "unreliable-step"
	| "wait-for-custom-event"
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
	| "wait-for-custom-event"
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

export const EMPTY_PROGRESS: ProgressDoc = {
	currentStep: null,
	currentProceedGate: null,
	steps: [],
	updatedAt: new Date(0).toISOString(),
};

export function appendStep(
	doc: ProgressDoc | null,
	entry: StepEntry,
): ProgressDoc {
	const now = new Date().toISOString();
	const base: ProgressDoc = doc ?? { ...EMPTY_PROGRESS, updatedAt: now };

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
	const base: ProgressDoc = doc ?? { ...EMPTY_PROGRESS, updatedAt: now };
	return {
		...base,
		currentProceedGate: gate,
		updatedAt: now,
	};
}
