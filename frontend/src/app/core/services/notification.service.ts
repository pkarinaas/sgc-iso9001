import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase/supabase.client';
import { AuthService } from './auth.service';
import type { AppNotification, Notification } from '../models/notification.model';

export type { AppNotification, Notification };

/**
 * NotificationService manages real-time notifications for the active user.
 * It stores the latest notifications using Angular Signals, derives the unread count,
 * listens to Supabase Realtime INSERT and UPDATE events on the `notifications` table,
 * and provides methods to mark individual or all notifications as read.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {
  /** Supabase client instance reference. */
  readonly supabase = supabase;

  /** Optional injected AuthService instance for retrieving session/user details. */
  private readonly authService = inject(AuthService, { optional: true });

  /** Writable signal holding the latest notifications for the active user. */
  readonly notifications = signal<AppNotification[]>([]);

  /** Derived signal computing the count of unread notifications. */
  readonly unreadCount = computed(
    () => this.notifications().filter((notification) => !notification.is_read).length,
  );

  /** Active Supabase realtime channel instance. */
  private channel: RealtimeChannel | null = null;

  /** Cached active user ID for filtering incoming realtime notifications. */
  currentUserId: string | null = null;

  /** Auth state change subscription reference. */
  private authSubscription: { unsubscribe: () => void } | null = null;

  constructor() {
    this.setupAuthListener();
  }

  /**
   * Sets up the listener on Supabase auth state change to trigger
   * notification loading and realtime channel subscription upon successful login,
   * or clean up upon logout.
   */
  private setupAuthListener(): void {
    try {
      const authResponse = this.supabase?.auth?.onAuthStateChange?.(async (_event, session) => {
        if (session?.user) {
          this.currentUserId = session.user.id;
          await this.loadNotifications(session.user.id);
          this.initializeRealtimeSubscription(session.user.id);
        } else {
          this.currentUserId = null;
          this.notifications.set([]);
          this.cleanupRealtimeSubscription();
        }
      });

      if (authResponse?.data?.subscription) {
        this.authSubscription = authResponse.data.subscription;
      }
    } catch (err) {
      console.warn('NotificationService: could not attach auth listener', err);
    }

    // Check if user session is already present
    this.checkInitialSession();
  }

  /**
   * Checks for an existing active session on boot and initializes state if present.
   */
  async checkInitialSession(): Promise<void> {
    try {
      const activeUser =
        this.authService?.session?.()?.user ??
        (await this.supabase?.auth?.getSession?.())?.data?.session?.user;
      if (activeUser?.id) {
        this.currentUserId = activeUser.id;
        await this.loadNotifications(activeUser.id);
        this.initializeRealtimeSubscription(activeUser.id);
      }
    } catch {
      // Ignore during testing / offline mode
    }
  }

  /**
   * Queries the latest 20 notifications for the current logged-in user ordered by `created_at DESC`
   * and populates the `notifications` signal.
   *
   * @param userId - Optional specific user ID to query for.
   * @returns The loaded array of notifications.
   */
  async loadNotifications(userId?: string): Promise<AppNotification[]> {
    const targetUserId = userId ?? this.currentUserId ?? (await this.resolveCurrentUserId());
    if (!targetUserId) {
      this.notifications.set([]);
      return [];
    }

    this.currentUserId = targetUserId;

    try {
      const { data, error } = await this.supabase
        .from('notifications')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error fetching notifications:', error);
        return this.notifications();
      }

      const list = (data ?? []) as AppNotification[];
      this.notifications.set(list);
      return list;
    } catch (err) {
      console.error('Unexpected error loading notifications:', err);
      return this.notifications();
    }
  }

  /**
   * Subscribes to realtime Postgres changes on the `notifications` table.
   * Handles both INSERT (prepends new notifications for the active user) and
   * UPDATE (updates the `is_read` status of matching notifications).
   *
   * @param userId - Optional user ID for matching notifications.
   * @returns The created RealtimeChannel instance.
   */
  initializeRealtimeSubscription(userId?: string): RealtimeChannel | null {
    const targetUserId = userId ?? this.currentUserId;

    // Clean up any existing channel before subscribing
    this.cleanupRealtimeSubscription();

    try {
      const channel = this.supabase.channel('public:notifications');

      channel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
          },
          (payload: any) => {
            const newRecord = (payload?.new ?? payload?.record ?? payload) as
              | AppNotification
              | undefined;
            const activeUserId = targetUserId ?? this.currentUserId;

            if (
              newRecord?.id &&
              newRecord?.user_id &&
              activeUserId &&
              newRecord.user_id === activeUserId
            ) {
              this.notifications.update((list) => {
                if (list.some((item) => item.id === newRecord.id)) {
                  return list;
                }
                return [newRecord, ...list];
              });
            }
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'notifications',
          },
          (payload: any) => {
            const updatedRecord = (payload?.new ?? payload?.record ?? payload) as
              | Partial<AppNotification>
              | undefined;
            const activeUserId = targetUserId ?? this.currentUserId;

            if (
              updatedRecord?.id &&
              (!updatedRecord.user_id || !activeUserId || updatedRecord.user_id === activeUserId)
            ) {
              this.notifications.update((list) =>
                list.map((item) =>
                  item.id === updatedRecord.id
                    ? { ...item, is_read: Boolean(updatedRecord.is_read) }
                    : item,
                ),
              );
            }
          },
        );

      channel.subscribe();
      this.channel = channel;
      return this.channel;
    } catch (err) {
      console.error('Error establishing notifications realtime channel:', err);
      return null;
    }
  }

  /**
   * Marks a single notification as read in Supabase and updates the local signal immediately.
   * Reverts local state if the database update fails.
   *
   * @param id - The notification UUID to mark as read.
   */
  async markAsRead(id: string): Promise<void> {
    if (!id) {
      return;
    }

    const previousList = this.notifications();
    this.notifications.update((list) =>
      list.map((item) => (item.id === id ? { ...item, is_read: true } : item)),
    );

    try {
      const { error } = await this.supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);

      if (error) {
        console.error('Error marking notification as read:', error);
        this.notifications.set(previousList);
      }
    } catch (err) {
      console.error('Unexpected error marking notification as read:', err);
      this.notifications.set(previousList);
    }
  }

  /**
   * Marks all unread notifications for the active user as read in Supabase
   * and updates the local signal immediately. Reverts local state if the update fails.
   */
  async markAllAsRead(): Promise<void> {
    const targetUserId = this.currentUserId ?? (await this.resolveCurrentUserId());
    if (!targetUserId) {
      return;
    }

    const previousList = this.notifications();
    this.notifications.update((list) =>
      list.map((item) => (item.is_read ? item : { ...item, is_read: true })),
    );

    try {
      const { error } = await this.supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', targetUserId)
        .eq('is_read', false);

      if (error) {
        console.error('Error marking all notifications as read:', error);
        this.notifications.set(previousList);
      }
    } catch (err) {
      console.error('Unexpected error marking all notifications as read:', err);
      this.notifications.set(previousList);
    }
  }

  /**
   * Resolves the current user's ID from AuthService or Supabase session.
   */
  private async resolveCurrentUserId(): Promise<string | null> {
    if (this.currentUserId) {
      return this.currentUserId;
    }

    if (this.authService?.session?.()) {
      const id = this.authService.session()?.user?.id;
      if (id) return id;
    }

    try {
      const { data } = await this.supabase.auth.getSession();
      return data?.session?.user?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Cleans up the active realtime channel subscription.
   */
  cleanupRealtimeSubscription(): void {
    if (this.channel) {
      try {
        this.supabase.removeChannel(this.channel);
      } catch (err) {
        console.warn('Error removing realtime channel:', err);
      }
      this.channel = null;
    }
  }

  /**
   * Lifecycle hook to ensure realtime channels and subscriptions are properly closed.
   */
  ngOnDestroy(): void {
    this.cleanupRealtimeSubscription();
    if (this.authSubscription) {
      try {
        this.authSubscription.unsubscribe();
      } catch {
        // no-op
      }
      this.authSubscription = null;
    }
  }
}
