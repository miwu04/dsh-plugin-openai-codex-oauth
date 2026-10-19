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

		// Both built-in locales carry the same key set; the locale runtime
		// rejects a registration that misses one. Placeholders use {name}.
		const copy = {
			en: {
				"button.signIn": "ChatGPT sign-in",
				"button.title": "Sign in with ChatGPT",
				"action.open": "Open sign-in page",
				"action.close": "Close",
				"action.cancel": "Cancel",
				"action.continue": "Continue",
				"prompt.choose": "Choose an option",
				"prompt.method": "Select sign-in method",
				"prompt.method.browser": "Browser login",
				"prompt.method.deviceCode": "Device code login",
				"prompt.redirectUrl": "Complete sign-in in your browser, or paste the final redirect URL here:",
				"notice.waiting": "Waiting for ChatGPT sign-in…",
				"notice.deviceCode": "Enter this code on the verification page: {code}",
				"notice.browser": "Complete sign-in in the browser window that opened.",
				"result.success": "ChatGPT account connected.",
				"result.cancelled": "Sign-in was cancelled.",
				"error.failed": "Sign-in failed. Check the DSH host logs and try again.",
				"error.busy": "Another ChatGPT sign-in is already in progress.",
				"error.namespace": "The sign-in service did not start. Reload the page and try again.",
				"error.unavailable": "The sign-in service is unavailable on this host.",
				"error.cancelled": "The sign-in was cancelled before it finished.",
				"error.detail": "Details"
			},
			zh: {
				"button.signIn": "ChatGPT 登录",
				"button.title": "使用 ChatGPT 登录",
				"action.open": "打开登录页面",
				"action.close": "关闭",
				"action.cancel": "取消",
				"action.continue": "继续",
				"prompt.choose": "请选择",
				"prompt.method": "选择登录方式",
				"prompt.method.browser": "浏览器登录",
				"prompt.method.deviceCode": "设备码登录",
				"prompt.redirectUrl": "请在浏览器中完成登录，或在此粘贴最终的跳转 URL：",
				"notice.waiting": "正在等待 ChatGPT 登录…",
				"notice.deviceCode": "请在验证页面输入此代码：{code}",
				"notice.browser": "请在打开的浏览器窗口中完成登录。",
				"result.success": "ChatGPT 账号已连接。",
				"result.cancelled": "登录已取消。",
				"error.failed": "登录失败。请检查 DSH Host 日志后重试。",
				"error.busy": "已有一个 ChatGPT 登录正在进行中。",
				"error.namespace": "登录服务未能启动。请刷新页面后重试。",
				"error.unavailable": "当前 Host 上登录服务不可用。",
				"error.cancelled": "登录在完成前已被取消。",
				"error.detail": "详情"
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

		/** Stable failure codes the dialog localizes; anything else is a detail. */
		const errorKey = (code) =>
			code === "busy"
				? "error.busy"
				: code === "namespace"
					? "error.namespace"
					: code === "unavailable"
						? "error.unavailable"
						: code === "cancelled"
							? "error.cancelled"
							: "error.failed";

		// pi-ai's Codex flow asks fixed English questions. Match the ones whose
		// answer shape is known so the dialog can stay in the active locale;
		// anything unrecognized keeps the Host's own wording.
		const KNOWN_PROMPTS = {
			"Complete login in your browser, or paste the final redirect URL here:": "prompt.redirectUrl"
		};
		const promptLabel = (t, prompt) => {
			const question = prompt?.prompt;
			const options = Array.isArray(question?.options) ? question.options : [];
			if (question?.kind === "select" && options.some((option) => option.id === "device_code")) {
				return t("prompt.method");
			}
			if (typeof question?.message === "string" && Object.hasOwn(KNOWN_PROMPTS, question.message)) {
				return t(KNOWN_PROMPTS[question.message]);
			}
			return text(question?.message, t("action.continue"));
		};
		const optionLabel = (t, option) =>
			option.id === "browser"
				? t("prompt.method.browser")
				: option.id === "device_code"
					? t("prompt.method.deviceCode")
					: option.label;

		/** Map a thrown value onto a localization code, keeping its message as detail. */
		const failureOf = (error) => ({
			code:
				error !== null && typeof error === "object" && typeof error.code === "string"
					? error.code === "gateway/invocation-unavailable" || error.code === "gateway/service-unavailable"
						? "unavailable"
						: error.code === "gateway/cancelled"
							? "cancelled"
							: error.code
					: "failed",
			detail: error instanceof Error ? error.message : String(error)
		});

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

			const fail = (failure) => setState({ phase: "failed", code: failure.code, detail: failure.detail });

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
					fail(failureOf(error));
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
							fail({ code: frame.code ?? "failed", detail: frame.message });
						}
					}
				} catch (error) {
					console.error("[openai-codex-oauth] the sign-in stream failed", error);
					handleRef.current = undefined;
					abortRef.current = undefined;
					fail(failureOf(error));
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
					fail(failureOf(error));
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
					? t(errorKey(state.code))
					: state.phase === "done"
						? state.status === "authorized"
							? t("result.success")
							: t("result.cancelled")
						: notice?.code !== undefined
							? t("notice.deviceCode", { code: String(notice.code) })
							: url !== undefined
								? t("notice.browser")
								: t("notice.waiting");

			const detail =
				state.phase === "failed" && typeof state.detail === "string" && state.detail.length > 0 && state.detail !== noticeText
					? state.detail
					: undefined;

			const working = state.phase === "working";
			const closable = !working;
			const footer =
				working || prompt !== undefined
					? [
							h(Button, { key: "cancel", variant: "outline", size: "sm", onClick: cancel }, t("action.cancel")),
							...(prompt === undefined
								? []
								: [
										h(
											Button,
											{
												key: "continue",
												variant: "outline",
												size: "sm",
												disabled: (state.answer ?? "").length === 0,
												onClick: submit
											},
											t("action.continue")
										)
									])
						]
					: [h(Button, { key: "close", variant: "outline", size: "sm", onClick: finish }, t("action.close"))];

			return h(
				Fragment,
				null,
				h(
					"span",
					{ ref: measure, style: { display: "inline-flex" } },
					h(Button, { variant: "outline", size: "sm", onClick: () => void start() }, t("button.signIn"))
				),
				h(
					Modal,
					{
						open: state.phase !== "idle",
						onClose: closable ? finish : cancel,
						title: t("button.title"),
						closeLabel: t("action.close"),
						footer: footer
					},
					h("p", { style: messageStyle, role: "status" }, noticeText),
					url === undefined ? null : h("a", { href: url, target: "_blank", rel: "noopener noreferrer", style: linkStyle }, t("action.open")),
					detail === undefined
						? null
						: h(
								"div",
								{ style: { display: "grid", gap: 4 } },
								h("span", { style: fieldLabelStyle }, t("error.detail")),
								h("pre", { style: detailStyle }, detail)
							),
					prompt === undefined
						? null
						: h(
								"div",
								{ style: { display: "grid", gap: 8, marginTop: 4 } },
								h("span", { style: fieldLabelStyle }, promptLabel(t, prompt)),
								selecting
									? h(
											"select",
											{
												value: state.answer ?? "",
												onChange: (event) => setState((current) => ({ ...current, answer: event.target.value })),
												style: inputStyle
											},
											h("option", { value: "", disabled: true }, t("prompt.choose")),
											...options.map((option) => h("option", { key: option.id, value: option.id }, optionLabel(t, option)))
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
		const detailStyle = {
			margin: 0,
			padding: "8px 10px",
			maxHeight: 120,
			overflow: "auto",
			borderRadius: "var(--dsw-radius-md, 8px)",
			background: "var(--dsw-alias-bg-module-platform, #f5f5f5)",
			color: "var(--dsw-alias-label-tertiary, #666)",
			fontFamily: "var(--ds-font-family-code, monospace)",
			fontSize: 12,
			lineHeight: "18px",
			whiteSpace: "pre-wrap",
			wordBreak: "break-word"
		};
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
				if (namespace === undefined) {
					const error = new Error("the openaiCodexOAuth Remote namespace did not mount");
					error.code = "namespace";
					throw error;
				}
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
