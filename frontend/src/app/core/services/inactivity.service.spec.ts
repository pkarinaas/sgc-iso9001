import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { AuthService } from './auth.service';
import {
  DEFAULT_IDLE_TIME_MS,
  DEFAULT_COUNTDOWN_TIME_MS,
  INACTIVITY_EVENTS,
  InactivityService,
} from './inactivity.service';

/**
 * Emulates fakeAsync / tick using Vitest fake timers for the Angular 22 zoneless environment.
 */
export function tick(millis = 0): void {
  vi.advanceTimersByTime(millis);
}

export function fakeAsync<T extends (...args: any[]) => any>(fn: T): (...args: Parameters<T>) => ReturnType<T> {
  return (...args: Parameters<T>) => {
    vi.useFakeTimers();
    try {
      return fn(...args);
    } finally {
      vi.useRealTimers();
    }
  };
}

describe('InactivityService', () => {
  let service: InactivityService;
  let authServiceMock: { signOut: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn> };
  let routerMock: { navigate: ReturnType<typeof vi.fn> };
  let messageServiceMock: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();

    const signOutMock = vi.fn().mockResolvedValue(undefined);
    authServiceMock = {
      signOut: signOutMock,
      logout: signOutMock,
    };

    routerMock = {
      navigate: vi.fn().mockResolvedValue(true),
    };

    messageServiceMock = {
      add: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        InactivityService,
        { provide: AuthService, useValue: authServiceMock },
        { provide: Router, useValue: routerMock },
        { provide: MessageService, useValue: messageServiceMock },
      ],
    });

    service = TestBed.inject(InactivityService);
  });

  afterEach(() => {
    service.stopMonitoring();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should initialize with idle and countdown constants', () => {
    expect(service).toBeTruthy();
    expect(DEFAULT_IDLE_TIME_MS).toBeDefined();
    expect(DEFAULT_COUNTDOWN_TIME_MS).toBeDefined();
    expect(service.isMonitoring).toBe(false);
  });

  it('should include mousemove, keydown, click, scroll in monitored events', () => {
    expect(INACTIVITY_EVENTS).toContain('mousemove');
    expect(INACTIVITY_EVENTS).toContain('keydown');
    expect(INACTIVITY_EVENTS).toContain('click');
    expect(INACTIVITY_EVENTS).toContain('scroll');
  });

  it('should emit false initially for isWarningVisible$', () => {
    let visible = true;
    const sub = service.isWarningVisible$.subscribe((v) => (visible = v));
    expect(visible).toBe(false);
    sub.unsubscribe();
  });

  // Test 1: Verify warning visible after 14 minutes (840000 ms) using fakeAsync and tick(840000)
  it('should emit true for isWarningVisible$ after 14 minutes (840000 ms) of inactivity', fakeAsync(() => {
    let isWarningVisible = false;
    const sub = service.isWarningVisible$.subscribe((visible) => (isWarningVisible = visible));

    service.startMonitoring(840_000, 60_000);
    expect(isWarningVisible).toBe(false);

    tick(840_000);
    expect(isWarningVisible).toBe(true);

    sub.unsubscribe();
  }));

  // Test 2: Verify that waiting 1 additional minute (60000 ms) triggers logout, navigation and toast
  it('should call authService.signOut(), redirect to /login and show toast after 1 additional minute (60000 ms)', fakeAsync(async () => {
    const forceLogoutSpy = vi.spyOn(service, 'forceLogout');
    service.startMonitoring(840_000, 60_000);

    // Advance 14 minutes to trigger warning
    tick(840_000);
    expect(authServiceMock.signOut).not.toHaveBeenCalled();

    // Advance 1 additional minute (60000 ms)
    tick(60_000);
    expect(forceLogoutSpy).toHaveBeenCalledOnce();
    await forceLogoutSpy.mock.results[0]?.value;

    expect(authServiceMock.signOut).toHaveBeenCalledOnce();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/login']);
    expect(messageServiceMock.add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warn',
        summary: 'Sesión expirada',
        detail: 'Su sesión se cerró por inactividad',
      }),
    );
  }));

  // Test 3: Verify that extendSession() resets warning (isWarningVisible$ emits false)
  it('should reset the warning (isWarningVisible$ emits false) when extendSession() is called', fakeAsync(() => {
    let isWarningVisible = false;
    const sub = service.isWarningVisible$.subscribe((visible) => (isWarningVisible = visible));

    service.startMonitoring(840_000, 60_000);

    // Advance 14 minutes to trigger warning
    tick(840_000);
    expect(isWarningVisible).toBe(true);

    // Extend session
    service.extendSession();
    expect(isWarningVisible).toBe(false);

    // Advance 60 seconds; should not logout because monitoring was restarted
    tick(60_000);
    expect(authServiceMock.signOut).not.toHaveBeenCalled();

    sub.unsubscribe();
  }));

  it('should reset idle timer when user activity occurs before warning threshold', () => {
    let warningShown = false;
    const sub = service.isWarningVisible$.subscribe((v) => (warningShown = v));

    service.startMonitoring(10_000, 5_000);

    // Advance 6s
    vi.advanceTimersByTime(6_000);
    expect(warningShown).toBe(false);

    // User moves mouse
    window.dispatchEvent(new Event('mousemove'));

    // Advance another 6s (total 12s, but 6s since mousemove)
    vi.advanceTimersByTime(6_000);
    expect(warningShown).toBe(false);

    // Now advance remaining 4s -> triggers warning
    vi.advanceTimersByTime(4_000);
    expect(warningShown).toBe(true);

    sub.unsubscribe();
  });

  it('should reset idle timer on keydown, click, or scroll events', () => {
    let warningShown = false;
    const sub = service.isWarningVisible$.subscribe((v) => (warningShown = v));

    service.startMonitoring(6_000, 2_000);

    vi.advanceTimersByTime(3_000);
    window.dispatchEvent(new Event('keydown'));

    vi.advanceTimersByTime(3_000);
    window.dispatchEvent(new Event('click'));

    vi.advanceTimersByTime(3_000);
    window.dispatchEvent(new Event('scroll'));

    expect(warningShown).toBe(false);

    vi.advanceTimersByTime(6_000);
    expect(warningShown).toBe(true);

    sub.unsubscribe();
  });

  it('should reset timer programmatically via resetTimer()', () => {
    let warningShown = false;
    const sub = service.isWarningVisible$.subscribe((v) => (warningShown = v));

    service.startMonitoring(6_000, 2_000);

    vi.advanceTimersByTime(4_000);
    service.resetTimer();

    vi.advanceTimersByTime(4_000);
    expect(warningShown).toBe(false);

    vi.advanceTimersByTime(2_000);
    expect(warningShown).toBe(true);

    sub.unsubscribe();
  });

  it('should not force logout if stopMonitoring() was called', () => {
    service.startMonitoring(5_000, 2_000);
    vi.advanceTimersByTime(5_000);

    service.stopMonitoring();
    vi.advanceTimersByTime(5_000);

    expect(authServiceMock.signOut).not.toHaveBeenCalled();
    expect(service.isMonitoring).toBe(false);
  });

  it('should clean up subscriptions on ngOnDestroy()', () => {
    service.startMonitoring(5_000, 2_000);
    expect(service.isMonitoring).toBe(true);

    service.ngOnDestroy();
    expect(service.isMonitoring).toBe(false);
  });
});
