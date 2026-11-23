import { Injectable, signal } from '@angular/core';
import { supabase } from '../supabase/supabase.client';
import type {
  AuditActionType,
  AuditLogDetails,
  AuditLogEntry,
  AuditLogFilterCriteria,
  AuditRecord,
} from '../models/audit.model';

export type {
  AuditActionType,
  AuditLogDetails,
  AuditLogEntry,
  AuditLogFilterCriteria,
  AuditRecord,
};

interface RawAuditLogUserRelation {
  full_name?: string | null;
  email?: string | null;
}

interface RawAuditLogDocumentRelation {
  code?: string | null;
  title?: string | null;
  version?: number | null;
}

interface RawAuditLogRow {
  id: string;
  user_id: string | null;
  document_id: number | string | null;
  action: string;
  details: AuditLogDetails | null;
  created_at: string;
  users?: RawAuditLogUserRelation | RawAuditLogUserRelation[] | null;
  documents?: RawAuditLogDocumentRelation | RawAuditLogDocumentRelation[] | null;
}

/**
 * AuditReportService manages fetching and state handling for ISO 9001
 * document reading audit records from the `audit_acknowledgements_view`.
 */
@Injectable({ providedIn: 'root' })
export class AuditReportService {
  private static readonly AUDIT_LOG_SELECT =
    'id, user_id, document_id, action, details, created_at, users(full_name, email), documents(code, title, version)';

  private readonly _records = signal<AuditRecord[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _auditLogs = signal<AuditLogEntry[]>([]);
  private readonly _auditLogsLoading = signal<boolean>(false);

  /** Direct Supabase client instance reference. */
  readonly supabase = supabase;

  /** Readonly signal of the latest loaded audit records. */
  readonly records = this._records.asReadonly();

  /** Readonly signal indicating if a request is in flight. */
  readonly loading = this._loading.asReadonly();

  /** Readonly signal containing error messages if a query fails. */
  readonly error = this._error.asReadonly();

  /** Readonly signal of the latest loaded global audit logs. */
  readonly auditLogs = this._auditLogs.asReadonly();

  /** Readonly signal indicating if global audit logs are loading. */
  readonly auditLogsLoading = this._auditLogsLoading.asReadonly();

  /**
   * Fetches audit records from the `audit_acknowledgements_view` PostgreSQL view.
   *
   * @returns Promise resolving to an array of AuditRecord objects.
   * @throws Error with translated details if query execution fails.
   */
  async getAuditRecords(): Promise<AuditRecord[]> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const { data, error } = await this.supabase
        .from('audit_acknowledgements_view')
        .select('*')
        .order('read_at', { ascending: false });

      if (error) {
        console.error('Error fetching audit records from audit_acknowledgements_view:', error);
        const errorMsg = `Error al obtener registros de auditoría: ${error.message}`;
        this._error.set(errorMsg);
        throw new Error(errorMsg);
      }

      const records = (data as unknown as AuditRecord[]) ?? [];
      this._records.set(records);
      return records;
    } catch (err: unknown) {
      if (!this._error()) {
        const message = err instanceof Error ? err.message : '';
        this._error.set(message || 'Error inesperado al consultar registros de auditoría.');
      }
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Fetches the chronological traceability timeline for a single document (newest first).
   *
   * @param documentId - The target document ID.
   * @returns Chronological array of normalized `AuditLogEntry` records.
   */
  async getDocumentHistory(documentId: number | string): Promise<AuditLogEntry[]> {
    const { data, error } = await this.supabase
      .from('audit_logs')
      .select(AuditReportService.AUDIT_LOG_SELECT)
      .eq('document_id', documentId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching document audit history:', error);
      throw new Error(`Error al obtener historial de trazabilidad: ${error.message}`);
    }

    const rows = (data as unknown as RawAuditLogRow[]) ?? [];
    return rows.map((row) => this.normalizeAuditLogRow(row));
  }

  /**
   * Fetches global audit log events ordered newest first, supporting optional
   * user, action, date range, and document search criteria.
   *
   * @param filters - Optional filter criteria.
   * @returns Filtered array of normalized `AuditLogEntry` records.
   */
  async getAuditLogs(filters?: AuditLogFilterCriteria): Promise<AuditLogEntry[]> {
    this._auditLogsLoading.set(true);

    try {
      let query = this.supabase
        .from('audit_logs')
        .select(AuditReportService.AUDIT_LOG_SELECT)
        .order('created_at', { ascending: false });

      if (filters?.userId) {
        query = query.eq('user_id', filters.userId);
      }

      if (filters?.action) {
        query = query.eq('action', filters.action);
      }

      if (filters?.dateFrom) {
        const start = new Date(filters.dateFrom);
        start.setHours(0, 0, 0, 0);
        query = query.gte('created_at', start.toISOString());
      }

      if (filters?.dateTo) {
        const end = new Date(filters.dateTo);
        end.setHours(23, 59, 59, 999);
        query = query.lte('created_at', end.toISOString());
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching audit logs:', error);
        throw new Error(`Error al obtener historial de auditoría: ${error.message}`);
      }

      const rows = (data as unknown as RawAuditLogRow[]) ?? [];
      let normalized = rows.map((row) => this.normalizeAuditLogRow(row));

      const docQuery = filters?.documentQuery?.trim().toLowerCase();
      if (docQuery) {
        normalized = normalized.filter((entry) => {
          const code = (entry.doc_code ?? '').toLowerCase();
          const title = (entry.doc_title ?? '').toLowerCase();
          return code.includes(docQuery) || title.includes(docQuery);
        });
      }

      this._auditLogs.set(normalized);
      return normalized;
    } finally {
      this._auditLogsLoading.set(false);
    }
  }

  private normalizeAuditLogRow(row: RawAuditLogRow): AuditLogEntry {
    const userRel = Array.isArray(row.users) ? row.users[0] : row.users;
    const docRel = Array.isArray(row.documents) ? row.documents[0] : row.documents;
    const details = row.details ?? {};

    return {
      id: row.id,
      user_id: row.user_id,
      document_id: row.document_id,
      action: row.action,
      details,
      created_at: row.created_at,
      user_name: userRel?.full_name ?? null,
      user_email: userRel?.email ?? null,
      doc_code: docRel?.code ?? details.document_code ?? null,
      doc_title: docRel?.title ?? details.document_title ?? null,
      doc_version: docRel?.version ?? details.document_version ?? null,
    };
  }
}

