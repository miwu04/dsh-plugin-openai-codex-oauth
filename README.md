# DSH OpenAI Codex OAuth plugin

Signs in to OpenAI Codex with a ChatGPT Plus/Pro subscription, stores the OAuth
grant in DSH's credentials file under `llm-pi-ai/openai-codex`, and adds a
**Sign in with ChatGPT** button to the Web **Settings → Models** page.

The package has two halves:

- `index.js` — the Host plugin. It exposes one bidirectional Remote stream
  (`openaiCodexOAuth/remoteBegin`) that relays an authorization flow's notices
  and prompts to a calling surface. On a DSH release where
  `@deepseek-ai/dsh-llm-pi-ai` already registers that provider's flow (every
  `0.2.1-rc.2` build does), the plugin reuses it and only adds the UI; it
  registers its own flow only when the key has none.
- `client.js` — the Web client bundle. It registers a control in the
  `settings.models.provider-card` seat, which the Models page dispatches once
  per provider card. The control renders only for the `openai-codex` row while
  that provider is configured, and it disappears with the row when the provider
  is removed. It is a `Button variant="outline" size="sm"` from
  `@deepseek-ai/dsh-client-ui-primitives`, and the dialog is that package's
  `Modal`, so both inherit the application's own styling; clicking it opens the
  Remote stream, renders notices, auth URLs, and prompts, and sends answers back
  over the stream's uplink.

## Requirements

- DeepSeek Harness `0.2.1-rc.2` (the client bundle and Host markers target this
  release).
- A profile that loads `@deepseek-ai/dsh-authorization` and
  `@deepseek-ai/dsh-credentials`.
- The pi-ai version bundled with that DSH release, containing the
  `openai-codex` provider and its OAuth login.
- The Web client load: the package declares `dsh.client.platform = "web"` and
  exports `./client`. DSH reads that bundle when the package is part of the
  active profile.

## Install

Add the package directory to the DSH profile that should own the flow. In that
profile's `cordis.patch.yml`, insert one loader entry that names the Host file
and declares the services the plugin reads:

```yaml
- insert:
    - id: openai-codex-oauth
      name: "file:///absolute/path/to/dsh-plugin-openai-codex-oauth/index.js"
      inject:
        - authorization
        - credentials
```

The `inject` list is required: without it Cordis refuses property access to
those services during plugin init. After editing the entry or the Host file,
restart `dsh web` once so the new module is imported; a failed first mount can
leave its service key held by the dead fiber.

A plugin is trusted, unsandboxed Host code: it can read DSH credentials and
reach the network. Review the source before enabling it.

## Using the button

1. Open **Settings → Models**.
2. Click **Sign in with ChatGPT** on the **openai-codex** provider card. The
   control exists only while that provider is configured.
3. Continue in the browser when the sign-in page opens, or copy the device code
   onto the verification page.
4. Answer any prompt the flow asks for. Secret prompts render as password
   fields and are sent only to the Host prompt waiter.
5. On success the grant is written to `llm-pi-ai/openai-codex`; the Models page
   refreshes its credential state from the Host's credential event.

Closing the dialog or clicking **Cancel sign-in** disposes the stream, which
cancels the attempt on the Host as well. Only one attempt runs at a time.

## Security

- OAuth access and refresh tokens are never logged, printed, or returned.
- Only the credential record is persisted, as a DSH `grant` at
  `llm-pi-ai/openai-codex`. It is not exported as a plain API key.
- Auth URLs and device codes travel only to the requesting client stream so the
  human can complete the sign-in. Do not paste them into logs or issue reports.
- Secret hotfixes aside, the client never receives the credential payload.

## Limitations

- The control belongs to the `openai-codex` provider card; removing that
  provider from the profile removes the control with it. It does not replace the
  account sign-in choice in the `settings.models.sign-in` slot.
- A browser-based login needs a surface that supports the manual-code prompt;
  device-code login is preferable for remote or headless surfaces.
- An attempt is process-local and is not resumable after its caller or the Host
  exits.
- Client bundles are read from disk once at composition time. After editing
  `client.js`, rebuild/restart the Web app so the new bundle is served; a
  running dev watcher is not required for the Host half.
- The manifest pins the authorization seam to DSH `0.2.1-rc.2`. Align peer
  versions when moving to another release.

## Tests

```sh
npm test
```

- `test.mjs` registers the flow, relays a device-code notice, verifies clean
  cancellation and unregistration, asserts the Host Remote marker, and drives
  the Remote stream end to end (uplink answer in, terminal `cancelled` out).
- `test-client.mjs` evaluates the client bundle, asserts the provider-card
  registration, checks that only a configured `openai-codex` row renders the
  control, and that one click mounts exactly one strict Remote stream
  contribution.
