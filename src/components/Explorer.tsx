import { useEffect, useRef, useState } from "react";
import { STEP_LESSONS } from "./stepLessons";
import {
	resolveStepState,
	STEPS,
	useWorkflow,
	type ProceedGate,
	type ResolvedStepState,
} from "./useWorkflow";

const STATE_BG: Record<ResolvedStepState, string> = {
	pending: "bg-white text-black",
	active: "bg-[#0000FF] text-white",
	waiting: "bg-[#F0DC5B] text-black",
	sleeping: "bg-[#FF00FF] text-white",
	retrying: "bg-[#FF6600] text-black",
	completed: "bg-[#00FF66] text-black",
	failed: "bg-[#FF0000] text-white",
	"rolling-back": "bg-[#9D00FF] text-white",
};

const APPROVAL_DELAY_MS = 1000;

export default function Explorer() {
	const w = useWorkflow("workflows-explorer:v3");
	const [tutorialDismissed, setTutorialDismissed] = useState(false);
	const [approvalDismissed, setApprovalDismissed] = useState(false);
	const [approvalReady, setApprovalReady] = useState(false);
	const [sendEventDismissed, setSendEventDismissed] = useState(false);
	const [sendEventReady, setSendEventReady] = useState(false);
	const [rollbackDismissed, setRollbackDismissed] = useState(false);
	const [rollbackReady, setRollbackReady] = useState(false);

	// Reset dismissal whenever the relevant gate changes — so a future Restart
	// shows the modal again.
	useEffect(() => {
		setTutorialDismissed(false);
	}, [w.currentProceedGate]);

	useEffect(() => {
		if (!w.isWaitingForApproval) setApprovalDismissed(false);
	}, [w.isWaitingForApproval]);

	useEffect(() => {
		if (!w.isWaitingForCustomEvent) setSendEventDismissed(false);
	}, [w.isWaitingForCustomEvent]);

	useEffect(() => {
		if (!w.isWaitingForRollbackDecision) setRollbackDismissed(false);
	}, [w.isWaitingForRollbackDecision]);

	// Delay the YES/NO approval modal slightly after the tutorial gate clears,
	// so the user sees the yellow WAITING badge on the step before the dialog
	// steals focus.
	useEffect(() => {
		if (!w.isWaitingForApproval) {
			setApprovalReady(false);
			return;
		}
		const t = window.setTimeout(() => setApprovalReady(true), APPROVAL_DELAY_MS);
		return () => window.clearTimeout(t);
	}, [w.isWaitingForApproval]);

	useEffect(() => {
		if (!w.isWaitingForCustomEvent) {
			setSendEventReady(false);
			return;
		}
		const t = window.setTimeout(
			() => setSendEventReady(true),
			APPROVAL_DELAY_MS,
		);
		return () => window.clearTimeout(t);
	}, [w.isWaitingForCustomEvent]);

	useEffect(() => {
		if (!w.isWaitingForRollbackDecision) {
			setRollbackReady(false);
			return;
		}
		const t = window.setTimeout(
			() => setRollbackReady(true),
			APPROVAL_DELAY_MS,
		);
		return () => window.clearTimeout(t);
	}, [w.isWaitingForRollbackDecision]);

	// The tutorial modal for "wait-for-approval" rolls directly into the
	// YES/NO approval modal, so we don't show two consecutive modals there —
	// the approval gate handles its own messaging.
	const showTutorial =
		w.currentProceedGate !== null && !tutorialDismissed;
	const showApproval =
		w.isWaitingForApproval && approvalReady && !approvalDismissed;
	const showSendEvent =
		w.isWaitingForCustomEvent && sendEventReady && !sendEventDismissed;
	const showRollback =
		w.isWaitingForRollbackDecision && rollbackReady && !rollbackDismissed;

	return (
		<div className="min-h-screen bg-[#F0DC5B] font-mono text-black">
			<main className="mx-auto max-w-6xl px-6 py-8">
				{/* Header banner */}
				<header className="mb-6 flex flex-wrap items-start justify-between gap-6 border-4 border-black bg-white p-6">
					<h1 className="text-5xl font-black uppercase leading-none tracking-tighter md:text-6xl">
						Workflows
						<br />
						Explorer.
					</h1>
					<a
						href="https://github.com/jamesqquick/astro-workflows-demo"
						target="_blank"
						rel="noreferrer"
						className="border-4 border-black bg-[#F0DC5B] px-4 py-3 text-xs font-black uppercase text-black hover:bg-black hover:text-[#F0DC5B]"
					>
						View source on GitHub →
					</a>
				</header>

				{/* Controls */}
				<section className="mb-6 border-4 border-black bg-white">
					<button
						type="button"
						onClick={w.startWorkflow}
						disabled={w.busy}
						className="w-full cursor-pointer bg-[#FF0000] px-6 py-4 text-left text-lg font-black uppercase text-white hover:bg-black hover:text-[#FF0000] disabled:cursor-not-allowed disabled:opacity-50"
					>
						{w.instanceId ? "▶ RESTART WORKFLOW" : "▶ START WORKFLOW"}
					</button>
				</section>

				<div className="mb-6 grid gap-0 border-4 border-black md:grid-cols-3">
					<div className="border-b-4 border-black bg-white p-4 md:border-b-0 md:border-r-4">
						<p className="text-[10px] font-black uppercase">Instance</p>
						<p className="mt-1 break-all font-mono text-xs">
							{w.instanceId ?? "—"}
						</p>
					</div>
					<div className="border-b-4 border-black bg-white p-4 md:border-b-0 md:border-r-4">
						<p className="text-[10px] font-black uppercase">Status</p>
						<p className="mt-1 inline-block bg-black px-2 py-0.5 font-black uppercase text-[#F0DC5B]">
							{w.status?.status ?? "—"}
						</p>
					</div>
					<div className="bg-white p-4">
						<p className="text-[10px] font-black uppercase">Current step</p>
						<p className="mt-1 font-mono text-xs">
							{w.currentProceedGate
								? `awaiting proceed → ${w.currentProceedGate}`
								: (w.status?.progress?.currentStep ?? "—")}
						</p>
					</div>
				</div>

				<section className="mb-6 border-4 border-black bg-black p-4 text-[#F0DC5B]">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<p className="text-[10px] font-black uppercase tracking-widest">
								Live progress path
							</p>
							<p className="mt-2 font-mono text-xs leading-relaxed">
								Browser → Worker → Workflow → ProgressRoom Durable Object → WebSocket → Browser
							</p>
						</div>
						<p className="border-2 border-[#F0DC5B] px-2 py-1 text-[10px] font-black uppercase">
							{w.connectionState}
						</p>
					</div>
					<p className="mt-3 max-w-3xl font-mono text-[11px] leading-relaxed text-white/80">
						The Workflow and Durable Object share the instance ID. The Durable Object persists the latest progress before broadcasting it, so reconnecting clients can catch up without polling for step progress.
					</p>
				</section>

				{w.status?.error && (
					<div className="mb-6 border-4 border-black bg-[#FF0000] p-4 text-white">
						<p className="text-[10px] font-black uppercase">
							! Workflow error
						</p>
						<p className="mt-1 font-mono text-xs">
							{w.status.error.name}: {w.status.error.message}
						</p>
					</div>
				)}

				{w.rollback && (
					<div
						className={`mb-6 border-4 border-black p-4 ${
							w.rollback.outcome === "complete"
								? "bg-[#9D00FF] text-white"
								: "bg-[#FF0000] text-white"
						}`}
					>
						<p className="text-[10px] font-black uppercase">
							↩ Saga rollback {w.rollback.outcome}
						</p>
						<p className="mt-1 font-mono text-xs">
							{w.rollback.outcome === "complete"
								? "All compensating steps ran in reverse step-start order."
								: `Rollback failed: ${w.rollback.error?.message ?? "unknown error"}`}
						</p>
					</div>
				)}

				<div className="grid gap-6 lg:grid-cols-2">
					{/* Steps */}
					<section className="border-4 border-black bg-white">
						<h2 className="border-b-4 border-black bg-black p-3 text-sm font-black uppercase text-[#F0DC5B]">
							[ STEPS ]
						</h2>
						<ol className="divide-y-4 divide-black">
							{STEPS.map((step, i) => {
								const s = resolveStepState(
									step.key,
									w.status?.progress ?? null,
									w.status?.status ?? null,
								);
								return (
									<li
										key={step.key}
										className={`flex items-stretch ${STATE_BG[s.state]}`}
									>
										<span className="flex w-14 flex-none items-center justify-center border-r-4 border-black text-2xl font-black">
											{i + 1}
										</span>
										<div className="flex flex-1 items-center gap-4 px-4 py-3">
											<div className="min-w-0 flex-1">
												<p className="font-black uppercase">{step.label}</p>
												<p className="font-mono text-[11px] opacity-80">
													{step.description}
												</p>
												{s.error && s.state !== "pending" && (
													<p className="mt-1 truncate font-mono text-xs">
														! {s.error}
													</p>
												)}
											</div>
											<div className="flex flex-col items-end gap-1 text-right">
												<span className="border-2 border-black bg-white px-2 py-0.5 text-[10px] font-black uppercase text-black">
													{s.state}
												</span>
												{s.attempt && (
													<span className="font-mono text-[10px] font-bold">
														{s.attempt}/{s.maxAttempts ?? "?"}
													</span>
												)}
											</div>
										</div>
									</li>
								);
							})}
						</ol>
					</section>

					{/* Log */}
					<section className="border-4 border-black bg-white">
						<h2 className="border-b-4 border-black bg-black p-3 text-sm font-black uppercase text-[#F0DC5B]">
							[ EVENT LOG ]
						</h2>
						<div className="h-[460px] overflow-y-auto bg-white p-3 font-mono text-xs leading-relaxed">
							{w.logs.length === 0 ? (
								<p className="font-black uppercase">// NO EVENTS YET.</p>
							) : (
								w.logs.map((entry) => {
									const bg = {
										info: "bg-white",
										success: "bg-[#00FF66]",
										warning: "bg-[#F0DC5B]",
										error: "bg-[#FF0000] text-white",
									}[entry.tone];
									return (
										<div
											key={entry.id}
											className={`mb-1 border-2 border-black px-2 py-1 ${bg}`}
										>
											<span className="font-black">[{entry.at}]</span>{" "}
											{entry.message}
										</div>
									);
								})
							)}
						</div>
					</section>
				</div>

				{w.status?.status === "complete" && w.status.output != null && (
					<section className="mt-6 border-4 border-black bg-[#00FF66]">
						<h2 className="border-b-4 border-black bg-black p-3 text-sm font-black uppercase text-[#00FF66]">
							[ FINAL OUTPUT ]
						</h2>
						<pre className="overflow-auto p-4 text-xs">
							{JSON.stringify(w.status.output, null, 2)}
						</pre>
					</section>
				)}
			</main>

			{/* Tutorial modal — shown before each substantive step */}
			{showTutorial && w.currentProceedGate && (
				<TutorialModal
					gate={w.currentProceedGate}
					busy={w.busy}
					onProceed={() => w.proceed(w.currentProceedGate as ProceedGate)}
					onDismiss={() => setTutorialDismissed(true)}
				/>
			)}

			{/* Approval modal — appears AFTER the tutorial gate clears, while the
			    actual wait-for-approval step is paused waiting for user-decision */}
			{showApproval && (
				<ApprovalModal
					busy={w.busy}
					onApprove={w.approve}
					onReject={w.reject}
					onDismiss={() => setApprovalDismissed(true)}
				/>
			)}

			{/* Send-event modal — appears while wait-for-custom-event is paused */}
			{showSendEvent && (
				<SendEventModal
					busy={w.busy}
					onSend={w.sendCustomEvent}
					onDismiss={() => setSendEventDismissed(true)}
				/>
			)}

			{/* Rollback-decision modal — appears while trigger-failure is paused */}
			{showRollback && (
				<RollbackDecisionModal
					busy={w.busy}
					onTriggerFailure={w.triggerFailure}
					onCompleteNormally={w.completeNormally}
					onDismiss={() => setRollbackDismissed(true)}
				/>
			)}

			{/* Reopen affordances when the user dismissed a modal but the gate
			    is still active. */}
			{w.currentProceedGate && tutorialDismissed && (
				<button
					type="button"
					onClick={() => setTutorialDismissed(false)}
					className="fixed bottom-6 right-6 z-40 cursor-pointer border-4 border-black bg-[#0000FF] px-5 py-3 text-sm font-black uppercase tracking-widest text-white shadow-[8px_8px_0_0_#000] hover:bg-black hover:text-[#0000FF]"
				>
					⚠ Tutorial paused — reopen
				</button>
			)}
			{w.isWaitingForApproval && approvalDismissed && (
				<button
					type="button"
					onClick={() => setApprovalDismissed(false)}
					className="fixed bottom-6 right-6 z-40 cursor-pointer border-4 border-black bg-[#00FF66] px-5 py-3 text-sm font-black uppercase tracking-widest text-black shadow-[8px_8px_0_0_#000] hover:bg-black hover:text-[#00FF66]"
				>
					⚠ Approval pending — reopen
				</button>
			)}
			{w.isWaitingForCustomEvent && sendEventDismissed && (
				<button
					type="button"
					onClick={() => setSendEventDismissed(false)}
					className="fixed bottom-6 right-6 z-40 cursor-pointer border-4 border-black bg-[#F0DC5B] px-5 py-3 text-sm font-black uppercase tracking-widest text-black shadow-[8px_8px_0_0_#000] hover:bg-black hover:text-[#F0DC5B]"
				>
					⚠ Event pending — reopen
				</button>
			)}
			{w.isWaitingForRollbackDecision && rollbackDismissed && (
				<button
					type="button"
					onClick={() => setRollbackDismissed(false)}
					className="fixed bottom-6 right-6 z-40 cursor-pointer border-4 border-black bg-[#9D00FF] px-5 py-3 text-sm font-black uppercase tracking-widest text-white shadow-[8px_8px_0_0_#000] hover:bg-black hover:text-[#9D00FF]"
				>
					⚠ Rollback choice pending — reopen
				</button>
			)}
		</div>
	);
}

