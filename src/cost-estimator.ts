/**
 * Cost estimation for media (audio/video) processing.
 *
 * Claude mode: Uses Whisper API for transcription ($0.006/min)
 * Gemini mode: Uses Gemini native audio/video processing (token-based)
 */

export interface CostEstimate {
  /** Estimated duration in seconds */
  estimatedDurationSec: number;
  /** Estimated cost in USD */
  estimatedCostUsd: number;
  /** Human-readable cost string */
  costDisplay: string;
  /** Human-readable duration string */
  durationDisplay: string;
  /** Model used for estimation */
  model: string;
  /** Pricing basis description */
  pricingBasis: string;
}

// Average bitrates for estimation (bytes per second)
// Feishu audio messages are typically opus at ~32kbps
const AUDIO_BITRATE_BPS = 4_000; // ~32kbps opus (conservative)
// Feishu video messages vary; use conservative estimate
const VIDEO_BITRATE_BPS = 500_000; // ~4Mbps typical mobile video

// Whisper pricing (for Claude pipeline)
const WHISPER_COST_PER_MINUTE_USD = 0.006;

// Gemini audio: ~32 tokens per second of audio
const GEMINI_AUDIO_TOKENS_PER_SEC = 32;
// Gemini video: ~258 tokens per second of video
const GEMINI_VIDEO_TOKENS_PER_SEC = 258;
// Gemini pricing per million tokens (input) - Gemini 2.0 Flash
const GEMINI_INPUT_PRICE_PER_M_TOKENS = 0.075;

/**
 * Detect if the current runtime is using a Gemini model.
 * Checks environment variables and common patterns.
 */
export function detectIsGeminiModel(modelHint?: string): boolean {
  if (modelHint) {
    return modelHint.toLowerCase().includes("gemini");
  }
  // Check environment variables
  const envModel =
    process.env.CLAWDBOT_MODEL ||
    process.env.CLAWDBOT_DEFAULT_MODEL ||
    process.env.DEFAULT_MODEL ||
    "";
  return envModel.toLowerCase().includes("gemini");
}

/**
 * Estimate media processing cost based on file size and model.
 */
export function estimateMediaCost(params: {
  fileSizeBytes: number;
  mediaType: "audio" | "video";
  modelHint?: string;
}): CostEstimate {
  const { fileSizeBytes, mediaType, modelHint } = params;

  // Estimate duration from file size
  const bitrate = mediaType === "audio" ? AUDIO_BITRATE_BPS : VIDEO_BITRATE_BPS;
  const estimatedDurationSec = Math.max(1, Math.round(fileSizeBytes / bitrate));

  const isGemini = detectIsGeminiModel(modelHint);

  let estimatedCostUsd: number;
  let pricingBasis: string;
  let modelName: string;

  if (isGemini) {
    // Gemini native audio/video processing
    const tokensPerSec =
      mediaType === "audio" ? GEMINI_AUDIO_TOKENS_PER_SEC : GEMINI_VIDEO_TOKENS_PER_SEC;
    const totalTokens = estimatedDurationSec * tokensPerSec;
    estimatedCostUsd = (totalTokens / 1_000_000) * GEMINI_INPUT_PRICE_PER_M_TOKENS;
    pricingBasis = `Gemini (${tokensPerSec} tok/s × $${GEMINI_INPUT_PRICE_PER_M_TOKENS}/M)`;
    modelName = modelHint || "gemini";
  } else {
    // Claude mode: uses Whisper for transcription
    const durationMin = estimatedDurationSec / 60;
    estimatedCostUsd = durationMin * WHISPER_COST_PER_MINUTE_USD;
    pricingBasis = `Whisper ($${WHISPER_COST_PER_MINUTE_USD}/min)`;
    modelName = "whisper";
  }

  // Format duration display
  const minutes = Math.floor(estimatedDurationSec / 60);
  const seconds = estimatedDurationSec % 60;
  const durationDisplay =
    minutes > 0
      ? `${minutes}分${seconds > 0 ? seconds + "秒" : ""}`
      : `${seconds}秒`;

  // Format cost display
  const costDisplay = estimatedCostUsd < 0.001 ? "< $0.001" : `$${estimatedCostUsd.toFixed(4)}`;

  return {
    estimatedDurationSec,
    estimatedCostUsd,
    costDisplay,
    durationDisplay,
    model: modelName,
    pricingBasis,
  };
}

/**
 * Format file size to human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
