/**
 * Supabase Edge Function: sync-document-to-drive
 *
 * Triggered by a Supabase Database Webhook on public.documents.
 * Processes approved documents upon approval transition or manual retry
 * (`drive_sync_status === 'PENDING'`), downloads the PDF from Supabase Storage,
 * authenticates with Google Drive API v3 via OAuth 2.0 Refresh Token,
 * uploads the PDF into the target folder, and persists the synchronization
 * outcome (with concise Spanish messages for end-user display) back to public.documents.
 *
 * Required environment variables:
 *   - SUPABASE_URL               : Supabase project URL (auto-injected)
 *   - SUPABASE_SERVICE_ROLE_KEY  : Service-role key for admin DB/Storage access (auto-injected)
 *   - GOOGLE_CLIENT_ID           : Google OAuth 2.0 Client ID
 *   - GOOGLE_CLIENT_SECRET       : Google OAuth 2.0 Client Secret
 *   - GOOGLE_REFRESH_TOKEN       : Google OAuth 2.0 Refresh Token
 *   - GOOGLE_DRIVE_FOLDER_ID     : Target Google Drive folder ID
 */

import { serve } from "std/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Constants & Types

const STORAGE_BUCKET = "sgc-files";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
const APPROVED_STATUSES = new Set(["APPROVED", "Aprobado"]);
const MAX_ERROR_LENGTH = 500;

type SyncErrorStage = "auth" | "storage" | "drive";

class SyncStageError extends Error {
  readonly stage: SyncErrorStage;
  readonly httpStatus?: number;

  constructor(stage: SyncErrorStage, message: string, httpStatus?: number) {
    super(message);
    this.name = "SyncStageError";
    this.stage = stage;
    this.httpStatus = httpStatus;
  }
}

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

/**
 * Maps internal sync failure stages to concise, user-friendly Spanish messages
 * suitable for storing in `public.documents.drive_sync_error` and displaying in the UI.
 */
function toUserFriendlySpanishError(
  stage: "auth" | "storage" | "drive",
  status?: number,
): string {
  if (stage === "auth") {
    return "Error de autenticación con Google Drive. Verifique las credenciales.";
  }
  if (stage === "storage") {
    return "No se pudo obtener el archivo PDF desde el almacenamiento interno.";
  }
  if (status === 404) {
    return "No se encontró la carpeta destino configurada en Google Drive.";
  }
  if (status === 403) {
    return "Permisos insuficientes o cuota excedida en Google Drive.";
  }
  return "No se pudo completar el respaldo en Google Drive. Intente nuevamente.";
}

/**
 * Exchanges a Google OAuth 2.0 Refresh Token for a short-lived access token.
 * Never logs client_secret, refresh_token, or the returned access_token.
 */
async function getGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Network error";
    throw new SyncStageError(
      "auth",
      `Google OAuth2 token request failed: ${reason}`,
    );
  }

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
    throw new SyncStageError(
      "auth",
      `Google OAuth2 token refresh failed (HTTP ${tokenResponse.status}): ${reason}`,
      tokenResponse.status,
    );
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

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(GOOGLE_DRIVE_UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody.buffer as ArrayBuffer,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Network error";
    throw new SyncStageError(
      "drive",
      `Google Drive upload request failed: ${reason}`,
    );
  }

  let uploadBody: DriveUploadResponse = {};
  try {
    uploadBody = (await uploadResponse.json()) as DriveUploadResponse;
  } catch {
    // Fallback handled below via HTTP status
  }

  if (!uploadResponse.ok || !uploadBody.id) {
    const reason =
      uploadBody.error?.message ?? `HTTP ${uploadResponse.status}`;
    throw new SyncStageError(
      "drive",
      `Google Drive upload failed (HTTP ${uploadResponse.status}): ${reason}`,
      uploadResponse.status,
    );
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

  // 4. Execute Storage download, Google OAuth 2.0 auth, Drive upload, and status persistence
  try {
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const googleRefreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
    const driveFolderId = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");

    if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
      throw new SyncStageError(
        "auth",
        "Missing Google OAuth 2.0 credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN).",
      );
    }

    if (!driveFolderId) {
      throw new SyncStageError(
        "drive",
        "Missing GOOGLE_DRIVE_FOLDER_ID environment variable.",
        404,
      );
    }

    if (!record.file_url) {
      throw new SyncStageError(
        "storage",
        "Document record has no file_url to download.",
      );
    }

    const storagePath = extractStoragePath(record.file_url);
    if (!storagePath) {
      throw new SyncStageError(
        "storage",
        "Unable to resolve storage file path from file_url.",
      );
    }

    console.log(
      `[sync-document-to-drive] Downloading document ${record.id} from bucket '${STORAGE_BUCKET}' (${storagePath})`,
    );

    const { data: blobData, error: storageError } = await adminClient.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);

    if (storageError || !blobData) {
      throw new SyncStageError(
        "storage",
        `Supabase Storage download failed: ${storageError?.message ?? "Empty response"}`,
      );
    }

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = new Uint8Array(await blobData.arrayBuffer());
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Failed to read PDF buffer";
      throw new SyncStageError(
        "storage",
        `Failed to read PDF buffer from Supabase Storage: ${reason}`,
      );
    }

    console.log(
      `[sync-document-to-drive] Authenticating with Google OAuth 2.0 for document ${record.id}`,
    );
    const accessToken = await getGoogleAccessToken(
      googleClientId,
      googleClientSecret,
      googleRefreshToken,
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
    const technicalMessage =
      err instanceof Error ? err.message : "Unexpected Google Drive sync error";

    console.error(
      `[sync-document-to-drive] Sync failed for document ${record.id}: ${technicalMessage}`,
    );

    const userFriendlyError =
      err instanceof SyncStageError
        ? toUserFriendlySpanishError(err.stage, err.httpStatus)
        : toUserFriendlySpanishError("drive");

    await recordSyncError(adminClient, record.id, userFriendlyError);

    return jsonResponse(
      {
        success: false,
        document_id: record.id,
        error: userFriendlyError,
      },
      200,
    );
  }
});