// ---------- Modal Frame (shared) -------------------------------------------

function ModalFrame(props: {
	stepIndex: number;
	totalSteps: number;
	headerLabel: string;
	onDismiss: () => void;
	children: React.ReactNode;
}) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				props.onDismiss();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<div
			role="dialog"
			aria-modal="true"
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-md overflow-y-auto"
		>
			<div className="my-auto w-full max-w-2xl border-8 border-black bg-white">
				<div className="flex items-center justify-between border-b-8 border-black bg-black px-6 py-3">
					<span className="text-[10px] font-black uppercase tracking-widest text-[#F0DC5B]">
						{props.headerLabel} · STEP {props.stepIndex} / {props.totalSteps}
					</span>
					<button
						type="button"
						onClick={props.onDismiss}
						className="cursor-pointer border-2 border-[#F0DC5B] bg-black px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-[#F0DC5B] hover:bg-[#F0DC5B] hover:text-black"
						aria-label="Close"
					>
						ESC ✕
					</button>
				</div>
				{props.children}
			</div>
		</div>
	);
}

// ---------- Tutorial Modal --------------------------------------------------

function TutorialModal(props: {
	gate: ProceedGate;
	busy: boolean;
	onProceed: () => Promise<void>;
	onDismiss: () => void;
}) {
	const [submitting, setSubmitting] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const proceedRef = useRef<HTMLButtonElement>(null);
	const submittingRef = useRef(false);

	useEffect(() => {
		proceedRef.current?.focus();
	}, []);

	const lesson = STEP_LESSONS[props.gate];
	const stepIndex = STEPS.findIndex((s) => s.key === props.gate) + 1;

	const handleProceed = async () => {
		if (submittingRef.current) return;
		submittingRef.current = true;
		setSubmitting(true);
		setErrorMsg(null);
		try {
			await props.onProceed();
		} catch (err) {
			setErrorMsg((err as Error).message);
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	};

	const proceedRefHandle = useRef<() => Promise<void>>(handleProceed);
	proceedRefHandle.current = handleProceed;

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void proceedRefHandle.current();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const disabled = props.busy || submitting;

	return (
		<ModalFrame
			stepIndex={stepIndex}
			totalSteps={STEPS.length}
			headerLabel="NEXT UP"
			onDismiss={props.onDismiss}
		>
			<div className="p-8">
				<span
					className={`inline-block border-2 border-black px-2 py-0.5 font-mono text-[11px] font-black uppercase tracking-wider ${lesson.primitiveColor}`}
				>
					{lesson.primitive}
				</span>
				<h2 className="mt-4 text-4xl font-black uppercase leading-none tracking-tighter md:text-5xl">
					{lesson.headline}
				</h2>
				<p className="mt-6 max-w-xl border-l-4 border-black pl-3 text-sm leading-relaxed">
					{lesson.body}
				</p>

				<div className="mt-6 border-4 border-black bg-black p-4">
					<p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#F0DC5B]">
						// code
					</p>
					<pre className="overflow-x-auto font-mono text-xs leading-relaxed text-[#F0DC5B]">
						{lesson.snippet}
					</pre>
				</div>

				<a
					href={lesson.docUrl}
					target="_blank"
					rel="noreferrer noopener"
					className="mt-4 inline-block border-b-2 border-black font-mono text-xs hover:bg-black hover:text-[#F0DC5B]"
				>
					→ {lesson.docLabel}
				</a>

				{errorMsg && (
					<p className="mt-4 border-2 border-black bg-[#FF0000] px-3 py-2 font-mono text-xs text-white">
						! {errorMsg}
					</p>
				)}
				{submitting && !errorMsg && (
					<p className="mt-4 border-2 border-black bg-[#F0DC5B] px-3 py-2 font-mono text-xs">
						Sending...
					</p>
				)}

				<button
					ref={proceedRef}
					type="button"
					onClick={handleProceed}
					disabled={disabled}
					className="mt-6 w-full cursor-pointer border-4 border-black bg-[#00FF66] px-6 py-4 text-2xl font-black uppercase text-black hover:bg-black hover:text-[#00FF66] disabled:cursor-not-allowed disabled:opacity-50"
				>
					PROCEED →
				</button>
				<p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-black/60">
					Keyboard: [ENTER] proceed · [ESC] dismiss
				</p>
			</div>
		</ModalFrame>
	);
}

// ---------- Approval Modal --------------------------------------------------

function ApprovalModal(props: {
	busy: boolean;
	onApprove: () => Promise<void>;
	onReject: () => Promise<void>;
	onDismiss: () => void;
}) {
	const yesRef = useRef<HTMLButtonElement>(null);
	const [submitting, setSubmitting] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	const handleRef = useRef<(action: "approve" | "reject") => Promise<void>>(
		async () => {},
	);
	const submittingRef = useRef(false);

	const handle = async (action: "approve" | "reject") => {
		if (submittingRef.current) return;
		submittingRef.current = true;
		setSubmitting(true);
		setErrorMsg(null);
		try {
			if (action === "approve") await props.onApprove();
			else await props.onReject();
		} catch (err) {
			setErrorMsg((err as Error).message);
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	};

	handleRef.current = handle;

	useEffect(() => {
		yesRef.current?.focus();
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "y" || e.key === "Y") {
				e.preventDefault();
				void handleRef.current("approve");
			}
			if (e.key === "n" || e.key === "N") {
				e.preventDefault();
				void handleRef.current("reject");
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const disabled = props.busy || submitting;
	const stepIndex =
		STEPS.findIndex((s) => s.key === "wait-for-approval") + 1;

	return (
		<ModalFrame
			stepIndex={stepIndex}
			totalSteps={STEPS.length}
			headerLabel="APPROVAL"
			onDismiss={props.onDismiss}
		>
			<div className="p-8">
				<h2 className="text-4xl font-black uppercase leading-none tracking-tighter md:text-5xl">
					Human
					<br />
					Approval
					<br />
					Required.
				</h2>
				<p className="mt-6 max-w-md border-l-4 border-black pl-3 text-sm">
					The workflow is paused and waiting on you. Do you want to continue?
				</p>
				{errorMsg && (
					<p className="mt-4 border-2 border-black bg-[#FF0000] px-3 py-2 font-mono text-xs text-white">
						! {errorMsg}
					</p>
				)}
				{submitting && !errorMsg && (
					<p className="mt-4 border-2 border-black bg-[#F0DC5B] px-3 py-2 font-mono text-xs">
						Sending...
					</p>
				)}
				<div className="mt-8 grid grid-cols-2 gap-0 border-4 border-black">
					<button
						ref={yesRef}
						type="button"
						onClick={() => handle("approve")}
						disabled={disabled}
						className="cursor-pointer border-r-4 border-black bg-[#00FF66] px-6 py-5 text-2xl font-black uppercase text-black hover:bg-black hover:text-[#00FF66] disabled:cursor-not-allowed disabled:opacity-50"
					>
						YES →
					</button>
					<button
						type="button"
						onClick={() => handle("reject")}
						disabled={disabled}
						className="cursor-pointer bg-[#FF0000] px-6 py-5 text-2xl font-black uppercase text-white hover:bg-black hover:text-[#FF0000] disabled:cursor-not-allowed disabled:opacity-50"
					>
						NO ✕
					</button>
				</div>
				<p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-black/60">
					Keyboard: [Y] approve · [N] reject · [ESC] close
				</p>
			</div>
		</ModalFrame>
	);
}

// ---------- Send Event Modal ------------------------------------------------

function SendEventModal(props: {
	busy: boolean;
	onSend: () => Promise<void>;
	onDismiss: () => void;
}) {
	const sendRef = useRef<HTMLButtonElement>(null);
	const [submitting, setSubmitting] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const submittingRef = useRef(false);
	const handleRef = useRef<() => Promise<void>>(async () => {});

	const handle = async () => {
		if (submittingRef.current) return;
		submittingRef.current = true;
		setSubmitting(true);
		setErrorMsg(null);
		try {
			await props.onSend();
		} catch (err) {
			setErrorMsg((err as Error).message);
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	};

	handleRef.current = handle;

	useEffect(() => {
		sendRef.current?.focus();
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void handleRef.current();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const disabled = props.busy || submitting;
	const stepIndex =
		STEPS.findIndex((s) => s.key === "wait-for-custom-event") + 1;

	return (
		<ModalFrame
			stepIndex={stepIndex}
			totalSteps={STEPS.length}
			headerLabel="EVENT"
			onDismiss={props.onDismiss}
		>
			<div className="p-8">
				<span className="inline-block border-2 border-black bg-[#F0DC5B] px-2 py-0.5 font-mono text-[11px] font-black uppercase tracking-wider text-black">
					step.waitForEvent
				</span>
				<h2 className="mt-4 text-4xl font-black uppercase leading-none tracking-tighter md:text-5xl">
					Waiting
					<br />
					for an
					<br />
					event.
				</h2>
				<p className="mt-6 max-w-md border-l-4 border-black pl-3 text-sm">
					The workflow is paused on a step.waitForEvent. It will resume the
					moment a matching event arrives. Click below to fire one.
				</p>

				<div className="mt-6 border-4 border-black bg-black p-4">
					<p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#F0DC5B]">
						// what this button does
					</p>
					<pre className="overflow-x-auto font-mono text-xs leading-relaxed text-[#F0DC5B]">
						{`await instance.sendEvent({
  type: "user-custom-event",
  payload: { sentAt: new Date().toISOString() },
});`}
					</pre>
				</div>

				{errorMsg && (
					<p className="mt-4 border-2 border-black bg-[#FF0000] px-3 py-2 font-mono text-xs text-white">
						! {errorMsg}
					</p>
				)}
				{submitting && !errorMsg && (
					<p className="mt-4 border-2 border-black bg-[#F0DC5B] px-3 py-2 font-mono text-xs">
						Sending...
					</p>
				)}

				<button
					ref={sendRef}
					type="button"
					onClick={handle}
					disabled={disabled}
					className="mt-6 w-full cursor-pointer border-4 border-black bg-[#0000FF] px-6 py-5 text-2xl font-black uppercase text-white hover:bg-black hover:text-[#0000FF] disabled:cursor-not-allowed disabled:opacity-50"
				>
					SEND EVENT →
				</button>
				<p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-black/60">
					Keyboard: [ENTER] send · [ESC] dismiss
				</p>
			</div>
		</ModalFrame>
	);
}

// ---------- Rollback Decision Modal -----------------------------------------

function RollbackDecisionModal(props: {
	busy: boolean;
	onTriggerFailure: () => Promise<void>;
	onCompleteNormally: () => Promise<void>;
	onDismiss: () => void;
}) {
	const failRef = useRef<HTMLButtonElement>(null);
	const [submitting, setSubmitting] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const submittingRef = useRef(false);
	const handleRef = useRef<(choice: "fail" | "complete") => Promise<void>>(
		async () => {},
	);

	const handle = async (choice: "fail" | "complete") => {
		if (submittingRef.current) return;
		submittingRef.current = true;
		setSubmitting(true);
		setErrorMsg(null);
		try {
			if (choice === "fail") await props.onTriggerFailure();
			else await props.onCompleteNormally();
		} catch (err) {
			setErrorMsg((err as Error).message);
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	};

	handleRef.current = handle;

	useEffect(() => {
		failRef.current?.focus();
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "f" || e.key === "F") {
				e.preventDefault();
				void handleRef.current("fail");
			}
			if (e.key === "c" || e.key === "C") {
				e.preventDefault();
				void handleRef.current("complete");
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const disabled = props.busy || submitting;
	const stepIndex = STEPS.findIndex((s) => s.key === "trigger-failure") + 1;

	return (
		<ModalFrame
			stepIndex={stepIndex}
			totalSteps={STEPS.length}
			headerLabel="ROLLBACK"
			onDismiss={props.onDismiss}
		>
			<div className="p-8">
				<span className="inline-block border-2 border-black bg-[#9D00FF] px-2 py-0.5 font-mono text-[11px] font-black uppercase tracking-wider text-white">
					step.do · rollback
				</span>
				<h2 className="mt-4 text-4xl font-black uppercase leading-none tracking-tighter md:text-5xl">
					Trigger
					<br />
					a saga
					<br />
					rollback?
				</h2>
				<p className="mt-6 max-w-md border-l-4 border-black pl-3 text-sm">
					Fail the instance and Workflows runs every step's rollback handler
					in reverse order: finalize → unreliable → process-approval →
					initialize. Or complete normally and keep the result.
				</p>

				{errorMsg && (
					<p className="mt-4 border-2 border-black bg-[#FF0000] px-3 py-2 font-mono text-xs text-white">
						! {errorMsg}
					</p>
				)}
				{submitting && !errorMsg && (
					<p className="mt-4 border-2 border-black bg-[#F0DC5B] px-3 py-2 font-mono text-xs">
						Sending...
					</p>
				)}

				<div className="mt-8 grid grid-cols-2 gap-0 border-4 border-black">
					<button
						ref={failRef}
						type="button"
						onClick={() => handle("fail")}
						disabled={disabled}
						className="cursor-pointer border-r-4 border-black bg-[#9D00FF] px-6 py-5 text-xl font-black uppercase text-white hover:bg-black hover:text-[#9D00FF] disabled:cursor-not-allowed disabled:opacity-50"
					>
						TRIGGER FAILURE ↩
					</button>
					<button
						type="button"
						onClick={() => handle("complete")}
						disabled={disabled}
						className="cursor-pointer bg-[#00FF66] px-6 py-5 text-xl font-black uppercase text-black hover:bg-black hover:text-[#00FF66] disabled:cursor-not-allowed disabled:opacity-50"
					>
						COMPLETE →
					</button>
				</div>
				<p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-black/60">
					Keyboard: [F] trigger failure · [C] complete · [ESC] close
				</p>
			</div>
		</ModalFrame>
	);
}
