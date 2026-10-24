import * as THREE from "three";
import { CONFIG } from "./config.js?v=20261022e";

/* =============================================================================
   Hostiles : silhouettes articulées, détection par ligne de vue, combat à
   distance et vagues successives.
   ========================================================================== */

const COULEUR_TENUE = 0x3b464b;
const COULEUR_GILET = 0x6b5433;
const COULEUR_PEAU = 0x8a6b52;

function materiau(couleur, rugosite = 0.85, metal = 0.05) {
  return new THREE.MeshStandardMaterial({ color: couleur, roughness: rugosite, metalness: metal });
}

export class Ennemi {
  constructor(scene, monde, audio, joueur, position) {
    this.scene = scene;
    this.monde = monde;
    this.audio = audio;
    this.joueur = joueur;

    this.groupe = new THREE.Group();
    this.groupe.position.copy(position);
    scene.add(this.groupe);

    this.vie = CONFIG.ennemis.vie;
    this.vivant = true;
    this.mort = false;
    this._tempsMort = 0;
    this.etat = "patrouille";
    this.cible = null;
    this.timerTir = 0.5 + Math.random();
    this.timerReaction = 0;
    this.timerDecision = 0;
    this.phaseMarche = Math.random() * 6.28;
    this.direction = new THREE.Vector3(0, 0, 1);
    this.destination = this._pointAleatoire();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this.rayon = 0.42;

    this._construire();
  }

  _construire() {
    const tenue = materiau(COULEUR_TENUE);
    const gilet = materiau(COULEUR_GILET, 0.9);
    const peau = materiau(COULEUR_PEAU, 0.9);
    const acier = materiau(0x1a1e20, 0.45, 0.8);

    const partie = (geo, mat, x, y, z, nom) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.ennemi = this;
      m.userData.partie = nom;
      this.groupe.add(m);
      return m;
    };

