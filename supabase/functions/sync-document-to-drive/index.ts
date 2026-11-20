/**
 * Supabase Edge Function: sync-document-to-drive
 *
 * Triggered by a Supabase Database Webhook on public.documents.
 * Processes approved documents upon approval transition or manual retry
 * (`drive_sync_status === 'PENDING'`), downloads the PDF from Supabase Storage,
 * authenticates with Google Drive API v3 via Service Account RS256 JWT
 * using Deno's native Web Crypto API, uploads the PDF into the target folder,
 * and persists the synchronization outcome back to public.documents.
 *
 * Required environment variables:
 *   - SUPABASE_URL                 : Supabase project URL (auto-injected)
 *   - SUPABASE_SERVICE_ROLE_KEY    : Service-role key for admin DB/Storage access (auto-injected)
 *   - GOOGLE_SERVICE_ACCOUNT_EMAIL : Google Service Account email
 *   - GOOGLE_PRIVATE_KEY           : Service Account PKCS#8 private key (PEM)
 *   - GOOGLE_DRIVE_FOLDER_ID       : Target Google Drive folder ID
 */

import { serve } from "std/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Constants & Types

const STORAGE_BUCKET = "sgc-files";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const APPROVED_STATUSES = new Set(["APPROVED", "Aprobado"]);
const MAX_ERROR_LENGTH = 500;

interface DocumentRecord {
  id: number;
  code: string | null;
  title: string | null;
  version: number | null;
  status: string;
  file_url: string | null;
  drive_sync_status?: string | null;
  drive_file_id?: string | null;
  drive_sync_error?: string | null;
  drive_synced_at?: string | null;
}

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: DocumentRecord | null;
  old_record: DocumentRecord | null;
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface DriveUploadResponse {
  id?: string;
  name?: string;
  error?: {
    message?: string;
  };
}

// Helpers

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isApprovedStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && APPROVED_STATUSES.has(status);
}

/**
 * Extracts the relative object path inside the 'sgc-files' bucket from either
 * a full Supabase Storage URL or an already-relative object path.
 */
function extractStoragePath(fileUrlOrPath: string): string {
  const trimmed = fileUrlOrPath.trim();
  if (!trimmed) {
    return "";
  }

  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return trimmed.replace(/^\/+/, "");
  }

  const cleanUrl = trimmed.split("?")[0];
  const bucketMarker = `/${STORAGE_BUCKET}/`;
  const markerIndex = cleanUrl.indexOf(bucketMarker);

  if (markerIndex !== -1) {
    return decodeURIComponent(cleanUrl.slice(markerIndex + bucketMarker.length));
  }

  const segments = cleanUrl.split("/");
  return decodeURIComponent(segments[segments.length - 1] ?? "");
}

/**
 * Formats the Google Drive filename as "[CODE] Title (vVersion).pdf",
 * sanitizing filesystem/Drive unsafe characters and formatting versions cleanly.
 */
