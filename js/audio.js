// Audio 100 % synthétisé — aucun fichier, donc rien à télécharger et un budget réseau nul.
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.pret = false;
    this._bruit = null;
    this._ambiance = null;
    this._souffle = null;
  }

  // À appeler sur un geste utilisateur (obligatoire sur tous les navigateurs).
  demarrer() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume()?.catch?.(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(this.ctx.destination);
    this._bruit = this._fabriquerBruit(2.2);
    this._lancerAmbiance();
    this.pret = true;
  }

  reglerVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  suspendre() {
    if (this.ctx && this.ctx.state === "running") this.ctx.suspend()?.catch?.(() => {});
  }
  reprendre() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume()?.catch?.(() => {});
  }

  // --------------------------------------------------------------- fabriques
  _fabriquerBruit(secondes) {
    const n = Math.floor(this.ctx.sampleRate * secondes);
    const tampon = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = tampon.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return tampon;
  }

  _sourceBruit(duree) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._bruit;
    s.loop = true;
    s.playbackRate.value = 0.85 + Math.random() * 0.3;
    return s;
  }

  _env(gain, t0, attaque, tenue, chute, pic) {
    const g = gain.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(pic, 0.0002), t0 + attaque);
    g.setValueAtTime(Math.max(pic, 0.0002), t0 + attaque + tenue);
    g.exponentialRampToValueAtTime(0.0001, t0 + attaque + tenue + chute);
  }

  // ------------------------------------------------------------------- tir
  tir() {
    if (!this.pret) return;
    const t = this.ctx.currentTime;

    // Cœur : bruit filtré + corps grave.
    const src = this._sourceBruit(0.35);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1400 + Math.random() * 400;
    bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    this._env(g, t, 0.002, 0.012, 0.16, 0.55);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.35);

    const corps = this.ctx.createOscillator();
    corps.type = "sine";
    corps.frequency.setValueAtTime(180, t);
    corps.frequency.exponentialRampToValueAtTime(48, t + 0.13);
    const gc = this.ctx.createGain();
    this._env(gc, t, 0.002, 0.005, 0.14, 0.5);
    corps.connect(gc).connect(this.master);
    corps.start(t); corps.stop(t + 0.2);

    // Queue métallique de la culasse.
    const clic = this.ctx.createOscillator();
    clic.type = "square";
    clic.frequency.value = 2600 + Math.random() * 600;
    const gcl = this.ctx.createGain();
    this._env(gcl, t + 0.02, 0.001, 0.001, 0.045, 0.05);
    clic.connect(gcl).connect(this.master);
    clic.start(t + 0.02); clic.stop(t + 0.09);
  }

  tirLointain(distance = 20) {
    if (!this.pret) return;
    const t = this.ctx.currentTime;
    const vol = Math.max(0.03, Math.min(0.3, 9 / (distance + 4)));
    const src = this._sourceBruit(0.5);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = this.ctx.createGain();
    this._env(g, t, 0.004, 0.02, 0.4, vol);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.5);
  }

  recharge() {
    if (!this.pret) return;
    const t = this.ctx.currentTime;
    [0, 0.55, 1.35].forEach((d, i) => {
      const s = this._sourceBruit(0.12);
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800 + i * 500;
      bp.Q.value = 3;
      const g = this.ctx.createGain();
      this._env(g, t + d, 0.002, 0.005, 0.07, 0.16);
      s.connect(bp).connect(g).connect(this.master);
      s.start(t + d); s.stop(t + d + 0.12);
    });
  }

  touche(tete = false) {
    if (!this.pret) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(tete ? 1900 : 1250, t);
    o.frequency.exponentialRampToValueAtTime(tete ? 1500 : 950, t + 0.06);
    const g = this.ctx.createGain();
    this._env(g, t, 0.001, 0.002, 0.07, tete ? 0.16 : 0.1);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.1);
  }

  pas() {
    if (!this.pret) return;
    const t = this.ctx.currentTime;
    const s = this._sourceBruit(0.1);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380 + Math.random() * 160;
    const g = this.ctx.createGain();
    this._env(g, t, 0.002, 0.006, 0.09, 0.11);
    s.connect(lp).connect(g).connect(this.master);
    s.start(t); s.stop(t + 0.12);
  }

  degat() {
    if (!this.pret) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.25);
    const g = this.ctx.createGain();
    this._env(g, t, 0.003, 0.02, 0.25, 0.4);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.4);

    const s = this._sourceBruit(0.2);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 2500;
    const gs = this.ctx.createGain();
    this._env(gs, t, 0.004, 0.01, 0.2, 0.12);
    s.connect(hp).connect(gs).connect(this.master);
    s.start(t); s.stop(t + 0.25);
  }

  elimination(tete = false) {
    if (!this.pret) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(tete ? 880 : 620, t);
    o.frequency.exponentialRampToValueAtTime(tete ? 1320 : 930, t + 0.09);
    const g = this.ctx.createGain();
    this._env(g, t, 0.002, 0.02, 0.16, 0.1);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.25);
  }

  lampadaire() {
    if (!this.pret) return;
    const t = this.ctx.currentTime;

    // Petit "clac" métallique du luminaire.
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(1600, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.12);
    const g = this.ctx.createGain();
    this._env(g, t, 0.001, 0.005, 0.12, 0.12);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.16);

    // Grésillement électrique bref.
    const s = this._sourceBruit(0.2);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 1800;
    const gs = this.ctx.createGain();
    this._env(gs, t, 0.002, 0.01, 0.15, 0.06);
    s.connect(hp).connect(gs).connect(this.master);
    s.start(t); s.stop(t + 0.2);
  }

  vague() {
    if (!this.pret) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(55, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 1.2);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 6;
    const g = this.ctx.createGain();
    this._env(g, t, 0.25, 0.5, 0.9, 0.18);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t); o.stop(t + 1.8);
  }

  interface() {
    if (!this.pret) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sine"; o.frequency.value = 720;
    const g = this.ctx.createGain();
    this._env(g, t, 0.001, 0.004, 0.05, 0.06);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.08);
  }

  // Bip d'avertissement quand un hostile s'apprête à apparaître.
  alerte() {
    if (!this.pret) return;
    const t = this.ctx.currentTime;
    [880, 620].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = "square";
      o.frequency.value = f;
      const g = this.ctx.createGain();
      this._env(g, t + i * 0.11, 0.002, 0.01, 0.08, 0.055);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.1);
    });
  }

  _lancerAmbiance() {
    const t = this.ctx.currentTime;
    // Vent : bruit filtré, lentement modulé.
    const vent = this._sourceBruit(4);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 320; lp.Q.value = 0.4;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.018;
    lfo.connect(lfoG).connect(g.gain);
    vent.connect(lp).connect(g).connect(this.master);
    vent.start(t); lfo.start(t);
    this._souffle = { vent, lfo };

    // Ronronnement industriel lointain.
    const hum = this.ctx.createOscillator();
    hum.type = "sine"; hum.frequency.value = 42;
    const gh = this.ctx.createGain();
    gh.gain.value = 0.022;
    hum.connect(gh).connect(this.master);
    hum.start(t);
    this._ambiance = { hum };
  }
}