    // Jambes.
    this.jambeG = new THREE.Group();
    this.jambeG.position.set(-0.11, 0.86, 0);
    this.jambeD = new THREE.Group();
    this.jambeD.position.set(0.11, 0.86, 0);
    this.groupe.add(this.jambeG, this.jambeD);
    for (const [g, cote] of [[this.jambeG, -1], [this.jambeD, 1]]) {
      const cuisse = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.5, 0.19), tenue);
      cuisse.position.y = -0.25;
      cuisse.castShadow = true;
      cuisse.userData.ennemi = this; cuisse.userData.partie = "corps";
      g.add(cuisse);
      const mollet = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.45, 0.17), tenue);
      mollet.position.y = -0.66;
      mollet.castShadow = true;
      mollet.userData.ennemi = this; mollet.userData.partie = "corps";
      g.add(mollet);
      const botte = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.13, 0.27), acier);
      botte.position.set(0, -0.9, 0.04);
      botte.castShadow = true;
      botte.userData.ennemi = this; botte.userData.partie = "corps";
      g.add(botte);
    }

    // Torse.
    this.torse = new THREE.Group();
    this.torse.position.set(0, 0.92, 0);
    this.groupe.add(this.torse);
    const buste = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.52, 0.24), tenue);
    buste.position.y = 0.26;
    buste.castShadow = true;
    buste.userData.ennemi = this; buste.userData.partie = "corps";
    this.torse.add(buste);

    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.10), gilet);
    plaque.position.set(0, 0.30, 0.15);
    plaque.castShadow = true;
    plaque.userData.ennemi = this; plaque.userData.partie = "corps";
    this.torse.add(plaque);

    const poche = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.09, 0.06), gilet);
    poche.position.set(-0.12, 0.16, 0.20);
    poche.userData.ennemi = this; poche.userData.partie = "corps";
    this.torse.add(poche);

    // Tête + casque + visière.
    this.tete = new THREE.Group();
    this.tete.position.set(0, 0.60, 0);
    this.torse.add(this.tete);
    const crane = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 0.24), peau);
    crane.position.y = 0.10;
    crane.castShadow = true;
    crane.userData.ennemi = this; crane.userData.partie = "tete";
    this.tete.add(crane);
    const casque = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), acier);
    casque.position.y = 0.15;
    casque.castShadow = true;
    casque.userData.ennemi = this; casque.userData.partie = "tete";
    this.tete.add(casque);
    const brassard = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.10, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x6a2a10, emissive: 0xff5a12, emissiveIntensity: 1.6 })
    );
    brassard.position.set(0.20, 0.33, 0.06);
    brassard.rotation.y = -0.3;
    this.torse.add(brassard);

    const visiere = new THREE.Mesh(
      new THREE.BoxGeometry(0.20, 0.055, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x3a1a08, emissive: 0xff6a1a, emissiveIntensity: 2.4 })
    );
    visiere.position.set(0, 0.10, 0.125);
    visiere.userData.ennemi = this; visiere.userData.partie = "tete";
    this.tete.add(visiere);

    // Bras.
    this.brasG = new THREE.Group();
    this.brasG.position.set(-0.27, 0.38, 0);
    this.torse.add(this.brasG);
    this.brasD = new THREE.Group();
    this.brasD.position.set(0.27, 0.38, 0);
    this.torse.add(this.brasD);
    for (const [g, cote] of [[this.brasG, -1], [this.brasD, 1]]) {
      const bras = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.40, 0.14), tenue);
      bras.position.y = -0.18;
      bras.castShadow = true;
      bras.userData.ennemi = this; bras.userData.partie = "corps";
      g.add(bras);
      const avant = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.34, 0.12), tenue);
      avant.position.y = -0.50;
      avant.castShadow = true;
      avant.userData.ennemi = this; avant.userData.partie = "corps";
      g.add(avant);
      g.rotation.x = -0.9;
    }

    // Fusil tenu en joue.
    this.arme = new THREE.Group();
    this.arme.position.set(0.06, -0.30, 0.18);
    this.brasD.add(this.arme);
    const carcasse = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.55), acier);
    carcasse.castShadow = true;
    carcasse.userData.ennemi = this; carcasse.userData.partie = "corps";
    this.arme.add(carcasse);
    const canon = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), acier);
    canon.rotation.x = Math.PI / 2;
    canon.position.z = -0.40;
    this.arme.add(canon);
    this.bouche = new THREE.Object3D();
    this.bouche.position.set(0, 0.01, -0.56);
    this.arme.add(this.bouche);

    // Volume de touche invisible : rend le torse « généreux » au tir.
    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.62, 0.34),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hitbox.position.set(0, 1.32, 0);
    hitbox.userData.ennemi = this;
    hitbox.userData.partie = "corps";
    this.groupe.add(hitbox);

    // Repères de tir (petit halo).
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0xffaa55, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.halo.scale.setScalar(0.5);
    this.bouche.add(this.halo);

    this._meshes = [];
    this.groupe.traverse((o) => { if (o.isMesh) this._meshes.push(o); });
  }

  get position() { return this.groupe.position; }

  meshesTir() { return this._meshes; }

  _pointAleatoire() {
    const lim = this.monde.limites - 3;
    return new THREE.Vector3((Math.random() - 0.5) * lim * 2, 0, (Math.random() - 0.5) * lim * 2);
  }

  toucher(degats, tete) {
    if (!this.vivant) return;
    this.vie -= degats;
    this.audio?.tirLointain(5);
    this.etat = "combat";
    this.timerReaction = 0.1;
    this.halo.material.opacity = 0;
    if (this.vie <= 0) this._mourir(tete);
  }

  _mourir(tete) {
    this.vivant = false;
    this.mort = true;
    this._tueParTete = tete;
    this._tempsMort = 0;
    this.audio?.elimination(tete);
    this._meshes.forEach((m) => { m.userData.ennemi = null; });
  }

  update(dt, joueur) {
    if (this.mort) {
      this._tempsMort += dt;
      // Chute au sol et effacement.
      this.groupe.rotation.x += (Math.PI / 2 - this.groupe.rotation.x) * Math.min(1, dt * 4);
      this.groupe.position.y = -Math.max(0, (this._tempsMort - 0.6) * 0.35);
      if (this._tempsMort > 2.6) {
        this.groupe.scale.multiplyScalar(Math.max(0, 1 - dt * 3));
      }
      return;
    }

    const distance = this.groupe.position.distanceTo(joueur.pieds);
    const versJoueur = this._tmp.copy(joueur.pieds).sub(this.groupe.position);
    versJoueur.y = 0;

    // Vision : distance + champ + ligne de vue.
    const dansChamp = versJoueur.clone().normalize().dot(this.direction) > -0.15;
    const voit = distance < CONFIG.ennemis.porteeVision && (this.etat === "combat" || dansChamp) && this._ligneDeVue(joueur);

    if (voit && this.etat !== "combat") {
      this.etat = "combat";
      this.timerReaction = CONFIG.ennemis.tempsReaction * (0.6 + Math.random() * 0.8);
    } else if (!voit && this.etat === "combat" && distance > CONFIG.ennemis.porteeVision * 1.15) {
      this.etat = "alerte";
      this.timerDecision = 2;
    }

    // Orientation vers la cible.
    let cibleDir = versJoueur;
    if (this.etat !== "combat") cibleDir = this._tmp2.copy(this.destination).sub(this.groupe.position).setY(0);

    if (cibleDir.lengthSq() > 0.001) {
      cibleDir.normalize();
      const angle = Math.atan2(cibleDir.x, cibleDir.z);
      const actuel = this.groupe.rotation.y;
      let diff = angle - actuel;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.groupe.rotation.y += diff * Math.min(1, dt * (this.etat === "combat" ? 9 : 4));
      this.direction.set(Math.sin(this.groupe.rotation.y), 0, Math.cos(this.groupe.rotation.y));
    }

    // Déplacement.
    let vitesse = 0;
    if (this.etat === "combat") {
      // Avance ou recule pour rester à bonne distance, avec un pas de côté.
      const cible = distance > 16 ? 1 : distance < 9 ? -1 : 0;
      const strafe = Math.sin(performance.now() * 0.0009 + this.phaseMarche) * 0.8;
      const dx = this.direction.x * cible + this.direction.z * strafe;
      const dz = this.direction.z * cible - this.direction.x * strafe;
      this._avancer(dx, dz, dt, CONFIG.ennemis.vitesseAssaut);
      vitesse = CONFIG.ennemis.vitesseAssaut;
    } else {
      const d = this.destination.clone().setY(0).sub(this.groupe.position);
      if (d.lengthSq() < 1.5) this.destination = this._pointAleatoire();
      else this._avancer(d.x, d.z, dt, CONFIG.ennemis.vitesse);
      vitesse = CONFIG.ennemis.vitesse;
    }

    // Animation de marche.
    this.phaseMarche += dt * (this.etat === "combat" ? 7 : 4.4);
    const amp = Math.min(0.55, vitesse * 0.12);
    const s = Math.sin(this.phaseMarche);
    this.jambeG.rotation.x = s * amp;
    this.jambeD.rotation.x = -s * amp;
    this.torse.position.y = 0.92 + Math.abs(Math.cos(this.phaseMarche)) * 0.02;
    this.tete.rotation.y = Math.sin(performance.now() * 0.0007) * 0.06;

    // Tir.
    if (this.etat === "combat") {
      this.timerReaction = Math.max(0, this.timerReaction - dt);
      this.bouche.getWorldPosition(this._tmp2);
      this.halo.material.opacity = 0;
      if (this.timerReaction <= 0 && distance < CONFIG.ennemis.porteeTir) {
        this.timerTir -= dt;
        if (this.timerTir <= 0) {
          this.timerTir = 60 / CONFIG.ennemis.cadence * (0.7 + Math.random() * 0.7);
          this._tirer(joueur, distance);
        }
      }
    }
  }

  _avancer(dx, dz, dt, vitesse) {
    const l = Math.hypot(dx, dz);
    if (l < 0.0001) return;
    dx /= l; dz /= l;
    const pas = vitesse * dt;
    const nx = this.groupe.position.x + dx * pas;
    const nz = this.groupe.position.z + dz * pas;
    if (this._libre(nx, this.groupe.position.z)) this.groupe.position.x = nx;
    if (this._libre(this.groupe.position.x, nz)) this.groupe.position.z = nz;
    const lim = this.monde.limites - 0.8;
    this.groupe.position.x = Math.max(-lim, Math.min(lim, this.groupe.position.x));
    this.groupe.position.z = Math.max(-lim, Math.min(lim, this.groupe.position.z));
  }

  _libre(x, z) {
    for (const b of this.monde.colliders) {
      if (b.max.y < 0.3) continue;
      if (x > b.min.x - this.rayon && x < b.max.x + this.rayon &&
          z > b.min.z - this.rayon && z < b.max.z + this.rayon) return false;
    }
    return true;
  }

  _ligneDeVue(joueur) {
    const origine = this._tmp2.set(this.groupe.position.x, 1.5, this.groupe.position.z);
    const cible = new THREE.Vector3(joueur.pieds.x, joueur.pieds.y + 1.2, joueur.pieds.z);
    const dir = cible.clone().sub(origine);
    const dist = dir.length();
    dir.normalize();
    const ray = new THREE.Raycaster(origine, dir, 0, dist);
    const touches = ray.intersectObjects(this.monde.meshes, false);
    return touches.length === 0 || touches[0].distance > dist - 0.4;
  }

  _tirer(joueur, distance) {
    const origine = new THREE.Vector3();
    this.bouche.getWorldPosition(origine);
    const cible = new THREE.Vector3(joueur.pieds.x, joueur.pieds.y + 1.25, joueur.pieds.z);
    const dir = cible.clone().sub(origine).normalize();

    const dispersion = CONFIG.ennemis.precision * (1 + distance * 0.012);
    dir.x += (Math.random() - 0.5) * dispersion * 2;
    dir.y += (Math.random() - 0.5) * dispersion * 2;
    dir.z += (Math.random() - 0.5) * dispersion * 2;
    dir.normalize();

    // Ligne de vue déjà validée ; on teste la proximité du tir avec le joueur.
    const auPlusPres = new THREE.Vector3().subVectors(cible, origine);
    const t = auPlusPres.dot(dir);
    const point = origine.clone().addScaledVector(dir, Math.max(0, t));
    const ecart = point.distanceTo(cible);
    const touche = ecart < 0.52;

    this._traceTir(origine, dir, touche ? cible : origine.clone().addScaledVector(dir, 30));
    this.audio?.tirLointain(distance);

    this.halo.material.opacity = 1;
    this._haloTimer = 0.05;

    if (touche) {
      const degats = CONFIG.ennemis.degats * (0.8 + Math.random() * 0.5);
      joueur.toucher(degats, this.groupe.position);
      this.audio?.degat();
    }
  }

  _traceTir(origine, dir, fin) {
    const geo = new THREE.BufferGeometry().setFromPoints([origine.clone(), fin.clone()]);
    const matiere = new THREE.LineBasicMaterial({
      color: 0xffb060, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ligne = new THREE.Line(geo, matiere);
    this.scene.add(ligne);
    this._traces = this._traces || [];
    this._traces.push({ ligne, t: 0 });
  }

  nettoyerTraces(dt) {
    if (!this._traces) return;
    for (let i = this._traces.length - 1; i >= 0; i--) {
      const tr = this._traces[i];
      tr.t += dt;
      tr.ligne.material.opacity = Math.max(0, 0.55 - tr.t * 5);
      if (tr.t > 0.12) {
        this.scene.remove(tr.ligne);
        tr.ligne.geometry.dispose();
        tr.ligne.material.dispose();
        this._traces.splice(i, 1);
      }
    }
    if (this.halo) this.halo.material.opacity = Math.max(0, this.halo.material.opacity - dt * 12);
  }

  detruire() {
    this.scene.remove(this.groupe);
    this.groupe.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); if (o.material.dispose) o.material.dispose(); }
    });
  }
}

