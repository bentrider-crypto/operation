import * as THREE from "three";
import { CONFIG } from "./config.js?v=20261024m";
import { Textures } from "./textures.js?v=20261024m";

/* =============================================================================
   Le niveau : un dépôt logistique de nuit, ceint de murs, avec un entrepôt
   central ouvert, des conteneurs, des caisses et des barrières. Toute la
   géométrie est générée ici ; les collisionneurs sont des boîtes alignées.
   ========================================================================== */

const T = new Textures();

function materiauStandard({ map, normal }, { couleur = 0xffffff, rugosite = 0.92, metal = 0.05, emissif = 0x000000, emissifForce = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: couleur,
    map: map || null,
    normalMap: normal || null,
    roughness: rugosite,
    metalness: metal,
    emissive: emissif,
    emissiveIntensity: emissifForce,
  });
  if (normal) m.normalScale.set(0.55, 0.55);
  return m;
}

export class Monde {
  constructor(scene, qualite) {
    this.scene = scene;
    this.qualite = qualite;
    this.colliders = [];        // THREE.Box3 — déplacement et balles
    this.meshes = [];           // cibles de raycast
    this.pointsApparition = [];
    this.ampoules = [];
    this._temps = 0;
    this._construire();
  }

  /* ------------------------------------------------------------- utilitaires */
  _ajouter(mesh, collision = true) {
    this.scene.add(mesh);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.meshes.push(mesh);
    if (collision) {
      mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(mesh);
      this.colliders.push(b);
    }
    return mesh;
  }

  _boite(l, h, p, materiau, x, y, z, ry = 0, collision = true) {
    const g = new THREE.BoxGeometry(l, h, p);
    const m = new THREE.Mesh(g, materiau);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    return this._ajouter(m, collision);
  }

