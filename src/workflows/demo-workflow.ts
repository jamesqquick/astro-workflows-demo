import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { ProceedGate, StepKey } from "./progress";

export type DemoWorkflowParams = {
	startedAt?: string;
};

type DecisionEvent = { decision: "approve" | "reject" };
type ProceedEvent = { for: ProceedGate };
type CustomEvent = { sentAt: string };
type RollbackDecisionEvent = { choice: "fail" | "complete" };

const UNRELIABLE_MAX_ATTEMPTS = 3;
const PROCEED_TIMEOUT = "1 hour";

/**
 * DemoWorkflow — a teaching tool for Cloudflare Workflows.
 *
 * Every substantive step is preceded by a tutorial gate (`step.waitForEvent`
 * with type "user-proceed") so the UI can show an educational modal before
 * each primitive runs.
 *
 * Per-step progress is mirrored to a per-instance ProgressRoom Durable
 * Object, which writes to its own SQLite-backed storage AND broadcasts every
 * change to all subscribed WebSocket clients. The browser sees state changes
 * in real time without polling.
 */
export class DemoWorkflow extends WorkflowEntrypoint<Env, DemoWorkflowParams> {
	async run(event: WorkflowEvent<DemoWorkflowParams>, step: WorkflowStep) {
		const instanceId = event.instanceId;
		const room = this.env.PROGRESS_ROOM.getByName(instanceId);

		const recordActive = (key: StepKey, attempt?: number) =>
			step.do(
				`progress:${key}:active${attempt ? `:${attempt}` : ""}`,
				async () => {
					await room.recordActive(key, attempt);
				},
			);

		const recordComplete = (key: StepKey, attempt?: number) =>
			step.do(
				`progress:${key}:complete${attempt ? `:${attempt}` : ""}`,
				async () => {
					await room.recordComplete(key, attempt);
				},
			);

		const recordRetrying = (key: StepKey, attempt: number, error: string) =>
			step.do(`progress:${key}:retry:${attempt}`, async () => {
				await room.recordRetrying(key, attempt, error);
			});

		/**
		 * Rollback handler used by every `step.do` that registers compensating
		 * logic. Rollbacks run in reverse step-start order when the instance
		 * fails downstream. We keep the compensating action deliberately simple:
		 * a console.log so you can watch the cascade in `wrangler dev`, plus an
		 * RPC to the ProgressRoom DO so the UI flips each step to "rolling-back"
		 * in real time. `room` is captured from the enclosing run() scope and is
		 * valid because Workflows re-runs run() deterministically up to the
		 * failure point before executing registered rollbacks.
		 */
		const rollbackStep =
			(key: StepKey) =>
			async ({
				error,
				output,
				ctx,
				stepName,
			}: {
				error: Error;
				output: unknown;
				ctx?: { step: { name: string; count: number }; attempt: number };
				stepName?: string;
			}) => {
				// Newer Workflows passes the step context as `ctx` (use
				// ctx.step.name); older runtimes passed a flat `stepName`.
				const name = ctx?.step.name ?? stepName ?? String(key);
				console.log(
					`[rollback] ↩ undoing "${name}" — cause: ${error.message} — output:`,
					output,
				);
				await room.recordRollback(key);
			};

		const setGate = (gate: ProceedGate | null) =>
			step.do(`progress:gate:${gate ?? "clear"}`, async () => {
				await room.setGate(gate);
			});

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
		const init = await step.do(
			"initialize",
			async () => {
				return {
					message: "Workflow started",
					startedAt: event.payload.startedAt ?? new Date().toISOString(),
				};
			},
			{ rollback: rollbackStep("initialize") },
		);
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
			{ rollback: rollbackStep("process-approval") },
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
			{ rollback: rollbackStep("unreliable-step") },
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

		// ---- Tutorial gate → Step 6: wait-for-custom-event --------------------
		// Showcases step.waitForEvent in a non-decision context: the workflow
		// just waits for ANY external signal to fire, then continues.
		await awaitProceed("wait-for-custom-event");
		await recordActive("wait-for-custom-event");
		const customEvent = await step.waitForEvent<CustomEvent>(
			"wait-for-custom-event",
			{ type: "user-custom-event", timeout: "5 minutes" },
		);
		await recordComplete("wait-for-custom-event");

		await step.sleep("post-custom-event-pause", "1 second");

		// ---- Tutorial gate → Step 7: finalize ---------------------------------
		await awaitProceed("finalize");
		await recordActive("finalize");
		const summary = await step.do(
			"finalize",
			async () => {
				return {
					init,
					humanDecision: approvalResult.decision,
					retryRecovered: recovered.succeededOnAttempt,
					customEventReceivedAt: customEvent.payload.sentAt,
					finishedAt: new Date().toISOString(),
				};
			},
			{ rollback: rollbackStep("finalize") },
		);
		await recordComplete("finalize");

		await step.sleep("post-finalize-pause", "1 second");

		// ---- Tutorial gate → Step 8: trigger-failure (saga rollbacks) --------
		// The user picks whether to fail the instance. Choosing "fail" throws a
		// NonRetryableError, which makes Workflows execute every registered
		// rollback handler in reverse step-start order:
		//   finalize → unreliable-step → process-approval → initialize
		// Choosing "complete" returns the summary and the instance ends cleanly.
		await awaitProceed("trigger-failure");
		await recordActive("trigger-failure");
		const rollbackDecision = await step.waitForEvent<RollbackDecisionEvent>(
			"trigger-failure",
			{ type: "user-rollback-decision", timeout: "5 minutes" },
		);
		await recordComplete("trigger-failure");

		if (rollbackDecision.payload.choice === "fail") {
			await step.do("execute-failure", async () => {
				// No rollback handler on this step — it is the one that fails and
				// kicks off the saga rollback cascade for the steps before it.
				throw new NonRetryableError(
					"Deliberate failure — triggering saga rollbacks",
				);
			});
		}

		return summary;
	}
}