export class GestionEnnemis {
  constructor(scene, monde, audio, joueur) {
    this.scene = scene;
    this.monde = monde;
    this.audio = audio;
    this.joueur = joueur;
    this.liste = [];
    this.meshesTir = [];
    this.restants = 0;
    this.elimines = 0;
  }

  lancerVague(numero) {
    const total = CONFIG.vagues.premiere + (numero - 1) * CONFIG.vagues.increment;
    this.restants = total;
    this._aApparaitre = total;
    this._numeroVague = numero;
  }

  _apparaitre() {
    const points = this.monde.pointsApparition;
    let meilleur = null, meilleureDistance = -1;
    for (let i = 0; i < 4; i++) {
      const p = points[Math.floor(Math.random() * points.length)];
      const d = p.distanceTo(this.joueur.pieds);
      if (d > meilleureDistance && d > 14) { meilleureDistance = d; meilleur = p; }
    }
    if (!meilleur) meilleur = points[0];
    const pos = meilleur.clone();
    pos.x += (Math.random() - 0.5) * 3;
    pos.z += (Math.random() - 0.5) * 3;
    pos.y = 0;

    const e = new Ennemi(this.scene, this.monde, this.audio, this.joueur, pos);
    this.liste.push(e);
    this.meshesTir.push(...e.meshesTir());
    this._aApparaitre--;
  }

