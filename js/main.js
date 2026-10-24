import * as THREE from "three";
import { CONFIG, ETATS } from "./config.js?v=20261022e";
import { Monde } from "./world.js?v=20261022e";
import { Joueur, Entrees } from "./player.js?v=20261022e";
import { Arme } from "./weapon.js?v=20261022e";
import { GestionEnnemis } from "./enemies.js?v=20261022e";
import { PostFX } from "./postfx.js?v=20261022e";
import { Audio } from "./audio.js?v=20261022e";

const $ = (id) => document.getElementById(id);

const REGLAGES_DEFAUT = {
  sensibilite: 100,
  volume: 70,
  qualite: "normale",
  inverser: false,
  tactile: null,
};

class Jeu {
  constructor(options = {}) {
    this.tactile = options.tactile === true;
    this.debug = options.debug === true;
    this.canvas = $("rendu");
    this.etat = ETATS.CHARGEMENT;
    this.reglages = this._chargerReglages();
    // Sur téléphone, on part directement en qualité basse : c'est là que ça compte.
    if (this.reglages.tactile === true) this.tactile = true;
    if (this.tactile && !this._reglagesSauves) this.reglages.qualite = "basse";
    this.qualite = CONFIG.rendu.qualite[this.reglages.qualite] || CONFIG.rendu.qualite.normale;

    this._initRendu();

    this.monde = null;
    this.joueur = null;
    this.arme = null;
    this.ennemis = null;
    this.postfx = null;
    this.audio = new Audio();
    this.audio.reglerVolume(this.reglages.volume / 100);

    this.entrees = null;
    this.vague = 1;
    this.score = 0;
    this.elimines = 0;
    this.tempsPartie = 0;
    this._attenteVague = -1;
    this._derniereVie = 100;
    this._dernierElimines = 0;
    this._messageTimer = 0;
    this._temps = 0;
    this._dernier = performance.now();
    this._orbite = 0;

    if (this.debug) this._afficherDiagnostic();
    this._cables();
    this._boucle = this._boucle.bind(this);
    requestAnimationFrame(this._boucle);
    this._demarrer();
  }

  /* --------------------------------------------------------------- réglages */
  _chargerReglages() {
    try {
      const brut = localStorage.getItem("cascade-operation-reglages");
      if (brut) { this._reglagesSauves = true; return { ...REGLAGES_DEFAUT, ...JSON.parse(brut) }; }
    } catch (e) { /* stockage indisponible : on continue avec les défauts */ }
    return { ...REGLAGES_DEFAUT };
  }

  _sauverReglages() {
    try { localStorage.setItem("cascade-operation-reglages", JSON.stringify(this.reglages)); }
    catch (e) { /* ignore */ }
  }

