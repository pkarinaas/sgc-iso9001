/**
 * Supabase Edge Function: send-email-notification
 *
 * Triggered by a Supabase Database Webhook on INSERT into public.notifications.
 * Fetches the recipient's email via the Supabase Admin Client, then sends a
 * transactional email through the Resend API.
 *
 * Required environment variables (set in Supabase Dashboard > Edge Functions > Secrets):
 *   - SUPABASE_URL          : Your Supabase project URL (auto-injected in hosted env).
 *   - SUPABASE_SERVICE_ROLE_KEY : Service-role key for admin-level DB access (auto-injected).
 *   - RESEND_API_KEY        : API key from https://resend.com
 *   - EMAIL_FROM            : Verified sender address in Resend (e.g. "SGC <noreply@yourdomain.com>")
 */

import { serve } from "std/server";
import { createClient } from "@supabase/supabase-js";

// Types

/** Shape of a row in public.notifications */
interface NotificationRecord {
  id: string;
  user_id: string;
  document_id: number | null;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

/** Supabase Database Webhook payload structure for INSERT events */
interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: NotificationRecord;
  old_record: NotificationRecord | null;
}

/** Minimal Resend send-email request body */
interface ResendEmailPayload {
  from: string;
  to: string;
  subject: string;
  html: string;
}

// Helpers

/**
 * Maps a notification type code to a human-readable Spanish email subject line.
 */
function buildEmailSubject(notificationType: string): string {
  const subjects: Record<string, string> = {
    REVIEW_REQUIRED: "Acción requerida: Documento pendiente de revisión",
    DOCUMENT_APPROVED: "Nuevo documento aprobado disponible en el SGC",
    READ_RECEIPT_REQUIRED: "Acción requerida: Confirmar lectura de documento",
  };
  return (
    subjects[notificationType] ??
    "Nueva notificación del Sistema de Gestión de Calidad"
  );
}

/**
 * Builds a simple HTML email body from the notification message.
 * Production implementations should use a template engine or Resend React templates.
 */
function buildEmailHtml(message: string, notificationType: string): string {
  const appUrl = Deno.env.get("APP_URL") ?? "https://your-sgc-app.com";

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notificación SGC</title>
</head>
<body style="margin:0;padding:0;font-family:sans-serif;background:#f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <!-- Header -->
    <tr>
      <td style="background:#881337;padding:24px 32px;">
        <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">
          Sistema de Gestión de Calidad
        </h1>
        <p style="color:#fda4af;margin:4px 0 0;font-size:13px;">ISO 9001</p>
      </td>
    </tr>
    <!-- Body -->
    <tr>
      <td style="padding:32px;">
        <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px;">
          ${message}
        </p>
        <a href="${appUrl}"
           style="display:inline-block;background:#881337;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">
          Ir al SGC
        </a>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="background:#f1f5f9;padding:16px 32px;">
        <p style="color:#94a3b8;font-size:12px;margin:0;">
          Este mensaje fue generado automáticamente. Tipo: <code>${notificationType}</code>.
          Por favor no responda a este correo.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

// Handler

serve(async (req: Request): Promise<Response> => {
  // Only accept POST requests (Supabase webhooks always POST)
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- 1. Parse webhook payload ---
  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch (err) {
    console.error(
      "[send-email-notification] Failed to parse webhook payload:",
      err,
    );
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Guard: only process INSERT events on the notifications table
  if (payload.type !== "INSERT" || payload.table !== "notifications") {
    console.log(
      `[send-email-notification] Skipping event: type=${payload.type}, table=${payload.table}`,
    );
    return new Response(JSON.stringify({ skipped: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const record = payload.record;
  if (!record?.user_id || !record?.message || !record?.type) {
    console.error(
      "[send-email-notification] Incomplete notification record:",
      record,
    );
    // Return 200 to prevent webhook retry storms
    return new Response(
      JSON.stringify({ error: "Incomplete record — email not sent", record }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // --- 2. Bootstrap Supabase Admin Client ---
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "[send-email-notification] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
    return new Response(
      JSON.stringify({ error: "Server misconfiguration — email not sent" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // The service-role client bypasses RLS; use strictly for admin lookups.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- 3. Resolve recipient email from public.users ---
  let recipientEmail: string;
  try {
    const { data: userData, error: userError } = await adminClient
      .from("users")
      .select("email, full_name")
      .eq("id", record.user_id)
      .single();

    if (userError || !userData?.email) {
      throw new Error(userError?.message ?? "User not found");
    }

    recipientEmail = userData.email;
    console.log(
      `[send-email-notification] Resolved recipient: ${userData.full_name} <${recipientEmail}>`,
    );
  } catch (err) {
    console.error(
      "[send-email-notification] Failed to resolve recipient email:",
      err,
    );
    // Return 200 — do not retry if the user no longer exists
    return new Response(
      JSON.stringify({ error: "Could not resolve recipient — email not sent" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // --- 4. Build email payload ---
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM") ?? "SGC <noreply@example.com>";

  if (!resendApiKey) {
    console.error("[send-email-notification] RESEND_API_KEY is not configured");
    return new Response(
      JSON.stringify({
        error: "Email provider not configured — email not sent",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const emailPayload: ResendEmailPayload = {
    from: emailFrom,
    to: recipientEmail,
    subject: buildEmailSubject(record.type),
    html: buildEmailHtml(record.message, record.type),
  };

  // --- 5. Send email via Resend API ---
  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify(emailPayload),
    });

    const resendBody = await resendResponse.json();

    if (!resendResponse.ok) {
      // Log error but return 200 to avoid webhook retry loops
      console.error(
        `[send-email-notification] Resend API error (${resendResponse.status}):`,
        resendBody,
      );
      return new Response(
        JSON.stringify({ error: "Email delivery failed", details: resendBody }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    console.log(
      `[send-email-notification] Email sent successfully. Resend ID: ${resendBody?.id}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        notification_id: record.id,
        resend_id: resendBody?.id,
        recipient: recipientEmail,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(
      "[send-email-notification] Network error calling Resend:",
      err,
    );
    // Return 200 to prevent webhook retry storms on transient network failures
    return new Response(
      JSON.stringify({
        error: "Network error sending email",
        message: (err as Error).message,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
});