  update(dt) {
    // Apparitions étalées, limitées en simultané.
    if (this._aApparaitre > 0 && this.liste.filter((e) => e.vivant).length < CONFIG.vagues.maxSimultanes) {
      this._timerApparition = (this._timerApparition ?? 1.2) - dt;
      if (this._timerApparition <= 0) {
        this._timerApparition = 1.1 + Math.random() * 0.9;
        this._apparaitre();
      }
    }

    for (let i = this.liste.length - 1; i >= 0; i--) {
      const e = this.liste[i];
      e.update(dt, this.joueur);
      e.nettoyerTraces(dt);
      if (!e.vivant && !e._signale) {
        e._signale = true;
        this.elimines++;
        this.onElimination?.(e, e._tueParTete === true);
      }
      if (e.mort && e._tempsMort > 3.2) {
        e.detruire();
        this.liste.splice(i, 1);
      }
    }
    // Reconstruit la liste de raycast (les morts ne sont plus touchables).
    this.meshesTir = this.liste.filter((e) => e.vivant).flatMap((e) => e.meshesTir());
  }

  get vivants() { return this.liste.filter((e) => e.vivant).length; }

  get vagueTerminee() {
    return this._aApparaitre <= 0 && this.liste.every((e) => !e.vivant);
  }

  nettoyer() {
    this.liste.forEach((e) => e.detruire());
    this.liste.length = 0;
    this.meshesTir.length = 0;
    this._aApparaitre = 0;
  }
}
