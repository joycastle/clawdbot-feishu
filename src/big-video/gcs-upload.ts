/**
 * GCS Upload — stream video files to Google Cloud Storage.
 *
 * Uses the existing Vertex AI Service Account for authentication.
 * Supports two modes:
 *   - streamUploadToGcs: pipe a readable stream directly to GCS (no temp file)
 *   - uploadToGcs: upload from a local file (legacy, still used for small files)
 *
 * Also handles GCS object deletion for periodic cleanup.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
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

// ─── Streaming Upload (no temp file) ─────────────────────────────────────────

/**
 * Stream a readable directly to GCS using resumable upload.
 * Buffers chunks in memory (8MB at a time), sends each to GCS, then discards.
 * No temp file is written to disk.
 *
 * @param readable - Source stream (e.g. from Feishu download)
 * @param params - Upload parameters
 * @returns GCS upload result
 */
export async function streamUploadToGcs(
  readable: Readable | ReadableStream<Uint8Array>,
  params: {
    mimeType: string;
    objectName: string;
    totalSize: number; // needed for Content-Range header
  },
): Promise<GcsUploadResult> {
  const token = await getAccessToken();
  const { mimeType, objectName, totalSize } = params;

  // Initiate resumable upload
  const initRes = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=resumable&name=${encodeURIComponent(objectName)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(totalSize),
      },
      body: JSON.stringify({ name: objectName, contentType: mimeType }),
    },
  );

  if (!initRes.ok) {
    throw new Error(`GCS resumable init failed: ${initRes.status} ${await initRes.text()}`);
  }

  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("GCS resumable init: no upload URL in response");
  }

  const nodeReadable = readable instanceof Readable
    ? readable
    : Readable.fromWeb(readable as ReadableStream<any>);

  const CHUNK_TARGET = 8 * 1024 * 1024; // 8MB chunks (must be multiple of 256KB for GCS)
  let buffer = Buffer.alloc(0);
  let bytesSent = 0;

  for await (const raw of nodeReadable) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    buffer = Buffer.concat([buffer, chunk]);

    // Send when we have enough data (or this is naturally the last chunk)
    while (buffer.length >= CHUNK_TARGET) {
      const toSend = buffer.subarray(0, CHUNK_TARGET);
      buffer = buffer.subarray(CHUNK_TARGET);

      const start = bytesSent;
      const end = start + toSend.length - 1;
      const contentRange = `bytes ${start}-${end}/${totalSize}`;

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(toSend.length),
          "Content-Type": mimeType,
          "Content-Range": contentRange,
        },
        body: toSend,
      } as any);

      if (uploadRes.status !== 308 && !uploadRes.ok) {
        throw new Error(`GCS stream upload failed at ${contentRange}: ${uploadRes.status} ${await uploadRes.text()}`);
      }
      // Consume response body to free resources
      await uploadRes.arrayBuffer().catch(() => {});

      bytesSent += toSend.length;
    }
  }

  // Send remaining buffer (final chunk)
  if (buffer.length > 0) {
    const start = bytesSent;
    const end = start + buffer.length - 1;
    const contentRange = `bytes ${start}-${end}/${totalSize}`;

    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(buffer.length),
        "Content-Type": mimeType,
        "Content-Range": contentRange,
      },
      body: buffer,
    } as any);

    if (!uploadRes.ok) {
      throw new Error(`GCS stream upload final chunk failed: ${uploadRes.status} ${await uploadRes.text()}`);
    }

    bytesSent += buffer.length;
  }

  return {
    gcsUri: `gs://${BUCKET_NAME}/${objectName}`,
    objectName,
    size: bytesSent,
  };
}

// ─── File-based Upload (legacy) ──────────────────────────────────────────────

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

  if (fileSize < 5 * 1024 * 1024) {
    const fileData = fs.readFileSync(params.filePath);

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
    };
  }

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

  const chunkSize = 8 * 1024 * 1024;
  let start = 0;
  while (start < fileSize) {
    const end = Math.min(start + chunkSize - 1, fileSize - 1);
    const contentLength = end - start + 1;
    const contentRange = `bytes ${start}-${end}/${fileSize}`;

    let attempt = 0;
    while (true) {
      attempt++;
      const body = fs.createReadStream(params.filePath, { start, end });
      const uploadRes = await fetch(uploadUrl, ({
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Length": String(contentLength),
          "Content-Type": params.mimeType,
          "Content-Range": contentRange,
        },
        body,
        duplex: "half",
      } as any));

      if (uploadRes.status === 308) {
        const range = uploadRes.headers.get("range");
        if (range) {
          const m = /bytes=\d+-(\d+)/i.exec(range);
          if (m?.[1]) {
            const last = Number.parseInt(m[1], 10);
            if (Number.isFinite(last) && last >= start) {
              start = last + 1;
              break;
            }
          }
        }
        if (attempt >= 3) {
          throw new Error(`GCS resumable upload incomplete after retries (start=${start}, end=${end})`);
        }
        await uploadRes.arrayBuffer().catch(() => {});
        continue;
      }

      if (!uploadRes.ok) {
        throw new Error(`GCS resumable upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
      }

      start = end + 1;
      break;
    }
  }

  return {
    gcsUri: `gs://${BUCKET_NAME}/${objectName}`,
    objectName,
    size: fileSize,
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
  const match = gcsUri.match(/^gs:\/\/[^/]+\/(.+)$/);
  return match ? match[1] : gcsUri;
}

// ─── Cleanup temp files (legacy, kept for backward compat) ───────────────────

/** Remove a temporary file (best-effort). */
export function cleanupTmpFile(tmpPath: string): void {
  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  } catch { /* ignore */ }
}
