const names = ['csgo_ui_crate_open', 'csgo_ui_crate_item_scroll', 'item_reveal3_rare', 'item_reveal4_mythical', 'item_reveal5_legendary', 'item_reveal6_ancient'] as const;
export type CaseSound = typeof names[number];

/** One gesture-unlocked context; ticks reuse decoded buffers, never media players. */
export class CaseAudio {
 private context?: AudioContext;
 private gain?: GainNode;
 private buffers = new Map<CaseSound, AudioBuffer>();
 private requests = new Map<CaseSound, Promise<ArrayBuffer>>();
 private decoding = new Map<CaseSound, Promise<void>>();
 private sources = new Set<AudioBufferSourceNode>();
 private legacyRoute?: HTMLAudioElement;
 private muted = false;
 private disposed = false;
 private activated = false;
 private generation = 0;
 constructor(private base: string) {}
 preload() {
  // Decode off the click path; playback is still unlocked only by a gesture.
  try { this.prepareContext(); } catch {}
  for (const name of names) void (this.context ? this.decode(name) : this.fetchSound(name)).catch(() => {});
 }
 private prepareContext() {
  if (this.context) return;
  const Constructor = window.AudioContext || (window as Window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  if (!Constructor) return;
  this.context = new Constructor();
  this.gain = this.context.createGain(); this.gain.gain.value = .65; this.gain.connect(this.context.destination);
 }
 recover() { if (this.activated && this.context && !this.muted) this.unlock(); }
 private fetchSound(name: CaseSound) {
  let request = this.requests.get(name);
  if (!request) {
   request = fetch(`${this.base}/sounds/${name}.mp3`).then(r => { if (!r.ok) throw new Error(`SFX ${r.status}`); return r.arrayBuffer(); });
   this.requests.set(name, request);
   void request.catch(() => this.requests.delete(name));
  }
  return request;
 }
 private decode(name: CaseSound) {
  const context = this.context;
  if (!context || this.buffers.has(name)) return Promise.resolve();
  let pending = this.decoding.get(name);
  if (!pending) {
   pending = this.fetchSound(name).then(data => context.decodeAudioData(data.slice(0))).then(buffer => { if (!this.disposed) this.buffers.set(name, buffer); });
   this.decoding.set(name, pending);
   void pending.finally(() => this.decoding.delete(name)).catch(() => {});
  }
  return pending;
 }
 // Call synchronously from click/tap, before any await, to preserve Safari activation.
 unlock() {
  if (this.disposed || this.muted) return;
  this.activated = true;
  try {
   const session = (navigator as Navigator & {audioSession?: {type: string}}).audioSession;
   if (session) session.type = 'playback';
   this.prepareContext();
   if (!this.context) return;
   // Older iOS routes Web Audio through the ringer. A single silent media
   // element keeps it on the media route; it never creates one player per tick.
   if (!session && /iP(hone|ad|od)/.test(navigator.userAgent)) {
    this.legacyRoute ??= new Audio(`${this.base}/sounds/silence.mp3`);
    this.legacyRoute.loop = true;
    void this.legacyRoute.play().catch(() => {});
   }
   void this.context.resume().catch(() => {});
   const pulse = this.context.createBufferSource();
   pulse.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
   pulse.connect(this.gain!); pulse.onended = () => pulse.disconnect(); pulse.start();
   for (const name of names) void this.decode(name).catch(() => {});
  } catch { /* Audio availability never blocks the roulette. Next gesture retries. */ }
 }
  private tickCounter = 0;

  playModernSfx(name: CaseSound) {
   if (this.disposed || this.muted || document.hidden || !this.context) return;
   if (this.context.state !== 'running') return;
   const ctx = this.context;
   const now = ctx.currentTime;
   const master = this.gain ?? ctx.destination;

   if (name === 'csgo_ui_crate_item_scroll') {
    this.tickCounter = (this.tickCounter + 1) % 4;
    const clickPitches = [520, 580, 640, 580];
    const freq = clickPitches[this.tickCounter];

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, now + 0.028);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.032);

    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.035);
    return;
   }

   if (name === 'csgo_ui_crate_open') {
    const sweepNotes = [440, 554.37, 659.25, 880];
    sweepNotes.forEach((freq, idx) => {
     const start = now + idx * 0.05;
     const osc = ctx.createOscillator();
     const gain = ctx.createGain();
     osc.type = 'sine';
     osc.frequency.setValueAtTime(freq, start);

     gain.gain.setValueAtTime(0.001, start);
     gain.gain.linearRampToValueAtTime(0.18, start + 0.01);
     gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);

     osc.connect(gain);
     gain.connect(master);
     osc.start(start);
     osc.stop(start + 0.3);
    });
    return;
   }

   const revealChords: Record<string, number[]> = {
    item_reveal3_rare: [440, 554.37, 659.25, 880],
    item_reveal4_mythical: [523.25, 659.25, 783.99, 1046.5],
    item_reveal5_legendary: [587.33, 739.99, 880, 1174.66],
    item_reveal6_ancient: [523.25, 659.25, 783.99, 1046.5, 1318.51],
   };
   const chord = revealChords[name] || revealChords.item_reveal3_rare;

   chord.forEach((freq, idx) => {
    const start = now + idx * 0.06;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6);

    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + 0.65);
   });
  }

  play(name: CaseSound) {
   if (this.disposed || this.muted || document.hidden || !this.context) return;
   this.playModernSfx(name);
  }
 setMuted(muted: boolean) {
  this.muted = muted;
  if (this.gain) this.gain.gain.value = muted ? 0 : .65;
  if (muted) this.pause(); else this.unlock();
 }
 pause() {
  this.generation++;
  for (const source of this.sources) { try { source.stop(); } catch {} source.disconnect(); }
  this.sources.clear(); this.legacyRoute?.pause();
 }
 dispose() { this.disposed = true; this.pause(); void this.context?.close().catch(() => {}); }
}
