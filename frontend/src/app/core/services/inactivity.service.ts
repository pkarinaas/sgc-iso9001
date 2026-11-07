import { inject, Injectable, NgZone, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, fromEvent, merge, of, Subject, Subscription, timer } from 'rxjs';
import { switchMap, throttleTime } from 'rxjs/operators';
import { AuthService } from './auth.service';

/** Default idle time threshold before showing the warning dialog (14 minutes). */
export const DEFAULT_IDLE_TIME_MS = 14 * 60 * 1000; // 840,000 ms

/** Default countdown time while warning is visible before forcing logout (1 minute). */
export const DEFAULT_COUNTDOWN_TIME_MS = 1 * 60 * 1000; // 60,000 ms

/** DOM interaction events monitored to track user activity. */
export const INACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll'] as const;

/**
 * InactivityService monitors user activity and handles a two-phase session expiration flow:
 * 1. Idle Phase: Monitors DOM events. After 14 minutes of inactivity, emits a warning.
 * 2. Countdown Phase: Shows an alert modal and waits 1 minute for user action.
 *    - If the user extends the session, timers reset.
 *    - If no action is taken, the session is forcefully terminated.
 */
@Injectable({ providedIn: 'root' })
export class InactivityService implements OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly messageService = inject(MessageService);
  private readonly ngZone = inject(NgZone);

  /** Reactive stream emitting whether the inactivity warning modal is currently visible. */
  private readonly warningVisibleSubject = new BehaviorSubject<boolean>(false);
  readonly isWarningVisible$ = this.warningVisibleSubject.asObservable();

  /** Active subscription for the idle detection phase. */
  private idleSubscription?: Subscription;

  /** Active subscription for the warning countdown phase. */
  private countdownSubscription?: Subscription;

  /** Subject to trigger an idle timer reset programmatically. */
  private readonly reset$ = new Subject<void>();

  /** Configured idle duration (in ms) before warning is triggered. */
  private idleTime = DEFAULT_IDLE_TIME_MS;

  /** Configured countdown duration (in ms) before forcing logout. */
  private countdownTime = DEFAULT_COUNTDOWN_TIME_MS;

  /** Flag indicating whether the service is actively monitoring for inactivity. */
  private _isMonitoring = false;

  get isMonitoring(): boolean {
    return this._isMonitoring;
  }

  /**
   * Starts the inactivity monitoring cycle.
   *
   * @param idleTimeMs - Inactivity time in ms before showing warning (default: 14 mins = 840,000 ms).
   * @param countdownTimeMs - Additional time in ms before forced logout (default: 1 min = 60,000 ms).
   */
  startMonitoring(
    idleTimeMs: number = DEFAULT_IDLE_TIME_MS,
    countdownTimeMs: number = DEFAULT_COUNTDOWN_TIME_MS,
  ): void {
    this.stopMonitoring();
    this.idleTime = idleTimeMs;
    this.countdownTime = countdownTimeMs;
    this._isMonitoring = true;
    this.warningVisibleSubject.next(false);

    if (typeof window === 'undefined') {
      return;
    }

    this.startIdlePhase();
  }

  /**
   * Listens to user interactions and resets the idle timer on each event.
   * If idleTime elapses without interactions, triggers the warning phase.
   */
  private startIdlePhase(): void {
    this.clearIdleSubscription();

    this.ngZone.runOutsideAngular(() => {
      const eventStreams$ = INACTIVITY_EVENTS.map((eventName) =>
        fromEvent(window, eventName, { passive: true }),
      );

      const userActivity$ = merge(...eventStreams$, this.reset$).pipe(
        throttleTime(1000, undefined, { leading: true, trailing: false }),
      );

      this.idleSubscription = merge(of(null), userActivity$)
        .pipe(switchMap(() => timer(this.idleTime)))
        .subscribe(() => {
          this.ngZone.run(() => {
            this.triggerWarningPhase();
          });
        });
    });
  }

  /**
   * Displays the warning modal dialog and starts the countdown timer.
   */
  private triggerWarningPhase(): void {
    this.clearIdleSubscription();
    this.warningVisibleSubject.next(true);

    this.clearCountdownSubscription();
    this.countdownSubscription = timer(this.countdownTime).subscribe(() => {
      void this.forceLogout();
    });
  }

  /**
   * Extends the session upon user confirmation:
   * Hides the warning dialog, cancels countdown, and restarts monitoring.
   */
  extendSession(): void {
    this.warningVisibleSubject.next(false);
    this.clearCountdownSubscription();
    this.startMonitoring(this.idleTime, this.countdownTime);
  }

  /**
   * Forces definitive logout when countdown expires or when explicitly invoked:
   * 1. Hides the warning dialog.
   * 2. Clears monitoring subscriptions.
   * 3. Signs out via AuthService.
   * 4. Navigates to `/login`.
   * 5. Displays session expiration toast notification.
   */
  async forceLogout(): Promise<void> {
    this.warningVisibleSubject.next(false);
    this.stopMonitoring();

    try {
      await this.authService.signOut();
    } catch {
      // Fallback navigation in case signOut fails
    }

    await this.router.navigate(['/login']);

    this.messageService.add({
      severity: 'warn',
      summary: 'Sesión expirada',
      detail: 'Su sesión se cerró por inactividad',
      life: 6000,
    });
  }

  /**
   * Alias for forceLogout to maintain backward compatibility.
   */
  async handleTimeout(): Promise<void> {
    await this.forceLogout();
  }

  /**
   * Manually resets the idle timer if monitoring is active and warning is not displayed.
   */
  resetTimer(): void {
    if (this._isMonitoring && !this.warningVisibleSubject.value) {
      this.reset$.next();
    }
  }

  /**
   * Completely stops monitoring, clearing all subscriptions and hiding the warning dialog.
   */
  stopMonitoring(): void {
    this.clearIdleSubscription();
    this.clearCountdownSubscription();
    this._isMonitoring = false;
    this.warningVisibleSubject.next(false);
  }

  private clearIdleSubscription(): void {
    if (this.idleSubscription) {
      this.idleSubscription.unsubscribe();
      this.idleSubscription = undefined;
    }
  }

  private clearCountdownSubscription(): void {
    if (this.countdownSubscription) {
      this.countdownSubscription.unsubscribe();
      this.countdownSubscription = undefined;
    }
  }

  ngOnDestroy(): void {
    this.stopMonitoring();
    this.reset$.complete();
    this.warningVisibleSubject.complete();
  }
}
