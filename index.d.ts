import type { Context, Service } from "@deepseek-ai/cordis";

export interface OpenAICodexOAuthConfig {
  /** pi-ai provider id; defaults to openai-codex. */
  providerId?: string;
  /** DSH credential record owner; defaults to llm-pi-ai. */
  recordScope?: string;
}

/** One interaction frame the Host yields over the `remoteBegin` Remote stream. */
export type OpenAICodexOAuthFrame =
  | { readonly type: "notice"; readonly notice: { readonly message: string; readonly url?: string; readonly code?: string } }
  | {
      readonly type: "prompt";
      readonly id: string;
      readonly prompt: {
        readonly kind: "text" | "secret" | "select";
        readonly message: string;
        readonly placeholder?: string;
        readonly options?: readonly { readonly id: string; readonly label: string }[];
      };
    }
  | { readonly type: "result"; readonly status: "authorized" | "cancelled" }
  | { readonly type: "error"; readonly message: string };

/** One uplink item the calling surface sends back over the same stream. */
export type OpenAICodexOAuthAnswer =
  | { readonly type: "answer"; readonly id: string; readonly value: string }
  | { readonly type: "cancel" };

/**
 * Registers pi-ai's Codex OAuth login as a DSH authorization flow and exposes
 * it to the Web client as one bidirectional Remote stream (`remoteBegin`).
 */
export declare class OpenAICodexOAuthPlugin extends Service {
  static inject: string[];
  readonly typertRemote: unknown;
  constructor(ctx: Context, config?: OpenAICodexOAuthConfig);
  remoteBegin(signal?: AbortSignal): AsyncGenerator<OpenAICodexOAuthFrame, void, unknown>;
}

export declare function apply(ctx: Context, config?: OpenAICodexOAuthConfig): OpenAICodexOAuthPlugin;
export default apply;
