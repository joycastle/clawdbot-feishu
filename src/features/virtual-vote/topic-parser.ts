/**
 * topic-parser — Extract structured topic + options from free-form topic text.
 *
 * When the agent fails to separate topic and options, this module uses the
 * same LLM model as voting to parse them from the raw topic string.
 */

import type { VirtualVoteLLMConfig, VirtualVoteLLMRuntime, LLMMessage } from "./llm-client.js";
import { callLLM } from "./llm-client.js";

export interface ParsedTopic {
  /** Clean topic description (options removed) */
  topic: string;
  /** Extracted options, empty if none found */
  options: string[];
}

const PARSE_PROMPT = `你是一个文本解析助手。从用户给出的投票主题文本中，提取出"投票主题"和"选项列表"。

规则：
1. 如果文本中包含明确的选项（通过 vs、/、VS、或、和、还是、顿号、逗号分隔，或者编号列表 1. 2. 3. 等），将它们提取为 options 数组
2. topic 应该是去掉选项后的纯主题描述。如果原文没有明确的主题描述，根据选项内容概括一个简短的主题
3. 如果文本中没有明确的可区分选项（只是一段描述性文字），options 返回空数组
4. 每个选项应该是简洁的短语，不要包含编号前缀

严格按 JSON 格式回复，不要输出其他内容：
{"topic": "...", "options": ["...", "..."]}`;

/**
 * Parse a free-form topic string into structured topic + options using LLM.
 *
 * Uses the same model as voting (from llmCfg) with lower temperature for consistent parsing.
 * Returns the original topic with empty options if parsing fails.
 */
export async function parseTopicOptions(
  topic: string,
  llmCfg: VirtualVoteLLMConfig,
  rt: VirtualVoteLLMRuntime,
  log?: (msg: string) => void,
): Promise<ParsedTopic> {
  const fallback: ParsedTopic = { topic, options: [] };

  if (!topic.trim()) return fallback;

  const parseCfg: VirtualVoteLLMConfig = {
    model: llmCfg.model,
    temperature: 0,
    maxTokens: 512,
    maxConcurrent: 1,
  };

  const messages: LLMMessage[] = [
    { role: "system", content: PARSE_PROMPT },
    { role: "user", content: topic },
  ];

  try {
    log?.(`topic-parser: parsing topic with ${llmCfg.model}`);
    const result = await callLLM(parseCfg, rt, messages);

    const jsonMatch = result.text.match(/\{[\s\S]*?"topic"[\s\S]*?\}/);
    if (!jsonMatch) {
      log?.(`topic-parser: no JSON found in response: ${result.text.slice(0, 200)}`);
      return fallback;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const parsedTopic = typeof parsed.topic === "string" ? parsed.topic.trim() : "";
    const parsedOptions = Array.isArray(parsed.options)
      ? parsed.options.map((o: unknown) => String(o).trim()).filter((o: string) => o.length > 0)
      : [];

    log?.(`topic-parser: extracted topic="${parsedTopic}", options=[${parsedOptions.join(", ")}]`);

    return {
      topic: parsedTopic || topic,
      options: parsedOptions,
    };
  } catch (err) {
    log?.(`topic-parser: LLM call failed: ${String(err)}`);
    return fallback;
  }
}
