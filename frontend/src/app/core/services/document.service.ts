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

  // Data-writing methods

  /**
   * Uploads a PDF file to Supabase Storage (`sgc-files` bucket) and inserts a
   * new row in `public.documents` with the provided metadata.
   *
   * File naming convention:
   *  - With code:    `[code]_[title_no_spaces]_v[version].pdf`
   *  - Without code: `[title_no_spaces]_v[version].pdf`
   *
   * @param file     - The PDF File object selected by the user.
   * @param metadata - Partial document metadata (title, code, version).
   * @throws Error with a descriptive message when Storage upload or DB insert fails.
   */
  async createDocument(file: File, metadata: Partial<Document>): Promise<void> {
    const titleSlug = (metadata.title ?? '').trim().replace(/\s+/g, '_');
    const version = metadata.version ?? '00';
    const fileName = metadata.code?.trim()
      ? `${metadata.code.trim()}_${titleSlug}_v${version}.pdf`
      : `${titleSlug}_v${version}.pdf`;

    // Upload file to Storage (with upsert: true in case a retry happens)
    const { error: storageError } = await supabase.storage
      .from('sgc-files')
      .upload(fileName, file, { upsert: true });

    if (storageError) {
      throw new Error(
        `Error al subir el archivo: ${this.translateStorageError(storageError.message)}`,
      );
    }

    // Retrieve public URL
    const { data: urlData } = supabase.storage.from('sgc-files').getPublicUrl(fileName);

    const fileUrl = urlData.publicUrl;

    // Insert metadata into public.documents (creator_id is injected by DB default)
    const { error: dbError } = await supabase.from('documents').insert({
      title: metadata.title,
      code: metadata.code?.trim() || null,
      version: metadata.version !== undefined ? Number(metadata.version) : 0,
      file_url: fileUrl,
    });

    if (dbError) {
      // Remove uploaded file to avoid orphaned storage objects
      await supabase.storage.from('sgc-files').remove([fileName]);
      throw new Error(
        `Error al registrar el documento: ${this.translateDatabaseError(dbError.message)}`,
      );
    }
  }

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
      this._error.set(
        `Error al cargar los documentos: ${this.translateDatabaseError(error.message)}`,
      );
    } else {
      this._documents.set((data as Document[]) ?? []);
    }

    this._loading.set(false);
  }

  // Error translation helpers

  /**
   * Translates Supabase Storage error messages into user-friendly Spanish.
   */
  private translateStorageError(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('row-level security') || lower.includes('policy')) {
      return 'No tienes permisos para subir archivos al repositorio.';
    }
    if (lower.includes('already exists') || lower.includes('duplicate')) {
      return 'Ya existe un archivo con este nombre en el almacenamiento.';
    }
    if (lower.includes('bucket not found')) {
      return 'El repositorio de almacenamiento no está configurado.';
    }
    if (
      lower.includes('payload too large') ||
      lower.includes('entity too large') ||
      lower.includes('size')
    ) {
      return 'El archivo supera el tamaño máximo permitido.';
    }
    if (lower.includes('jwt') || lower.includes('token') || lower.includes('expired')) {
      return 'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.';
    }
    return message;
  }

  /**
   * Translates Supabase Database / PostgREST error messages into user-friendly Spanish.
   */
  private translateDatabaseError(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('row-level security') || lower.includes('policy')) {
      return 'No tienes permisos para realizar esta operación en la base de datos.';
    }
    if (lower.includes('duplicate key') || lower.includes('unique constraint')) {
      return 'Ya existe un documento con ese código.';
    }
    if (lower.includes('foreign key')) {
      return 'El usuario creador u otra referencia asociada no es válida.';
    }
    if (lower.includes('not-null')) {
      return 'Faltan campos obligatorios para guardar el documento.';
    }
    if (lower.includes('jwt') || lower.includes('token') || lower.includes('expired')) {
      return 'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.';
    }
    return message;
  }
}