  _initRendu() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.qualite.pixelRatioMax));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = this.qualite.ombres;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 320);

    window.addEventListener("resize", () => this._redimensionner());
  }

  _redimensionner() {
    const l = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = l / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.qualite.pixelRatioMax));
    this.renderer.setSize(l, h, false);
    const taille = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(taille);
    this.postfx?.setSize(taille.x, taille.y);
  }

  /* ------------------------------------------------------------------- init */
  async _demarrer() {
    const barre = $("chargement-barre");
    const texte = $("chargement-texte");
    const etapes = [
      ["Préparation du terrain…", () => { this.monde = new Monde(this.scene, this.qualite); }],
      ["Déploiement de l'unité…", () => {
        this.joueur = new Joueur(this.camera, this.monde, this.audio);
        this.entrees = new Entrees(this.canvas);
        this.entrees.tactile = this.tactile;
        // Branchés dans tous les cas : ça ne coûte rien sans doigts,
        // et ça permet d'activer le tactile au premier contact.
        this.entrees.brancherVue(this.canvas);
        this.entrees.brancherStick($("zone-stick"), $("stick-base"), $("stick-pouce"));
        this.arme = new Arme(this.camera, this.scene, this.audio);
        this.arme.onTouche = (tete) => this._surTouche(tete);
      }],
      ["Armement des hostiles…", () => {
        this.ennemis = new GestionEnnemis(this.scene, this.monde, this.audio, this.joueur);
        this.ennemis.onElimination = (e, tete) => this._surElimination(tete);
      }],
      ["Étalonnage de l'image…", () => {
        this.postfx = new PostFX(this.renderer, this.qualite);
        const taille = new THREE.Vector2();
        this.renderer.getDrawingBufferSize(taille);
        this.postfx.setSize(taille.x, taille.y);
        this.postfx.setQualite(this.qualite);
      }],
    ];

    for (let i = 0; i < etapes.length; i++) {
      texte.textContent = etapes[i][0];
      barre.style.width = `${Math.round((i / etapes.length) * 100)}%`;
      await new Promise((r) => setTimeout(r, 60));
      etapes[i][1]();
    }
    barre.style.width = "100%";
    await new Promise((r) => setTimeout(r, 160));

    this._appliquerQualite(this.reglages.qualite);
    $("chargement").classList.remove("actif");
    this._allerAccueil();
  }

  /* ----------------------------------------------------------------- menus */
  _cables() {
    $("btn-jouer").addEventListener("click", () => { this.audio.interface(); this._lancerPartie(); });
    $("btn-debug").addEventListener("click", () => {
      const el = $("debug");
      const visible = !el.classList.contains("cache");
      if (visible) el.classList.add("cache");
      else this._afficherDiagnostic();
    });
    $("btn-rejouer").addEventListener("click", () => { this.audio.interface(); this._lancerPartie(); });
    $("btn-reglages").addEventListener("click", () => { this.audio.interface(); this._ouvrirReglages("accueil"); });
    $("btn-pause-reglages").addEventListener("click", () => { this.audio.interface(); this._ouvrirReglages("pause"); });
    $("btn-fermer-reglages").addEventListener("click", () => { this.audio.interface(); this._fermerReglages(); });
    $("btn-reprendre").addEventListener("click", () => { this.audio.interface(); this._reprendre(); });
    $("btn-abandonner").addEventListener("click", () => { this.audio.interface(); this._allerAccueil(); });
    $("btn-menu").addEventListener("click", () => { this.audio.interface(); this._allerAccueil(); });

    const sens = $("reg-sensibilite"), vol = $("reg-volume");
    const qual = $("reg-qualite"), inv = $("reg-inverser"), tact = $("reg-tactile");
    sens.value = this.reglages.sensibilite;
    vol.value = this.reglages.volume;
    qual.value = this.reglages.qualite;
    inv.checked = this.reglages.inverser;
    tact.checked = this.tactile;
    $("aide-clavier").classList.toggle("cache", this.tactile);
    $("aide-tactile").classList.toggle("cache", !this.tactile);
    $("reg-sensibilite-val").textContent = `${this.reglages.sensibilite} %`;
    $("reg-volume-val").textContent = `${this.reglages.volume} %`;

    sens.addEventListener("input", () => {
      this.reglages.sensibilite = Number(sens.value);
      $("reg-sensibilite-val").textContent = `${sens.value} %`;
      this._sauverReglages();
    });
    vol.addEventListener("input", () => {
      this.reglages.volume = Number(vol.value);
      $("reg-volume-val").textContent = `${vol.value} %`;
      this.audio.reglerVolume(this.reglages.volume / 100);
      this._sauverReglages();
    });
    qual.addEventListener("change", () => {
      this.reglages.qualite = qual.value;
      this._appliquerQualite(qual.value);
      this._sauverReglages();
    });
    inv.addEventListener("change", () => {
      this.reglages.inverser = inv.checked;
      this._sauverReglages();
    });
    tact.addEventListener("change", () => {
      this.reglages.tactile = tact.checked;
      this._sauverReglages();
      if (tact.checked) this._activerTactile();
      else this.desactiverTactile();
    });

    this.canvas.addEventListener("click", () => {
      if (this.etat === ETATS.JEU && !this.entrees.verrouille && !this.tactile) this.entrees.demanderVerrou();
    });

    this._cablesTactile();

    // Filet de sécurité : le premier contact active le mode tactile,
    // même si la détection de l'appareil s'est trompée.
    document.addEventListener("touchstart", () => {
      if (!this.tactile) this._activerTactile();
    }, { passive: true });

    document.addEventListener("pointerlockchange", () => {
      if (!this.entrees || this.tactile) return;
      if (!document.pointerLockElement && this.etat === ETATS.JEU) this._pause();
    });

    window.addEventListener("blur", () => { if (this.etat === ETATS.JEU) this._pause(); });
    window.addEventListener("resize", () => this._verifierOrientation());
    window.addEventListener("orientationchange", () => setTimeout(() => this._verifierOrientation(), 200));

    window.addEventListener("keydown", (e) => {
      if (e.code === "F3") {
        e.preventDefault();
        this._perfVisible = !this._perfVisible;
        $("perf").classList.toggle("cache", !this._perfVisible);
      }
      if (e.code === "Escape" && this.etat === ETATS.PAUSE) this._reprendre();
      if (e.code === "KeyM" && this.etat === ETATS.JEU) {
        this.reglages.volume = this.reglages.volume > 0 ? 0 : 70;
        this.audio.reglerVolume(this.reglages.volume / 100);
        $("reg-volume").value = this.reglages.volume;
        $("reg-volume-val").textContent = `${this.reglages.volume} %`;
        this._sauverReglages();
      }
    });

    window.addEventListener("error", (e) => this._erreur(e.message));
    window.addEventListener("unhandledrejection", (e) => this._erreur(e.reason?.message || String(e.reason)));
  }

  desactiverTactile() {
    this.tactile = false;
    if (this.entrees) { this.entrees.tactile = false; this.entrees.tirGeste = false; }
    $("tactile").classList.add("cache");
    $("hud").classList.remove("tactile");
    this._verifierOrientation();
  }

  _activerTactile() {
    this.tactile = true;
    if (this.entrees) this.entrees.tactile = true;
    this.entrees?.relacherVerrou();
    if (!this._reglagesSauves) this._appliquerQualite("basse");
    if (this.etat === ETATS.JEU) {
      $("tactile").classList.remove("cache");
      $("hud").classList.add("tactile");
      $("stick-base").classList.add("repos");
      this._verifierOrientation();
    }
  }

  _afficherDiagnostic() {
    const el = $("debug");
    el.classList.remove("cache");
    if (this._diagActif) { clearInterval(this._diagTimer); }
    this._diagActif = true;
    const oui = (v) => (v ? "oui" : "non");
    const maj = () => {
      const gl = (() => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch (e) { return false; } })();
      el.textContent = [
        `tactile : ${oui(this.tactile)}`,
        `maxTouchPoints : ${navigator.maxTouchPoints || 0}`,
        `ontouchstart : ${oui("ontouchstart" in window)}`,
        `pointer coarse : ${oui(matchMedia("(pointer: coarse)").matches)}`,
        `pointer fine : ${oui(matchMedia("(pointer: fine)").matches)}`,
        `hover : ${oui(matchMedia("(hover: hover)").matches)}`,
        `écran : ${window.innerWidth}×${window.innerHeight}`,
        `densité : ${window.devicePixelRatio}`,
        `WebGL2 : ${oui(gl)}`,
        `état : ${this.etat}`,
        `ui tactile : ${oui(!$("tactile").classList.contains("cache"))}`,
        `agents : ${navigator.userAgent.slice(0, 46)}`,
      ].join("\n");
    };
    maj();
    clearInterval(this._diagTimer);
    this._diagTimer = setInterval(maj, 800);
  }

  _cablesTactile() {
    const tir = $("t-btn-tir"), viser = $("t-btn-viser");
    const maintenir = (el, fn) => {
      el.addEventListener("touchstart", (e) => { e.preventDefault(); fn(true); el.classList.add("actif"); }, { passive: false });
      el.addEventListener("touchend", (e) => { e.preventDefault(); fn(false); el.classList.remove("actif"); }, { passive: false });
      el.addEventListener("touchcancel", () => { fn(false); el.classList.remove("actif"); });
    };
    maintenir(tir, (on) => { this.entrees.tactileTir = on; });
    maintenir(viser, (on) => { if (on) this.entrees.tactileVise = !this.entrees.tactileVise; });

    $("t-btn-pause").addEventListener("touchstart", (e) => {
      e.preventDefault();
      this._pause();
    }, { passive: false });

    $("t-btn-recharger").addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.arme?.recharger();
      this.audio?.interface();
    }, { passive: false });

    $("t-btn-saut").addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.entrees.touches.add("Space");
      setTimeout(() => this.entrees.touches.delete("Space"), 180);
    }, { passive: false });
  }

  _verifierOrientation() {
    if (!this.tactile) return;
    // On ne bloque plus : en portrait, un simple bandeau conseille le paysage.
    const portrait = window.innerHeight > window.innerWidth;
    $("paysage").classList.toggle("cache", !portrait || this.etat !== ETATS.JEU);
  }

  _erreur(message) {
    const el = $("erreur");
    el.textContent = `Erreur : ${message}\n\nRecharge la page. Si le problème persiste, ouvre la console (F12).`;
    el.classList.remove("cache");
    console.error(message);
  }

  _appliquerQualite(nom) {
    const q = CONFIG.rendu.qualite[nom] || CONFIG.rendu.qualite.normale;
    this.qualite = q;
    this.renderer.shadowMap.enabled = q.ombres;
    this.scene.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { m.needsUpdate = true; });
      }
    });
    this.postfx?.setQualite(q);
    this._redimensionner();
  }

  _allerAccueil() {
    this.etat = ETATS.ACCUEIL;
    this._afficherVoile("accueil");
    $("hud").classList.add("cache");
    this.entrees?.relacherVerrou();
    this.audio.reprendre();
    this.audio.suspendre();
    this.joueur?.reinitialiser();
    this.ennemis?.nettoyer();
    this.arme?.reinitialiser();
    this.vague = 1; this.score = 0; this.elimines = 0; this.tempsPartie = 0;
    $("tactile").classList.add("cache");
  }

  _lancerPartie() {
    this._masquerVoiles();
    this.etat = ETATS.JEU;
    $("hud").classList.remove("cache");
    this.joueur.reinitialiser();
    this.ennemis.nettoyer();
    this.arme.reinitialiser();
    this.vague = 1;
    this.score = 0;
    this.elimines = 0;
    this.tempsPartie = 0;
    this._attenteVague = -1;
    this._attenteFin = 1.6;
    this._derniereVie = CONFIG.joueur.vieMax;
    this._dernierElimines = 0;
    this.journal = [];
    $("journal").innerHTML = "";
    this.audio.demarrer();
    this.audio.reprendre();
    if (this.tactile) {
      $("tactile").classList.remove("cache");
      $("hud").classList.add("tactile");
      $("stick-base").classList.add("repos");
      this._verifierOrientation();
      this.entrees.tactileVise = false;
      this.entrees.tactileTir = false;
      this.entrees.tirGeste = false;
      setTimeout(() => {
        if (this.etat === ETATS.JEU) {
          this._message("GLISSE POUR VISER\nDOUBLE-TAPE POUR TIRER", { petit: true, duree: 3.5 });
        }
      }, 2400);
    } else {
      this.entrees.demanderVerrou();
    }
    this.ennemis.lancerVague(1);
    this._message("VAGUE 1", { petit: false, duree: 2.2 });
    this.audio.vague();
    this._majHud();
  }

  _pause() {
    if (this.etat !== ETATS.JEU) return;
    this.etat = ETATS.PAUSE;
    this._afficherVoile("pause");
    $("tactile").classList.add("cache");
    this.entrees.relacherVerrou();
    this.entrees.touches.clear();
    this.entrees.gauche = this.entrees.droite = false;
    this.audio.suspendre();
  }

  _reprendre() {
    if (!this.joueur) return;
    this._masquerVoiles();
    this.etat = ETATS.JEU;
    this.audio.reprendre();
    if (!this.tactile) this.entrees.demanderVerrou();
  }

  _ouvrirReglages(depuis) {
    this._depuisReglages = depuis;
    this._afficherVoile("reglages");
    this.entrees?.relacherVerrou();
  }

  _fermerReglages() {
    if (this._depuisReglages === "pause") { this._afficherVoile("pause"); this.etat = ETATS.PAUSE; }
    else { this._afficherVoile("accueil"); this.etat = ETATS.ACCUEIL; }
  }

  _afficherVoile(id) {
    ["accueil", "reglages", "pause", "fin"].forEach((n) => $(n).classList.toggle("actif", n === id));
  }

  _masquerVoiles() {
    ["accueil", "reglages", "pause", "fin"].forEach((n) => $(n).classList.remove("actif"));
  }

  _terminer() {
    this.etat = ETATS.FIN;
    this._afficherVoile("fin");
    this.entrees.relacherVerrou();
    $("fin-vagues").textContent = String(this.vague - 1);
    $("fin-elimines").textContent = String(this.elimines);
    $("fin-score").textContent = String(this.score).padStart(4, "0");
    $("fin-temps").textContent = this._chrono();
    $("fin-titre").textContent = "TU ES TOMBÉ";
    $("fin-surtitre").textContent = "OPÉRATION TERMINÉE";
    this.audio.suspendre();
  }

  /* ------------------------------------------------------------------- HUD */
  _message(texte, { petit = false, rouge = false, duree = 2 } = {}) {
    const el = $("message-centre");
    el.textContent = texte;
    el.classList.remove("cache", "petit", "rouge");
    if (petit) el.classList.add("petit");
    if (rouge) el.classList.add("rouge");
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
    this._messageTimer = duree;
  }

  _journal(texte) {
    const el = $("journal");
    const d = document.createElement("div");
    d.className = "entree";
    d.innerHTML = texte;
    el.prepend(d);
    while (el.children.length > 5) el.lastChild.remove();
    setTimeout(() => d.remove(), 6000);
  }

  // Arc rouge orienté vers celui qui vient de tirer.
  _indiquerDirection(j) {
    if (!j.sourceDegat) return;
    const dx = j.sourceDegat.x - j.pieds.x;
    const dz = j.sourceDegat.z - j.pieds.z;
    const f = dx * -Math.sin(j.yaw) + dz * -Math.cos(j.yaw);
    const r = dx * Math.cos(j.yaw) + dz * -Math.sin(j.yaw);
    const angle = Math.atan2(r, f) * 180 / Math.PI;
    const el = $("degats-direction");
    el.style.transform = `rotate(${angle.toFixed(0)}deg)`;
    el.classList.add("joue");
    clearTimeout(this._directionTimer);
    this._directionTimer = setTimeout(() => el.classList.remove("joue"), 700);
  }

  _surTouche(tete) {
    const m = $("marqueur-touche");
    m.classList.remove("joue");
    void m.offsetWidth;
    m.classList.add("joue");
  }

  _surElimination(tete) {
    this.elimines++;
    this.score += tete ? 150 : 100;
    this._journal(tete ? "☠ <b>HEADSHOT</b> — +150" : "☠ hostile neutralisé — +100");
  }

  _chrono() {
    const s = Math.floor(this.tempsPartie);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  _majPerf(dt) {
    this._perfTemps = (this._perfTemps || 0) + dt;
    this._perfImages = (this._perfImages || 0) + 1;
    if (this._perfTemps < 0.5 || !this._perfVisible) { if (!this._perfVisible) { this._perfTemps = 0; this._perfImages = 0; } return; }
    const fps = Math.round(this._perfImages / this._perfTemps);
    const st = this.postfx?.stats || { appels: 0, triangles: 0 };
    $("perf").textContent =
      `fps ${String(fps).padStart(3)}   ${(1000 / Math.max(1, fps)).toFixed(1)} ms\n` +
      `appels ${st.appels}  triangles ${(st.triangles / 1000).toFixed(0)}k\n` +
      `qualité ${this.reglages.qualite}`;
    this._perfTemps = 0; this._perfImages = 0;
  }

  _majHud() {
    const j = this.joueur, a = this.arme.etat;
    const pct = Math.max(0, Math.min(1, j.vie / CONFIG.joueur.vieMax));
    $("hud-sante-barre").style.width = `${pct * 100}%`;
    $("hud-sante-barre").style.background = pct > 0.55
      ? "linear-gradient(90deg,#37a86a,#7cf2a8)"
      : pct > 0.25 ? "linear-gradient(90deg,#a8842f,#ffb02e)"
      : "linear-gradient(90deg,#7d1f1f,#ff4d4d)";
    $("hud-sante").textContent = String(Math.ceil(j.vie));
    $("hud-chargeur").textContent = String(a.chargeur);
    $("hud-chargeur").classList.toggle("vide", a.chargeur === 0);
    $("hud-reserve").textContent = String(a.reserve);
    $("hud-vague").textContent = String(this.vague);
    $("hud-restants").textContent = `${this.ennemis.vivants} hostile${this.ennemis.vivants > 1 ? "s" : ""}`;
    $("hud-score").textContent = String(this.score).padStart(4, "0");
    $("hud-temps").textContent = this._chrono();
    $("hud-arme").textContent = CONFIG.arme.nom;
  }

  /* ---------------------------------------------------------------- boucle */
  _boucle(maintenant) {
    requestAnimationFrame(this._boucle);
    const dt = Math.min(0.05, (maintenant - this._dernier) / 1000) || 0;
    this._dernier = maintenant;
    this._temps += dt;

    if (this.etat === ETATS.JEU && this.joueur) {
      this._maj(dt);
      this.postfx.render(this.scene, this.camera, this._temps);
    } else if (this.etat === ETATS.ACCUEIL && this.monde) {
      this._cameraAccueil(dt);
      this.postfx.render(this.scene, this.camera, this._temps);
    } else if (this.etat === ETATS.PAUSE && this.monde) {
      this.postfx.render(this.scene, this.camera, this._temps);
    }
  }

  _cameraAccueil(dt) {
    this._orbite += dt * 0.055;
    const r = 26;
    this.camera.position.set(
      Math.cos(this._orbite) * r,
      9 + Math.sin(this._orbite * 0.7) * 1.6,
      Math.sin(this._orbite) * r
    );
    this.camera.lookAt(0, 2.2, 0);
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    this.monde.animer(dt, this._temps);
  }

  _maj(dt) {
    const j = this.joueur;
    const e = this.entrees;
    const souris = e.consommerSouris();

    if (j.vivant) {
      if (e.verrouille) j.appliquerSouris(souris.dx, souris.dy, this.reglages.sensibilite / 100, this.reglages.inverser);
      j.update(dt, e, { peutBouger: true });
      this.arme.update(dt, j, {
        tir: (e.gauche && e.verrouille) || e.tactileTir || e.tirGeste,
        vise: (e.droite && e.verrouille) || e.tactileVise,
        souris,
      }, this.monde, this.ennemis);
    } else {
      j.update(dt, e, { peutBouger: false });
    }

    this.monde.animer(dt, this._temps);
    this.ennemis.update(dt);

    if (j.vivant) {
      this.tempsPartie += dt;
      // Dégâts ressentis.
      if (j.vie < this._derniereVie - 0.01) {
        const bord = $("degats-bord");
        bord.classList.remove("joue");
        void bord.offsetWidth;
        bord.classList.add("joue");
        setTimeout(() => bord.classList.remove("joue"), 90);
        this._indiquerDirection(j);
      }
      this._derniereVie = j.vie;
    }

    // Vagues.
    if (this.ennemis.vagueTerminee && this._attenteVague < 0) {
      this._attenteVague = CONFIG.vagues.pauseEntreVagues;
      this._message("VAGUE SUIVANTE", { petit: true, duree: 2 });
    }
    if (this._attenteVague >= 0) {
      this._attenteVague -= dt;
      if (this._attenteVague < 0) {
        this.vague++;
        this.ennemis.lancerVague(this.vague);
        this._message(`VAGUE ${this.vague}`, { duree: 2.2 });
        this.audio.vague();
        this.score += 250;
      }
    }

    // Viseur dynamique : s'ouvre quand on bouge ou qu'on tire.
    const ouverture = 9 + Math.min(12, j.vitesseHorizontale * 1.4) + (1 - this.arme.etat.vise) * 4;
    $("viseur").style.setProperty("--ecart", `${ouverture}px`);
    $("viseur").style.opacity = this.arme.etat.vise > 0.6 ? "0.35" : "1";

    if (this._messageTimer > 0) {
      this._messageTimer -= dt;
      if (this._messageTimer <= 0) $("message-centre").classList.add("cache");
    }

    this._majHud();
    this._majPerf(dt);

    if (!j.vivant && this.etat === ETATS.JEU) {
      this._attenteFin = (this._attenteFin ?? 1.6) - dt;
      if (this._attenteFin <= 0) { this._attenteFin = 1.6; this._terminer(); }
    }
  }
}

