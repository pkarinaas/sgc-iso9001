# Supabase Edge Functions

This directory contains Deno/TypeScript Edge Functions deployed to Supabase.

## Functions

### `send-email-notification`

Triggered automatically by a **Supabase Database Webhook** whenever a new row is `INSERT`ed
into the `public.notifications` table. It resolves the recipient's email via the Admin Client
and sends a transactional email through the [Resend](https://resend.com) API.

**Entry point:** `supabase/functions/send-email-notification/index.ts`

---

## Required Environment Variables

Configure these in **Supabase Dashboard → Edge Functions → Secrets** (or via the CLI):

| Variable | Description | Auto-injected? |
|---|---|---|
| `SUPABASE_URL` | Your Supabase project URL | ✅ Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (bypasses RLS for admin queries) | ✅ Yes |
| `RESEND_API_KEY` | API key from [resend.com](https://resend.com) | ❌ Manual |
| `EMAIL_FROM` | Verified sender address (e.g. `SGC <noreply@yourdomain.com>`) | ❌ Manual |
| `APP_URL` | Public URL of the SGC app (used in email CTA button) | ❌ Manual |

---

## Supabase Database Webhook Setup

1. Go to **Supabase Dashboard → Database → Webhooks**.
2. Click **Create a new hook**.
3. Configure:
   - **Name:** `on_notification_insert`
   - **Table:** `public.notifications`
   - **Events:** ✅ Insert
   - **Type:** Supabase Edge Functions
   - **Function:** `send-email-notification`
4. Save the hook.

> The webhook sends a POST request with the payload:
> ```json
> {
>   "type": "INSERT",
>   "table": "notifications",
>   "schema": "public",
>   "record": { "id": "...", "user_id": "...", "type": "...", "message": "...", ... },
>   "old_record": null
> }
> ```

---

## Supported Notification Types → Email Subjects

| `type` value | Email subject (ES) |
|---|---|
| `REVIEW_REQUIRED` | Acción requerida: Documento pendiente de revisión |
| `DOCUMENT_APPROVED` | Nuevo documento aprobado disponible en el SGC |
| `READ_RECEIPT_REQUIRED` | Acción requerida: Confirmar lectura de documento |
| *(any other)* | Nueva notificación del Sistema de Gestión de Calidad |

---

## Error Handling Strategy

The function **always returns HTTP 200** to Supabase, even on failures, to prevent the
webhook from entering a retry loop that could cause email spam. All errors are logged via
`console.error` and visible in **Supabase Dashboard → Edge Functions → Logs**.

---

## Local Development

```bash
# Install Supabase CLI (if not already installed)
# https://supabase.com/docs/guides/cli

# Serve functions locally
supabase functions serve send-email-notification --env-file .env.local

# Example test request
curl -X POST http://localhost:54321/functions/v1/send-email-notification \
  -H "Content-Type: application/json" \
  -d '{
    "type": "INSERT",
    "table": "notifications",
    "schema": "public",
    "record": {
      "id": "test-uuid",
      "user_id": "your-user-uuid",
      "document_id": null,
      "type": "DOCUMENT_APPROVED",
      "message": "El documento SGC-PR-001 ha sido aprobado.",
      "is_read": false,
      "created_at": "2026-11-15T12:00:00Z"
    },
    "old_record": null
  }'
```
