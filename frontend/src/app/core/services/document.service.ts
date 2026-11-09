import { Injectable, signal } from '@angular/core';
import { supabase } from '../supabase/supabase.client';
import type { Document, DocumentStatus } from '../models/document.model';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';

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

  /** Direct Supabase client instance reference. */
  readonly supabase = supabase;

  /** List of documents returned by the last successful `loadDocuments()` call. */
  readonly documents = this._documents.asReadonly();

  /** True while the Supabase request is in-flight. */
  readonly loading = this._loading.asReadonly();

  /** Contains the error message of the last failed request, or null. */
  readonly error = this._error.asReadonly();

  // Data-writing methods

  /**
   * Deletes a document from `public.documents` by its ID.
   *
   * @param id - The ID of the document to delete.
   * @throws Error message if DB deletion fails.
   */
  async deleteDocument(id: number | string): Promise<void> {
    const { error } = await supabase.from('documents').delete().eq('id', id);

    if (error) {
      throw new Error(
        `Error al eliminar el documento: ${this.translateDatabaseError(error.message)}`,
      );
    }
  }

  /**
   * Updates the lifecycle status of a document in `public.documents`.
   *
   * @param id - The ID of the document to update.
   * @param status - The new lifecycle status.
   * @throws Error with message if DB update fails.
   */
  async updateDocumentStatus(id: number | string, status: DocumentStatus): Promise<void> {
    const { error } = await supabase.from('documents').update({ status }).eq('id', id);

    if (error) {
      throw new Error(
        `Error al actualizar el estado del documento: ${this.translateDatabaseError(error.message)}`,
      );
    }
  }

  /**
   * Updates an existing document's metadata (title, code, process_area) in `public.documents`.
   *
   * @param id - The ID of the document to update.
   * @param metadata - Partial document metadata containing fields to update.
   * @throws Error with a user-friendly message if DB update fails.
   */
  async updateDocument(id: number | string, metadata: Partial<Document>): Promise<void> {
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (metadata.title !== undefined) {
      updatePayload['title'] = metadata.title.trim();
    }
    if (metadata.code !== undefined) {
      updatePayload['code'] = metadata.code?.trim() || null;
    }
    if (metadata.process_area !== undefined) {
      updatePayload['process_area'] = metadata.process_area || null;
    }

    const { error } = await supabase.from('documents').update(updatePayload).eq('id', id);

    if (error) {
      throw new Error(
        `Error al actualizar el documento: ${this.translateDatabaseError(error.message)}`,
      );
    }
  }

  /**
   * Fetches approved documents belonging to the specified user's assigned process areas
   * that have not yet been acknowledged by the user.
   *
   * @param userId - UUID of the authenticated user.
   * @param userAreas - Array of process areas assigned to the user.
   * @returns Array of pending unacknowledged Document objects.
   */
  async getPendingDocuments(userId: string, userAreas: string[]): Promise<Document[]> {
    if (!userId || !userAreas || userAreas.length === 0) {
      return [];
    }

    // Query approved documents in user's assigned process areas
    const { data: approvedDocs, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('status', 'APPROVED')
      .in('process_area', userAreas)
      .order('updated_at', { ascending: false });

    if (docError || !approvedDocs || approvedDocs.length === 0) {
      return [];
    }

    // Query acknowledgements for this user
    const { data: acks, error: ackError } = await supabase
      .from('document_acknowledgements')
      .select('document_id')
      .eq('user_id', userId);

    if (ackError) {
      return approvedDocs as Document[];
    }

    // Filter documents keeping only those not in acknowledgements
    const ackDocIds = new Set(
      (acks ?? []).map((ack: { document_id: number | string }) => String(ack.document_id)),
    );

    return (approvedDocs as Document[]).filter((doc) => !ackDocIds.has(String(doc.id)));
  }

  /**
   * Records a user's mandatory reading acknowledgement for a document in
   * `public.document_acknowledgements`.
   *
   * @param documentId - The ID of the acknowledged document.
   * @param userId - The ID of the acknowledging user.
   * @returns Supabase response or inserted acknowledgement record.
   * @throws Error if documentId or userId is missing or if DB insertion fails.
   */
  async acknowledgeDocument(documentId: string | number, userId: string): Promise<any> {
    if (!documentId || !userId) {
      throw new Error('Faltan datos obligatorios para confirmar la lectura.');
    }

    const { data, error } = await this.supabase
      .from('document_acknowledgements')
      .insert({ document_id: documentId, user_id: userId })
      .select();

    if (error) {
      throw new Error(
        `Error al registrar confirmación de lectura: ${this.translateDatabaseError(error.message)}`,
      );
    }

    return data;
  }

  /**
   * Fetches aggregated metrics for the dashboard via the get_dashboard_metrics RPC.
   *
   * @returns Aggregated metrics payload containing documentsByStatus and totalAcknowledgements.
   * @throws Error if the RPC execution fails.
   */
  async getDashboardMetrics(): Promise<any> {
    const { data, error } = await this.supabase.rpc('get_dashboard_metrics');

    if (error) {
      throw new Error(
        `Error al obtener métricas del dashboard: ${this.translateDatabaseError(error.message)}`,
      );
    }

    return data;
  }

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
  /**
   * Retrieves the next version number for a given document code.
   *  - If documents with the code exist: returns max(version) + 1.
   *  - If no documents exist with the code: returns 0.
   *
   * @param code - The document code to look up.
   * @returns Next integer version number (0, 1, 2, ...).
   */
  async getNextVersionForCode(code: string): Promise<number> {
    const cleanCode = code?.trim();
    if (!cleanCode) {
      return 0;
    }

    const { data, error } = await supabase
      .from('documents')
      .select('version')
      .eq('code', cleanCode)
      .order('version', { ascending: false })
      .limit(1);

    if (
      error ||
      !data ||
      data.length === 0 ||
      data[0].version === null ||
      data[0].version === undefined
    ) {
      return 0;
    }

    return Number(data[0].version) + 1;
  }

  async createDocument(file: File, metadata: Partial<Document>): Promise<void> {
    const cleanCode = metadata.code?.trim() || null;
    let nextVersion = 0;

    if (cleanCode) {
      const { data: versionData } = await supabase
        .from('documents')
        .select('version')
        .eq('code', cleanCode)
        .order('version', { ascending: false })
        .limit(1);

      if (
        versionData &&
        versionData.length > 0 &&
        versionData[0].version !== null &&
        versionData[0].version !== undefined
      ) {
        nextVersion = Number(versionData[0].version) + 1;
      }
    } else if (metadata.version !== undefined && metadata.version !== null) {
      nextVersion = Number(metadata.version);
    }

    const titleSlug = (metadata.title ?? '').trim().replace(/\s+/g, '_');
    const versionStr = String(nextVersion).padStart(2, '0');
    const fileName = cleanCode
      ? `${cleanCode}_${titleSlug}_v${versionStr}.pdf`
      : `${titleSlug}_v${versionStr}.pdf`;

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
      code: cleanCode,
      version: nextVersion,
      process_area: metadata.process_area ?? null,
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

  // Storage & file access methods

  /**
   * Extracts the relative file path inside the 'sgc-files' storage bucket from a given
   * full Supabase storage URL or relative path string.
   *
   * @param fileUrlOrPath - The complete URL or relative path to the stored document.
   * @returns The relative storage path suitable for Supabase Storage API calls.
   */
  extractFilePath(fileUrlOrPath: string): string {
    if (!fileUrlOrPath) {
      return '';
    }
    if (!fileUrlOrPath.startsWith('http://') && !fileUrlOrPath.startsWith('https://')) {
      return fileUrlOrPath;
    }
    const bucketMarker = '/sgc-files/';
    const index = fileUrlOrPath.indexOf(bucketMarker);
    if (index !== -1) {
      const extracted = fileUrlOrPath.substring(index + bucketMarker.length);
      return decodeURIComponent(extracted.split('?')[0]);
    }
    const segments = fileUrlOrPath.split('?')[0].split('/');
    return decodeURIComponent(segments[segments.length - 1] || '');
  }

  /**
   * Generates a temporary signed URL (valid for 60 seconds) for securely viewing
   * a PDF document stored in the 'sgc-files' Supabase storage bucket.
   *
   * @param filePath - The full URL or relative file path of the document.
   * @returns The signed URL string, or null if the generation fails.
   */
  async getSignedDocumentUrl(filePath: string): Promise<string | null> {
    if (!filePath) {
      return null;
    }

    const relativePath = this.extractFilePath(filePath);
    if (!relativePath) {
      return null;
    }

    try {
      const { data, error } = await supabase.storage
        .from('sgc-files')
        .createSignedUrl(relativePath, 60);

      if (error || !data?.signedUrl) {
        console.error('Error creating signed URL for document:', error?.message);
        return null;
      }

      return data.signedUrl;
    } catch (err) {
      console.error('Unexpected error generating signed URL:', err);
      return null;
    }
  }

  /**
   * Downloads a document from Supabase Storage, applies an indelible watermark
   * ("COPIA NO CONTROLADA - [Date]") across all pages using pdf-lib, and triggers
   * a client-side browser download without modifying the original stored file.
   *
   * @param filePath - The full URL or relative file path of the document in storage.
   * @param documentCode - The document code (e.g. 'PE-03') used to name the downloaded file.
   * @param documentTitle - The document title (e.g. 'Control Calidad') used to name the downloaded file.
   */
  async downloadWatermarkedDocument(
    filePath: string,
    documentCode?: string,
    documentTitle?: string,
  ): Promise<void> {
    if (!filePath) {
      throw new Error('No se proporcionó una ruta de archivo válida.');
    }

    const relativePath = this.extractFilePath(filePath);
    if (!relativePath) {
      throw new Error('No se pudo determinar la ubicación del archivo en el repositorio.');
    }

    // Fetch the file from Supabase Storage
    const { data: blobData, error: downloadError } = await supabase.storage
      .from('sgc-files')
      .download(relativePath);

    if (downloadError || !blobData) {
      throw new Error(
        `Error al descargar el archivo: ${this.translateStorageError(downloadError?.message ?? '')}`,
      );
    }

    // Convert the downloaded Blob to an ArrayBuffer
    const arrayBuffer = await blobData.arrayBuffer();

    // Load the PDF with pdf-lib
    const pdfDoc = await PDFDocument.load(arrayBuffer);

    // Iterate through all pages and apply diagonal watermark
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();
    const formattedDate = new Date().toLocaleDateString('es-AR');
    const watermarkText = `COPIA NO CONTROLADA - ${formattedDate}`;

    for (const page of pages) {
      const { width, height } = page.getSize();
      page.drawText(watermarkText, {
        font,
        x: width / 2 - 240,
        y: height / 2 - 180,
        size: 36,
        color: rgb(0.85, 0.25, 0.25),
        opacity: 0.15,
        rotate: degrees(35),
      });
    }

    // Save the modified document
    const pdfBytes = await pdfDoc.save();

    // Trigger browser download using a temporary <a> tag
    const watermarkedBlob = new Blob([pdfBytes as unknown as BlobPart], {
      type: 'application/pdf',
    });
    const blobUrl = URL.createObjectURL(watermarkedBlob);
    const link = document.createElement('a');
    link.href = blobUrl;

    const baseCode = (documentCode || 'DOCUMENTO').trim().replace(/[\/\\]/g, '_');
    const safeTitle = (documentTitle || 'UNTITLED').trim().replace(/[^a-zA-Z0-9]/g, '_');

    link.download = `${baseCode}_${safeTitle}_COPIA_NO_CONTROLADA.pdf`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
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
