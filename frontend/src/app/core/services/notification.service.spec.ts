import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@angular/core';
import { NotificationService, type AppNotification } from './notification.service';
import { AuthService } from './auth.service';
import { supabase } from '../supabase/supabase.client';

describe('NotificationService', () => {
  let service: NotificationService;
  let authServiceMock: {
    session: ReturnType<typeof signal<any>>;
  };

  let mockChannelInstance: {
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  };

  let registeredCallbacks: Record<string, (payload: any) => void> = {};

  const sampleNotifications: AppNotification[] = [
    {
      id: 'notif-1',
      user_id: 'usr-101',
      document_id: 10,
      type: 'DOCUMENT_APPROVED',
      message: 'Se ha publicado un nuevo documento aprobado',
      is_read: false,
      created_at: '2026-11-18T12:00:00Z',
    },
    {
      id: 'notif-2',
      user_id: 'usr-101',
      document_id: 11,
      type: 'REVIEW_REQUIRED',
      message: 'Hay un nuevo borrador pendiente de revisión',
      is_read: true,
      created_at: '2026-11-17T10:30:00Z',
    },
  ];

  beforeEach(() => {
    registeredCallbacks = {};

    mockChannelInstance = {
      on: vi.fn().mockImplementation((_event, filter, callback) => {
        if (filter?.event) {
          registeredCallbacks[filter.event] = callback;
        }
        return mockChannelInstance;
      }),
      subscribe: vi.fn().mockReturnValue(mockChannelInstance),
      unsubscribe: vi.fn(),
    };

    authServiceMock = {
      session: signal(null),
    };

    vi.spyOn(supabase, 'channel').mockReturnValue(mockChannelInstance as any);
    vi.spyOn(supabase, 'removeChannel').mockReturnValue(undefined as any);

    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        {
          provide: AuthService,
          useValue: authServiceMock,
        },
      ],
    });

    service = TestBed.inject(NotificationService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be created with empty notifications and unreadCount of 0', () => {
    expect(service).toBeTruthy();
    expect(service.notifications()).toEqual([]);
    expect(service.unreadCount()).toBe(0);
  });

  describe('loadNotifications', () => {
    it('should fetch latest 20 notifications ordered by created_at DESC and update unreadCount', async () => {
      const limitMock = vi.fn().mockResolvedValueOnce({
        data: sampleNotifications,
        error: null,
      });
      const orderMock = vi.fn().mockReturnValue({ limit: limitMock });
      const eqMock = vi.fn().mockReturnValue({ order: orderMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });

      const fromSpy = vi.spyOn(service.supabase, 'from').mockReturnValue({
        select: selectMock,
      } as any);

      const result = await service.loadNotifications('usr-101');

      expect(fromSpy).toHaveBeenCalledWith('notifications');
      expect(selectMock).toHaveBeenCalledWith('*');
      expect(eqMock).toHaveBeenCalledWith('user_id', 'usr-101');
      expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(limitMock).toHaveBeenCalledWith(20);
      expect(result).toEqual(sampleNotifications);
      expect(service.notifications()).toEqual(sampleNotifications);
      expect(service.unreadCount()).toBe(1);
    });

    it('should preserve existing notifications when database query returns an error', async () => {
      service.notifications.set(sampleNotifications);

      const limitMock = vi.fn().mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' },
      });

      vi.spyOn(service.supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({ limit: limitMock }),
          }),
        }),
      } as any);

      const result = await service.loadNotifications('usr-101');

      expect(result).toEqual(sampleNotifications);
      expect(service.notifications()).toEqual(sampleNotifications);
      expect(service.unreadCount()).toBe(1);
    });

    it('should clear notifications when no user can be resolved', async () => {
      service.notifications.set(sampleNotifications);
      authServiceMock.session.set(null);
      service.currentUserId = null;

      vi.spyOn(service.supabase.auth, 'getSession').mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });

      const result = await service.loadNotifications();

      expect(result).toEqual([]);
      expect(service.notifications()).toEqual([]);
      expect(service.unreadCount()).toBe(0);
    });
  });

  describe('initializeRealtimeSubscription', () => {
    it('should subscribe to INSERT and UPDATE events on public:notifications', () => {
      service.currentUserId = 'usr-101';
      const channel = service.initializeRealtimeSubscription('usr-101');

      expect(service.supabase.channel).toHaveBeenCalledWith('public:notifications');
      expect(mockChannelInstance.on).toHaveBeenCalledWith(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        expect.any(Function),
      );
      expect(mockChannelInstance.on).toHaveBeenCalledWith(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications' },
        expect.any(Function),
      );
      expect(mockChannelInstance.subscribe).toHaveBeenCalled();
      expect(channel).toBe(mockChannelInstance);
    });

    it('should prepend INSERT payload to notifications and increment unreadCount for active user', () => {
      service.currentUserId = 'usr-101';
      service.notifications.set(sampleNotifications);
      service.initializeRealtimeSubscription('usr-101');

      const incoming: AppNotification = {
        id: 'notif-99',
        user_id: 'usr-101',
        document_id: 25,
        type: 'APPROVAL_REQUIRED',
        message: 'Un documento ha sido revisado y requiere su aprobación',
        is_read: false,
        created_at: '2026-11-18T15:00:00Z',
      };

      registeredCallbacks['INSERT']({ new: incoming });

      expect(service.notifications()).toHaveLength(3);
      expect(service.notifications()[0]).toEqual(incoming);
      expect(service.unreadCount()).toBe(2);
    });

    it('should ignore duplicate INSERT notifications with an existing id', () => {
      service.currentUserId = 'usr-101';
      service.notifications.set(sampleNotifications);
      service.initializeRealtimeSubscription('usr-101');

      registeredCallbacks['INSERT']({ new: sampleNotifications[0] });

      expect(service.notifications()).toHaveLength(2);
      expect(service.unreadCount()).toBe(1);
    });

    it('should ignore INSERT payload belonging to a different user', () => {
      service.currentUserId = 'usr-101';
      service.notifications.set(sampleNotifications);
      service.initializeRealtimeSubscription('usr-101');

      registeredCallbacks['INSERT']({
        new: {
          id: 'notif-other',
          user_id: 'usr-999',
          document_id: 1,
          type: 'REVIEW_REQUIRED',
          message: 'Other user notification',
          is_read: false,
          created_at: '2026-11-18T16:00:00Z',
        },
      });

      expect(service.notifications()).toHaveLength(2);
      expect(service.unreadCount()).toBe(1);
    });

    it('should update matching notification is_read field on UPDATE event and recalculate unreadCount', () => {
      service.currentUserId = 'usr-101';
      service.notifications.set(sampleNotifications);
      service.initializeRealtimeSubscription('usr-101');

      expect(service.unreadCount()).toBe(1);

      registeredCallbacks['UPDATE']({
        new: {
          ...sampleNotifications[0],
          is_read: true,
        },
      });

      expect(service.notifications()[0].is_read).toBe(true);
      expect(service.unreadCount()).toBe(0);
    });

    it('should clean up existing channel before creating a new subscription', () => {
      const cleanupSpy = vi.spyOn(service, 'cleanupRealtimeSubscription');
      service.initializeRealtimeSubscription('usr-101');
      expect(cleanupSpy).toHaveBeenCalled();
    });
  });

  describe('markAsRead', () => {
    it('should immediately update local signal and mark notification as read in Supabase', async () => {
      service.notifications.set(sampleNotifications);

      const eqMock = vi.fn().mockResolvedValueOnce({ error: null });
      const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
      const fromSpy = vi.spyOn(service.supabase, 'from').mockReturnValue({
        update: updateMock,
      } as any);

      await service.markAsRead('notif-1');

      expect(fromSpy).toHaveBeenCalledWith('notifications');
      expect(updateMock).toHaveBeenCalledWith({ is_read: true });
      expect(eqMock).toHaveBeenCalledWith('id', 'notif-1');
      expect(service.notifications().find((n) => n.id === 'notif-1')?.is_read).toBe(true);
      expect(service.unreadCount()).toBe(0);
    });

    it('should revert local signal state when markAsRead database update fails', async () => {
      service.notifications.set(sampleNotifications);

      const eqMock = vi.fn().mockResolvedValueOnce({ error: { message: 'RLS denied' } });
      vi.spyOn(service.supabase, 'from').mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: eqMock }),
      } as any);

      await service.markAsRead('notif-1');

      expect(service.notifications().find((n) => n.id === 'notif-1')?.is_read).toBe(false);
      expect(service.unreadCount()).toBe(1);
    });
  });

  describe('markAllAsRead', () => {
    it('should immediately mark all notifications read locally and update Supabase', async () => {
      service.currentUserId = 'usr-101';
      service.notifications.set([
        sampleNotifications[0],
        { ...sampleNotifications[1], is_read: false },
      ]);
      expect(service.unreadCount()).toBe(2);

      const eqIsReadMock = vi.fn().mockResolvedValueOnce({ error: null });
      const eqUserMock = vi.fn().mockReturnValue({ eq: eqIsReadMock });
      const updateMock = vi.fn().mockReturnValue({ eq: eqUserMock });
      const fromSpy = vi.spyOn(service.supabase, 'from').mockReturnValue({
        update: updateMock,
      } as any);

      await service.markAllAsRead();

      expect(fromSpy).toHaveBeenCalledWith('notifications');
      expect(updateMock).toHaveBeenCalledWith({ is_read: true });
      expect(eqUserMock).toHaveBeenCalledWith('user_id', 'usr-101');
      expect(eqIsReadMock).toHaveBeenCalledWith('is_read', false);
      expect(service.unreadCount()).toBe(0);
      expect(service.notifications().every((n) => n.is_read)).toBe(true);
    });

    it('should revert local signal state when markAllAsRead database update fails', async () => {
      service.currentUserId = 'usr-101';
      service.notifications.set(sampleNotifications);

      const eqIsReadMock = vi.fn().mockResolvedValueOnce({ error: { message: 'Update failed' } });
      vi.spyOn(service.supabase, 'from').mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ eq: eqIsReadMock }),
        }),
      } as any);

      await service.markAllAsRead();

      expect(service.unreadCount()).toBe(1);
      expect(service.notifications()[0].is_read).toBe(false);
    });
  });

  describe('cleanup and lifecycle', () => {
    it('should remove realtime channel in cleanupRealtimeSubscription', () => {
      service.initializeRealtimeSubscription('usr-101');
      service.cleanupRealtimeSubscription();

      expect(service.supabase.removeChannel).toHaveBeenCalledWith(mockChannelInstance);
    });

    it('should clean up subscriptions on ngOnDestroy', () => {
      const cleanupSpy = vi.spyOn(service, 'cleanupRealtimeSubscription');
      service.ngOnDestroy();
      expect(cleanupSpy).toHaveBeenCalled();
    });
  });
});
