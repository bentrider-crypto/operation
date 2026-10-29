import * as THREE from "three";
import { CONFIG } from "./config.js?v=20261030d";

/* =============================================================================
   Entrées clavier/souris + contrôleur du joueur (capsule contre boîtes AABB).
   ========================================================================== */

export class Entrees {
  constructor(canvas) {
    this.canvas = canvas;
    this.touches = new Set();
    this.dx = 0; this.dy = 0;
    this.tactile = false;
    this.axeX = 0; this.axeY = 0;      // pavé directionnel, -1..1
    this.tactileTir = false;           // bouton TIR maintenu
    this.tirGeste = false;             // doigt maintenu sur la zone de visée
    this.tirTape = false;              // tap court, consommé par la boucle
    this._appuiVue = false;
    this._vueId = null;
    this._vueDebut = 0;
    this._vueBouge = false;
    this._doigtsDir = new Map();
    this.gauche = false; this.droite = false;
    this.verrouille = false;
    this._écouteurs = {};

    window.addEventListener("keydown", (e) => {
      const cible = e.target;
      if (cible && (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" ||
          cible.tagName === "SELECT" || cible.isContentEditable)) return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.touches.add(e.code);
      this._émettre("touche", e.code);
    });
    window.addEventListener("keyup", (e) => this.touches.delete(e.code));

    window.addEventListener("blur", () => {
      this.touches.clear(); this.gauche = this.droite = false;
      this.reinitialiserTactile();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { this.touches.clear(); this.reinitialiserTactile(); }
    });

    document.addEventListener("pointerlockchange", () => {
      this.verrouille = document.pointerLockElement === this.canvas;
      if (this.verrouille) { this._ignoreSouris = true; this.dx = 0; this.dy = 0; }
      this._émettre("verrou", this.verrouille);
    });
    document.addEventListener("pointerlockerror", () => this._émettre("verrou", false));

    document.addEventListener("mousemove", (e) => {
      if (!this.verrouille) return;
      // Certains navigateurs envoient un delta énorme juste après le
      // verrouillage : on l'ignore, et on borne les pics de mouvement.
      const dx = Math.max(-160, Math.min(160, e.movementX || 0));
      const dy = Math.max(-160, Math.min(160, e.movementY || 0));
      this.dx += dx;
      this.dy += dy;
    });

    canvas.addEventListener("mousedown", (e) => {
      if (!this.verrouille) return;
      if (e.button === 0) this.gauche = true;
      if (e.button === 2) this.droite = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.gauche = false;
      if (e.button === 2) this.droite = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // --- commandes tactiles ---------------------------------------------------
  // Quatre flèches : un doigt par flèche, plusieurs directions possibles.
  brancherDirections(zone) {
    if (!zone) return;
    const boutons = [...zone.querySelectorAll("[data-direction]")];
    const actives = new Map(); // pointerId -> direction
    const recalculer = () => {
      const d = new Set(actives.values());
      this.axeX = (d.has("droite") ? 1 : 0) - (d.has("gauche") ? 1 : 0);
      this.axeY = (d.has("bas") ? 1 : 0) - (d.has("haut") ? 1 : 0);
    };
    for (const b of boutons) {
      const appuyer = (e) => {
        e.preventDefault();
        b.classList.add("actif");
        actives.set(e.pointerId, b.dataset.direction);
        recalculer();
      };
      const relacher = (e) => {
        b.classList.remove("actif");
        actives.delete(e.pointerId);
        recalculer();
      };
      b.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        appuyer(e);
      });
      b.addEventListener("pointerup", relacher);
      b.addEventListener("pointercancel", relacher);
      b.addEventListener("lostpointercapture", relacher);
    }
  }

  // Glisser sur la moitié droite = viser ; tap court = tirer ;
  // maintien immobile = tir continu.
  brancherVue(canvas) {
    const SEUIL_GLISSE = 10;    // px avant de considérer que c'est un glissement
    const DUREE_TAP = 280;      // ms

    canvas.addEventListener("touchstart", (e) => {
      if (this._vueId !== null) return;
      const t = e.changedTouches[0];
      if (!t) return;
      this._vueId = t.identifier;
      this._vueX = this._vueLX = t.clientX;
      this._vueY = this._vueLY = t.clientY;
      this._vueDebut = performance.now();
      this._vueBouge = false;
      this._appuiVue = true;
    }, { passive: true });

    canvas.addEventListener("touchmove", (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._vueId) continue;
        if (Math.hypot(t.clientX - this._vueX, t.clientY - this._vueY) > SEUIL_GLISSE) this._vueBouge = true;
        this.dx += (t.clientX - this._vueLX) * 1.6;
        this.dy += (t.clientY - this._vueLY) * 1.6;
        this._vueLX = t.clientX; this._vueLY = t.clientY;
      }
    }, { passive: true });

