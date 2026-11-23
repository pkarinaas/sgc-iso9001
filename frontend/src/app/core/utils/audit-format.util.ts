import type { AuditActionType, AuditLogEntry } from '../models/audit.model';

/** Visual pastel color palette variants matching the SGC design system. */
export type AuditBadgeVariant = 'blue' | 'green' | 'amber' | 'indigo' | 'teal' | 'rose' | 'slate';

/** Presentation metadata used to render audit timeline markers and action badges. */
export interface AuditActionPresentation {
  label: string;
  icon: string;
  variant: AuditBadgeVariant;
}

/** Dropdown options for filtering audit logs by action type in Spanish. */
export const AUDIT_ACTION_OPTIONS: { label: string; value: AuditActionType | null }[] = [
  { label: 'Todas las acciones', value: null },
  { label: 'Creación', value: 'DOCUMENT_CREATED' },
  { label: 'Nueva versión', value: 'VERSION_UPLOADED' },
  { label: 'Edición', value: 'DOCUMENT_UPDATED' },
  { label: 'Cambio de estado', value: 'STATUS_CHANGED' },
  { label: 'Aprobación', value: 'DOCUMENT_APPROVED' },
  { label: 'Eliminación', value: 'DOCUMENT_DELETED' },
  { label: 'Acuse de lectura', value: 'READ_ACKNOWLEDGED' },
  { label: 'Respaldo Drive', value: 'DRIVE_SYNC_SUCCESS' },
  { label: 'Error de respaldo', value: 'DRIVE_SYNC_ERROR' },
];

/**
 * Returns the Spanish label, PrimeIcon class, and pastel palette variant
 * corresponding to the given audit action key.
 */
export function getAuditActionPresentation(action: string): AuditActionPresentation {
  switch (action) {
    case 'DOCUMENT_CREATED':
      return { label: 'Creación', icon: 'pi pi-file-plus', variant: 'blue' };
    case 'VERSION_UPLOADED':
      return { label: 'Nueva versión', icon: 'pi pi-file-plus', variant: 'blue' };
    case 'DOCUMENT_UPDATED':
      return { label: 'Edición', icon: 'pi pi-pencil', variant: 'amber' };
    case 'DOCUMENT_APPROVED':
      return { label: 'Aprobación', icon: 'pi pi-check-circle', variant: 'green' };
    case 'STATUS_CHANGED':
      return { label: 'Cambio de estado', icon: 'pi pi-sync', variant: 'amber' };
    case 'DOCUMENT_DELETED':
      return { label: 'Eliminación', icon: 'pi pi-trash', variant: 'rose' };
    case 'READ_ACKNOWLEDGED':
      return { label: 'Acuse de lectura', icon: 'pi pi-eye', variant: 'indigo' };
    case 'DRIVE_SYNC_SUCCESS':
      return { label: 'Respaldo Drive', icon: 'pi pi-cloud', variant: 'teal' };
    case 'DRIVE_SYNC_ERROR':
      return { label: 'Error de respaldo', icon: 'pi pi-exclamation-circle', variant: 'rose' };
    default:
      return { label: action, icon: 'pi pi-history', variant: 'slate' };
  }
}

/**
 * Translates an internal workflow status code into its Spanish display label.
 */
export function translateAuditStatus(status: string | null | undefined): string {
  if (!status) {
    return '—';
  }
  const labels: Record<string, string> = {
    DRAFT: 'Borrador',
    REVIEWED: 'Revisado',
    APPROVED: 'Aprobado',
    OBSOLETE: 'Obsoleto',
  };
  return labels[status.toUpperCase()] ?? status;
}

function formatAuditVersion(version: number | null | undefined): string {
  if (version === null || version === undefined || Number.isNaN(Number(version))) {
    return 'v00';
  }
  const numeric = Number(version);
  return Number.isInteger(numeric)
    ? `v${String(numeric).padStart(2, '0')}`
    : `v${numeric.toFixed(1)}`;
}

