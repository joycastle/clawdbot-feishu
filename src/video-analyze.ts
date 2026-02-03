/**
 * Video analysis via Vertex AI Gemini API.
 *
 * Sends video files to Gemini for automatic analysis.
 * Uses service account credentials for authentication (JWT → OAuth2 token).
 * Videos ≤ 20MB supported via inline base64 in the generateContent API.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ServiceAccountCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export interface VideoAnalysisResult {
  /** The analysis text from Gemini */
  text: string;
  /** Model used */
  model: string;
  /** Token usage info */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Processing duration in ms */
  durationMs: number;
  /** Actual cost estimate based on token usage */
  estimatedCostUsd?: number;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_MODEL = "gemini-3-flash-preview";
const VERTEX_AI_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const MAX_VIDEO_SIZE_MB = 20;

// Pricing per million tokens (official Google pricing, ≤200K input tokens tier)
const PRICING = {
  "gemini-3-flash": { input: 0.50, output: 3.00 },
  "gemini-3-flash-preview": { input: 0.50, output: 3.00 },
  "gemini-3-pro-preview": { input: 2.00, output: 12.00 },
  "gemini-2.0-flash-001": { input: 0.15, output: 0.60 },
  "gemini-2.5-flash-preview-05-20": { input: 0.30, output: 2.50 },
} as Record<string, { input: number; output: number }>;

// ─── Auth: JWT → OAuth2 Token ────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64url");
}

async function getAccessToken(credentials: ServiceAccountCredentials): Promise<string> {
  // Return cached token if still valid (with 60s margin)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: VERTEX_AI_SCOPE,
      aud: credentials.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = sign.sign(credentials.private_key, "base64url");

  const jwt = `${signInput}.${signature}`;

  const res = await fetch(credentials.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OAuth2 token exchange failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

// ─── Gemini API Call ─────────────────────────────────────────────────────────

function loadCredentials(): ServiceAccountCredentials {
  const credPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(process.env.HOME || "/home/ubuntu", ".clawdbot/credentials/google-vertex-sa.json");

  if (!fs.existsSync(credPath)) {
    throw new Error(`Google credentials not found at ${credPath}`);
  }

  return JSON.parse(fs.readFileSync(credPath, "utf-8")) as ServiceAccountCredentials;
}

function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".mp4": "video/mp4",
    ".avi": "video/x-msvideo",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".3gp": "video/3gpp",
    ".flv": "video/x-flv",
    ".wmv": "video/x-ms-wmv",
  };
  return mimeMap[ext] || "video/mp4";
}

/**
 * Analyze a video file using Vertex AI Gemini API.
 *
 * @param videoPath - Path to the video file on disk
 * @param options - Analysis options
 * @returns Analysis result with text, usage, and cost estimate
 */
export async function analyzeVideo(
  videoPath: string,
  options?: {
    model?: string;
    prompt?: string;
    mimeType?: string;
    log?: (msg: string) => void;
  },
): Promise<VideoAnalysisResult> {
  const log = options?.log ?? console.log;
  const model = options?.model ?? DEFAULT_MODEL;
  const prompt =
    options?.prompt ??
    "请详细分析这个视频的内容。描述视频中发生了什么，包括画面、文字、操作流程等关键信息。如果是应用或游戏录屏，请描述功能和界面交互。";

  const startTime = Date.now();

  // Load credentials and get access token
  const credentials = loadCredentials();
  const projectId = credentials.project_id || process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "global";

  if (!projectId) {
    throw new Error("Google Cloud project ID not found in credentials or environment");
  }

  log(`video-analyze: loading video from ${videoPath}`);

  // Check file size
  const stat = fs.statSync(videoPath);
  const fileSizeMb = stat.size / (1024 * 1024);
  log(`video-analyze: video size = ${fileSizeMb.toFixed(1)} MB`);

  if (fileSizeMb > MAX_VIDEO_SIZE_MB) {
    throw new Error(
      `视频文件过大（${fileSizeMb.toFixed(1)} MB），超出 ${MAX_VIDEO_SIZE_MB} MB 上限。请压缩视频或发送较短的片段。`,
    );
  }

  const mimeType = options?.mimeType ?? inferMimeType(videoPath);

  // Get access token
  log(`video-analyze: authenticating with Vertex AI...`);
  const accessToken = await getAccessToken(credentials);

  // Inline base64 upload
  const videoBuffer = fs.readFileSync(videoPath);
  const videoBase64 = videoBuffer.toString("base64");

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: videoBase64 } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
      topP: 0.95,
    },
  };

  // Build API URL — handle "global" location specially
  const apiHost = location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
  const apiUrl = `https://${apiHost}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  log(`video-analyze: calling Gemini API (model=${model})...`);

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API call failed (${res.status}): ${errText}`);
  }

  const response = (await res.json()) as GeminiResponse;

  const durationMs = Date.now() - startTime;

  if (response.error) {
    throw new Error(`Gemini API error: ${response.error.message} (${response.error.status})`);
  }

  // Extract text from response
  const text =
    response.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("\n") || "";

  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  // Extract usage
  const usage = response.usageMetadata
    ? {
        promptTokens: response.usageMetadata.promptTokenCount || 0,
        completionTokens: response.usageMetadata.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata.totalTokenCount || 0,
      }
    : undefined;

  // Estimate cost
  let estimatedCostUsd: number | undefined;
  if (usage) {
    const pricing = PRICING[model] || PRICING[DEFAULT_MODEL];
    estimatedCostUsd =
      (usage.promptTokens / 1_000_000) * pricing.input +
      (usage.completionTokens / 1_000_000) * pricing.output;
  }

  log(
    `video-analyze: complete in ${(durationMs / 1000).toFixed(1)}s ` +
      `(tokens: ${usage?.promptTokens ?? "?"}→${usage?.completionTokens ?? "?"}, ` +
      `cost: $${estimatedCostUsd?.toFixed(4) ?? "?"})`,
  );

  return {
    text,
    model,
    usage,
    durationMs,
    estimatedCostUsd,
  };
}