    const fin = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._vueId) continue;
        const duree = performance.now() - this._vueDebut;
        if (!this._vueBouge && duree < DUREE_TAP) {
          this.tirTape = true;
          try { navigator.vibrate?.(8); } catch (err) { /* ignore */ }
        }
        this._appuiVue = false;
        this.tirGeste = false;
        this._vueId = null;
      }
    };
    canvas.addEventListener("touchend", fin);
    canvas.addEventListener("touchcancel", fin);
  }

  // À appeler à chaque image : transforme un maintien immobile en tir continu.
  majTactile() {
    if (this._appuiVue && !this._vueBouge &&
        performance.now() - this._vueDebut > 320) {
      this.tirGeste = true;
    }
  }

  consommerTirTape() {
    const v = this.tirTape;
    this.tirTape = false;
    return v;
  }

  reinitialiserTactile() {
    this.axeX = 0; this.axeY = 0;
    this.tactileTir = false;
    this.tirGeste = false;
    this.tirTape = false;
    this._appuiVue = false;
    this._vueId = null;
    this._vueBouge = false;
    this._doigtsDir?.clear();
    this.dx = 0; this.dy = 0;
    document.querySelectorAll("#dpad .actif, #t-btn-tir.actif")
      .forEach((el) => el.classList.remove("actif"));
  }

  sur(nom, fn) { (this._écouteurs[nom] ||= []).push(fn); }
  _émettre(nom, v) { (this._écouteurs[nom] || []).forEach((f) => f(v)); }

  demanderVerrou() {
    if (this.verrouille) return;
    try {
      const demande = this.canvas.requestPointerLock?.();
      // Les navigateurs récents renvoient une promesse : un refus ne doit
      // pas afficher l'écran d'erreur fatal du jeu.
      if (demande && typeof demande.catch === "function") {
        demande.catch(() => this._émettre("verrou", false));
      }
    } catch (e) {
      this._émettre("verrou", false);
    }
  }
  relacherVerrou() { if (this.verrouille) document.exitPointerLock?.(); }

  consommerSouris() {
    if (this._ignoreSouris) {
      this._ignoreSouris = false;
      this.dx = 0; this.dy = 0;
      return { dx: 0, dy: 0 };
    }
    const d = { dx: this.dx, dy: this.dy };
    this.dx = 0; this.dy = 0;
    return d;
  }

  estAppuyee(...codes) { return codes.some((c) => this.touches.has(c)); }
}

export class Joueur {
  constructor(camera, monde, audio) {
    this.camera = camera;
    this.monde = monde;
    this.audio = audio;
    this.pieds = new THREE.Vector3().copy(monde.departJoueur);
    this.vitesse = new THREE.Vector3();
    this.lacet = new THREE.Vector3(0, 0, -1);
    this.yaw = 0;
    this.pitch = 0;
    this.accroupi = false;
    this.sprint = false;
    this.auSol = true;
    this.hauteurYeux = CONFIG.joueur.taille;
    this.reculPitch = 0;
    this.reculYaw = 0;
    this.secousse = 0;
    this.bob = 0;
    this._pasTimer = 0;
    this._vitesseLisse = 0;
    this._sautTouche = false;

    this.vie = CONFIG.joueur.vieMax;
    this._tempsDepuisDegat = 99;
    this.vivant = true;

    this.rayon = CONFIG.joueur.rayon;
    this._boxTete = new THREE.Box3();
    this._tmp = new THREE.Vector3();
    this._candidats = [];
  }