// Démarrage : on refuse proprement plutôt que d'afficher un écran cassé.
function supporteWebGL2() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGL2RenderingContext && c.getContext("webgl2"));
  } catch (e) { return false; }
}

function pointeurGrossier() {
  try {
    // Détection volontairement large : certains téléphones rapportent
    // « pointer: fine » alors qu'ils n'ont pas de souris.
    if ((navigator.maxTouchPoints || 0) > 0) return true;
    if ("ontouchstart" in window) return true;
    return window.matchMedia("(pointer: coarse)").matches;
  } catch (e) { return false; }
}

function bloquer(titre, texte) {
  document.getElementById("chargement").classList.remove("actif");
  document.getElementById("incompatible-titre").textContent = titre;
  document.getElementById("incompatible-texte").textContent = texte;
  document.getElementById("incompatible").classList.add("actif");
}

try {
  const params = new URLSearchParams(location.search);
  if (params.get("tactile") === "1") {
    window.__tactileForce = true;
  }
  if (!supporteWebGL2()) {
    bloquer("WEBGL 2 REQUIS", "Ce navigateur ne fournit pas WebGL 2, indispensable au rendu 3D du jeu. Essaie un navigateur récent, ou active l'accélération matérielle.");
  } else {
    window.__jeu = new Jeu({
      tactile: window.__tactileForce === true || pointeurGrossier(),
      debug: params.get("debug") === "1",
    });
  }
} catch (err) {
  const el = document.getElementById("erreur");
  if (el) {
    el.textContent = `Impossible de démarrer le jeu : ${err.message}\n\n${err.stack || ""}`;
    el.classList.remove("cache");
  }
  console.error(err);
}
