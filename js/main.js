import * as THREE from "three";
import { CONFIG, ETATS } from "./config.js?v=20261030i";
import { Monde } from "./world.js?v=20261030i";
import { Joueur, Entrees } from "./player.js?v=20261030i";
import { Arme } from "./weapon.js?v=20261030i";
import { GestionEnnemis } from "./enemies.js?v=20261030i";
import { PostFX } from "./postfx.js?v=20261030i";
import { Audio } from "./audio.js?v=20261030i";

const $ = (id) => document.getElementById(id);

const CLE_REGLAGES = "cascade-operation-reglages-v2";
const CLE_REGLAGES_ANCIENNE = "cascade-operation-reglages";
const CLE_TUTO_VU = "cascade-operation-tuto-vu";
const CLE_TUTO_TOUJOURS = "cascade-operation-tuto-toujours";

const REGLAGES_DEFAUT = {
  sensibilite: 100,
  sensibiliteTactile: 100,
  volume: 70,
  qualite: "normale",
  inverser: false,
  aideVisee: true,
  tactile: null,
};

class Jeu {
  constructor(options = {}) {
    this.tactile = options.tactile === true;
    this.debug = options.debug === true;
    this.canvas = $("rendu");
    this.etat = ETATS.CHARGEMENT;
    this.reglages = this._chargerReglages();
    // Le choix explicite de l'utilisateur prime sur la détection.
    if (this.reglages.tactile === true) this.tactile = true;
    else if (this.reglages.tactile === false) this.tactile = false;
    // Sur téléphone, on part directement en qualité basse : c'est là que ça compte.
    if (this.tactile && !this._reglagesSauves) this.reglages.qualite = "basse";
    this.qualite = CONFIG.rendu.qualite[this.reglages.qualite] || CONFIG.rendu.qualite.normale;

    this._resScale = 1;
    this._pleinEcranVoulu = false;
    this._pleinEcranActif = false;
    this._graceOrientation = false;
    this._graceOrientationTimer = null;
    this._adaptTemps = 0;
    this._adaptImages = 0;
    this._dernierFps = 60;
    this._vibrationTimer = 0;
    this._record = this._chargerRecord();
    this._chargerTuto();

    // Hauteur validée : 60 % de l'écran.
    this.mireY = CONFIG.arme.mireY;
    this._mireNdc = new THREE.Vector2(0, 0);
    // Nettoie l'ancien réglage expérimental de la mire.
    try { localStorage.removeItem("cascade-operation-mire"); } catch (e) { /* ignore */ }
    this._appliquerMire();

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
      const brut = localStorage.getItem(CLE_REGLAGES);
      if (brut) {
        this._reglagesSauves = true;
        return { ...REGLAGES_DEFAUT, ...JSON.parse(brut) };
      }

      // Migration depuis l'ancienne version : on conserve les préférences,
      // mais on oublie « tactile:false » qui pouvait laisser un téléphone en
      // mode souris, sans aucune commande utilisable.
      const ancien = localStorage.getItem(CLE_REGLAGES_ANCIENNE);
      if (ancien) {
        const v = JSON.parse(ancien) || {};
        const tactile = v.tactile === true ? true : null;
        return { ...REGLAGES_DEFAUT, ...v, tactile };
      }
    } catch (e) { /* stockage indisponible : on continue avec les défauts */ }
    return { ...REGLAGES_DEFAUT };
  }

  _sauverReglages() {
    try {
      localStorage.setItem(CLE_REGLAGES, JSON.stringify(this.reglages));
      this._reglagesSauves = true;
    } catch (e) { /* ignore */ }
  }

  _chargerRecord() {
    try { return parseInt(localStorage.getItem("cascade-operation-record") || "0", 10) || 0; }
    catch (e) { return 0; }
  }

  _sauverRecord() {
    try { localStorage.setItem("cascade-operation-record", String(this._record)); }
    catch (e) { /* ignore */ }
  }

  _majRecordAccueil() {
    const el = $("record-accueil");
    if (el) el.textContent = `RECORD ${String(this._record).padStart(4, "0")}`;
  }

  _appliquerMire() {
    document.documentElement.style.setProperty("--mire-y", `${this.mireY}%`);
    // Quand la mire descend, le message de vague remonte pour ne pas la masquer.
    const messageY = this.mireY > 52 ? 38 : 62;
    document.documentElement.style.setProperty("--message-y", `${messageY}%`);
  }

  _initRendu() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.setPixelRatio(this._ratioPixel());
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = this.qualite.ombres;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 320);

    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this._pause();
      this._erreur("Le contexte 3D a été perdu. Recharge la page pour reprendre.");
    });

    window.addEventListener("resize", () => this._redimensionner());
  }

  _ratioPixel() {
    return Math.min(window.devicePixelRatio || 1, this.qualite.pixelRatioMax) * (this._resScale || 1);
  }

  _redimensionner() {
    const l = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = l / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this._ratioPixel());
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
        this.entrees.brancherDirections($("dpad"));
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
    $("btn-jouer").addEventListener("click", () => { this.audio.interface(); this._demanderLancer(); });
    $("btn-tuto").addEventListener("click", () => { this.audio.interface(); this._ouvrirTuto(); });
    $("btn-tuto-jouer").addEventListener("click", () => { this.audio.interface(); this._lancerDepuisTuto(); });
    $("btn-tuto-retour").addEventListener("click", () => { this.audio.interface(); this._fermerTuto(); });
    document.querySelectorAll(".btn-avis").forEach((b) => {
      b.addEventListener("click", () => {
        this.audio.interface();
        this._ouvrirAvis(b.dataset.depuis || "accueil");
      });
    });
    document.querySelectorAll(".js-nav-tuto").forEach((b) => {
      b.addEventListener("click", () => {
        this.audio.interface();
        this._ouvrirTuto(b.dataset.depuis || "accueil");
      });
    });
    document.querySelectorAll(".js-nav-accueil").forEach((b) => {
      b.addEventListener("click", () => {
        this.audio.interface();
        this._allerAccueil();
      });
    });
    $("btn-avis-fermer")?.addEventListener("click", () => { this.audio.interface(); this._fermerAvis(); });
    this._cablesAvis();
    $("tuto-toujours").addEventListener("change", () => {
      this._tutoToujours = $("tuto-toujours").checked;
      this._sauverTuto();
    });
    document.querySelectorAll(".btn-debug").forEach((b) => b.addEventListener("click", () => {
      const el = $("debug");
      const visible = !el.classList.contains("cache");
      if (visible) el.classList.add("cache");
      else this._afficherDiagnostic();
    }));
    $("btn-rejouer").addEventListener("click", () => { this.audio.interface(); this._demanderLancer(); });
    $("btn-reglages").addEventListener("click", () => { this.audio.interface(); this._ouvrirReglages("accueil"); });
    $("btn-pause-reglages").addEventListener("click", () => { this.audio.interface(); this._ouvrirReglages("pause"); });
    $("btn-fermer-reglages").addEventListener("click", () => { this.audio.interface(); this._fermerReglages(); });
    $("btn-reprendre").addEventListener("click", () => { this.audio.interface(); this._reprendre(); });
    $("btn-abandonner").addEventListener("click", () => { this.audio.interface(); this._allerAccueil(); });
    $("btn-menu").addEventListener("click", () => { this.audio.interface(); this._allerAccueil(); });

    // Plein écran : utile sur Android, ignoré proprement sur iPhone.
    const fsDispo = typeof document.documentElement.requestFullscreen === "function";
    document.querySelectorAll(".btn-plein-ecran").forEach((b) => {
      if (!fsDispo) { b.classList.add("cache"); return; }
      b.addEventListener("click", () => { this.audio.interface(); this._pleinEcran(); });
    });

    // Filet de sécurité : si un téléphone a été laissé en mode souris par
    // d'anciens réglages, un bouton visible permet de réactiver le tactile.
    $("btn-tactile")?.addEventListener("click", () => {
      this.audio.interface();
      this.reglages.tactile = true;
      this._sauverReglages();
      this._activerTactile();
    });

    const sens = $("reg-sensibilite"), sensT = $("reg-sensibilite-tactile");
    const vol = $("reg-volume"), qual = $("reg-qualite");
    const inv = $("reg-inverser"), tact = $("reg-tactile"), aide = $("reg-aide-visee");
    sens.value = this.reglages.sensibilite;
    sensT.value = this.reglages.sensibiliteTactile;
    vol.value = this.reglages.volume;
    qual.value = this.reglages.qualite;
    inv.checked = this.reglages.inverser;
    tact.checked = this.tactile;
    aide.checked = this.reglages.aideVisee !== false;
    $("aide-clavier").classList.toggle("cache", this.tactile);
    $("aide-tactile").classList.toggle("cache", !this.tactile);
    $("reg-sensibilite-val").textContent = `${this.reglages.sensibilite} %`;
    $("reg-sensibilite-tactile-val").textContent = `${this.reglages.sensibiliteTactile} %`;
    $("reg-volume-val").textContent = `${this.reglages.volume} %`;
    this._majRecordAccueil();
    this._majBoutonTactile();

    sens.addEventListener("input", () => {
      this.reglages.sensibilite = Number(sens.value);
      $("reg-sensibilite-val").textContent = `${sens.value} %`;
      this._sauverReglages();
    });
    sensT.addEventListener("input", () => {
      this.reglages.sensibiliteTactile = Number(sensT.value);
      $("reg-sensibilite-tactile-val").textContent = `${sensT.value} %`;
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
    aide.addEventListener("change", () => {
      this.reglages.aideVisee = aide.checked;
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
    // sauf si l'utilisateur l'a explicitement désactivé.
    document.addEventListener("touchstart", () => {
      if (this.tactile) return;
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      // Sur un PC portable tactile, le pointeur principal est fin : on ne
      // bascule pas tout le jeu en mode mobile pour un simple contact.
      if (!window.__tactileForce && !coarse) return;
      // Sur un téléphone, même si un ancien réglage disait « tactile:false »,
      // le contact doit rendre le jeu jouable. On mémorise la correction.
      this.reglages.tactile = true;
      this._sauverReglages();
      this._activerTactile();
    }, { passive: true });

    document.addEventListener("fullscreenchange", () => {
      this._pleinEcranActif = !!document.fullscreenElement;
    });

    document.addEventListener("touchstart", () => {
      if (this.tactile && this._pleinEcranVoulu && !document.fullscreenElement &&
          this.etat === ETATS.JEU) {
        this._pleinEcran();
      }
    }, { passive: true });

    document.addEventListener("pointerlockchange", () => {
      if (!this.entrees || this.tactile) return;
      const verrouille = document.pointerLockElement === this.canvas;
      // Un événement « déverrouillé » alors qu'on ne l'était pas déjà ne doit
      // pas mettre le jeu en pause (cas des navigateurs mobiles qui refusent
      // ou simulent le pointer lock).
      if (this._etaitVerrouille && !verrouille && this.etat === ETATS.JEU) this._pause("pointerlock");
      this._etaitVerrouille = verrouille;
    });

    window.addEventListener("blur", () => {
      // Sur téléphone, un simple contact peut faire perdre le focus à la page
      // (barre d'adresse, plein écran) : on ne met pas en pause le mode tactile.
      if (this.etat === ETATS.JEU && !this.tactile) this._pause("blur");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.etat === ETATS.JEU) this._pause("visibilite");
    });
    window.addEventListener("resize", () => this._verifierOrientation());
    window.addEventListener("orientationchange", () => setTimeout(() => this._verifierOrientation(), 200));

    window.addEventListener("keydown", (e) => {
      const cible = e.target;
      if (cible && (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" ||
          cible.tagName === "SELECT" || cible.isContentEditable)) return;
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

  _majBoutonTactile() {
    const el = $("btn-tactile");
    if (!el) return;
    const dispo = (navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window;
    el.classList.toggle("cache", !dispo || this.tactile);
  }

  _afficherCommandesTactiles() {
    $("tactile").classList.remove("cache");
    $("hud").classList.add("tactile");
  }

  _masquerCommandesTactiles() {
    $("tactile").classList.add("cache");
    $("hud").classList.remove("tactile");
  }

  desactiverTactile() {
    this.tactile = false;
    if (this.entrees) {
      this.entrees.tactile = false;
      this.entrees.reinitialiserTactile();
    }
    document.body.classList.remove("tactile");
    this._masquerCommandesTactiles();
    const cb = $("reg-tactile");
    if (cb) cb.checked = false;
    $("aide-clavier")?.classList.remove("cache");
    $("aide-tactile")?.classList.add("cache");
    this._majBoutonTactile();
    this._majTutoMode();
    this._verifierOrientation();
  }

  _activerTactile() {
    this.tactile = true;
    if (this.entrees) {
      this.entrees.tactile = true;
      this.entrees.reinitialiserTactile();
    }
    this.entrees?.relacherVerrou();
    document.body.classList.add("tactile");
    if (!this._reglagesSauves) {
      this.reglages.qualite = "basse";
      const q = $("reg-qualite");
      if (q) q.value = "basse";
      this._appliquerQualite("basse");
    }
    const cb = $("reg-tactile");
    if (cb) cb.checked = true;
    $("aide-clavier")?.classList.add("cache");
    $("aide-tactile")?.classList.remove("cache");
    this._majBoutonTactile();
    this._majTutoMode();
    if (this.etat === ETATS.JEU) this._afficherCommandesTactiles();
    this._verifierOrientation();
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
        `raison pause : ${this._raisonPause || "-"}`,
        `fps : ${(this._dernierFps || 0).toFixed(0)}`,
        `résolution : ${Math.round((this._resScale || 1) * 100)} %`,
        `aide visée : ${oui(this.reglages.aideVisee !== false)}`,
        `ui tactile : ${oui(!$("tactile").classList.contains("cache"))}`,
        `agents : ${navigator.userAgent.slice(0, 46)}`,
      ].join("\n");
    };
    maj();
    clearInterval(this._diagTimer);
    this._diagTimer = setInterval(maj, 800);
  }

  _cablesTactile() {
    const tir = $("t-btn-tir");
    const recharger = $("t-btn-recharger");
    const pause = $("t-btn-pause");

    const maintenir = (el, onDown, onUp) => {
      if (!el) return;
      let actif = false;
      const relacher = () => {
        if (!actif) return;
        actif = false;
        el.classList.remove("actif");
        onUp?.();
      };
      el.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        actif = true;
        el.classList.add("actif");
        onDown?.();
      });
      el.addEventListener("pointerup", relacher);
      el.addEventListener("pointercancel", relacher);
      el.addEventListener("lostpointercapture", relacher);
    };

    maintenir(tir,
      () => { this.entrees.tactileTir = true; },
      () => { this.entrees.tactileTir = false; });

    if (recharger) {
      recharger.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.arme?.recharger();
        this.audio?.interface();
      });
    }
    if (pause) {
      pause.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this._pause("bouton");
      });
    }
  }

  _pleinEcran() {
    const el = document.documentElement;
    if (typeof el.requestFullscreen !== "function") return;
    this._pleinEcranVoulu = true;
    if (document.fullscreenElement) return;
    el.requestFullscreen()
      .then(() => {
        if (screen.orientation?.lock) screen.orientation.lock("landscape").catch(() => {});
      })
      .catch(() => {});
  }

  _verifierOrientation() {
    const portrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle("tactile", this.tactile);
    if (!this.tactile) {
      $("orientation")?.classList.add("cache");
      return;
    }
    const enJeu = this.etat === ETATS.JEU || this.etat === ETATS.PAUSE;
    $("orientation")?.classList.toggle("cache", !(portrait && enJeu));

    if (portrait && this.etat === ETATS.JEU) {
      // Au démarrage, on laisse au plein écran / verrouillage d'orientation
      // le temps de faire son travail avant de mettre en pause.
      if (this._graceOrientation) return;
      // Mise en pause due à l'orientation : on reprendra tout seul quand le
      // téléphone sera revenu en paysage.
      this._pause("orientation");
      return;
    }
    if (!portrait && this.etat === ETATS.PAUSE && this._pauseOrigineOrientation) {
      this._reprendre({ automatique: true });
    }
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
    this.reglages.qualite = nom;
    this._resScale = 1;
    const sel = $("reg-qualite");
    if (sel && sel.value !== nom) sel.value = nom;
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
    this.entrees?.reinitialiserTactile();
    this.audio.reprendre();
    this.audio.suspendre();
    this.joueur?.reinitialiser();
    this.ennemis?.nettoyer();
    this.arme?.reinitialiser();
    this.vague = 1; this.score = 0; this.elimines = 0; this.tempsPartie = 0;
    this._graceOrientation = false;
    clearTimeout(this._graceOrientationTimer);
    this._masquerCommandesTactiles();
    this._majRecordAccueil();
    this._verifierOrientation();
  }

  _lancerPartie() {
    this._masquerVoiles();
    this.etat = ETATS.JEU;
    this._graceOrientation = true;
    clearTimeout(this._graceOrientationTimer);
    this._graceOrientationTimer = setTimeout(() => {
      this._graceOrientation = false;
      this._verifierOrientation();
    }, 1200);
    $("hud").classList.remove("cache");
    this.joueur.reinitialiser();
    this.ennemis.nettoyer();
    this.arme.reinitialiser();
    this.monde.reinitialiserLampadaires();
    this.vague = 1;
    this.score = 0;
    this.elimines = 0;
    this.tempsPartie = 0;
    this._attenteVague = -1;
    this._attenteFin = 1.6;
    this._derniereVie = CONFIG.joueur.vieMax;
    this._dernierElimines = 0;
    this._resScale = 1;
    this._adaptTemps = 0;
    this._adaptImages = 0;
    this.journal = [];
    $("journal").innerHTML = "";
    this.audio.demarrer();
    this.audio.reprendre();
    this.entrees.reinitialiserTactile();
    if (this.tactile) {
      this._afficherCommandesTactiles();
      this.arme.aideVisee = this.reglages.aideVisee !== false;
      this._pleinEcran();
      setTimeout(() => {
        if (this.etat === ETATS.JEU) {
          this._message("FLÈCHES POUR SE DÉPLACER\nGLISSE POUR VISER\nTAPE POUR TIRER",
            { petit: true, duree: 4.5 });
        }
      }, 2400);
    } else {
      this.arme.aideVisee = false;
      this.entrees.demanderVerrou();
    }
    this.ennemis.lancerVague(1);
    this._message("VAGUE 1", { petit: false, duree: 2.2 });
    this.audio.vague();
    this._majHud();
    this._verifierOrientation();
  }

  _pause(origine = "manuelle") {
    if (this.etat !== ETATS.JEU) return;
    this.etat = ETATS.PAUSE;
    this._graceOrientation = false;
    clearTimeout(this._graceOrientationTimer);
    this._raisonPause = origine;
    this._pauseOrigineOrientation = origine === "orientation";
    this._afficherVoile("pause");
    this._masquerCommandesTactiles();
    this.entrees.relacherVerrou();
    this.entrees.touches.clear();
    this.entrees.gauche = this.entrees.droite = false;
    this.entrees.reinitialiserTactile();
    this.audio.suspendre();
    this._verifierOrientation();
  }

  _reprendre({ automatique = false } = {}) {
    if (!this.joueur) return;
    if (this.tactile && window.innerHeight > window.innerWidth) {
      this._verifierOrientation();
      return;
    }
    this._pauseOrigineOrientation = false;
    this._graceOrientation = false;
    clearTimeout(this._graceOrientationTimer);
    // Si le plein écran a été perdu, on le redemande depuis ce clic utilisateur.
    if (this.tactile && !automatique && !document.fullscreenElement) this._pleinEcran();
    this._masquerVoiles();
    this.etat = ETATS.JEU;
    this.audio.reprendre();
    this.entrees.reinitialiserTactile();
    if (this.tactile) this._afficherCommandesTactiles();
    else this.entrees.demanderVerrou();
    this._verifierOrientation();
  }

  /* ------------------------------------------------------------------- avis */
  _cablesAvis() {
    const form = $("form-avis");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const statut = $("avis-statut");
      const message = $("avis-message").value.trim();
      if (message.length < 10) {
        statut.textContent = "Écris au moins quelques mots (10 caractères).";
        statut.className = "avis-statut erreur";
        $("avis-message").focus();
        return;
      }

      const bouton = $("btn-avis-envoyer");
      bouton.disabled = true;
      statut.textContent = "Envoi en cours…";
      statut.className = "avis-statut";

      try {
        const donnees = new FormData(form);
        donnees.set("version", (($("version")?.textContent || "").replace(/^build\s*/i, "").trim()));
        donnees.set("ecran", `${window.innerWidth}x${window.innerHeight}`);
        const reponse = await fetch("./commentaire.php", {
          method: "POST",
          body: donnees,
          headers: { "Accept": "application/json" },
        });
        const resultat = await reponse.json().catch(() => null);
        if (!reponse.ok || !resultat?.ok) {
          throw new Error(resultat?.erreur || "Envoi impossible pour le moment.");
        }
        form.reset();
        statut.textContent = "Merci, ton message est bien arrivé.";
        statut.className = "avis-statut ok";
      } catch (err) {
        statut.textContent = err?.message || "Envoi impossible. Réessaie plus tard.";
        statut.className = "avis-statut erreur";
      } finally {
        bouton.disabled = false;
      }
    });
  }

  _ouvrirAvis(depuis = "accueil") {
    this._avisDepuis = depuis;
    this._afficherVoile("avis");
    this.entrees?.relacherVerrou();
    this.entrees?.reinitialiserTactile();
    const statut = $("avis-statut");
    if (statut) {
      statut.textContent = "";
      statut.className = "avis-statut";
    }
    this._verifierOrientation();
  }

  _fermerAvis() {
    if (this._avisDepuis === "pause") {
      this._afficherVoile("pause");
      this.etat = ETATS.PAUSE;
    } else if (this._avisDepuis === "fin") {
      this._afficherVoile("fin");
      this.etat = ETATS.FIN;
    } else {
      this._afficherVoile("accueil");
      this.etat = ETATS.ACCUEIL;
    }
    this._verifierOrientation();
  }

  /* ------------------------------------------------------------ mode d'emploi */
  _chargerTuto() {
    try {
      this._tutoVu = localStorage.getItem(CLE_TUTO_VU) === "1";
      this._tutoToujours = localStorage.getItem(CLE_TUTO_TOUJOURS) === "1";
    } catch (e) {
      this._tutoVu = false;
      this._tutoToujours = false;
    }
  }

  _sauverTuto() {
    try {
      localStorage.setItem(CLE_TUTO_VU, this._tutoVu ? "1" : "0");
      localStorage.setItem(CLE_TUTO_TOUJOURS, this._tutoToujours ? "1" : "0");
    } catch (e) { /* ignore */ }
  }

  _majTutoMode() {
    $("tuto-etapes-tactile")?.classList.toggle("cache", !this.tactile);
    $("tuto-etapes-clavier")?.classList.toggle("cache", this.tactile);
  }

  _demanderLancer() {
    if (!this._tutoVu || this._tutoToujours) {
      this._ouvrirTuto();
      return;
    }
    this._lancerPartie();
  }

  _ouvrirTuto(depuis = "accueil") {
    this._tutoDepuis = depuis;
    this._etatTutoPrecedent = this.etat;
    this._afficherVoile("tuto");
    this.entrees?.relacherVerrou();
    this.entrees?.reinitialiserTactile();
    $("tuto-toujours").checked = this._tutoToujours;
    this._majTutoMode();
    this._verifierOrientation();
  }

  _fermerTuto() {
    const precedent = this._etatTutoPrecedent;
    if (this._tutoDepuis === "pause") {
      this._afficherVoile("pause");
      this.etat = ETATS.PAUSE;
    } else if (this._tutoDepuis === "fin") {
      this._afficherVoile("fin");
      this.etat = ETATS.FIN;
    } else if (this._tutoDepuis === "reglages") {
      this._afficherVoile("reglages");
      this.etat = precedent === ETATS.PAUSE ? ETATS.PAUSE : ETATS.ACCUEIL;
    } else if (this._tutoDepuis === "avis") {
      this._afficherVoile("avis");
      this.etat = precedent;
    } else {
      this._afficherVoile("accueil");
      this.etat = ETATS.ACCUEIL;
    }
    this._verifierOrientation();
  }

  _lancerDepuisTuto() {
    this._tutoVu = true;
    this._sauverTuto();
    this._lancerPartie();
  }

  _ouvrirReglages(depuis) {
    this._depuisReglages = depuis;
    this._afficherVoile("reglages");
    this.entrees?.relacherVerrou();
    this.entrees?.reinitialiserTactile();
  }

  _fermerReglages() {
    if (this._depuisReglages === "pause") { this._afficherVoile("pause"); this.etat = ETATS.PAUSE; }
    else { this._afficherVoile("accueil"); this.etat = ETATS.ACCUEIL; }
  }

  _afficherVoile(id) {
    ["accueil", "tuto", "avis", "reglages", "pause", "fin"].forEach((n) => $(n).classList.toggle("actif", n === id));
  }

  _masquerVoiles() {
    ["accueil", "tuto", "avis", "reglages", "pause", "fin"].forEach((n) => $(n).classList.remove("actif"));
  }

  _terminer() {
    this.etat = ETATS.FIN;
    this._afficherVoile("fin");
    this._masquerCommandesTactiles();
    this.entrees.relacherVerrou();
    this.entrees.reinitialiserTactile();
    this._verifierOrientation();

    const nouveauRecord = this.score > this._record;
    if (nouveauRecord) {
      this._record = this.score;
      this._sauverRecord();
    }

    $("fin-vagues").textContent = String(Math.max(0, this.vague - 1));
    $("fin-elimines").textContent = String(this.elimines);
    $("fin-score").textContent = String(this.score).padStart(4, "0");
    $("fin-temps").textContent = this._chrono();
    $("fin-titre").textContent = "TU ES TOMBÉ";
    $("fin-surtitre").textContent = nouveauRecord ? "NOUVEAU RECORD" : "OPÉRATION TERMINÉE";
    const rec = $("fin-record");
    if (rec) {
      rec.textContent = String(this._record).padStart(4, "0");
      rec.classList.toggle("nouveau", nouveauRecord);
    }
    this._vibrer([28, 40, 28]);
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

  _vibrer(motif) {
    if (!this.tactile || !navigator.vibrate) return;
    try { navigator.vibrate(motif); } catch (e) { /* certains navigateurs refusent */ }
  }

  _surTouche(tete) {
    const m = $("marqueur-touche");
    m.classList.remove("joue");
    void m.offsetWidth;
    m.classList.add("joue");
    const maintenant = performance.now();
    if (maintenant - this._vibrationTimer > 55) {
      this._vibrer(tete ? 18 : 9);
      this._vibrationTimer = maintenant;
    }
  }

  _surElimination(tete) {
    this.elimines++;
    this.score += tete ? 150 : 100;
    this._journal(tete ? "☠ <b>HEADSHOT</b> — +150" : "☠ hostile neutralisé — +100");
    this._vibrer(tete ? 30 : 18);
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
      `qualité ${this.reglages.qualite}  résolution ${Math.round((this._resScale || 1) * 100)} %`;
    this._perfTemps = 0; this._perfImages = 0;
  }

  // Résolution adaptative : on descend doucement si le téléphone peine.
  _majFps(dt) {
    this._adaptTemps += dt;
    this._adaptImages++;
    if (this._adaptTemps < 2.0) return;
    const fps = this._adaptImages / this._adaptTemps;
    this._dernierFps = fps;
    this._adaptTemps = 0;
    this._adaptImages = 0;
    if (!this.tactile || this.etat !== ETATS.JEU) return;
    const avant = this._resScale;
    if (fps < 27 && this._resScale > 0.6) this._resScale = Math.max(0.6, this._resScale - 0.12);
    else if (fps > 52 && this._resScale < 1) this._resScale = Math.min(1, this._resScale + 0.08);
    if (Math.abs(this._resScale - avant) > 0.001) this._redimensionner();
  }

  _majIndicateurHostile() {
    const el = $("indicateur-hostile");
    if (!el) return;
    const dernier = this.ennemis.restants === 1 && this.ennemis.vivants === 1 && this.joueur?.vivant;
    if (!dernier) {
      el.classList.add("cache");
      return;
    }
    const e = this.ennemis.liste.find((x) => x.vivant);
    if (!e) {
      el.classList.add("cache");
      return;
    }

    this.camera.updateMatrixWorld();
    const cible = new THREE.Vector3(e.groupe.position.x, e.groupe.position.y + 1.2, e.groupe.position.z);
    const local = this.camera.worldToLocal(cible.clone());
    let x, y;

    if (local.z < 0) {
      const ndc = cible.clone().project(this.camera);
      x = (ndc.x * 0.5 + 0.5) * window.innerWidth;
      y = (-ndc.y * 0.5 + 0.5) * window.innerHeight;
    } else {
      const angle = (Math.abs(local.x) < 0.001 && Math.abs(local.y) < 0.001)
        ? -Math.PI / 2
        : Math.atan2(local.y, local.x);
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      x = cx + Math.cos(angle) * (cx - 54);
      y = cy - Math.sin(angle) * (cy - 54);
    }

    const marge = 54;
    x = Math.max(marge, Math.min(window.innerWidth - marge, x));
    y = Math.max(marge, Math.min(window.innerHeight - marge, y));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    const distance = Math.hypot(
      e.groupe.position.x - this.joueur.pieds.x,
      e.groupe.position.z - this.joueur.pieds.z
    );
    $("indicateur-hostile-distance").textContent = `${Math.round(distance)} m`;
    el.classList.remove("cache");
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
    const restants = this.ennemis.restants;
    $("hud-restants").textContent = `${restants} hostile${restants > 1 ? "s" : ""}`;
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
      this.postfx.render(this.scene, this.camera, this._temps,
        this.arme ? { scene: this.arme.sceneArme, camera: this.arme.cameraArme } : null);
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
    e.majTactile();
    const souris = e.consommerSouris();
    const tirTape = e.consommerTirTape();

    // Position réelle de la croix à l'écran, en coordonnées NDC.
    const rectMire = $("viseur").getBoundingClientRect();
    this._mireNdc.set(
      ((rectMire.left + rectMire.width / 2) / window.innerWidth) * 2 - 1,
      -(((rectMire.top + rectMire.height / 2) / window.innerHeight) * 2 - 1)
    );
    this.arme.mireNdc.copy(this._mireNdc);

    if (j.vivant) {
      if (e.verrouille || this.tactile) {
        const sensibilite = this.tactile ? this.reglages.sensibiliteTactile : this.reglages.sensibilite;
        j.appliquerSouris(souris.dx, souris.dy, sensibilite / 100, this.reglages.inverser);
      }
      this.arme.aideVisee = this.tactile && this.reglages.aideVisee !== false;
      j.update(dt, e, { peutBouger: true });
      this.arme.update(dt, j, {
        tir: (e.gauche && e.verrouille) || e.tactileTir || e.tirGeste || tirTape,
        vise: (e.droite && e.verrouille) && !this.tactile,
        souris,
      }, this.monde, this.ennemis);
    } else {
      e.tactileTir = false;
      e.tirGeste = false;
      e.tirTape = false;
      j.update(dt, e, { peutBouger: false });
    }

    this.monde.animer(dt, this._temps);
    this.ennemis.update(dt);
    this._majIndicateurHostile();

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
    this._majFps(dt);

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
    // On regarde le pointeur PRINCIPAL. Sur un PC portable tactile, il est
    // fin (souris) : on reste en mode clavier/souris. Sur un téléphone, même
    // avec un stylet ou une souris secondaire, il reste grossier.
    const grossier = window.matchMedia("(pointer: coarse)").matches;
    return grossier && (navigator.maxTouchPoints || 0) > 0;
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