  reinitialiser() {
    this.pieds.copy(this.monde.departJoueur);
    this.vitesse.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0;
    this.reculPitch = 0; this.reculYaw = 0;
    this.vie = CONFIG.joueur.vieMax;
    this._tempsDepuisDegat = 99;
    this.vivant = true;
    this.accroupi = false;
    this.sprint = false;
    this.auSol = true;
  }

  get hauteurCorps() {
    return this.accroupi ? CONFIG.joueur.hauteurAccroupi + 0.24 : CONFIG.joueur.taille + 0.24;
  }

  get vitesseHorizontale() {
    return Math.hypot(this.vitesse.x, this.vitesse.z);
  }

  appliquerSouris(dx, dy, sensibilite, inverser) {
    const s = 0.0021 * sensibilite;
    this.yaw -= dx * s;
    this.pitch -= dy * s * (inverser ? -1 : 1);
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  toucher(degats, source = null) {
    if (!this.vivant) return;
    if (source) this.sourceDegat = source.clone();
    this.vie = Math.max(0, this.vie - degats);
    this._tempsDepuisDegat = 0;
    this.secousse = Math.min(1, this.secousse + 0.35);
    if (this.vie <= 0) this.vivant = false;
  }

  update(dt, entrees, { peutBouger = true } = {}) {
    const c = CONFIG.joueur;
    if (peutBouger) {
      const avant = entrees.estAppuyee("KeyW", "ArrowUp") ? 1 : 0;
      const arriere = entrees.estAppuyee("KeyS", "ArrowDown") ? 1 : 0;
      const gauche = entrees.estAppuyee("KeyA", "ArrowLeft") ? 1 : 0;
      const droite = entrees.estAppuyee("KeyD", "ArrowRight") ? 1 : 0;

      const vx = (droite - gauche) + entrees.axeX;
      const vz = (arriere - avant) + entrees.axeY;
      const longueur = Math.hypot(vx, vz);
      const dirX = longueur > 0 ? vx / longueur : 0;
      const dirZ = longueur > 0 ? vz / longueur : 0;

      this.sprint = entrees.estAppuyee("ShiftLeft", "ShiftRight") && avant === 1 && !this.accroupi;
      const voulu = this.accroupi ? c.vitesseAccroupi : this.sprint ? c.vitesseSprint : c.vitesseMarche;

      // Direction monde à partir du lacet.
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const mx = dirX * cos + dirZ * sin;
      const mz = -dirX * sin + dirZ * cos;

      const cibleX = mx * voulu;
      const cibleZ = mz * voulu;
      const accel = c.acceleration * (this.auSol ? 1 : 0.28);
      this.vitesse.x += (cibleX - this.vitesse.x) * Math.min(1, accel * dt / Math.max(1, voulu) * 2.4);
      this.vitesse.z += (cibleZ - this.vitesse.z) * Math.min(1, accel * dt / Math.max(1, voulu) * 2.4);
      if (longueur === 0) {
        const f = Math.max(0, 1 - c.friction * dt);
        this.vitesse.x *= f; this.vitesse.z *= f;
      }

      // Saut.
      if (entrees.estAppuyee("Space") && this.auSol && !this.accroupi && !this._sautTouche) {
        this.vitesse.y = c.saut;
        this.auSol = false;
        this._sautTouche = true;
        this.audio?.pas();
      }
      if (!entrees.estAppuyee("Space")) this._sautTouche = false;

      // Accroupi.
      const veutAccroupi = entrees.estAppuyee("ControlLeft", "ControlRight", "KeyC");
      this.accroupi = veutAccroupi && this.auSol;
    } else {
      this.vitesse.multiplyScalar(Math.max(0, 1 - 10 * dt));
    }

    // Gravité.
    this.vitesse.y -= c.gravite * dt;
    this.pieds.y += this.vitesse.y * dt;
    if (this.pieds.y <= 0) {
      if (!this.auSol && this.vitesse.y < -5) {
        this.secousse = Math.min(1, this.secousse + 0.35);
        this.audio?.pas();
      }
      this.pieds.y = 0;
      this.vitesse.y = 0;
      this.auSol = true;
    } else {
      this.auSol = false;
    }

    // Déplacement horizontal + collisions.
    this.pieds.x += this.vitesse.x * dt;
    this.pieds.z += this.vitesse.z * dt;
    this._collisions(dt);

    // Limites de l'arène.
    const lim = this.monde.limites;
    this.pieds.x = Math.max(-lim, Math.min(lim, this.pieds.x));
    this.pieds.z = Math.max(-lim, Math.min(lim, this.pieds.z));

    // Régénération.
    this._tempsDepuisDegat += dt;
    if (this.vivant && this._tempsDepuisDegat > c.delaiRegen) {
      this.vie = Math.min(c.vieMax, this.vie + c.regen * dt);
    }

    // Hauteur des yeux (accroupi) et oscillations de marche.
    const cibleYeux = this.accroupi ? c.hauteurAccroupi : c.taille;
    this.hauteurYeux += (cibleYeux - this.hauteurYeux) * Math.min(1, dt * 12);

    const v = this.vitesseHorizontale;
    this._vitesseLisse += (v - this._vitesseLisse) * Math.min(1, dt * 8);
    const cadence = this.sprint ? 1.55 : 1;
    this.bob += dt * (3.2 + this._vitesseLisse * 0.85) * cadence;
    const amplitude = Math.min(0.045, this._vitesseLisse * 0.0075) * (this.auSol ? 1 : 0.15);

    // Bruit de pas.
    if (this.auSol && v > 1.2) {
      this._pasTimer += dt * (this.sprint ? 2.3 : 1.7);
      if (this._pasTimer >= 1) { this._pasTimer = 0; this.audio?.pas(); }
    }

    // Recul (retour progressif).
    this.reculPitch *= Math.max(0, 1 - dt * 9);
    this.reculYaw *= Math.max(0, 1 - dt * 9);
    this.secousse *= Math.max(0, 1 - dt * 6);

    // Caméra.
    const secousseY = Math.sin(this.secousse * 42) * this.secousse * 0.05;
    this.camera.position.set(
      this.pieds.x + Math.sin(this.bob) * amplitude * 0.5,
      this.pieds.y + this.hauteurYeux + Math.sin(this.bob * 2) * amplitude + secousseY - this.secousse * 0.03,
      this.pieds.z + Math.cos(this.bob * 0.5) * amplitude * 0.2
    );
    this.camera.rotation.set(
      this.pitch + this.reculPitch + secousseY * 0.5,
      this.yaw + this.reculYaw,
      Math.sin(this.bob) * amplitude * 0.9
    , "YXZ");
    this.camera.rotation.order = "YXZ";
  }

  _collisions(dt) {
    const r = this.rayon;
    const bas = this.pieds.y + 0.08;
    const haut = this.pieds.y + this.hauteurCorps;
    const px = this.pieds.x, pz = this.pieds.z;

    for (const b of this.monde.colliders) {
      if (b.max.y < bas || b.min.y > haut) continue;
      const cx = Math.max(b.min.x, Math.min(px, b.max.x));
      const cz = Math.max(b.min.z, Math.min(pz, b.max.z));
      const dx = px - cx, dz = pz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;

      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const poussee = (r - d) / d;
        this.pieds.x += dx * poussee;
        this.pieds.z += dz * poussee;
        // Annule la vitesse dans la direction du choc.
        const nx = dx / d, nz = dz / d;
        const vn = this.vitesse.x * nx + this.vitesse.z * nz;
        if (vn < 0) { this.vitesse.x -= vn * nx; this.vitesse.z -= vn * nz; }
      } else {
        // Centre dans la boîte : sortie par le plus petit recouvrement.
        const sorties = [
          { axe: "x", v: b.min.x - r - px, d: Math.abs(b.min.x - r - px) },
          { axe: "x", v: b.max.x + r - px, d: Math.abs(b.max.x + r - px) },
          { axe: "z", v: b.min.z - r - pz, d: Math.abs(b.min.z - r - pz) },
          { axe: "z", v: b.max.z + r - pz, d: Math.abs(b.max.z + r - pz) },
        ].sort((a, c) => a.d - c.d)[0];
        if (sorties.axe === "x") { this.pieds.x += sorties.v; this.vitesse.x = 0; }
        else { this.pieds.z += sorties.v; this.vitesse.z = 0; }
      }
    }
  }

  // Direction de visée monde (utile pour tirer et pour l'IA).
  directionVisee(cible = new THREE.Vector3()) {
    return this.camera.getWorldDirection(cible);
  }
}
