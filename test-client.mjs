import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
assert.equal(manifest.name, "dsh-plugin-openai-codex-oauth");
assert.equal(manifest.dsh?.client?.platform, "web", "dsh.client.platform must be a string");
assert.equal(typeof manifest.exports?.["./client"], "string", "exports['./client'] must resolve to the bundle");
await readFile(new URL(manifest.exports["./client"], import.meta.url), "utf8");

const source = await readFile(new URL("./client.js", import.meta.url), "utf8");

let registration;
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol("Fragment"),
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
};
const Button = (props) => ({ kind: "Button", props });
const Modal = (props) => ({ kind: "Modal", props });
const windowStub = { __ModuleLoader__: { load: (value) => { registration = value; } } };
new Function("window", source)(windowStub);

assert.equal(registration.id, "dsh-plugin-openai-codex-oauth", "the bundle registers the package id");
const mod = registration.factory((specifier) => {
  if (specifier === "react") return React;
  if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return { Button, Modal };
  throw new Error("the bundle must not require " + specifier);
});
assert.equal(typeof mod.apply, "function");
assert.deepEqual(mod.inject, ["slots", "locale", "remote"]);

let mounted;
let footer;
let beginCalls = 0;
const remoteBeginHandle = { dispose() {}, send() {}, async *[Symbol.asyncIterator]() {} };
// The namespace appears only once the mount completes, like the real one, and
// is reachable only through ctx.get("remote.<namespace>").
let namespace;
const remote = {
  $mount: async (contribution) => {
    mounted = contribution;
    namespace = {
      remoteBegin: () => {
        beginCalls += 1;
        return remoteBeginHandle;
      },
    };
    return async () => {};
  },
};
const ctx = {
  get: (key) => (key === "remote.openaiCodexOAuth" ? namespace : undefined),
  effect: (fn) => void fn(),
  locale: {
    register: (namespace, dictionary) => {
      assert.equal(namespace, "openai-codex-oauth");
      assert.ok(dictionary.en?.button && dictionary.zh?.button);
    },
  },
  slots: {
    inject: (name, register) => {
      assert.equal(name, "settings.models.provider-card");
      register();
    },
    register: (descriptor, component) => {
      footer = { descriptor, component };
      return () => {};
    },
  },
  remote,
};

mod.apply(ctx);

assert.equal(footer.descriptor.name, "settings.models.provider-card");
assert.equal(footer.descriptor.key, "llm-pi-ai");
assert.equal(footer.descriptor.locale, "openai-codex-oauth");
assert.equal(typeof footer.descriptor.inject, "function");
assert.equal(typeof footer.component, "function");

// The control exists only for a configured openai-codex row.
const t = (key) => key;
const render = (provider, configured) => footer.component({ provider, configured, t, signIn: async () => remoteBeginHandle });
assert.equal(render({ provider: "opencode-go" }, true), null, "other providers render nothing");
assert.equal(render({ provider: "openai-codex" }, false), null, "an unconfigured provider renders nothing");
assert.notEqual(render({ provider: "openai-codex" }, true), null, "the configured provider renders the control");

const injected = footer.descriptor.inject();
assert.equal(typeof injected.signIn, "function");
assert.equal(ctx.remote.openaiCodexOAuth, undefined, "the namespace must not hang off ctx.remote");
const handle = await injected.signIn(new AbortController().signal);
assert.equal(handle, remoteBeginHandle);
assert.equal(beginCalls, 1, "one click opens exactly one stream");

assert.ok(mounted, "the click mounted the generated Remote contribution");
assert.equal(mounted.package, "dsh-plugin-openai-codex-oauth");
assert.equal(mounted.descriptors.length, 1);
const descriptor = mounted.descriptors[0];
assert.equal(descriptor.id, "dsh-plugin-openai-codex-oauth#openaiCodexOAuth/remoteBegin");
assert.equal(descriptor.service, "openaiCodexOAuth");
assert.equal(descriptor.namespace, "openaiCodexOAuth");
assert.equal(descriptor.method, "remoteBegin");
assert.equal(descriptor.mode, "stream");
assert.equal(descriptor.invocation.kind, "direct");
assert.deepEqual(descriptor.parameters, []);
assert.equal(descriptor.cancellation.parameter, "signal");
assert.equal(descriptor.uplink.codec.mode, "strict", "uplink codec must be strict");
assert.equal(typeof descriptor.uplink.codec.create, "function");

console.log("ok - client bundle registers the openai-codex provider-card control and one strict Remote stream");
