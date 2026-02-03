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

// Gemini audio: ~25 tokens per second of audio
const GEMINI_AUDIO_TOKENS_PER_SEC = 25;
// Gemini video: ~258 tokens per second of video (1 fps sample rate)
const GEMINI_VIDEO_TOKENS_PER_SEC = 258;

// Gemini 3 Pro pricing per million tokens (used for video)
const GEMINI3_PRO_INPUT_PRICE_PER_M_TOKENS = 1.25;
const GEMINI3_PRO_OUTPUT_PRICE_PER_M_TOKENS = 10.00;
// Gemini 2.0 Flash pricing (fallback for audio/non-video)
const GEMINI2_INPUT_PRICE_PER_M_TOKENS = 0.15;
const GEMINI2_OUTPUT_PRICE_PER_M_TOKENS = 0.60;
// Estimated output tokens for a video analysis (~2000 tokens)
const GEMINI_ESTIMATED_OUTPUT_TOKENS = 2000;

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
  /** Actual duration in milliseconds (from Feishu message metadata) */
  durationMs?: number;
}): CostEstimate {
  const { fileSizeBytes, mediaType, modelHint, durationMs } = params;

  // Use actual duration if available, otherwise estimate from file size
  let estimatedDurationSec: number;
  if (durationMs && durationMs > 0) {
    estimatedDurationSec = Math.max(1, Math.round(durationMs / 1000));
  } else {
    const bitrate = mediaType === "audio" ? AUDIO_BITRATE_BPS : VIDEO_BITRATE_BPS;
    estimatedDurationSec = Math.max(1, Math.round(fileSizeBytes / bitrate));
  }

  const isGemini = detectIsGeminiModel(modelHint);

  let estimatedCostUsd: number;
  let pricingBasis: string;
  let modelName: string;

  if (mediaType === "video") {
    // Video always uses Gemini 3 Flash for analysis
    const tokensPerSec = GEMINI_VIDEO_TOKENS_PER_SEC;
    const totalInputTokens = estimatedDurationSec * tokensPerSec;
    const inputCost = (totalInputTokens / 1_000_000) * GEMINI3_PRO_INPUT_PRICE_PER_M_TOKENS;
    const outputCost = (GEMINI_ESTIMATED_OUTPUT_TOKENS / 1_000_000) * GEMINI3_PRO_OUTPUT_PRICE_PER_M_TOKENS;
    estimatedCostUsd = inputCost + outputCost;
    pricingBasis = `Gemini 3 Pro ($${GEMINI3_PRO_INPUT_PRICE_PER_M_TOKENS}/M input + $${GEMINI3_PRO_OUTPUT_PRICE_PER_M_TOKENS}/M output)`;
    modelName = "gemini-3-pro-preview";
  } else if (isGemini) {
    // Gemini native audio processing
    const tokensPerSec = GEMINI_AUDIO_TOKENS_PER_SEC;
    const totalInputTokens = estimatedDurationSec * tokensPerSec;
    const inputCost = (totalInputTokens / 1_000_000) * GEMINI2_INPUT_PRICE_PER_M_TOKENS;
    const outputCost = (GEMINI_ESTIMATED_OUTPUT_TOKENS / 1_000_000) * GEMINI2_OUTPUT_PRICE_PER_M_TOKENS;
    estimatedCostUsd = inputCost + outputCost;
    pricingBasis = `Gemini 2.0 Flash ($${GEMINI2_INPUT_PRICE_PER_M_TOKENS}/M input + $${GEMINI2_OUTPUT_PRICE_PER_M_TOKENS}/M output)`;
    modelName = modelHint || "gemini-2.0-flash";
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
