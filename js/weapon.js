import * as THREE from "three";
import { CONFIG } from "./config.js?v=20261030i";

/* =============================================================================
   Arme à la première personne : modèle géométrique, recul, visée, rechargement
   et tous les effets de tir (flash, traçante, impact, douille).
   ========================================================================== */

function mat(couleur, rugosite = 0.6, metal = 0.3) {
  return new THREE.MeshStandardMaterial({ color: couleur, roughness: rugosite, metalness: metal });
}

export class Arme {
  constructor(camera, scene, audio) {
    this.camera = camera;
    this.scene = scene;
    this.audio = audio;

    this.groupe = new THREE.Group();

    // Le modèle d'arme est rendu dans une scène séparée, après le décor et
    // avec un tampon de profondeur nettoyé : il ne peut plus traverser les murs.
    this.sceneArme = new THREE.Scene();
    this.cameraArme = new THREE.PerspectiveCamera(75, 1, 0.01, 12);
    this.sceneArme.add(this.groupe);

    // Éclairage dédié au modèle, dans la même veine que la scène principale.
    this.sceneArme.add(new THREE.HemisphereLight(0x44687d, 0x2a2219, 1.75));
    const luneArme = new THREE.DirectionalLight(0xcfe2f0, 2.4);
    luneArme.position.set(-4, 5, 3);
    this.sceneArme.add(luneArme);
    const faceArme = new THREE.DirectionalLight(0x93b6cc, 0.9);
    faceArme.position.set(2, 2, 4);
    this.sceneArme.add(faceArme);

    this._construire();
    this._construireEffets();

    this.etat = {
      chargeur: CONFIG.arme.chargeur,
      reserve: CONFIG.arme.reserveMax,
      rechargeEnCours: false,
      tempsRecharge: 0,
      cadence: 0,
      vise: 0,              // 0 → 1 lissé
      reculZ: 0,
      reculRot: 0,
      swayX: 0, swayY: 0,
      bobPhase: 0,
      tirTenus: 0,
      derniereBalle: 0,
    };

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = CONFIG.arme.portee;
    this._rayonAide = new THREE.Raycaster();
    this.aideVisee = false;
    this._origine = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this.mireNdc = new THREE.Vector2(0, 0);
    this._tmpMonde = new THREE.Vector3();
    this._douilleLocale = new THREE.Vector3(0.03, 0.03, -0.12);
    this._viseur = new THREE.Vector2(0, 0);
    this._effets = [];
    this._decals = [];
    this._douilles = [];
    this._temps = 0;
    this.porteeMax = CONFIG.arme.portee;
    this._tirAudioTimer = 0;
  }

  /* ------------------------------------------------------------------ modèle */
  _construire() {
    const corps = mat(0x4b5451, 0.5, 0.55);
    const polymere = mat(0x5a625e, 0.72, 0.1);
    const acier = mat(0x9aa3a6, 0.35, 0.85);
    const canon = mat(0x262c2e, 0.4, 0.9);
    const bois = mat(0x5a4028, 0.8, 0.05);

    const ajouter = (geo, materiau, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, materiau);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = false;
      m.receiveShadow = false;
      this.groupe.add(m);
      return m;
    };

