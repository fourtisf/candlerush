/** WebAudio blips, ported verbatim from the prototype's `Snd`. */
class Sound {
  private ac: AudioContext | null = null;
  private gain: GainNode | null = null;
  on = true;

  boot(): void {
    if (this.ac) return;
    try {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ac = new Ctor();
      this.gain = this.ac.createGain();
      this.gain.gain.value = 0.13;
      this.gain.connect(this.ac.destination);
    } catch {
      this.ac = null;
    }
  }

  private b(f: number, f2: number | null, d: number, type: OscillatorType = 'triangle', v = 1): void {
    if (!this.on || !this.ac || !this.gain) return;
    if (this.ac.state === 'suspended') void this.ac.resume();
    const c = this.ac.currentTime;
    const o = this.ac.createOscillator();
    const g = this.ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, c);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), c + d);
    g.gain.setValueAtTime(0, c);
    g.gain.linearRampToValueAtTime(v, c + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, c + d);
    o.connect(g);
    g.connect(this.gain);
    o.start(c);
    o.stop(c + d + 0.02);
  }

  jump() { this.b(430, 760, 0.13, 'triangle', 0.9); }
  dbl() { this.b(620, 980, 0.12, 'triangle', 0.75); }
  land() { this.b(180, 110, 0.07, 'sine', 0.7); }
  pip(n: number) { this.b(880 + Math.min(n, 10) * 70, null, 0.07, 'square', 0.32); }
  flip(up: boolean) { this.b(up ? 300 : 640, up ? 720 : 280, 0.16, 'sawtooth', 0.5); }
  perfect() { this.b(1180, 1560, 0.09, 'triangle', 0.5); }
  power() { this.b(400, 1200, 0.28, 'sawtooth', 0.5); }
  bad() { this.b(160, 60, 0.35, 'sawtooth', 0.7); }
  die() { this.b(300, 45, 0.7, 'sawtooth', 1); }
  buy() { this.b(520, 1040, 0.2, 'triangle', 0.6); }
  bell() {
    this.b(880, 880, 0.5, 'sine', 0.8);
    setTimeout(() => this.b(1320, 1320, 0.7, 'sine', 0.6), 120);
  }
}

export const Snd = new Sound();
