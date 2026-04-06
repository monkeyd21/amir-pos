import { Subject, Observable } from 'rxjs';

export class DialogRef<R = any> {
  private afterClosedSubject = new Subject<R | undefined>();
  private cleanupFn: (() => void) | null = null;

  /** @internal */
  _setCleanup(fn: () => void): void {
    this.cleanupFn = fn;
  }

  close(result?: R): void {
    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }
    this.afterClosedSubject.next(result);
    this.afterClosedSubject.complete();
  }

  afterClosed(): Observable<R | undefined> {
    return this.afterClosedSubject.asObservable();
  }
}
