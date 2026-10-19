window.__ModuleLoader__.load({
	id: "dsh-plugin-openai-codex-oauth",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const { Button, Modal } = require("@deepseek-ai/dsh-client-ui-primitives");
		const { createElement: h, Fragment, useEffect, useRef, useState } = React;

		const NS = "openai-codex-oauth";
		const PACKAGE = "dsh-plugin-openai-codex-oauth";
		const copy = {
			en: {
				short: "ChatGPT sign-in",
				button: "Sign in with ChatGPT",
				working: "Waiting for ChatGPT sign-in…",
				open: "Open sign-in page",
				close: "Close",
				cancel: "Cancel",
				failed: "Sign-in failed. Check the DSH host logs and try again.",
				choose: "Choose an option",
				continue: "Continue",
				cancelled: "Sign-in was cancelled.",
				success: "ChatGPT account connected."
			},
			zh: {
				short: "ChatGPT 登录",
				button: "使用 ChatGPT 登录",
				working: "正在等待 ChatGPT 登录…",
				open: "打开登录页面",
				close: "关闭",
				cancel: "取消",
				failed: "登录失败。请检查 DSH Host 日志后重试。",
				choose: "请选择",
				continue: "继续",
				cancelled: "登录已取消。",
				success: "ChatGPT 账号已连接。"
			}
		};

		/** A permissive strict codec: the Host is the only writer of these frames. */
		const codec = (typeSymbol) => ({
			mode: "strict",
			typeSymbol,
			create: () => ({ parse: (value) => value })
		});

		/**
		 * Client half of the generated Remote contract for this package. The
		 * descriptors mirror the Host `remoteBegin` stream method; the Gateway
		 * resolves the live Host method by namespace and endpoint at call time.
		 */
		const CONTRIBUTION = {
			package: PACKAGE,
			descriptors: [
				{
					id: `${PACKAGE}#openaiCodexOAuth/remoteBegin`,
					service: "openaiCodexOAuth",
					namespace: "openaiCodexOAuth",
					method: "remoteBegin",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [],
					cancellation: { parameter: "signal" },
					uplink: { codec: codec(`${PACKAGE}#openaiCodexOAuth/remoteBegin:uplink`) },
					result: { mode: "src-json" }
				}
			]
		};

		const safeUrl = (value) => (typeof value === "string" && /^https:\/\//i.test(value) ? value : undefined);
		const text = (value, fallback) => (typeof value === "string" && value.trim().length > 0 ? value : fallback);

		/**
		 * The control belongs to one provider card. It sits immediately left of
		 * that card's own Edit button and uses the page's Button primitive with
		 * its small outline variant, so it reads as another card action.
		 */
		function SignIn({ provider, configured, t, signIn }) {
			const [state, setState] = useState({ phase: "idle" });
			const handleRef = useRef(undefined);
			const abortRef = useRef(undefined);

			useEffect(
				() => () => {
					handleRef.current?.dispose();
					abortRef.current?.abort();
				},
				[]
			);

			// Place the control immediately left of the card's own action group.
			// This writes inline styles instead of component state: setting state
			// from a ref callback re-runs every render and loops.
			const measure = (element) => {
				if (element === null || element === undefined) return;
				// Walk out to the provider card: the slot may wrap the component.
				let card = element.parentElement;
				while (card !== null && card !== undefined && !/rowCard/.test(String(card.className ?? ""))) {
					card = card.parentElement;
				}
				if (card === null || card === undefined || typeof card.querySelector !== "function") return;
				const actions = card.querySelector('[class*="rowActions"]');
				if (actions === null) return;
				if (typeof getComputedStyle === "function" && getComputedStyle(card).position === "static") {
					card.style.position = "relative";
				}
				const cardBox = card.getBoundingClientRect();
				const actionsBox = actions.getBoundingClientRect();
				if (cardBox.width === 0 || actionsBox.width === 0) return;
				const top = actionsBox.top - cardBox.top + (actionsBox.height - 28) / 2;
				const right = cardBox.right - actionsBox.left + 4;
				if (!Number.isFinite(top) || !Number.isFinite(right) || right < 0) return;
				element.style.position = "absolute";
				element.style.top = String(top) + "px";
				element.style.right = String(right) + "px";
				// Safety net: if the measured anchor would put the control outside
				// the card, fall back to the in-flow row so it stays visible.
				const placed = element.getBoundingClientRect();
				const inside =
					placed.width > 0 &&
					placed.left >= cardBox.left - 1 &&
					placed.right <= cardBox.right + 1 &&
					placed.top >= cardBox.top - 1 &&
					placed.bottom <= cardBox.bottom + 1;
				if (!inside) {
					element.style.position = "";
					element.style.top = "";
					element.style.right = "";
				}
			};

			const start = async () => {
				const controller = new AbortController();
				abortRef.current = controller;
				setState({ phase: "working", notice: undefined, prompt: undefined, answer: "" });
				let handle;
				try {
					handle = await signIn(controller.signal);
				} catch (error) {
					abortRef.current = undefined;
					console.error("[openai-codex-oauth] opening the sign-in stream failed", error);
					setState({ phase: "failed", message: error instanceof Error ? error.message : String(error) });
					return;
				}
				handleRef.current = handle;
				try {
					for await (const frame of handle) {
						if (frame === null || typeof frame !== "object") continue;
						if (frame.type === "notice") {
							setState((current) => (current.phase === "working" ? { ...current, notice: frame.notice } : current));
						} else if (frame.type === "prompt") {
							setState((current) => (current.phase === "working" ? { ...current, prompt: frame, answer: "" } : current));
						} else if (frame.type === "result") {
							handleRef.current = undefined;
							abortRef.current = undefined;
							setState({ phase: "done", status: frame.status });
						} else if (frame.type === "error") {
							handleRef.current = undefined;
							abortRef.current = undefined;
							setState({ phase: "failed", message: frame.message });
						}
					}
				} catch (error) {
					console.error("[openai-codex-oauth] the sign-in stream failed", error);
					handleRef.current = undefined;
					abortRef.current = undefined;
					setState({ phase: "failed", message: error instanceof Error ? error.message : String(error) });
				}
			};

			const submit = () => {
				const handle = handleRef.current;
				const prompt = state.prompt;
				if (handle === undefined || prompt === undefined) return;
				try {
					handle.send({ type: "answer", id: prompt.id, value: state.answer });
				} catch (error) {
					console.error("[openai-codex-oauth] answering the prompt failed", error);
					setState({ phase: "failed", message: error instanceof Error ? error.message : String(error) });
					return;
				}
				setState((current) => ({ ...current, prompt: undefined, answer: "" }));
			};

			const cancel = () => {
				handleRef.current?.dispose();
				handleRef.current = undefined;
				abortRef.current?.abort();
				abortRef.current = undefined;
				setState({ phase: "idle" });
			};

			const finish = () => setState({ phase: "idle" });

			if (provider === undefined || provider.provider !== "openai-codex" || configured !== true) return null;

			const notice = state.notice;
			const prompt = state.prompt;
			const url = state.phase === "working" ? safeUrl(notice?.url) : undefined;
			const options = Array.isArray(prompt?.prompt?.options) ? prompt.prompt.options : [];
			const selecting = prompt?.prompt?.kind === "select" && options.length > 0;
			const noticeText =
				state.phase === "failed"
					? t("failed")
					: state.phase === "done"
						? state.status === "authorized"
							? t("success")
							: t("cancelled")
						: notice?.code
							? [text(notice?.message, ""), String(notice.code)].filter(Boolean).join(" ")
							: text(notice?.message, t("working"));

			const working = state.phase === "working";
			const closable = !working;
			const footer = working || prompt !== undefined
				? [
						h(Button, { key: "cancel", variant: "outline", size: "sm", onClick: cancel }, t("cancel")),
						...(prompt === undefined
							? []
							: [h(Button, { key: "continue", variant: "outline", size: "sm", disabled: (state.answer ?? "").length === 0, onClick: submit }, t("continue"))])
					]
				: [h(Button, { key: "close", variant: "outline", size: "sm", onClick: finish }, t("close"))];

			return h(
				Fragment,
				null,
				h(
					"span",
					{ ref: measure, style: { display: "inline-flex" } },
					h(Button, { variant: "outline", size: "sm", onClick: () => void start() }, t("short"))
				),
				h(
					Modal,
					{
						open: state.phase !== "idle",
						onClose: closable ? finish : cancel,
						title: t("button"),
						closeLabel: t("close"),
						footer: footer
					},
					h("p", { style: messageStyle, role: "status" }, noticeText),
					url === undefined
						? null
						: h(
								"a",
								{ href: url, target: "_blank", rel: "noopener noreferrer", style: linkStyle },
								t("open")
							),
					state.phase === "failed" ? h("p", { role: "alert", style: errorStyle }, text(state.message, t("failed"))) : null,
					prompt === undefined
						? null
						: h(
								"div",
								{ style: { display: "grid", gap: 8, marginTop: 4 } },
								h("span", { style: fieldLabelStyle }, text(prompt.prompt?.message, t("continue"))),
								selecting
									? h(
											"select",
											{
												value: state.answer ?? "",
												onChange: (event) => setState((current) => ({ ...current, answer: event.target.value })),
												style: inputStyle
											},
											h("option", { value: "", disabled: true }, t("choose")),
											...options.map((option) => h("option", { key: option.id, value: option.id }, option.label))
										)
									: h("input", {
											type: prompt.prompt?.kind === "secret" ? "password" : "text",
											value: state.answer ?? "",
											placeholder: text(prompt.prompt?.placeholder, ""),
											onChange: (event) => setState((current) => ({ ...current, answer: event.target.value })),
											onKeyDown: (event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													submit();
												}
											},
											autoFocus: true,
											style: inputStyle
										})
							)
				)
			);
		}

		// Field metrics copied from the Models page's own editor inputs.
		const inputStyle = {
			boxSizing: "border-box",
			width: "100%",
			height: 32,
			padding: "0 10px",
			border: "0.5px solid var(--dsw-alias-border-l4, #c8c8c8)",
			borderRadius: "var(--dsw-radius-md, 8px)",
			background: "var(--dsw-alias-bg-layer-1, #fff)",
			color: "var(--dsw-alias-label-primary, #111)",
			font: "inherit",
			fontSize: 14,
			lineHeight: "22px"
		};
		const messageStyle = { margin: 0, fontSize: 14, lineHeight: "22px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" };
		const errorStyle = { ...messageStyle, color: "var(--dsw-alias-state-error-primary, #d33)" };
		const linkStyle = {
			color: "var(--dsw-alias-state-business-primary, #2563eb)",
			fontSize: 14,
			lineHeight: "22px",
			textDecoration: "none",
			alignSelf: "flex-start"
		};
		const fieldLabelStyle = { color: "var(--dsw-alias-label-secondary, #555)", fontSize: 12, lineHeight: "18px" };

		const inject = ["slots", "locale", "remote"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, copy), "codex-oauth: locale");
			let mounted;
			// A mounted namespace is a Cordis service keyed "remote.<namespace>".
			// Reading it as a property of ctx.remote trips the inject guard, so it
			// is fetched through ctx.get, which has no inject requirement.
			const namespaceOf = () =>
				typeof ctx.get === "function" ? ctx.get("remote.openaiCodexOAuth") : ctx.remote.openaiCodexOAuth;
			const signIn = async (signal) => {
				let namespace = namespaceOf();
				// A hot-reloaded bundle may run beside a namespace the previous
				// instance already mounted; reuse it instead of mounting twice.
				if (namespace === undefined) {
					mounted ??= ctx.remote.$mount(CONTRIBUTION).catch((error) => {
						mounted = undefined;
						throw error;
					});
					await mounted;
					namespace = namespaceOf();
				}
				if (namespace === undefined) throw new Error("the openaiCodexOAuth Remote namespace did not mount");
				return namespace.remoteBegin(signal);
			};
			// Provider-card extras are keyed by the row's settings namespace; every
			// pi-ai provider card dispatches here and the component filters to
			// openai-codex, so the control exists only while that provider does.
			ctx.slots.inject("settings.models.provider-card", () =>
				ctx.slots.register(
					{
						name: "settings.models.provider-card",
						key: "llm-pi-ai",
						locale: NS,
						inject: () => ({ signIn })
					},
					SignIn
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
