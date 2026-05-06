import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";
import {
	appendStep,
	readProgress,
	setProceedGate,
	writeProgress,
	type ProceedGate,
	type StepKey,
} from "./progress";

export type DemoWorkflowParams = {
	startedAt?: string;
};

type DecisionEvent = { decision: "approve" | "reject" };
type ProceedEvent = { for: ProceedGate };

const UNRELIABLE_MAX_ATTEMPTS = 3;
const PROCEED_TIMEOUT = "1 hour";

/**
 * DemoWorkflow — a teaching tool for Cloudflare Workflows.
 *
 * Every substantive step is preceded by a tutorial gate (`step.waitForEvent`
 * with type "user-proceed") so the UI can show an educational modal before
 * each primitive runs. The user clicks PROCEED and the corresponding step
 * executes. The approval step itself is a separate gate that uses
 * "user-decision" events.
 *
 * Per-step progress is mirrored to KV so the UI can surface "currently on
 * step N" and "currently waiting on tutorial gate G".
 */
export class DemoWorkflow extends WorkflowEntrypoint<Env, DemoWorkflowParams> {
	async run(event: WorkflowEvent<DemoWorkflowParams>, step: WorkflowStep) {
		const instanceId = event.instanceId;
		const kv = this.env.JQQ_WORKFLOWS_DEMO_KV;

		const recordActive = (key: StepKey, attempt?: number) =>
			step.do(
				`progress:${key}:active${attempt ? `:${attempt}` : ""}`,
				async () => {
					const prev = await readProgress(kv, instanceId);
					await writeProgress(
						kv,
						instanceId,
						appendStep(prev, {
							key,
							state: "active",
							attempt,
							maxAttempts:
								key === "unreliable-step" ? UNRELIABLE_MAX_ATTEMPTS : undefined,
							at: new Date().toISOString(),
						}),
					);
				},
			);

		const recordComplete = (key: StepKey, attempt?: number) =>
			step.do(
				`progress:${key}:complete${attempt ? `:${attempt}` : ""}`,
				async () => {
					const prev = await readProgress(kv, instanceId);
					await writeProgress(
						kv,
						instanceId,
						appendStep(prev, {
							key,
							state: "completed",
							attempt,
							maxAttempts:
								key === "unreliable-step" ? UNRELIABLE_MAX_ATTEMPTS : undefined,
							at: new Date().toISOString(),
						}),
					);
				},
			);

		const recordRetrying = (key: StepKey, attempt: number, error: string) =>
			step.do(`progress:${key}:retry:${attempt}`, async () => {
				const prev = await readProgress(kv, instanceId);
				await writeProgress(
					kv,
					instanceId,
					appendStep(prev, {
						key,
						state: "retrying",
						attempt,
						maxAttempts:
							key === "unreliable-step" ? UNRELIABLE_MAX_ATTEMPTS : undefined,
						error,
						at: new Date().toISOString(),
					}),
				);
			});

		const setGate = (gate: ProceedGate | null) =>
			step.do(`progress:gate:${gate ?? "clear"}`, async () => {
				const prev = await readProgress(kv, instanceId);
				await writeProgress(kv, instanceId, setProceedGate(prev, gate));
			});

		// Tutorial gate before each substantive step.
		const awaitProceed = async (gate: ProceedGate) => {
			await setGate(gate);
			await step.waitForEvent<ProceedEvent>(`proceed:${gate}`, {
				type: "user-proceed",
				timeout: PROCEED_TIMEOUT,
			});
			await setGate(null);
		};

		// ---- Tutorial gate → Step 1: initialize -------------------------------
		await awaitProceed("initialize");
		await recordActive("initialize");
		const init = await step.do("initialize", async () => {
			return {
				message: "Workflow started",
				startedAt: event.payload.startedAt ?? new Date().toISOString(),
			};
		});
		await recordComplete("initialize");

		await step.sleep("post-init-pause", "1 second");

		// ---- Tutorial gate → Step 2: wait-for-approval (also the YES/NO gate) -
		await awaitProceed("wait-for-approval");
		await recordActive("wait-for-approval");
		const decisionEvent = await step.waitForEvent<DecisionEvent>(
			"wait-for-approval",
			{ type: "user-decision", timeout: "5 minutes" },
		);
		await recordComplete("wait-for-approval");

		// ---- Step 3: process-approval (no gate — runs right after decision) ---
		await recordActive("process-approval");
		const approvalResult = await step.do(
			"process-approval",
			{ retries: { limit: 1, delay: "1 second", backoff: "constant" } },
			async () => {
				if (decisionEvent.payload.decision === "reject") {
					throw new Error("Rejected by human");
				}
				return {
					decision: "approve" as const,
					at: new Date().toISOString(),
				};
			},
		);
		await recordComplete("process-approval");

		await step.sleep("post-approval-pause", "1 second");

		// ---- Tutorial gate → Step 4: durable sleep ----------------------------
		await awaitProceed("sleep-step");
		await recordActive("sleep-step");
		await step.sleep("sleep-step", "10 seconds");
		await recordComplete("sleep-step");

		// ---- Tutorial gate → Step 5: unreliable-step --------------------------
		await awaitProceed("unreliable-step");
		await recordActive("unreliable-step", 1);
		const recovered = await step.do(
			"unreliable-step",
			{
				retries: {
					limit: UNRELIABLE_MAX_ATTEMPTS,
					delay: "2 seconds",
					backoff: "linear",
				},
			},
			async (ctx) => {
				if (ctx.attempt < UNRELIABLE_MAX_ATTEMPTS) {
					// Demo-only: deliberate throw to showcase step-level retries.
					// wrangler dev will log this as an "Uncaught Error" — that's
					// expected; Workflows catches it and reruns the step.
					console.log(
						`[demo] planned failure on attempt ${ctx.attempt} — workflow will retry`,
					);
					throw new Error(
						`(planned demo failure — attempt ${ctx.attempt} of ${UNRELIABLE_MAX_ATTEMPTS})`,
					);
				}
				return { succeededOnAttempt: ctx.attempt };
			},
		);
		for (let a = 1; a < recovered.succeededOnAttempt; a++) {
			await recordRetrying(
				"unreliable-step",
				a,
				`Planned demo failure on attempt ${a}`,
			);
		}
		await recordComplete("unreliable-step", recovered.succeededOnAttempt);

		await step.sleep("post-retry-pause", "1 second");

		// ---- Tutorial gate → Step 6: finalize ---------------------------------
		await awaitProceed("finalize");
		await recordActive("finalize");
		const summary = await step.do("finalize", async () => {
			return {
				init,
				humanDecision: approvalResult.decision,
				retryRecovered: recovered.succeededOnAttempt,
				finishedAt: new Date().toISOString(),
			};
		});
		await recordComplete("finalize");

		return summary;
	}
}
