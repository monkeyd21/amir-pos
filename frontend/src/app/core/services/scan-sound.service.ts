import { Injectable } from '@angular/core';

/**
 * Short audio cues for barcode scanning so the cashier knows the result without
 * looking at the screen:
 *   - valid     → a single bright high beep   (item added)
 *   - duplicate → two quick mid beeps          (item already in cart, re-scanned)
 *   - invalid   → three long beeps             (not found / out of stock)
 *
 * Tones are synthesised with the Web Audio API, so there are no asset files to
 * ship and no network fetch. The AudioContext is created lazily and resumed on
 * first use (always triggered by a scan/keystroke, so autoplay policies allow it).
 */
@Injectable({ providedIn: 'root' })
export class ScanSoundService {
  private ctx: AudioContext | null = null;
  /** Master switch — could be wired to a settings toggle later. */
  enabled = true;

  private getCtx(): AudioContext | null {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) {
        const Ctor =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** Play a single tone. `delay` lets callers chain beeps. */
  private beep(freq: number, durationMs: number, type: OscillatorType, delay = 0): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    // Quick attack + decay so beeps are crisp, not clicky.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + durationMs / 1000 + 0.02);
  }

  /** Item scanned and added — one bright beep. */
  valid(): void {
    this.beep(1320, 90, 'sine');
  }

  /** Item already in the cart (re-scan) — two quick mid beeps. */
  duplicate(): void {
    this.beep(880, 70, 'square', 0);
    this.beep(880, 70, 'square', 0.11);
  }

  /** Barcode not found / out of stock — three long beeps so the cashier
   *  can't miss it over store noise (spec §7.1c). Sharp high-tone, not a
   *  dull buzz, and clearly distinct from the single valid / double duplicate. */
  invalid(): void {
    this.beep(620, 200, 'square', 0);
    this.beep(620, 200, 'square', 0.26);
    this.beep(620, 200, 'square', 0.52);
  }
}
