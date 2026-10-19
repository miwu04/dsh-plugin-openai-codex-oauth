import { Service } from "@deepseek-ai/cordis";
import { bindTypertRemote, Remote, isRemoteJsonValue } from "@deepseek-ai/dsh-typert-protocol";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

const DEFAULT_PROVIDER_ID = "openai-codex";

// Plugin-level injection: the loader starts this plugin only after both
// services exist, and the entry itself also declares them.
export const inject = ["authorization", "credentials"];

/**
 * Read one required service without tripping Cordis's inject guard. Property
 * access on a context outside its inject list throws; ctx.get does not.
 * @param ctx - context holding the service.
 * @param name - Cordis service key.
 * @returns the service, or undefined when it is unavailable.
 */
function serviceOf(ctx, name) {
  const registered = ctx.get(name);
  if (registered !== undefined) return registered;
  try {
    return ctx[name];
  } catch {
    return undefined;
  }
}

function toPiCredential(record) {
  if (!record) return undefined;
  if (record.kind === "grant") return record.payload;
  return {
    type: "api_key",
    ...(record.key === undefined ? {} : { key: record.key }),
    ...(record.env === undefined ? {} : { env: { ...record.env } }),
  };
}

function toDshRecord(credential) {
  if (credential.type === "api_key") {
    return {
      kind: "api-key",
      ...(credential.key === undefined ? {} : { key: credential.key }),
      ...(credential.env === undefined ? {} : { env: { ...credential.env } }),
    };
  }
  // pi-ai OAuth credentials are JSON-shaped. Round-trip them before handing
  // them to DSH's strict JSON credential-record validator.
  return { kind: "grant", payload: JSON.parse(JSON.stringify(credential)) };
}

const noticeFrame = (notice) => ({
  type: "notice",
  notice: {
    message: typeof notice?.message === "string" ? notice.message : "",
    ...(typeof notice?.url === "string" ? { url: notice.url } : {}),
    ...(typeof notice?.code === "string" ? { code: notice.code } : {}),
  },
});

const promptFrame = (prompt) => ({
  type: "prompt",
  id: prompt.id,
  prompt: {
    kind: prompt.kind,
    message: prompt.message,
    ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
    ...(prompt.kind === "select" ? { options: prompt.options ?? [] } : {}),
  },
});

/**
 * Register pi-ai's Codex OAuth login as a DSH authorization flow, and expose
 * that flow to the Web client as one bidirectional Remote stream. The flow
 * itself starts only when a surface calls ctx.authorization.begin() for its
 * key; the stream merely relays notices and prompts for a calling surface.
 */
export class OpenAICodexOAuthPlugin extends Service {
  static inject = ["authorization", "credentials"];

  constructor(ctx, config = {}) {
    super(ctx, "openaiCodexOAuth");
    this.typertRemote = bindTypertRemote(this, this.name);
    this.activeAttempt = undefined;
    this.config = {
      providerId: config.providerId ?? DEFAULT_PROVIDER_ID,
      recordScope: config.recordScope ?? "llm-pi-ai",
    };
  }