function formatDriveFileName(record: DocumentRecord): string {
  const sanitize = (value: string): string =>
    value.replace(/[/\\:*?"<>|]/g, "-").trim();

  const code = sanitize(record.code ?? "") || "NO-CODE";
  const title = sanitize(record.title ?? "") || "Untitled Document";

  const numericVersion =
    record.version !== null && record.version !== undefined && Number.isFinite(Number(record.version))
      ? Number(record.version)
      : 0;
  const rawVersion = Number.isInteger(numericVersion)
    ? String(numericVersion)
    : numericVersion.toFixed(1);
  const formattedVersion = `v${rawVersion.length < 2 ? rawVersion.padStart(2, "0") : rawVersion}`;

  return `[${code}] ${title} (${formattedVersion}).pdf`;
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeJson(obj: Record<string, unknown>): string {
  const encoded = new TextEncoder().encode(JSON.stringify(obj));
  return base64UrlEncodeBytes(encoded);
}

/**
 * Normalizes escaped newlines in a PEM string and extracts raw PKCS#8 DER bytes.
 */
function pemToPkcs8Der(privateKeyPem: string): Uint8Array {
  const normalized = privateKeyPem.replace(/\\n/g, "\n");
  const base64Body = normalized
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

  if (!base64Body) {
    throw new Error("Google private key PEM content is empty or invalid.");
  }

  const binary = atob(base64Body);
  const derBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    derBytes[i] = binary.charCodeAt(i);
  }
  return derBytes;
}

/**
 * Generates an RS256-signed Service Account JWT using Web Crypto and exchanges
 * it for a short-lived Google OAuth2 access token.
 * Never logs the private key, JWT assertion, or returned access token.
 */
async function getGoogleAccessToken(
  serviceAccountEmail: string,
  privateKeyPem: string,
): Promise<string> {
  const derBytes = pemToPkcs8Der(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    derBytes.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const headerSegment = base64UrlEncodeJson({ alg: "RS256", typ: "JWT" });
  const claimSegment = base64UrlEncodeJson({
    iss: serviceAccountEmail,
    scope: GOOGLE_DRIVE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  });

  const signingInput = `${headerSegment}.${claimSegment}`;
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const signatureSegment = base64UrlEncodeBytes(new Uint8Array(signatureBuffer));
  const assertion = `${signingInput}.${signatureSegment}`;

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  let tokenBody: GoogleTokenResponse = {};
  try {
    tokenBody = (await tokenResponse.json()) as GoogleTokenResponse;
  } catch {
    // Fallback handled below via HTTP status
  }

  if (!tokenResponse.ok || !tokenBody.access_token) {
    const reason =
      tokenBody.error_description ??
      tokenBody.error ??
      `HTTP ${tokenResponse.status}`;
    throw new Error(`Google OAuth2 token exchange failed: ${reason}`);
  }

  return tokenBody.access_token;
}

/**
 * Builds a RFC 2387 multipart/related payload pairing JSON metadata with raw PDF bytes.
 */
function buildMultipartRelatedBody(
  metadata: Record<string, unknown>,
  pdfBytes: Uint8Array,
  boundary: string,
): Uint8Array {
  const encoder = new TextEncoder();
  const metadataPart = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/pdf\r\n\r\n`,
  );
  const closingPart = encoder.encode(`\r\n--${boundary}--`);

  const combined = new Uint8Array(
    metadataPart.length + pdfBytes.length + closingPart.length,
  );
  combined.set(metadataPart, 0);
  combined.set(pdfBytes, metadataPart.length);
  combined.set(closingPart, metadataPart.length + pdfBytes.length);

  return combined;
}

/**
 * Uploads the PDF binary to Google Drive API v3 and returns the created Drive file ID.
 */
async function uploadPdfToGoogleDrive(
  accessToken: string,
  fileName: string,
  folderId: string,
  pdfBytes: Uint8Array,
): Promise<string> {
  const boundary = `sgc_drive_${crypto.randomUUID().replace(/-/g, "")}`;
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: "application/pdf",
  };

  const multipartBody = buildMultipartRelatedBody(metadata, pdfBytes, boundary);

  const uploadResponse = await fetch(GOOGLE_DRIVE_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody.buffer as ArrayBuffer,
  });

  let uploadBody: DriveUploadResponse = {};
  try {
    uploadBody = (await uploadResponse.json()) as DriveUploadResponse;
  } catch {
    // Fallback handled below via HTTP status
  }

  if (!uploadResponse.ok || !uploadBody.id) {
    const reason =
      uploadBody.error?.message ?? `HTTP ${uploadResponse.status}`;
    throw new Error(`Google Drive upload failed: ${reason}`);
  }

  return uploadBody.id;
}

/**
 * Persists a concise failure state into public.documents for UI reporting.
 */
async function recordSyncError(
  adminClient: SupabaseClient,
  documentId: number,
  message: string,
): Promise<void> {
  const conciseError = message.slice(0, MAX_ERROR_LENGTH);
  const { error } = await adminClient
    .from("documents")
    .update({
      drive_sync_status: "ERROR",
      drive_sync_error: conciseError,
    })
    .eq("id", documentId);

  if (error) {
    console.error(
      `[sync-document-to-drive] Failed to persist ERROR state for document ${documentId}:`,
      error.message,
    );
  }
}

// Handler

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // 1. Parse webhook payload safely
  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch (err) {
    console.error("[sync-document-to-drive] Invalid JSON payload:", err);
    return jsonResponse({ error: "Invalid JSON payload" }, 200);
  }

  // 2. Filter target events on public.documents
  const record = payload.record;
  if (payload.table !== "documents" || !record?.id) {
    console.log(
      `[sync-document-to-drive] Skipping event: type=${payload.type}, table=${payload.table}`,
    );
    return jsonResponse({ skipped: true }, 200);
  }

  const isStatusTransitionToApproved =
    payload.type === "UPDATE" &&
    isApprovedStatus(record.status) &&
    !isApprovedStatus(payload.old_record?.status);

  const isManualRetry =
    (payload.type === "UPDATE" || payload.type === "INSERT") &&
    isApprovedStatus(record.status) &&
    record.drive_sync_status === "PENDING";

  if (!isStatusTransitionToApproved && !isManualRetry) {
    console.log(
      `[sync-document-to-drive] Skipping document ${record.id}: status=${record.status}, drive_sync_status=${record.drive_sync_status ?? "null"}`,
    );
    return jsonResponse({ skipped: true }, 200);
  }

  // 3. Initialize Supabase Admin Client
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "[sync-document-to-drive] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable",
    );
    return jsonResponse(
      { error: "Server configuration missing — sync aborted" },
      200,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // 4. Execute Storage download, Google OAuth2 auth, Drive upload, and status persistence
  try {
    const serviceAccountEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    const privateKeyPem = Deno.env.get("GOOGLE_PRIVATE_KEY");
    const driveFolderId = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");

    if (!serviceAccountEmail || !privateKeyPem || !driveFolderId) {
      throw new Error(
        "Missing Google Drive credentials or target folder configuration.",
      );
    }

    if (!record.file_url) {
      throw new Error("Document record has no file_url to download.");
    }

    const storagePath = extractStoragePath(record.file_url);
    if (!storagePath) {
      throw new Error("Unable to resolve storage file path from file_url.");
    }

    console.log(
      `[sync-document-to-drive] Downloading document ${record.id} from bucket '${STORAGE_BUCKET}' (${storagePath})`,
    );

    const { data: blobData, error: storageError } = await adminClient.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);

    if (storageError || !blobData) {
      throw new Error(
        `Supabase Storage download failed: ${storageError?.message ?? "Empty response"}`,
      );
    }

    const pdfBytes = new Uint8Array(await blobData.arrayBuffer());

    console.log(
      `[sync-document-to-drive] Authenticating with Google Drive Service Account for document ${record.id}`,
    );
    const accessToken = await getGoogleAccessToken(
      serviceAccountEmail,
      privateKeyPem,
    );

    const fileName = formatDriveFileName(record);
    console.log(
      `[sync-document-to-drive] Uploading '${fileName}' to Google Drive for document ${record.id}`,
    );
    const driveFileId = await uploadPdfToGoogleDrive(
      accessToken,
      fileName,
      driveFolderId,
      pdfBytes,
    );

    const syncedAt = new Date().toISOString();
    const { error: updateError } = await adminClient
      .from("documents")
      .update({
        drive_sync_status: "SYNCED",
        drive_file_id: driveFileId,
        drive_sync_error: null,
        drive_synced_at: syncedAt,
      })
      .eq("id", record.id);

    if (updateError) {
      console.error(
        `[sync-document-to-drive] Uploaded Drive file ${driveFileId} for document ${record.id}, but DB update failed:`,
        updateError.message,
      );
      return jsonResponse(
        {
          success: false,
          document_id: record.id,
          drive_file_id: driveFileId,
          error: `DB status update failed: ${updateError.message}`,
        },
        200,
      );
    }

    console.log(
      `[sync-document-to-drive] Document ${record.id} synced successfully (drive_file_id=${driveFileId})`,
    );

    return jsonResponse(
      {
        success: true,
        document_id: record.id,
        drive_file_id: driveFileId,
        file_name: fileName,
        drive_synced_at: syncedAt,
      },
      200,
    );
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unexpected Google Drive sync error";

    console.error(
      `[sync-document-to-drive] Sync failed for document ${record.id}: ${errorMessage}`,
    );

    await recordSyncError(adminClient, record.id, errorMessage);

    return jsonResponse(
      {
        success: false,
        document_id: record.id,
        error: errorMessage,
      },
      200,
    );
  }
});
