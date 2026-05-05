import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";

export type DemoWorkflowParams = {
	startedAt?: string;
};

type UserEvent = {
	message: string;
};

/**
 * DemoWorkflow showcases four Cloudflare Workflows features:
 *  1. step.do — durable, replayable step execution
 *  2. step.waitForEvent — pause and react to a sendEvent() call (human-in-the-loop)
 *  3. step.sleep — durable sleep that resumes at the exact step
 *  4. step-level retry with ctx.attempt — only the failing step retries
 */
export class DemoWorkflow extends WorkflowEntrypoint<Env, DemoWorkflowParams> {
	async run(event: WorkflowEvent<DemoWorkflowParams>, step: WorkflowStep) {
		// Step 1: simple initialization step
		const init = await step.do("initialize", async () => {
			return {
				message: "Workflow started",
				startedAt: event.payload.startedAt ?? new Date().toISOString(),
			};
		});

		// Step 2: pause until someone sends a "user-input" event from the UI
		const userEvent = await step.waitForEvent<UserEvent>("wait-for-event", {
			type: "user-input",
			timeout: "5 minutes",
		});

		// Step 3: process the payload received from the event
		const processed = await step.do("process-event", async () => {
			return {
				received: userEvent.payload.message,
				processedAt: new Date().toISOString(),
			};
		});

		// Step 4: durable sleep — workflow hibernates and resumes here
		await step.sleep("sleep-step", "10 seconds");

		// Step 5: an unreliable step that fails on attempts 1 and 2,
		// succeeds on attempt 3. Demonstrates step-level retry without
		// re-running steps 1-4.
		const recovered = await step.do(
			"unreliable-step",
			{
				retries: { limit: 3, delay: "2 seconds", backoff: "linear" },
			},
			async (ctx) => {
				if (ctx.attempt < 3) {
					throw new Error(
						`Simulated failure on attempt ${ctx.attempt} (will retry)`,
					);
				}
				return {
					succeededOnAttempt: ctx.attempt,
				};
			},
		);

		// Step 6: finalize and return a summary of everything that happened
		const summary = await step.do("finalize", async () => {
			return {
				init,
				userMessage: processed.received,
				retryRecovered: recovered.succeededOnAttempt,
				finishedAt: new Date().toISOString(),
			};
		});

		return summary;
	}
}
