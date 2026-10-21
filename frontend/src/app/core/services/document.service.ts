import { Injectable, signal } from '@angular/core';
import { supabase } from '../supabase/supabase.client';
import type { Document } from '../models/document.model';

/**
 * DocumentService manages the reactive state for the Document Repository feature.
 *
 * All state is exposed as read-only Angular Signals so that components can
 * bind directly without manual subscriptions.
 */
@Injectable({ providedIn: 'root' })
export class DocumentService {
  // State signals (writable internally, read-only externally)

  private readonly _documents = signal<Document[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  /** List of documents returned by the last successful `loadDocuments()` call. */
  readonly documents = this._documents.asReadonly();

  /** True while the Supabase request is in-flight. */
  readonly loading = this._loading.asReadonly();

  /** Contains the error message of the last failed request, or null. */
  readonly error = this._error.asReadonly();

  // Data-loading methods

  /**
   * Fetches all documents from `public.documents` ordered by `updated_at`
   * descending so the most recently modified documents appear first.
   */
  async loadDocuments(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      this._error.set(error.message);
    } else {
      this._documents.set((data as Document[]) ?? []);
    }

    this._loading.set(false);
  }
}
