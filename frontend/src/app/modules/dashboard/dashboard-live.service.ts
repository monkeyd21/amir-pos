import { Injectable, NgZone, OnDestroy, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';

export type LiveState = 'connecting' | 'live' | 'reconnecting' | 'offline';

/**
 * Dashboard spec §1.4 / §11: the dashboard follows the till without a manual
 * refresh.
 *
 * Reads `GET /dashboard/stream` (Server-Sent Events) with `fetch` rather than
 * `EventSource`, so the bearer token travels in a header and never in a URL.
 * When the line drops it says so and retries every 30 seconds; when the
 * browser goes offline it waits for the network to come back.
 *
 * `changes$` fires once per server-side change (already coalesced by the
 * server) and once on every (re)connect, so a dashboard that missed events
 * while disconnected catches up straight away.
 */
@Injectable()
export class DashboardLiveService implements OnDestroy {
  readonly state = signal<LiveState>('connecting');
  /** When the stream last delivered anything (connect, change or heartbeat). */
  readonly lastContact = signal<Date | null>(null);
  readonly changes$ = new Subject<void>();
  /**
   * The stream was refused for an expired token. The dashboard answers with
   * an ordinary API call (the auth interceptor refreshes the token on the
   * way) and then calls `reconnectNow()`.
   */
  readonly authExpired$ = new Subject<void>();

  private abort: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  static readonly RETRY_MS = 30_000;

  private readonly onOnline = () => this.zone.run(() => this.reconnectNow());
  private readonly onOffline = () => this.zone.run(() => this.state.set('offline'));

  constructor(private zone: NgZone) {}

  start(): void {
    this.stopped = false;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    if (!navigator.onLine) {
      this.state.set('offline');
      return;
    }
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    this.abort?.abort();
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  ngOnDestroy(): void {
    this.stop();
  }

  /** Try again immediately (network back, tab visible again, token refreshed). */
  reconnectNow(): void {
    if (this.stopped) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.abort?.abort();
    this.connect();
  }

  private connect(): void {
    const controller = new AbortController();
    this.abort = controller;
    if (this.state() !== 'reconnecting') this.state.set('connecting');

    // Outside Angular: a long-lived read must not keep change detection busy.
    this.zone.runOutsideAngular(() => {
      this.read(controller).catch((e: unknown) => {
        if (controller.signal.aborted || this.stopped) return;
        this.zone.run(() => {
          if (e instanceof Error && e.message === 'stream 401') {
            this.state.set('reconnecting');
            this.authExpired$.next();
            return;
          }
          this.scheduleRetry();
        });
      });
    });
  }

  private async read(controller: AbortController): Promise<void> {
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    const token = localStorage.getItem('accessToken');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const branch = JSON.parse(localStorage.getItem('currentBranch') || 'null');
      if (branch?.id != null) headers['X-Branch-Id'] = String(branch.id);
    } catch {
      // ignore a malformed stored branch
    }

    const res = await fetch(`${environment.apiUrl}/dashboard/stream`, { headers, signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream closed');
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        this.zone.run(() => this.handle(frame));
      }
    }
  }

  private handle(frame: string): void {
    this.lastContact.set(new Date());
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    if (event === 'ready') {
      this.state.set('live');
      this.changes$.next(); // catch up on anything missed while away
    } else if (event === 'change') {
      this.changes$.next();
    }
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.state.set(navigator.onLine ? 'reconnecting' : 'offline');
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), DashboardLiveService.RETRY_MS);
  }
}