  async *[Service.init]() {
    const { providerId, recordScope } = this.config;
    const key = credentialKey(recordScope, providerId);
    const provider = builtinModels().getProvider(providerId);
    if (!provider) throw new Error("openai-codex-oauth: missing pi-ai provider " + providerId);
    if (!provider.auth.oauth?.login) throw new Error("openai-codex-oauth: no OAuth login for " + providerId);
    if (recordScope !== "llm-pi-ai") throw new Error("openai-codex-oauth currently writes pi-ai records, so recordScope must be llm-pi-ai");

    const ctx = this.ctx;
    const authorization = serviceOf(ctx, "authorization");
    const credentialsService = serviceOf(ctx, "credentials");
    if (authorization === undefined || credentialsService === undefined) {
      throw new Error("openai-codex-oauth: authorization and credentials services are required");
    }

    // dsh-llm-pi-ai registers a flow for every installed pi-ai provider as soon
    // as it mounts, so this key is normally already present. Registering ours
    // would throw; in that case the plugin's only contribution is the UI.
    if (authorization.describe(key) !== undefined) {
      yield () => {};
      return;
    }

    const unregister = authorization.registerFlow({
      key,
      label: provider.auth.oauth.name ?? "ChatGPT (Codex)",
      methods: [{ id: "oauth", label: provider.auth.oauth.loginLabel ?? "Sign in with ChatGPT" }],
      async run(session) {
        if (session.method !== "oauth") throw new Error("Unsupported authorization method: " + session.method);

        // This store adapter gives pi-ai its expected credential store while
        // DSH remains the sole durable writer. Refresh writes are serialized by
        // DSH modifyRecord, including cross-process locking where supported.
        const credentials = {
          async read(id, options) {
            options?.signal?.throwIfAborted();
            return toPiCredential(await credentialsService.readRecord(credentialKey(recordScope, id)));
          },
          async list(options) {
            options?.signal?.throwIfAborted();
            const records = await credentialsService.listRecords();
            return records.flatMap((entry) => {
              if (entry.key !== key) return [];
              return [{ providerId, type: entry.kind === "api-key" ? "api_key" : "oauth" }];
            });
          },
          async modify(id, mutate, options) {
            let result;
            await credentialsService.modifyRecord(credentialKey(recordScope, id), async (current) => {
              options?.signal?.throwIfAborted();
              result = await mutate(toPiCredential(current));
              return result === undefined ? undefined : toDshRecord(result);
            });
            return result;
          },
          async delete(id, options) {
            options?.signal?.throwIfAborted();
            await credentialsService.deleteRecord(credentialKey(recordScope, id));
          },
        };

        const models = builtinModels({ credentials });
        await models.login(providerId, "oauth", {
          signal: session.signal,
          notify(event) {
            const link = event.links?.[0];
            if (event.type === "auth_url") {
              session.notify({ message: event.instructions ?? "Complete sign-in in your browser.", url: event.url });
            } else if (event.type === "device_code") {
              session.notify({ message: "Enter the device code on the verification page.", url: event.verificationUri, code: event.userCode });
            } else if (event.type === "info") {
              session.notify({ message: event.message, ...(link === undefined ? {} : { url: link.url }) });
            } else {
              session.notify({ message: event.message ?? "Signing in…" });
            }
          },
          async prompt(prompt) {
            const signal = prompt.signal === undefined ? {} : { signal: prompt.signal };
            if (prompt.type === "select") return session.prompt({
              ...signal,
              kind: "select",
              message: prompt.message,
              options: prompt.options,
            });
            return session.prompt({
              ...signal,
              kind: prompt.type === "secret" ? "secret" : "text",
              message: prompt.message,
              ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
            });
          },
        });
      },
    });
    yield () => unregister();
  }