function formatUpdatedFieldLabel(field: string): string {
  const fieldLabels: Record<string, string> = {
    title: 'Título',
    code: 'Código',
    process_area: 'Área / Proceso',
  };
  return fieldLabels[field] ?? field;
}

function isTechnicalDriveError(message: string): boolean {
  return (
    message.length > 160 ||
    /https?:\/\/|\berror:/i.test(message) ||
    /\b(failed|quota|exceeded|storage|service account|oauth|token|invalid|missing|unexpected|unable|timeout|network|forbidden|unauthorized|not found|http\s*\d{3}|google drive upload|supabase|status code|exception|stack|permission denied)\b/i.test(
      message,
    )
  );
}

/**
 * Builds a concise, human-readable Spanish description of the audit event.
 */
export function formatAuditDetail(entry: AuditLogEntry): string {
  const details = entry.details ?? {};
  const versionLabel = formatAuditVersion(entry.doc_version ?? details.document_version);

  switch (entry.action) {
    case 'DOCUMENT_CREATED': {
      const statusLabel = translateAuditStatus(details.new_status ?? 'DRAFT');
      return `Documento creado en estado ${statusLabel} (${versionLabel})`;
    }
    case 'VERSION_UPLOADED':
      return `Nueva versión ${versionLabel} cargada`;
    case 'DOCUMENT_UPDATED': {
      const fields = details.changed_fields ?? [];
      if (fields.length > 0) {
        return `Campos actualizados: ${fields.map(formatUpdatedFieldLabel).join(', ')}`;
      }
      return 'Metadatos del documento actualizados';
    }
    case 'DOCUMENT_APPROVED':
    case 'STATUS_CHANGED': {
      if (details.old_status && details.new_status) {
        return `Estado: ${translateAuditStatus(details.old_status)} → ${translateAuditStatus(details.new_status)}`;
      }
      if (details.new_status) {
        return `Estado actualizado a ${translateAuditStatus(details.new_status)}`;
      }
      return entry.action === 'DOCUMENT_APPROVED'
        ? 'Documento aprobado en el SGC'
        : 'Cambio de estado registrado';
    }
    case 'DOCUMENT_DELETED': {
      const oldStatus = details.old_status
        ? ` en estado ${translateAuditStatus(details.old_status)}`
        : '';
      return `Documento eliminado del repositorio${oldStatus}`;
    }
    case 'READ_ACKNOWLEDGED':
      return 'Confirmó la lectura obligatoria del documento';
    case 'DRIVE_SYNC_SUCCESS':
      return 'Documento respaldado correctamente en Google Drive';
    case 'DRIVE_SYNC_ERROR': {
      const rawError = details.drive_sync_error?.trim();
      if (!rawError || isTechnicalDriveError(rawError)) {
        return 'No se pudo completar el respaldo en Google Drive';
      }
      return rawError;
    }
    default:
      return 'Evento de trazabilidad registrado';
  }
}

/**
 * Resolves the actor display name for an audit log entry.
 */
export function formatAuditActor(entry: AuditLogEntry): string {
  const name = entry.user_name?.trim();
  if (name) {
    return name;
  }
  const email = entry.user_email?.trim();
  if (email) {
    return email;
  }
  if (entry.action === 'DRIVE_SYNC_SUCCESS' || entry.action === 'DRIVE_SYNC_ERROR') {
    return 'Sistema (Google Drive)';
  }
  return 'Sistema';
}

/**
 * Formats an ISO timestamp into `dd/MM/yyyy HH:mm` for audit timelines and tables.
 */
export function formatAuditTimestamp(isoDate: string | null | undefined): string {
  if (!isoDate) {
    return '—';
  }
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Replaces Unicode characters unsupported by jsPDF's default WinAnsi font encoding
 * (arrows, em/en dashes, curly quotes) with ASCII-safe equivalents while preserving
 * standard Spanish accented characters.
 */
export function sanitizeForPdf(text: string): string {
  return text
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}
