/**
 * Model definitions for User Notifications.
 */

export type NotificationType =
  | 'REVIEW_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'DOCUMENT_APPROVED'
  | 'READ_RECEIPT_REQUIRED'
  | string;

export interface AppNotification {
  id: string;
  user_id: string;
  document_id: number | null;
  type: NotificationType;
  message: string;
  is_read: boolean;
  created_at: string;
}

/** Backward-compatible alias for AppNotification. */
export type Notification = AppNotification;
