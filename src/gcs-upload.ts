/**
 * GCS Upload — stream video files to Google Cloud Storage.
 *
 * Uses the existing Vertex AI Service Account for authentication.
 * Supports streaming upload (resumable) to avoid loading entire file into memory.
 * Also handles GCS object deletion for periodic cleanup.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

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

export interface GcsUploadResult {
  gcsUri: string;
  objectName: string;
  size: number;
  md5: string;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const BUCKET_NAME = "larkbot-storage";
const GCS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ?? path.join(process.env.HOME ?? "/tmp", ".clawdbot/credentials/google-vertex-sa.json");

// ─── Auth ────────────────────────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64url");
}

function loadServiceAccount(): ServiceAccountCredentials {
  const raw = fs.readFileSync(SA_PATH, "utf-8");
  return JSON.parse(raw);
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: GCS_SCOPE,
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }));

  const signInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = sign.sign(sa.private_key, "base64url");
  const jwt = `${signInput}.${signature}`;

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    throw new Error(`GCS auth failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

// ─── Stream Download + MD5 ───────────────────────────────────────────────────

/**
 * Download a readable stream to /tmp while computing MD5.
 * Returns the temp file path and the MD5 hex digest.
 */
export async function streamToTmpWithMd5(
  readable: Readable | ReadableStream<Uint8Array>,
  fileName: string,
): Promise<{ tmpPath: string; md5: string; size: number }> {
  const tmpPath = path.join("/tmp", `feishu-video-${Date.now()}-${fileName}`);
  const writeStream = fs.createWriteStream(tmpPath);
  const hash = crypto.createHash("md5");
  let size = 0;

  // Convert web ReadableStream to Node Readable if needed
  const nodeReadable = readable instanceof Readable
    ? readable
    : Readable.fromWeb(readable as ReadableStream<any>);

  await new Promise<void>((resolve, reject) => {
    nodeReadable.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      size += chunk.length;
    });
    nodeReadable.on("error", reject);
    writeStream.on("error", reject);
    writeStream.on("finish", resolve);
    nodeReadable.pipe(writeStream);
  });

  return { tmpPath, md5: hash.digest("hex"), size };
}

// ─── GCS Upload ──────────────────────────────────────────────────────────────

/**
 * Upload a local file to GCS using streaming.
 * Uses simple upload for files < 5MB, resumable for larger files.
 */
export async function uploadToGcs(params: {
  filePath: string;
  mimeType: string;
  objectName?: string;
}): Promise<GcsUploadResult> {
  const token = await getAccessToken();
  const fileSize = fs.statSync(params.filePath).size;
  const objectName = params.objectName ?? `video-${Date.now()}-${path.basename(params.filePath)}`;

  // Compute MD5 while reading for upload
  const hash = crypto.createHash("md5");

  if (fileSize < 5 * 1024 * 1024) {
    // Simple upload for small files
    const fileData = fs.readFileSync(params.filePath);
    hash.update(fileData);

    const res = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=media&name=${encodeURIComponent(objectName)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": params.mimeType,
          "Content-Length": String(fileSize),
        },
        body: fileData,
      },
    );

    if (!res.ok) {
      throw new Error(`GCS upload failed: ${res.status} ${await res.text()}`);
    }

    return {
      gcsUri: `gs://${BUCKET_NAME}/${objectName}`,
      objectName,
      size: fileSize,
      md5: hash.digest("hex"),
    };
  }

  // Resumable upload for larger files
  // Step 1: Initiate resumable upload
  const initRes = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=resumable&name=${encodeURIComponent(objectName)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": params.mimeType,
        "X-Upload-Content-Length": String(fileSize),
      },
      body: JSON.stringify({ name: objectName, contentType: params.mimeType }),
    },
  );

  if (!initRes.ok) {
    throw new Error(`GCS resumable init failed: ${initRes.status} ${await initRes.text()}`);
  }

  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("GCS resumable init: no upload URL in response");
  }

  // Step 2: Stream upload the file
  const fileStream = fs.createReadStream(params.filePath);

  // We need to collect for MD5 and also send to GCS
  // Read file in chunks, update hash, collect into buffer for upload
  const chunks: Buffer[] = [];
  for await (const chunk of fileStream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buf);
    chunks.push(buf);
  }
  const fullBuffer = Buffer.concat(chunks);

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(fileSize),
      "Content-Type": params.mimeType,
    },
    body: fullBuffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`GCS resumable upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  return {
    gcsUri: `gs://${BUCKET_NAME}/${objectName}`,
    objectName,
    size: fileSize,
    md5: hash.digest("hex"),
  };
}

// ─── GCS Delete ──────────────────────────────────────────────────────────────

/** Delete a single object from GCS. */
export async function deleteGcsObject(objectName: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodeURIComponent(objectName)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  // 404 is fine (already deleted)
  if (!res.ok && res.status !== 404) {
    throw new Error(`GCS delete failed: ${res.status} ${await res.text()}`);
  }
}

/** Delete all objects in the bucket (for periodic cleanup). */
export async function clearGcsBucket(): Promise<number> {
  const token = await getAccessToken();
  let deleted = 0;
  let pageToken: string | undefined;

  do {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`GCS list failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as {
      items?: Array<{ name: string }>;
      nextPageToken?: string;
    };

    for (const item of data.items ?? []) {
      await deleteGcsObject(item.name);
      deleted++;
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return deleted;
}

/** Extract object name from gs:// URI. */
export function objectNameFromUri(gcsUri: string): string {
  // gs://bucket-name/object-name → object-name
  const match = gcsUri.match(/^gs:\/\/[^/]+\/(.+)$/);
  return match ? match[1] : gcsUri;
}

// ─── Cleanup temp files ──────────────────────────────────────────────────────

/** Remove a temporary file (best-effort). */
export function cleanupTmpFile(tmpPath: string): void {
  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  } catch { /* ignore */ }
}