    // Corps + crosse + garde-main.
    ajouter(new THREE.BoxGeometry(0.075, 0.085, 0.46), corps, 0, 0, -0.10);
    ajouter(new THREE.BoxGeometry(0.06, 0.065, 0.22), polymere, 0, -0.005, 0.20);
    ajouter(new THREE.BoxGeometry(0.07, 0.07, 0.30), polymere, 0, 0.012, -0.34);
    // Crosse.
    ajouter(new THREE.BoxGeometry(0.055, 0.14, 0.05), polymere, 0, -0.02, 0.30, 0.18);
    ajouter(new THREE.BoxGeometry(0.05, 0.05, 0.22), bois, 0, -0.045, 0.28);
    // Canon + frein de bouche.
    ajouter(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 10), canon, 0, 0.012, -0.60, Math.PI / 2);
    ajouter(new THREE.CylinderGeometry(0.026, 0.024, 0.07, 10), acier, 0, 0.012, -0.80, Math.PI / 2);
    // Chargeur.
    ajouter(new THREE.BoxGeometry(0.05, 0.17, 0.075), corps, 0, -0.115, -0.06, 0.12);
    // Poignée pistolet.
    ajouter(new THREE.BoxGeometry(0.045, 0.115, 0.055), polymere, 0, -0.10, 0.10, -0.32);
    // Rail + hausse + guidon.
    ajouter(new THREE.BoxGeometry(0.03, 0.012, 0.30), acier, 0, 0.052, -0.20);
    ajouter(new THREE.BoxGeometry(0.018, 0.035, 0.012), acier, 0, 0.072, 0.02);
    ajouter(new THREE.BoxGeometry(0.012, 0.045, 0.012), acier, 0, 0.082, -0.38);
    const or = new THREE.MeshStandardMaterial({ color: 0xd8b34a, roughness: 0.4, metalness: 0.8, emissive: 0x3a2a08, emissiveIntensity: 0.6 });
    ajouter(new THREE.BoxGeometry(0.02, 0.004, 0.004), or, 0, 0.086, 0.02);
    // Dragon (anneau sous la bouche).
    ajouter(new THREE.TorusGeometry(0.018, 0.004, 6, 10), acier, 0, -0.03, -0.72, Math.PI / 2);
    // Lampe tactique.
    ajouter(new THREE.CylinderGeometry(0.016, 0.016, 0.10, 10), acier, 0.038, -0.01, -0.44, Math.PI / 2);

    // Mains gantées.
    const gant = mat(0x2a2f30, 0.95, 0.05);
    ajouter(new THREE.BoxGeometry(0.065, 0.09, 0.10), gant, 0, -0.085, 0.10, -0.3);
    ajouter(new THREE.BoxGeometry(0.075, 0.075, 0.13), gant, 0.01, -0.055, -0.34);

    // Position au repos.
    this.groupe.position.set(0.24, -0.26, -0.95);
    this.groupe.rotation.set(0.02, 0.06, 0);
    this.groupe.scale.setScalar(0.72);
    this.base = {
      position: new THREE.Vector3(0.24, -0.26, -0.95),
      vise: new THREE.Vector3(0.0, -0.135, -0.80),
      rotation: new THREE.Euler(0.02, 0.06, 0),
    };

    // Point de départ des effets.
    // Lumière dédiée au modèle d'arme : sans elle, il reste dans le noir.
    const lampeVue = new THREE.PointLight(0xfff0d8, 0.34, 3.2, 2);
    lampeVue.position.set(0.35, 0.55, 0.45);
    this.groupe.add(lampeVue);
    const lampeRemplissage = new THREE.PointLight(0x9fc7e0, 0.14, 3.0, 2);
    lampeRemplissage.position.set(-0.55, -0.15, 0.35);
    this.groupe.add(lampeRemplissage);

    this.bouche = new THREE.Object3D();
    this.bouche.position.set(0, 0.012, -0.84);
    this.groupe.add(this.bouche);
  }

  _construireEffets() {
    // Flash de bouche : sprite additif + lumière brève.
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,250,220,1)");
    g.addColorStop(0.3, "rgba(255,190,90,0.8)");
    g.addColorStop(1, "rgba(255,120,20,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;

    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xffd9a0, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    this.flash.scale.set(0.45, 0.45, 1);
    this.flash.position.set(0, 0.012, -0.88);
    this.groupe.add(this.flash);

    this.lumiereFlash = new THREE.PointLight(0xffb060, 0, 9, 2);
    this.lumiereFlash.position.set(0, 0.012, -0.9);
    this.groupe.add(this.lumiereFlash);

    // Impact : éclat radial réutilisé.
    const ci = document.createElement("canvas");
    ci.width = ci.height = 64;
    const xi = ci.getContext("2d");
    const gi = xi.createRadialGradient(32, 32, 0, 32, 32, 30);
    gi.addColorStop(0, "rgba(10,9,8,0.95)");
    gi.addColorStop(0.55, "rgba(20,18,16,0.55)");
    gi.addColorStop(1, "rgba(20,18,16,0)");
    xi.fillStyle = gi; xi.fillRect(0, 0, 64, 64);
    this.texImpact = new THREE.CanvasTexture(ci);

    this._geoImpact = new THREE.PlaneGeometry(0.16, 0.16);
    this._matImpact = new THREE.MeshBasicMaterial({
      map: this.texImpact, transparent: true, depthWrite: false, opacity: 0.9,
      polygonOffset: true, polygonOffsetFactor: -4,
    });

    this._geoEtincelle = new THREE.BufferGeometry();
    this._geoEtincelle.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
  }

  // Point local du modèle (espace caméra) -> coordonnées monde.
  _pointMonde(local, cible = this._tmpMonde) {
    this.groupe.updateMatrix();
    cible.copy(local).applyMatrix4(this.groupe.matrix);
    this.camera.updateMatrixWorld();
    return cible.applyMatrix4(this.camera.matrixWorld);
  }

  /* ------------------------------------------------------------------- tir */
  get chargeurPlein() { return this.etat.chargeur > 0; }

  peutTirer() {
    return this.etat.chargeur > 0 && !this.etat.rechargeEnCours && this.etat.cadence <= 0;
  }

  recharger() {
    const e = this.etat;
    if (e.rechargeEnCours || e.chargeur >= CONFIG.arme.chargeur || e.reserve <= 0) return false;
    e.rechargeEnCours = true;
    e.tempsRecharge = 0;
    this.audio?.recharge();
    return true;
  }

  tirer(joueur, monde, ennemis) {
    const e = this.etat;
    if (!this.peutTirer()) return;
    e.chargeur--;
    e.cadence = 60 / CONFIG.arme.cadence;
    e.tirTenus++;
    this.audio?.tir();

    // Le tir passe par la position réelle de la croix, pas forcément le centre.
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.mireNdc, this.camera);
    this._origine.copy(this.raycaster.ray.origin);
    this._direction.copy(this.raycaster.ray.direction);
    if (this.aideVisee) this._viserAssiste(ennemis, monde);

    const dispersion = THREE.MathUtils.lerp(
      CONFIG.arme.dispersion,
      CONFIG.arme.dispersionVise,
      e.vise
    ) + Math.min(0.02, joueur.vitesseHorizontale * 0.0025) * (1 - e.vise * 0.7);

    this._direction.x += (Math.random() - 0.5) * dispersion;
    this._direction.y += (Math.random() - 0.5) * dispersion;
    this._direction.z += (Math.random() - 0.5) * dispersion;
    this._direction.normalize();

    this.raycaster.set(this._origine, this._direction);
    this.raycaster.far = this.porteeMax;

    const cibles = monde.meshes.concat(ennemis.meshesTir);
    const touches = this.raycaster.intersectObjects(cibles, false);
    // Pas de marge de 0,4 m : un mur tout proche doit arrêter la balle.
    const hit = touches.find((t) => t.distance > 0.05);

    const positionBouche = this._pointMonde(this.bouche.position);

    if (hit) {
      const point = hit.point;
      this._impact(point, hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0));
      this._tracer(positionBouche, point);
      const donnees = hit.object.userData;
      if (donnees?.ennemi) {
        const tete = donnees.partie === "tete";
        const degats = tete ? CONFIG.arme.degatsTete : CONFIG.arme.degats;
        donnees.ennemi.toucher(degats, tete);
        this.audio?.touche(tete);
        this.onTouche?.(tete);
      }
      if (donnees?.lampadaire) {
        const etat = monde.toucherLampadaire(donnees.lampadaire);
        if (etat) {
          if (etat === "eteint") this.audio?.lampadaire();
        }
      }
    } else {
      const fin = this._origine.clone().addScaledVector(this._direction, this.porteeMax);
      this._tracer(positionBouche, fin);
    }

    this._douille();
    this._flash();
    this._recul(joueur, e.tirTenus);
  }

  // Aide tactile : si le réticule effleure un hostile visible, on incline
  // légèrement la balle vers lui. Jamais à travers un mur.
  _viserAssiste(ennemis, monde) {
    if (!ennemis?.liste) return;
    const dir = this._direction;
    let meilleur = null;
    let meilleurAngle = CONFIG.arme.aideVisee.cone;
    const cible = new THREE.Vector3();
    const vers = new THREE.Vector3();

    for (const e of ennemis.liste) {
      if (!e.vivant) continue;
      cible.copy(e.groupe.position);
      cible.y += 1.25;
      vers.subVectors(cible, this._origine);
      const distance = vers.length();
      if (distance < 1 || distance > CONFIG.arme.aideVisee.portee) continue;
      vers.divideScalar(distance);
      const angle = Math.acos(THREE.MathUtils.clamp(dir.dot(vers), -1, 1));
      if (angle >= meilleurAngle) continue;

      this._rayonAide.set(this._origine, vers);
      this._rayonAide.far = distance;
      const obstacle = this._rayonAide.intersectObjects(monde.meshes, false)[0];
      if (obstacle && obstacle.distance < distance - 0.4) continue;

      meilleur = vers.clone();
      meilleurAngle = angle;
    }

    if (meilleur) dir.lerp(meilleur, CONFIG.arme.aideVisee.force).normalize();
  }

  _flash() {
    this.flash.material.opacity = 0.95;
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.38 + Math.random() * 0.16);
    this.lumiereFlash.intensity = 9;
    this._effets.push({ type: "flash", t: 0, duree: 0.05 });
  }

  _recul(joueur, tirTenus) {
    const f = CONFIG.arme.recul * (1 - this.etat.vise * 0.45);
    this.etat.reculZ = Math.min(0.09, this.etat.reculZ + 0.022 * f);
    this.etat.reculRot = Math.min(0.16, this.etat.reculRot + 0.05 * f);
    joueur.reculPitch += 0.012 * f * (0.6 + Math.random() * 0.7);
    joueur.reculYaw += (Math.random() - 0.5) * 0.012 * f;
    this.etat.swayX += (Math.random() - 0.5) * 0.01;
  }

  _tracer(depuis, vers) {
    const geo = new THREE.BufferGeometry().setFromPoints([depuis.clone(), vers.clone()]);
    const matiere = new THREE.LineBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ligne = new THREE.Line(geo, matiere);
    this.scene.add(ligne);
    this._effets.push({ type: "tracer", objet: ligne, t: 0, duree: 0.07 });
  }

  _impact(point, normale) {
    const d = new THREE.Mesh(this._geoImpact, this._matImpact.clone());
    d.position.copy(point).addScaledVector(normale, 0.012);
    d.lookAt(point.clone().add(normale));
    d.rotation.z = Math.random() * Math.PI * 2;
    d.scale.setScalar(0.7 + Math.random() * 0.7);
    this.scene.add(d);
    this._decals.push(d);
    if (this._decals.length > 70) {
      const vieux = this._decals.shift();
      this.scene.remove(vieux);
      vieux.material.dispose();
    }

    // Étincelles.
    const n = 7;
    const pos = new Float32Array(n * 3);
    const vit = [];
    for (let i = 0; i < n; i++) {
      pos[i * 3] = point.x; pos[i * 3 + 1] = point.y; pos[i * 3 + 2] = point.z;
      vit.push(new THREE.Vector3(
        (Math.random() - 0.5) * 3.2,
        Math.random() * 2.6 + 0.4,
        (Math.random() - 0.5) * 3.2
      ).addScaledVector(normale, 1.2));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const matiere = new THREE.PointsMaterial({
      color: 0xffc070, size: 0.035, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, matiere);
    this.scene.add(points);
    this._effets.push({ type: "etincelles", objet: points, t: 0, duree: 0.35, vit, pos });
  }

  _douille() {
    const geo = new THREE.CylinderGeometry(0.008, 0.008, 0.026, 6);
    const matiere = new THREE.MeshStandardMaterial({ color: 0xc9a34a, metalness: 1, roughness: 0.3 });
    const d = new THREE.Mesh(geo, matiere);
    const p = this._pointMonde(this._douilleLocale);
    d.position.copy(p);
    d.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this.scene.add(d);
    const dir = new THREE.Vector3(0.6 + Math.random() * 0.4, 0.7, 0.1 + Math.random() * 0.3);
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.camera.rotation.y);
    this._douilles.push({ mesh: d, v: dir.multiplyScalar(2.2 + Math.random()), t: 0 });
  }

  /* ---------------------------------------------------------------- animation */
  update(dt, joueur, entree, monde, ennemis) {
    const e = this.etat;
    this._temps += dt;
    e.cadence = Math.max(0, e.cadence - dt);

    // Visée.
    const cibleVise = entree.vise && !e.rechargeEnCours ? 1 : 0;
    e.vise += (cibleVise - e.vise) * Math.min(1, dt * 11);

    // Tir maintenu.
    if (entree.tir && !e.rechargeEnCours) {
      if (e.chargeur <= 0) {
        this.recharger();
      } else {
        this.tirer(joueur, monde, ennemis);
      }
    }
    // Rechargement automatique quand vide et détente relâchée.
    if (e.chargeur <= 0 && !e.rechargeEnCours && e.reserve > 0 && !entree.tir) {
      this.recharger();
    }

    // Rechargement.
    if (e.rechargeEnCours) {
      e.tempsRecharge += dt;
      if (e.tempsRecharge >= CONFIG.arme.tempsRechargement) {
        const manque = CONFIG.arme.chargeur - e.chargeur;
        const pris = Math.min(manque, e.reserve);
        e.chargeur += pris;
        e.reserve -= pris;
        e.rechargeEnCours = false;
        e.tempsRecharge = 0;
        e.tirTenus = 0;
      }
    }

    // Caméra : FOV de visée.
    const fovCible = THREE.MathUtils.lerp(75, CONFIG.arme.zoomVise, e.vise);
    this.camera.fov += (fovCible - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.updateProjectionMatrix();

    // La caméra du modèle d'arme suit le FOV et le format de l'écran.
    this.cameraArme.fov = this.camera.fov;
    this.cameraArme.aspect = this.camera.aspect;
    this.cameraArme.updateProjectionMatrix();

    // Position de repos / visée.
    const cible = new THREE.Vector3().lerpVectors(this.base.position, this.base.vise, e.vise);

    // Oscillation de marche.
    const mouvement = Math.min(1, joueur.vitesseHorizontale / 6);
    e.bobPhase += dt * (2.2 + joueur.vitesseHorizontale * 1.15);
    const bobX = Math.sin(e.bobPhase) * 0.008 * mouvement * (1 - e.vise * 0.7);
    const bobY = Math.abs(Math.cos(e.bobPhase)) * 0.006 * mouvement * (1 - e.vise * 0.7);

    // Respiration au repos.
    const souffle = Math.sin(this._temps * 1.6) * 0.0018 * (1 - e.vise * 0.8);

    // Sway souris (lissé).
    const souris = entree.souris ?? { dx: 0, dy: 0 };
    e.swayX += (Math.max(-0.03, Math.min(0.03, -souris.dx * 0.0012)) - e.swayX) * Math.min(1, dt * 8);
    e.swayY += (Math.max(-0.03, Math.min(0.03, -souris.dy * 0.0012)) - e.swayY) * Math.min(1, dt * 8);

    // Retour du recul.
    e.reculZ *= Math.max(0, 1 - dt * 12);
    e.reculRot *= Math.max(0, 1 - dt * 12);

    // Rechargement : l'arme bascule et descend.
    let rechargeRot = 0, rechargeY = 0;
    if (e.rechargeEnCours) {
      const p = e.tempsRecharge / CONFIG.arme.tempsRechargement;
      const courbe = Math.sin(Math.min(1, p * 1.4) * Math.PI);
      rechargeRot = courbe * 0.5;
      rechargeY = -courbe * 0.09;
    }

    this.groupe.position.set(
      cible.x + bobX + e.swayX,
      cible.y + bobY + souffle + e.swayY + rechargeY,
      cible.z + e.reculZ + Math.abs(bobY) * 0.5
    );
    this.groupe.rotation.set(
      this.base.rotation.x + e.reculRot - rechargeRot * 0.6 + e.swayY * 1.6,
      this.base.rotation.y + e.swayX * 2.0,
      this.base.rotation.z + rechargeRot + Math.sin(e.bobPhase * 0.5) * 0.006 * mouvement
    );

    // Effets.
    for (let i = this._effets.length - 1; i >= 0; i--) {
      const f = this._effets[i];
      f.t += dt;
      if (f.type === "flash") {
        const k = 1 - f.t / f.duree;
        this.flash.material.opacity = Math.max(0, k) * 0.95;
        this.lumiereFlash.intensity = Math.max(0, k) * 9;
      } else if (f.type === "tracer") {
        f.objet.material.opacity = Math.max(0, 1 - f.t / f.duree) * 0.8;
      } else if (f.type === "etincelles") {
        const p = f.objet.geometry.attributes.position;
        for (let k = 0; k < f.vit.length; k++) {
          f.vit[k].y -= 9 * dt;
          f.pos[k * 3] += f.vit[k].x * dt;
          f.pos[k * 3 + 1] += f.vit[k].y * dt;
          f.pos[k * 3 + 2] += f.vit[k].z * dt;
        }
        p.needsUpdate = true;
        f.objet.material.opacity = Math.max(0, 1 - f.t / f.duree);
      }
      if (f.t >= f.duree) {
        if (f.objet) { this.scene.remove(f.objet); f.objet.geometry?.dispose(); f.objet.material?.dispose(); }
        this._effets.splice(i, 1);
      }
    }

    // Douilles.
    for (let i = this._douilles.length - 1; i >= 0; i--) {
      const d = this._douilles[i];
      d.t += dt;
      d.v.y -= 12 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += dt * 9;
      d.mesh.rotation.z += dt * 6;
      if (d.mesh.position.y < 0.02) { d.mesh.position.y = 0.02; d.v.multiplyScalar(0.35); d.v.y = Math.abs(d.v.y) * 0.3; }
      if (d.t > 2.2) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        d.mesh.material.dispose();
        this._douilles.splice(i, 1);
      }
    }
  }

  reinitialiser() {
    this.etat.chargeur = CONFIG.arme.chargeur;
    this.etat.reserve = CONFIG.arme.reserveMax;
    this.etat.rechargeEnCours = false;
    this.etat.cadence = 0;
    this.etat.tirTenus = 0;
    this._decals.forEach((d) => { this.scene.remove(d); d.material.dispose(); });
    this._decals.length = 0;
    this._effets.forEach((f) => { if (f.objet) this.scene.remove(f.objet); });
    this._effets.length = 0;
    this._douilles.forEach((d) => this.scene.remove(d.mesh));
    this._douilles.length = 0;
  }
}
