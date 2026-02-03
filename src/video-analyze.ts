/**
 * Video analysis via Vertex AI Gemini API.
 *
 * Sends video files to Gemini for automatic analysis.
 * Uses service account credentials for authentication (JWT → OAuth2 token).
 * - Videos ≤ 20MB: inline base64 via generateContent API
 * - Videos 20–30MB: upload to GCS temp bucket, use fileUri, then delete
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
const MAX_INLINE_SIZE_MB = 20;
const MAX_VIDEO_SIZE_MB = 30;

// Pricing per million tokens
const PRICING = {
  "gemini-3-flash-preview": { input: 0.15, output: 0.60 },
  "gemini-3-pro-preview": { input: 1.25, output: 10.00 },
  "gemini-2.0-flash-001": { input: 0.15, output: 0.60 },
  "gemini-2.5-flash-preview-05-20": { input: 0.30, output: 2.50 },
} as Record<string, { input: number; output: number }>;

// GCS temp bucket for large video uploads (auto-created if missing)
const GCS_TEMP_BUCKET_PREFIX = "clawdbot-video-temp";

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

// ─── GCS Helpers ─────────────────────────────────────────────────────────────

function getGcsBucketName(projectId: string): string {
  return `${GCS_TEMP_BUCKET_PREFIX}-${projectId}`;
}

/**
 * Ensure GCS temp bucket exists; create if not.
 */
async function ensureGcsBucket(
  projectId: string,
  accessToken: string,
  log: (msg: string) => void,
): Promise<string> {
  const bucket = getGcsBucketName(projectId);

  // Check if bucket exists
  const checkRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (checkRes.ok) {
    return bucket;
  }

  // Create bucket with auto-delete lifecycle (1 day)
  log(`video-analyze: creating GCS temp bucket ${bucket}`);
  const createRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b?project=${projectId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: bucket,
        location: "US",
        storageClass: "STANDARD",
        lifecycle: {
          rule: [
            {
              action: { type: "Delete" },
              condition: { age: 1 }, // Auto-delete after 1 day
            },
          ],
        },
      }),
    },
  );

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create GCS bucket ${bucket}: ${createRes.status} ${errText}`);
  }

  log(`video-analyze: created GCS temp bucket ${bucket}`);
  return bucket;
}

/**
 * Upload a file to GCS and return the gs:// URI.
 */
async function uploadToGcs(params: {
  bucket: string;
  filePath: string;
  mimeType: string;
  accessToken: string;
  log: (msg: string) => void;
}): Promise<string> {
  const { bucket, filePath, mimeType, accessToken, log } = params;
  const objectName = `video-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${path.extname(filePath)}`;

  log(`video-analyze: uploading to GCS gs://${bucket}/${objectName}`);

  const fileBuffer = fs.readFileSync(filePath);
  const uploadRes = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectName)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": mimeType,
      },
      body: fileBuffer,
    },
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`GCS upload failed: ${uploadRes.status} ${errText}`);
  }

  const gcsUri = `gs://${bucket}/${objectName}`;
  log(`video-analyze: uploaded to ${gcsUri}`);
  return gcsUri;
}

/**
 * Delete a GCS object (best-effort cleanup).
 */
async function deleteFromGcs(params: {
  bucket: string;
  objectName: string;
  accessToken: string;
  log: (msg: string) => void;
}): Promise<void> {
  const { bucket, objectName, accessToken, log } = params;
  try {
    await fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectName)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    log(`video-analyze: deleted GCS object gs://${bucket}/${objectName}`);
  } catch (err) {
    log(`video-analyze: failed to delete GCS object (non-fatal): ${String(err)}`);
  }
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

  // Build request body based on file size
  let requestBody: Record<string, unknown>;
  let gcsUri: string | undefined;
  let gcsBucket: string | undefined;
  let gcsObjectName: string | undefined;

  if (fileSizeMb <= MAX_INLINE_SIZE_MB) {
    // Inline base64 upload for small videos
    const videoBuffer = fs.readFileSync(videoPath);
    const videoBase64 = videoBuffer.toString("base64");

    requestBody = {
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
  } else {
    // GCS upload for larger videos (20–30MB)
    log(`video-analyze: video > ${MAX_INLINE_SIZE_MB}MB, using GCS upload`);
    gcsBucket = await ensureGcsBucket(projectId, accessToken, log);
    gcsUri = await uploadToGcs({ bucket: gcsBucket, filePath: videoPath, mimeType, accessToken, log });
    gcsObjectName = gcsUri.replace(`gs://${gcsBucket}/`, "");

    requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            { fileData: { mimeType, fileUri: gcsUri } },
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
  }

  // Build API URL — handle "global" location specially
  const apiHost = location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
  const apiUrl = `https://${apiHost}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  log(`video-analyze: calling Gemini API (model=${model})...`);

  let response: GeminiResponse;
  try {
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

    response = (await res.json()) as GeminiResponse;
  } finally {
    // Clean up GCS object if uploaded
    if (gcsBucket && gcsObjectName) {
      deleteFromGcs({ bucket: gcsBucket, objectName: gcsObjectName, accessToken, log })
        .catch(() => {}); // fire-and-forget cleanup
    }
  }

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
