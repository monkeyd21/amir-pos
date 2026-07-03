import { Injectable } from '@angular/core';

/**
 * §4 — audio cues for barcode scanning so the cashier knows the result without
 * looking at the screen. Distinct by pattern so they're told apart by ear:
 *   - valid       → one short bright beep            (item added)
 *   - duplicate   → two quick beeps                  (already in cart, re-scan)
 *   - invalid     → three long beeps                 (barcode not found)
 *   - outOfStock  → a descending warble, twice       (found but no stock)
 *
 * Primary playback uses bundled pre-recorded WAV files (assets/sounds/*.wav),
 * authored at full-scale amplitude and played at max volume — the spec's fix
 * was VOLUME, not pitch. Files are decoded once into AudioBuffers for low
 * latency. If Web Audio or a file is unavailable, we fall back to synthesised
 * tones so a cue always fires (no silent regression).
 */
@Injectable({ providedIn: 'root' })
export class ScanSoundService {
  private ctx: AudioContext | null = null;
  private buffers: Record<string, AudioBuffer> = {};
  /** Master switch — could be wired to a settings toggle later. */
  enabled = true;

  private readonly files: Record<string, string> = {
    valid: 'assets/sounds/scan-success.wav',
    duplicate: 'assets/sounds/scan-duplicate.wav',
    invalid: 'assets/sounds/scan-invalid.wav',
    outOfStock: 'assets/sounds/out-of-stock.wav',
  };

  constructor() {
    // Best-effort eager preload/decode (works on a suspended context; playback
    // resumes it on the first scan gesture).
    this.preload();
  }

  private getCtx(): AudioContext | null {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) {
        const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    } catch {
      return null;
    }
  }

  private async preload(): Promise<void> {
    const ctx = this.getCtx();
    if (!ctx) return;
    await Promise.all(
      Object.entries(this.files).map(async ([key, url]) => {
        try {
          const res = await fetch(url);
          const arr = await res.arrayBuffer();
          this.buffers[key] = await ctx.decodeAudioData(arr);
        } catch {
          /* fall back to synth for this cue */
        }
      })
    );
  }

  /** Play a decoded file at full volume; returns false if not available. */
  private playFile(key: string): boolean {
    const ctx = this.getCtx();
    const buf = this.buffers[key];
    if (!ctx || !buf) return false;
    try {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = 1.0; // files are already at full-scale amplitude
      src.buffer = buf;
      src.connect(gain).connect(ctx.destination);
      src.start();
      return true;
    } catch {
      return false;
    }
  }

  /** Synthesised fallback tone. */
  private beep(freq: number, durationMs: number, type: OscillatorType, delay = 0): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + durationMs / 1000 + 0.02);
  }

  /** Item scanned and added — one bright beep. */
  valid(): void {
    if (!this.playFile('valid')) this.beep(3200, 100, 'sine');
  }

  /** Item already in the cart (re-scan) — two quick beeps. */
  duplicate(): void {
    if (!this.playFile('duplicate')) {
      this.beep(3200, 70, 'square', 0);
      this.beep(3200, 70, 'square', 0.12);
    }
  }

  /** Barcode not found — three long beeps, unmissable over store noise. */
  invalid(): void {
    if (!this.playFile('invalid')) {
      this.beep(2000, 200, 'square', 0);
      this.beep(2000, 200, 'square', 0.28);
      this.beep(2000, 200, 'square', 0.56);
    }
  }

  /** Item found but out of stock — a descending warble, clearly distinct from
   *  the three-beep "not found" cue. */
  outOfStock(): void {
    if (!this.playFile('outOfStock')) {
      this.beep(2600, 120, 'square', 0);
      this.beep(1500, 160, 'square', 0.13);
    }
  }
}
