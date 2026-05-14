import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const DEFAULT_MODE: ThemeMode = 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _mode = signal<ThemeMode>(this.readInitialMode());
  readonly mode = this._mode.asReadonly();

  constructor() {
    this.apply(this._mode());
  }

  set(mode: ThemeMode): void {
    this._mode.set(mode);
    this.apply(mode);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
  }

  toggle(): void {
    this.set(this._mode() === 'dark' ? 'light' : 'dark');
  }

  private apply(mode: ThemeMode): void {
    document.documentElement.dataset['theme'] = mode;
  }

  private readInitialMode(): ThemeMode {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return DEFAULT_MODE;
  }
}
