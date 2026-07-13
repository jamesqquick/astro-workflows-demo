import type { ProceedGate } from "../workflows/progress";

export type StepLesson = {
	primitive: string;
	primitiveColor: string;
	headline: string;
	body: string;
	snippet: string;
	docUrl: string;
	docLabel: string;
};

export const STEP_LESSONS: Record<ProceedGate, StepLesson> = {
	initialize: {
		primitive: "step.do",
		primitiveColor: "bg-[#0000FF] text-white",
		headline: "Run a durable step",
		body: "Every meaningful action in a workflow runs inside step.do. The result is persisted — if the worker restarts mid-execution, completed steps return their cached values instead of re-running. This is what makes workflows durable.",
		snippet: `const init = await step.do("initialize", async () => {
  return {
    message: "Workflow started",
    startedAt: new Date().toISOString(),
  };
});`,
		docUrl: "https://developers.cloudflare.com/workflows/build/workers-api/#step",
		docLabel: "developers.cloudflare.com/workflows/build/workers-api/#step",
	},

	"wait-for-approval": {
		primitive: "step.waitForEvent",
		primitiveColor: "bg-[#F0DC5B] text-black",
		headline: "Pause for human input",
		body: "The workflow hibernates until an external sendEvent call wakes it up. This is the human-in-the-loop primitive — content moderation, approval flows, manual gates. Below this dialog, you'll see the actual YES/NO approval prompt.",
		snippet: `const decision = await step.waitForEvent("wait-for-approval", {
  type: "user-decision",
  timeout: "5 minutes",
});

// elsewhere, send the event:
// await instance.sendEvent({
//   type: "user-decision",
//   payload: { decision: "approve" },
// });`,
		docUrl: "https://developers.cloudflare.com/workflows/build/events-and-parameters/",
		docLabel:
			"developers.cloudflare.com/workflows/build/events-and-parameters",
	},

	"sleep-step": {
		primitive: "step.sleep",
		primitiveColor: "bg-[#FF00FF] text-white",
		headline: "Durable hibernation",
		body: "Sleep for any duration without burning compute. The workflow goes to disk and resumes when the time elapses. Try a worker redeploy during the sleep — the workflow still resumes correctly. Useful for delayed jobs, retries with backoff, or scheduled side effects.",
		snippet: `await step.sleep("sleep-step", "10 seconds");

// also supports sleeping until a specific time:
// await step.sleepUntil("until-monday", new Date("..."));`,
		docUrl:
			"https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/",
		docLabel:
			"developers.cloudflare.com/workflows/build/sleeping-and-retrying",
	},

	"unreliable-step": {
		primitive: "step.do · retries",
		primitiveColor: "bg-[#FF6600] text-black",
		headline: "Step-level retries",
		body: "When a step throws, only that step retries — not the whole workflow. The runtime gives you ctx.attempt so you can branch on it. We'll deliberately fail attempts 1 and 2 to demonstrate the retry behaviour, then succeed on attempt 3.",
		snippet: `await step.do(
  "unreliable-step",
  {
    retries: {
      limit: 3,
      delay: "2 seconds",
      backoff: "linear",
    },
  },
  async (ctx) => {
    if (ctx.attempt < 3) {
      throw new Error(\`failed on attempt \${ctx.attempt}\`);
    }
    return { succeededOnAttempt: ctx.attempt };
  },
);`,
		docUrl:
			"https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/#retry-steps",
		docLabel:
			"developers.cloudflare.com/workflows/build/sleeping-and-retrying",
	},

	"wait-for-custom-event": {
		primitive: "step.waitForEvent",
		primitiveColor: "bg-[#F0DC5B] text-black",
		headline: "Wait for any external signal",
		body: "step.waitForEvent isn't only for binary approve/reject decisions. The workflow can pause indefinitely until ANY matching event arrives — a webhook from Stripe, a Kafka message, a button click, a cron trigger. The workflow uses no compute while it waits.",
		snippet: `const customEvent = await step.waitForEvent("wait-for-custom-event", {
  type: "user-custom-event",
  timeout: "5 minutes",
});

// elsewhere, fire the event:
// await instance.sendEvent({
//   type: "user-custom-event",
//   payload: { sentAt: new Date().toISOString() },
// });`,
		docUrl: "https://developers.cloudflare.com/workflows/build/events-and-parameters/",
		docLabel:
			"developers.cloudflare.com/workflows/build/events-and-parameters",
	},

	finalize: {
		primitive: "step.do",
		primitiveColor: "bg-[#00FF66] text-black",
		headline: "Return the final result",
		body: "The last step's return value becomes the workflow's output, accessible later via instance.status().output. Use this to surface the outcome to whatever triggered the workflow — a queue handler, an HTTP endpoint, another worker.",
		snippet: `const summary = await step.do("finalize", async () => ({
  humanDecision: approvalResult.decision,
  retryRecovered: recovered.succeededOnAttempt,
  finishedAt: new Date().toISOString(),
}));

return summary;`,
		docUrl:
			"https://developers.cloudflare.com/workflows/build/workers-api/#workflowentrypoint",
		docLabel:
			"developers.cloudflare.com/workflows/build/workers-api",
	},

	"trigger-failure": {
		primitive: "step.do · rollback",
		primitiveColor: "bg-[#FF0000] text-white",
		headline: "Saga-style rollbacks",
		body: "Attach a rollback handler to any step.do. If the instance fails downstream, Workflows runs every rollback in reverse step-start order — undoing each step's work right next to where it was done, instead of one giant top-level catch. Below, you'll choose whether to TRIGGER A FAILURE (watch all four completed steps roll back in reverse) or COMPLETE NORMALLY.",
		snippet: `await step.do(
  "initialize",
  async () => {
    const resource = await provision();
    return { resourceId: resource.id };
  },
  {
    rollback: async ({ output, error }) => {
      // runs in reverse order if the instance fails later
      await deprovision(output.resourceId);
    },
    rollbackConfig: {
      retries: { limit: 3, delay: "15 seconds", backoff: "linear" },
      timeout: "2 minutes",
    },
  },
);`,
		docUrl:
			"https://developers.cloudflare.com/workflows/build/workers-api/#rollback-options",
		docLabel:
			"developers.cloudflare.com/workflows/build/workers-api/#rollback-options",
	},
};