  /**
   * Run one ChatGPT sign-in for the calling Remote stream. Each yielded frame
   * is one interaction event; the client answers prompts with uplink items.
   * Only one attempt runs at a time, and the stream's disposal cancels it.
   * @param signal - Remote stream cancellation, including a Client disconnect.
   */
  async *remoteBegin(signal) {
    const { providerId, recordScope } = this.config;
    const key = credentialKey(recordScope, providerId);
    if (this.activeAttempt !== undefined) {
      yield { type: "error", message: "Another ChatGPT sign-in is already in progress." };
      return;
    }

    const invocation = this.ctx.invocation;
    const uplink = invocation === undefined ? undefined : invocation.uplink();
    const local = new AbortController();
    const abort = () => local.abort(signal?.reason ?? new Error("The sign-in request was cancelled."));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });

    const prompts = new Map();
    const output = [];
    let wake;
    let closed = false;
    let nextPromptId = 0;
    const publish = (frame) => {
      if (closed || !isRemoteJsonValue(frame)) return;
      output.push(frame);
      wake?.();
      wake = undefined;
    };

    const interaction = {
      notify: (notice) => publish(noticeFrame(notice)),
      prompt: (question) => new Promise((resolve, reject) => {
        const id = String(++nextPromptId);
        const questionSignal = question.signal;
        const cleanup = () => questionSignal?.removeEventListener("abort", onAbort);
        const onAbort = () => {
          if (!prompts.delete(id)) return;
          cleanup();
          reject(questionSignal.reason ?? new Error("The prompt was withdrawn."));
        };
        prompts.set(id, {
          resolve: (value) => { cleanup(); resolve(value); },
          reject: (error) => { cleanup(); reject(error); },
        });
        questionSignal?.addEventListener("abort", onAbort, { once: true });
        publish(promptFrame({ ...question, id }));
      }),
    };

    const reader = uplink === undefined ? undefined : (async () => {
      try {
        for await (const item of uplink) {
          if (item === null || typeof item !== "object") continue;
          if (item.type === "cancel") { abort(); continue; }
          if (item.type !== "answer" || typeof item.id !== "string" || typeof item.value !== "string") continue;
          const waiter = prompts.get(item.id);
          if (waiter === undefined) continue;
          prompts.delete(item.id);
          waiter.resolve(item.value);
        }
      } catch {
        // The uplink ends with its stream; the pump still settles the attempt.
      }
    })();

    const settleWaiters = (error) => {
      for (const waiter of prompts.values()) waiter.reject(error);
      prompts.clear();
    };

    this.activeAttempt = { abort: () => local.abort(new Error("Replaced by a newer sign-in.")) };
    const pump = (async () => {
      try {
        const authorization = serviceOf(this.ctx, "authorization");
        if (authorization === undefined) throw new Error("openai-codex-oauth: the authorization service is unavailable");
        const outcome = await authorization.begin({ key, method: "oauth", signal: local.signal, interaction });
        publish({ type: "result", status: outcome.status });
      } catch (error) {
        publish({ type: "error", message: error instanceof Error ? error.message : "The ChatGPT sign-in failed." });
      } finally {
        closed = true;
        settleWaiters(local.signal.reason instanceof Error ? local.signal.reason : new Error("The sign-in attempt ended."));
        wake?.();
        wake = undefined;
      }
    })();

    try {
      while (!closed || output.length > 0) {
        if (output.length > 0) yield output.shift();
        else await new Promise((resolve) => { wake = resolve; });
      }
    } finally {
      closed = true;
      signal?.removeEventListener("abort", abort);
      if (!local.signal.aborted) local.abort(new Error("The sign-in stream closed."));
      settleWaiters(local.signal.reason instanceof Error ? local.signal.reason : new Error("The sign-in stream closed."));
      wake?.();
      wake = undefined;
      serviceOf(this.ctx, "authorization")?.cancel(key);
      this.activeAttempt = undefined;
      // The uplink reader stays unawaited: the carrier closes the uplink once
      // this method returns, which is what ends its iteration. Awaiting it here
      // would wait on the very close that waits on this return.
      await pump.catch(() => {});
      void reader;
    }
  }
}

/**
 * Apply protocol Remote markers without decorator syntax. The initializer runs
 * with the owning prototype as 'this', which is what the protocol reads.
 * @param target - class prototype receiving the marker.
 * @param name - public instance method name.
 * @param options - optional Remote options, for example { mode: "stream" }.
 */
function markRemote(target, name, options) {
  const holder = Object.create(target);
  const context = {
    kind: "method",
    name,
    static: false,
    private: false,
    addInitializer(initializer) { initializer.call(holder); },
  };
  const method = target[name];
  if (options === undefined) Remote(method, context);
  else Remote(options)(method, context);
}

markRemote(OpenAICodexOAuthPlugin.prototype, "remoteBegin", { mode: "stream" });

export function apply(ctx, config = {}) {
  return new OpenAICodexOAuthPlugin(ctx, config);
}

export default apply;
