import assert from "node:assert/strict";
import { Context, Service } from "@deepseek-ai/cordis";
import { AuthorizationService } from "@deepseek-ai/dsh-authorization";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import plugin from "./index.js";

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

function createCredentials() {
  const records = new Map();
  return {
    records,
    store: {
      async readRecord(key) { return records.get(String(key)); },
      async listRecords() { return [...records].map(([key, record]) => ({ key, kind: record.kind })); },
      async modifyRecord(key, mutate) {
        const next = await mutate(records.get(String(key)));
        if (next !== undefined) records.set(String(key), next);
        return records.get(String(key));
      },
      async deleteRecord(key) { records.delete(String(key)); },
    },
  };
}

function createUplink() {
  const items = [];
  let notify;
  let ended = false;
  return {
    push(item) { items.push(item); notify?.(); notify = undefined; },
    end() { ended = true; notify?.(); notify = undefined; },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (items.length > 0) yield items.shift();
        if (ended) return;
        await new Promise((resolve) => { notify = resolve; });
      }
    },
  };
}

async function startPlugin() {
  const ctx = new Context();
  const credentials = createCredentials();
  ctx.credentials = credentials.store;
  ctx.authorization = new AuthorizationService(ctx);
  const instance = plugin(ctx);
  const lifecycle = instance[Service.init]();
  const cleanup = await lifecycle.next();
  return { ctx, instance, cleanup };
}

// 1. Flow registration, device-code relay, cancellation, and unregistration.
{
  const { ctx, cleanup } = await startPlugin();
  const key = credentialKey("llm-pi-ai", "openai-codex");
  assert.equal(ctx.authorization.describe(key)?.methods[0]?.label, "Sign in with ChatGPT");
  assert.equal(ctx.authorization.describe(key)?.inFlight, false);

  const notices = [];
  const abort = new AbortController();
  const running = ctx.authorization.begin({
    key,
    method: "oauth",
    signal: abort.signal,
    interaction: {
      notify(notice) { notices.push(notice); },
      async prompt(prompt) {
        if (prompt.kind === "select") return "device_code";
        throw new Error("Unexpected prompt kind in test: " + prompt.kind);
      },
    },
  });

  // The device-code request is a real network round trip; allow for latency.
  for (let i = 0; i < 500 && !notices.some((notice) => typeof notice.code === "string"); i++) await tick();
  assert.ok(notices.some((notice) => typeof notice.code === "string"), "expected a device-code notice");
  assert.equal(ctx.authorization.describe(key)?.inFlight, true);
  abort.abort(new Error("test finished"));
  const result = await running;
  assert.equal(result.status, "cancelled");
  assert.equal(ctx.authorization.describe(key)?.inFlight, false);
  await cleanup.value();
  assert.equal(ctx.authorization.describe(key), undefined);
}

// 2. The Remote marker declares exactly one stream method.
{
  const { instance, cleanup } = await startPlugin();
  assert.deepEqual(
    remoteMethods(instance).map((marker) => [marker.method, marker.mode]),
    [["remoteBegin", "stream"]],
  );
  await cleanup.value();
}

// 3. The Remote stream relays notices and prompts, accepts an uplink answer,
//    and settles as cancelled when its caller cancels.
{
  const { ctx, instance, cleanup } = await startPlugin();
  const key = credentialKey("llm-pi-ai", "openai-codex");
  const abort = new AbortController();
  const uplink = createUplink();
  const invocation = { signal: abort.signal, uplink: () => uplink };

  const callCtx = ctx.extend({ invocation });
  const frames = [];
  const consumer = (async () => {
    for await (const frame of callCtx.openaiCodexOAuth.remoteBegin(abort.signal)) {
      frames.push(frame);
      if (frame.type === "prompt") {
        assert.equal(frame.prompt.kind, "select");
        uplink.push({ type: "answer", id: frame.id, value: "device_code" });
      }
    }
  })();

  for (let i = 0; i < 100 && !frames.some((frame) => frame.type === "notice"); i++) await tick();
  assert.ok(frames.some((frame) => frame.type === "notice"), "expected a relayed notice");
  assert.ok(frames.some((frame) => frame.type === "prompt"), "expected the select prompt");

  abort.abort(new Error("test finished"));
  await consumer;
  uplink.end();

  const terminal = frames.at(-1);
  assert.equal(terminal.type, "result");
  assert.equal(terminal.status, "cancelled");
  assert.equal(ctx.authorization.describe(key)?.inFlight, false);
  await cleanup.value();
}

console.log("ok - registers flow, relays device code, cancels cleanly, unregisters");
console.log("ok - Remote marker declares one stream method");
console.log("ok - Remote stream relays notices/prompts, accepts uplink answers, cancels");
