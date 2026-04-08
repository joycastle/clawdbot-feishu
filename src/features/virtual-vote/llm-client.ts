/**
 * llm-client — LLM calls for virtual vote, reusing openclaw's provider system.
 *
 * Uses @mariozechner/pi-ai (openclaw's unified inference library) + openclaw runtime
 * for model resolution and authentication. Supports all openclaw-configured providers
 * including Anthropic, OpenAI, Google Vertex, Gemini, LiteLLM, etc.
 *
 * Model format: "provider/model-id" (e.g. "anthropic/claude-opus-4-6", "litellm/gpt-4o")
 */

import { getModel, complete } from "@mariozechner/pi-ai";
import type { Context, UserMessage, ImageContent, TextContent, AssistantMessage } from "@mariozechner/pi-ai";
import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VirtualVoteLLMConfig {
  /** openclaw model ref, e.g. "anthropic/claude-opus-4-6" */
  model: string;
  temperature: number;
  maxTokens: number;
  maxConcurrent: number;
}

/** Resolved runtime dependencies needed for LLM calls. */
export interface VirtualVoteLLMRuntime {
  config: OpenClawConfig;
  runtime: PluginRuntime;
}

export interface LLMMessage {
  role: "system" | "user";
  content: string | LLMContentPart[];
}

export type LLMContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string }; // base64

export interface LLMResult {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

// ─── Model Resolution ───────────────────────────────────────────────────────

/**
 * Parse "provider/model-id" format.
 */
function parseModelRef(modelRef: string): { provider: string; modelId: string } {
  const slashIdx = modelRef.indexOf("/");
  if (slashIdx <= 0) {
    throw new Error(
      `virtualVote: invalid model format "${modelRef}". Expected "provider/model-id" (e.g. "anthropic/claude-opus-4-6")`,
    );
  }
  return {
    provider: modelRef.slice(0, slashIdx),
    modelId: modelRef.slice(slashIdx + 1),
  };
}

// ─── Message Conversion ─────────────────────────────────────────────────────

/**
 * Convert our LLMMessage[] to pi-ai Context format.
 */
function buildContext(messages: LLMMessage[]): Context {
  const systemMsg = messages.find((m) => m.role === "system");
  const userMessages = messages.filter((m) => m.role === "user");

  const piMessages: UserMessage[] = userMessages.map((m) => {
    let content: string | (TextContent | ImageContent)[];

    if (typeof m.content === "string") {
      content = m.content;
    } else {
      content = m.content.map((part): TextContent | ImageContent => {
        if (part.type === "text") {
          return { type: "text", text: part.text };
        }
        return { type: "image", data: part.data, mimeType: part.mediaType };
      });
    }

    return { role: "user" as const, content, timestamp: Date.now() };
  });

  return {
    systemPrompt: systemMsg
      ? typeof systemMsg.content === "string"
        ? systemMsg.content
        : systemMsg.content
            .filter((p) => p.type === "text")
            .map((p) => (p as { type: "text"; text: string }).text)
            .join("\n")
      : undefined,
    messages: piMessages,
  };
}

/**
 * Extract text result from pi-ai AssistantMessage.
 */
function extractResult(response: AssistantMessage): LLMResult {
  const text = response.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");

  return {
    text,
    usage: response.usage
      ? { inputTokens: response.usage.input, outputTokens: response.usage.output }
      : undefined,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Call the LLM using openclaw's provider infrastructure.
 */
export async function callLLM(
  cfg: VirtualVoteLLMConfig,
  rt: VirtualVoteLLMRuntime,
  messages: LLMMessage[],
): Promise<LLMResult> {
  const { provider, modelId } = parseModelRef(cfg.model);

  // Get the pi-ai model object
  const model = getModel(provider as any, modelId as any);

  // Resolve API key via openclaw's auth system
  const auth = await rt.runtime.modelAuth.resolveApiKeyForProvider({
    provider,
    cfg: rt.config,
  });

  if (!auth.apiKey) {
    throw new Error(
      `virtualVote: no API key resolved for provider "${provider}". ` +
        `Check openclaw auth profiles or environment variables.`,
    );
  }

  // Build pi-ai context
  const context = buildContext(messages);

  // Call via pi-ai complete()
  const response = await complete(model, context, {
    apiKey: auth.apiKey,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
  });

  return extractResult(response);
}
