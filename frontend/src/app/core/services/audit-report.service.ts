import { Injectable, signal } from '@angular/core';
import { supabase } from '../supabase/supabase.client';
import type { AuditRecord } from '../models/audit.model';

export type { AuditRecord };

/**
 * AuditReportService manages fetching and state handling for ISO 9001
 * document reading audit records from the `audit_acknowledgements_view`.
 */
@Injectable({ providedIn: 'root' })
export class AuditReportService {
  private readonly _records = signal<AuditRecord[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  /** Direct Supabase client instance reference. */
  readonly supabase = supabase;

  /** Readonly signal of the latest loaded audit records. */
  readonly records = this._records.asReadonly();

  /** Readonly signal indicating if a request is in flight. */
  readonly loading = this._loading.asReadonly();

  /** Readonly signal containing error messages if a query fails. */
  readonly error = this._error.asReadonly();

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
}