  _cylindre(rayon, hauteur, materiau, x, y, z, collision = true, radial = 16) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rayon, rayon, hauteur, radial), materiau);
    m.position.set(x, y, z);
    return this._ajouter(m, collision);
  }

  /* ------------------------------------------------------------------ monde */
  _construire() {
    const c = CONFIG.couleurs;
    this.scene.background = new THREE.Color(0x070d11);
    this.scene.fog = new THREE.FogExp2(0x111e23, CONFIG.rendu.brouillard);

    this._ciel();
    this._lumiere();
    this._sol();
    this._perimetre();
    this._entrepot();
    this._cargaison();
    this._lampadaires();
    this._details();
    this._poussieres();

    // Points d'apparition des hostiles, répartis autour de l'enceinte.
    this.pointsApparition = [
      new THREE.Vector3(-24, 0, -20), new THREE.Vector3(22, 0, -23),
      new THREE.Vector3(-27, 0, 12),  new THREE.Vector3(26, 0, 16),
      new THREE.Vector3(-9, 0, -25),  new THREE.Vector3(10, 0, 25),
      new THREE.Vector3(-25, 0, 0),   new THREE.Vector3(25, 0, -6),
    ];
    this.departJoueur = new THREE.Vector3(0, 0, 22);
    this.limites = 27.5;
  }

  _ciel() {
    const geo = new THREE.SphereGeometry(220, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        haut: { value: new THREE.Color(0x0a1420) },
        bas:  { value: new THREE.Color(0x1e3438) },
        lune: { value: new THREE.Vector3(0.35, 0.55, -0.75) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 haut; uniform vec3 bas; uniform vec3 lune;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float h = clamp(vDir.y * 1.6 + 0.12, 0.0, 1.0);
          vec3 col = mix(bas, haut, pow(h, 0.75));
          // halo de lune
          float d = max(dot(normalize(vDir), normalize(lune)), 0.0);
          col += vec3(0.22, 0.28, 0.34) * pow(d, 900.0) * 1.5;
          col += vec3(0.05, 0.07, 0.09) * pow(d, 6.0);
          // étoiles : petits points 3D, discrets
          vec3 p3 = floor(vDir * 420.0);
          float s = step(0.9992, hash(p3.xy + p3.z * 3.7));
          col += vec3(0.5, 0.58, 0.68) * s * smoothstep(0.04, 0.5, vDir.y);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const ciel = new THREE.Mesh(geo, mat);
    ciel.frustumCulled = false;
    this.scene.add(ciel);
  }

  _lumiere() {
    const hemi = new THREE.HemisphereLight(0x44687d, 0x2a2219, 1.75);
    this.scene.add(hemi);

    const lune = new THREE.DirectionalLight(0xcfe2f0, 2.9);
    lune.position.set(-42, 58, -34);
    lune.castShadow = CONFIG.rendu.ombres && this.qualite.ombres;
    lune.shadow.mapSize.set(2048, 2048);
    lune.shadow.camera.left = -44;
    lune.shadow.camera.right = 44;
    lune.shadow.camera.top = 44;
    lune.shadow.camera.bottom = -44;
    lune.shadow.camera.near = 1;
    lune.shadow.camera.far = 150;
    lune.shadow.bias = -0.0006;
    lune.shadow.normalBias = 0.035;
    this.scene.add(lune);
    this.scene.add(lune.target);

    // Éclairage de face, doux : sort les volumes côté joueur.
    const face = new THREE.DirectionalLight(0x93b6cc, 0.85);
    face.position.set(8, 16, 42);
    this.scene.add(face);

    // Contre-jour froid, sans ombre : détache les silhouettes.
    const contre = new THREE.DirectionalLight(0x4d7d92, 0.8);
    contre.position.set(38, 26, 40);
    this.scene.add(contre);
  }

  _sol() {
    const asphalte = T.asphalte([10, 10]);
    const mat = materiauStandard(asphalte, { couleur: 0xd2d6d4, rugosite: 0.88, metal: 0.06 });
    mat.normalScale.set(0.28, 0.28);
    const sol = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat);
    sol.rotation.x = -Math.PI / 2;
    sol.receiveShadow = true;
    this.scene.add(sol);
    this.meshes.push(sol);

    // Marquages au sol : zone de manœuvre.
    const blanc = new THREE.MeshBasicMaterial({ color: 0xb9c2b6, transparent: true, opacity: 0.09 });
    for (let i = -2; i <= 2; i++) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 40), blanc);
      l.rotation.x = -Math.PI / 2;
      l.position.set(i * 7, 0.012, 0);
      this.scene.add(l);
    }
    const cercle = new THREE.Mesh(new THREE.RingGeometry(5.4, 5.6, 48), blanc);
    cercle.rotation.x = -Math.PI / 2;
    cercle.position.set(0, 0.012, 0);
    this.scene.add(cercle);

    // Flaque : disque très lisse qui accroche la lumière.
    const flaqueMat = new THREE.MeshStandardMaterial({
      color: 0x0a1214, roughness: 0.08, metalness: 0.9, transparent: true, opacity: 0.85,
    });
    for (const [x, z, r] of [[-12, 8, 3.2], [14, -10, 2.6], [4, 16, 1.9], [-18, -14, 2.2]]) {
      const f = new THREE.Mesh(new THREE.CircleGeometry(r, 28), flaqueMat);
      f.rotation.x = -Math.PI / 2;
      f.scale.set(1.5, 1, 1);
      f.position.set(x, 0.015, z);
      this.scene.add(f);
    }
  }

  _perimetre() {
    const parpaings = T.parpaings([6, 2]);
    const mat = materiauStandard(parpaings, { couleur: 0xb9bdb4, rugosite: 0.95 });
    const H = 6, E = 56, ep = 0.6;

    // Murs pleins sauf une trouée au nord (le fond du décor).
    this._boite(E, H, ep, mat, 0, H / 2, -E / 2, 0);
    this._boite(E, H, ep, mat, 0, H / 2, E / 2, 0);
    this._boite(ep, H, E, mat, -E / 2, H / 2, 0, 0);
    this._boite(ep, H, E, mat,  E / 2, H / 2, 0, 0);

    // Couronnement métallique.
    const metal = T.metal([10, 1]);
    const matMetal = materiauStandard(metal, { couleur: 0x5c6b68, rugosite: 0.55, metal: 0.55 });
    for (const [l, p, x, z] of [[E, ep + 0.4, 0, -E / 2], [E, ep + 0.4, 0, E / 2]]) {
      this._boite(l, 0.25, p, matMetal, x, H + 0.1, z, 0, false);
    }
    for (const [p, l, x, z] of [[ep + 0.4, E, -E / 2, 0], [ep + 0.4, E, E / 2, 0]]) {
      this._boite(p, 0.25, l, matMetal, x, H + 0.1, z, 0, false);
    }

    // Barbelés : deux fils continus au sommet des murs.
    const filMat = new THREE.LineBasicMaterial({ color: 0x59615e, transparent: true, opacity: 0.55 });
    for (const z of [-E / 2, E / 2]) {
      for (const y of [H + 0.32, H + 0.5]) {
        const pts = [new THREE.Vector3(-E / 2, y, z), new THREE.Vector3(E / 2, y, z)];
        this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), filMat));
      }
    }
    for (const x of [-E / 2, E / 2]) {
      for (const y of [H + 0.32, H + 0.5]) {
        const pts = [new THREE.Vector3(x, y, -E / 2), new THREE.Vector3(x, y, E / 2)];
        this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), filMat));
      }
    }
  }

  _entrepot() {
    const beton = T.beton([3, 2]);
    const mur = materiauStandard(beton, { couleur: 0xc2c5be, rugosite: 0.93 });
    const tole = T.metal([4, 2]);
    const toit = materiauStandard(tole, { couleur: 0x4a5754, rugosite: 0.6, metal: 0.5 });

    const L = 20, P = 14, H = 6.5;

    // Trois murs, façade ouverte vers le sud (+Z).
    this._boite(L, H, 0.5, mur, 0, H / 2, -P / 2);
    this._boite(0.5, H, P, mur, -L / 2, H / 2, 0);
    this._boite(0.5, H, P, mur,  L / 2, H / 2, 0);

    // Toiture partielle, laissant une verrière au centre (lumière lunaire).
    this._boite(L, 0.35, P, toit, 0, H, 0, 0, false);
    const verriere = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 5),
      new THREE.MeshStandardMaterial({ color: 0x8fb6c4, emissive: 0x24424e, emissiveIntensity: 0.6, transparent: true, opacity: 0.4, roughness: 0.3, metalness: 0.1 })
    );
    verriere.rotation.x = -Math.PI / 2;
    verriere.position.set(0, H - 0.02, 0);
    this.scene.add(verriere);

    // Poutres.
    for (let i = -2; i <= 2; i++) {
      this._boite(L - 0.6, 0.28, 0.28, toit, 0, H - 0.45, i * 3.2, 0, false);
    }

    // Piliers intérieurs.
    for (const z of [-4.2, 4.2]) {
      for (const x of [-6.4, 6.4]) {
        this._boite(0.55, H, 0.55, mur, x, H / 2, z);
      }
    }

    // Quai de chargement surélevé à l'arrière.
    this._boite(L - 4, 1.1, 3.2, mur, 0, 0.55, -P / 2 + 1.9);

    // Bandeau de danger sur le quai.
    const danger = T.danger([8, 1]);
    const matDanger = materiauStandard(danger, { rugosite: 0.8 });
    this._boite(L - 4.2, 0.18, 0.35, matDanger, 0, 1.12, -P / 2 + 3.55, 0, false);

    // Lampes de façade : sortent l'entrepôt de la silhouette.
    for (const x of [-8.5, 8.5]) {
      const abat = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.18, 0.4),
        new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa244, emissiveIntensity: 6, toneMapped: false })
      );
      abat.position.set(x, 5.4, -P / 2 + 0.35);
      this.scene.add(abat);
      const l = new THREE.PointLight(0xffb060, 14, 16, 2);
      l.position.set(x, 5.2, -P / 2 + 1.2);
      this.scene.add(l);
    }

    // Portes latérales (décor).
    const porte = new THREE.MeshStandardMaterial({ color: 0x2f3a38, roughness: 0.6, metalness: 0.4 });
    for (const x of [-L / 2 + 0.35, L / 2 - 0.35]) {
      this._boite(0.12, 3.4, 3.4, porte, x, 1.7, 1.5, 0, false);
    }
  }

  _cargaison() {
    const metal = T.metal([3, 2]);
    const cont = T.conteneur([1, 1]);
    const bois = T.bois([2, 2]);
    const jute = T.jute([1, 1]);

    const matConteneur = materiauStandard(cont, { couleur: 0xb9c4c0, rugosite: 0.78, metal: 0.25 });
    const matCaisse = materiauStandard(bois, { couleur: 0xb9a883, rugosite: 0.9 });
    const matMetal = materiauStandard(metal, { couleur: 0x6b7a76, rugosite: 0.55, metal: 0.6 });
    const matJute = materiauStandard(jute, { couleur: 0x9c8f6c, rugosite: 0.98 });

    // Conteneurs : posés, empilés, certains basculés.
    const conteneurs = [
      [-17, -12, 0, 0], [-17, -12, 2.5, 0], [-17, -8.5, 0, 0],
      [16, 12, 0.5, 0], [16, 12, 3.0, 0], [19.5, 8, 0, 0],
      [-20, 14, 0, 0], [12, -14, 0, 0], [-6, -20, 0, 0],
    ];
    for (const [x, z, y, ry] of conteneurs) {
      this._boite(6.0, 2.55, 2.44, matConteneur, x, y + 1.275, z, ry);
    }
    // Conteneur couché : obstacle massif.
    this._boite(2.44, 2.55, 6.0, matConteneur, 6, 1.275, 14, 0);

    // Caisses : quelques piles.
    const piles = [
      [0, 6.4, 1.0], [-3.4, 6.4, 1.0], [0, 6.4, 2.1], [-8.5, 10.2, 0.9],
      [9.2, -4.5, 1.0], [9.2, -4.5, 2.0], [-14, 4, 1.0], [14, -2, 0.9],
      [-4.5, -6.5, 1.0], [-4.5, -9.2, 1.0], [-4.5, -9.2, 2.0],
    ];
    for (const [x, z, y] of piles) {
      const t = 1.1;
      this._boite(t, t, t, matCaisse, x, y - t / 2 + 0.02, z, (Math.random() - 0.5) * 0.35);
      // Croisillons peints sur la caisse.
      const bande = new THREE.Mesh(new THREE.BoxGeometry(t * 1.01, 0.08, 0.08), matMetal);
      bande.position.set(x, y - 0.1, z + t / 2);
      this.scene.add(bande);
    }

    // Palettes.
    for (const [x, z] of [[-2, 12], [3, 12.6], [-16, -3], [18, 2]]) {
      this._boite(1.2, 0.14, 1.0, matCaisse, x, 1.05, z, 0, false);
    }

    // Sacs de sable : murets.
    const murets = [[-9, 2, 3.4, 0], [9, -8, 3.0, 0.3], [-13, -18, 4.2, 1.2]];
    for (const [x, z, l, ry] of murets) {
      const n = Math.round(l / 0.62);
      for (let i = 0; i < n; i++) {
        for (let h = 0; h < 3; h++) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), matJute);
          s.scale.set(1, 0.62, 0.8);
          s.position.set(
            x + Math.cos(ry) * (i - n / 2) * 0.6,
            0.2 + h * 0.38,
            z - Math.sin(ry) * (i - n / 2) * 0.6
          );
          s.castShadow = true; s.receiveShadow = true;
          this.scene.add(s);
        }
      }
      // Collision approximative du muret.
      const b = new THREE.Box3();
      b.setFromCenterAndSize(
        new THREE.Vector3(x, 0.6, z),
        new THREE.Vector3(l * 0.72, 1.2, 0.9)
      );
      this.colliders.push(b);
    }

    // Barrières béton (jersey).
    const barriereMat = materiauStandard(T.beton([2, 1]), { couleur: 0x9aa09a, rugosite: 0.95 });
    const barrieres = [[-11, -2, 0], [11, 4, 0.15], [-2, -12, 1.57], [3, 18, 0]];
    for (const [x, z, ry] of barrieres) {
      this._boite(4.4, 0.95, 0.62, barriereMat, x, 0.475, z, ry);
      this._boite(4.4, 0.32, 0.9, barriereMat, x, 0.16, z, ry, false);
    }

    // Fûts.
    const futMat = materiauStandard(metal, { couleur: 0x5f4b3f, rugosite: 0.7, metal: 0.5 });
    for (const [x, z] of [[-7.5, 14.5], [-6.7, 15.6], [13.5, -11], [14.4, -10.2], [2, -18], [-19, 19]]) {
      this._cylindre(0.32, 1.0, futMat, x, 0.5, z, true, 12);
    }
  }

  _lampadaires() {
    const metal = T.metal([1, 4]);
    const matMetal = materiauStandard(metal, { couleur: 0x3c4a47, rugosite: 0.5, metal: 0.7 });
    const ampouleMat = new THREE.MeshStandardMaterial({
      color: 0xffd9a0, emissive: 0xffa244, emissiveIntensity: 5, toneMapped: false,
    });
    const ampouleEteinteMat = new THREE.MeshStandardMaterial({
      color: 0x1b1e1d, roughness: 0.9, metalness: 0.15,
    });
    this._matAmpouleAllumee = ampouleMat;
    this._matAmpouleEteinte = ampouleEteinteMat;

    // Cible invisible autour de la tête de lampe : plus généreuse que l'ampoule.
    const matCible = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false,
    });

    const mâts = [[-20, 6, 0], [20, -4, 0], [2, -20, 0], [-4, 20, 0]];
    for (const [x, z] of mâts) {
      this._cylindre(0.11, 7.2, matMetal, x, 3.6, z, false, 8);
      this._boite(1.6, 0.14, 0.14, matMetal, x + 0.7, 7.15, z, 0, false);

      const ampoule = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.32), ampouleMat);
      ampoule.position.set(x + 1.35, 7.0, z);
      this.scene.add(ampoule);

      const cible = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.9, 0.9), matCible);
      cible.position.copy(ampoule.position);
      cible.position.y += 0.1;
      this.scene.add(cible);
      this.meshes.push(ampoule, cible);

      const l = new THREE.PointLight(0xffa244, 34, 26, 2);
      l.position.set(x + 1.35, 6.85, z);
      this.scene.add(l);

      const record = {
        ampoule, cible, lumiere: l, base: 26, phase: Math.random() * 6.28,
        eteinte: false, _extinction: 0,
        materiauAllume: ampouleMat, materiauEteint: ampouleEteinteMat,
      };
      ampoule.userData.lampadaire = record;
      cible.userData.lampadaire = record;
      this.ampoules.push(record);
    }

    // Halo visible de loin autour de chaque ampoule (sprite).
    const halo = this._textureHalo();
    for (const a of this.ampoules) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: halo, color: 0xffb05a, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      s.scale.set(1.5, 1.5, 1);
      s.position.copy(a.ampoule.position);
      this.scene.add(s);
      a.halo = s;
    }
  }

  eteindreLampadaire(record) {
    if (!record || record.eteinte) return false;
    record.eteinte = true;
    record._extinction = 0.6;
    record.ampoule.material = record.materiauEteint;
    if (record.halo) record.halo.visible = false;
    return true;
  }

  reinitialiserLampadaires() {
    for (const a of this.ampoules) {
      a.eteinte = false;
      a._extinction = 0;
      a.ampoule.material = a.materiauAllume;
      a.lumiere.intensity = a.base;
      if (a.halo) {
        a.halo.visible = true;
        a.halo.material.opacity = 0.5;
      }
    }
  }

  // Point libre pour une apparition ou un déplacement sûr.
  estLibre(x, z, marge = 0.8) {
    const lim = this.limites - Math.max(0.9, marge);
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
    for (const b of this.colliders) {
      if (b.max.y < 0.3) continue;
      if (x > b.min.x - marge && x < b.max.x + marge &&
          z > b.min.z - marge && z < b.max.z + marge) return false;
    }
    return true;
  }

  // Le centre est-il réellement à l'intérieur d'un obstacle ?
  dansCollider(x, z) {
    for (const b of this.colliders) {
      if (b.max.y < 0.3) continue;
      if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z) return true;
    }
    return false;
  }

  _textureHalo() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,220,170,1)");
    g.addColorStop(0.25, "rgba(255,170,80,0.55)");
    g.addColorStop(1, "rgba(255,140,40,0)");
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _details() {
    const metal = T.metal([6, 1]);
    const matMetal = materiauStandard(metal, { couleur: 0x53615d, rugosite: 0.55, metal: 0.65 });

    // Tuyauterie le long du mur ouest.
    for (let i = 0; i < 3; i++) {
      const g = new THREE.CylinderGeometry(0.09, 0.09, 40, 8);
      const t = new THREE.Mesh(g, matMetal);
      t.rotation.z = Math.PI / 2;
      t.position.set(0, 4.4 + i * 0.35, -27.4);
      this.scene.add(t);
    }

    // Câbles suspendus.
    const cableMat = new THREE.LineBasicMaterial({ color: 0x141a19 });
    for (let i = 0; i < 6; i++) {
      const pts = [];
      const x0 = -18 + i * 7;
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        pts.push(new THREE.Vector3(
          x0 + t * 4,
          8.2 - Math.sin(t * Math.PI) * 1.1,
          -20 + i * 6
        ));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.scene.add(new THREE.Line(geo, cableMat));
    }

    // Panneaux d'avertissement (géométrie simple).
    const panneauMat = new THREE.MeshStandardMaterial({ color: 0xc8b23a, roughness: 0.8 });
    for (const [x, z, ry] of [[-28, 3, Math.PI / 2], [28, -10, -Math.PI / 2], [0, -28, 0]]) {
      this._boite(1.1, 0.75, 0.06, panneauMat, x, 2.2, z, ry, false);
    }

    // Broussaille sèche aux angles.
    const herbeMat = new THREE.MeshStandardMaterial({ color: 0x3d4a30, roughness: 1, side: THREE.DoubleSide });
    for (let i = 0; i < 40; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 25 + Math.random() * 3;
      const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
      const brin = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5 + Math.random() * 0.5, 3), herbeMat);
      brin.position.set(x, 0.25, z);
      brin.rotation.z = (Math.random() - 0.5) * 0.5;
      this.scene.add(brin);
    }
  }

  _poussieres() {
    const n = Math.floor(700 * this.qualite.particules);
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 56;
      pos[i * 3 + 1] = Math.random() * 9;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 56;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xbfd8c8, size: 0.022, transparent: true, opacity: 0.16,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.poussieres = new THREE.Points(geo, mat);
    this.scene.add(this.poussieres);
  }

  /* --------------------------------------------------------------- animation */
  animer(dt, temps) {
    this._temps += dt;
    // Scintillement léger des lampes à sodium, extinction avec amorce.
    for (const a of this.ampoules) {
      if (a.eteinte) {
        if (a._extinction > 0) {
          a._extinction = Math.max(0, a._extinction - dt);
          const k = a._extinction / 0.6;
          a.lumiere.intensity = a.base * k * (Math.random() < 0.45 ? 1 : 0.12);
        } else {
          a.lumiere.intensity = 0;
        }
        if (a.halo) a.halo.visible = false;
        continue;
      }
      const f = 1 + Math.sin(temps * 7 + a.phase) * 0.03 + Math.sin(temps * 23 + a.phase * 2) * 0.015;
      a.lumiere.intensity = a.base * f;
      if (a.halo) a.halo.material.opacity = 0.5 * f;
    }
    // Dérive lente des poussières.
    if (this.poussieres) {
      const p = this.poussieres.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + dt * 0.12;
        if (y > 9) y = 0;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }
  }
}
