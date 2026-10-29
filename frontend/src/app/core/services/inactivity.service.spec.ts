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

describe('InactivityService', () => {
  let service: InactivityService;
  let authServiceMock: { signOut: ReturnType<typeof vi.fn> };
  let routerMock: { navigate: ReturnType<typeof vi.fn> };
  let messageServiceMock: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();

    authServiceMock = {
      signOut: vi.fn().mockResolvedValue(undefined),
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

  it('should show warning after idle time expires and force logout after countdown', async () => {
    const forceLogoutSpy = vi.spyOn(service, 'forceLogout');
    let warningShown = false;
    const sub = service.isWarningVisible$.subscribe((v) => (warningShown = v));

    // Custom short timers for test: 10s idle, 5s countdown
    service.startMonitoring(10_000, 5_000);

    expect(warningShown).toBe(false);

    // Advance 10s -> warning phase should trigger
    vi.advanceTimersByTime(10_000);
    expect(warningShown).toBe(true);
    expect(authServiceMock.signOut).not.toHaveBeenCalled();

    // Advance 5s countdown -> force logout
    vi.advanceTimersByTime(5_000);
    expect(forceLogoutSpy).toHaveBeenCalledOnce();
    await forceLogoutSpy.mock.results[0]?.value;

    expect(warningShown).toBe(false);
    expect(authServiceMock.signOut).toHaveBeenCalledOnce();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/login']);
    expect(messageServiceMock.add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warn',
        summary: 'Sesión expirada',
        detail: 'Su sesión se cerró por inactividad',
      }),
    );

    sub.unsubscribe();
  });

  it('should extend session, hide warning, and restart idle monitoring on extendSession()', () => {
    let warningShown = false;
    const sub = service.isWarningVisible$.subscribe((v) => (warningShown = v));

    service.startMonitoring(10_000, 5_000);

    // Reach warning phase
    vi.advanceTimersByTime(10_000);
    expect(warningShown).toBe(true);

    // User chooses to extend session
    service.extendSession();
    expect(warningShown).toBe(false);

    // Advance past the old countdown (5s) -> should NOT force logout
    vi.advanceTimersByTime(6_000);
    expect(authServiceMock.signOut).not.toHaveBeenCalled();

    // Advance remaining idle time to reach 10s again -> warning triggers again
    vi.advanceTimersByTime(4_000);
    expect(warningShown).toBe(true);

    sub.unsubscribe();
  });

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
