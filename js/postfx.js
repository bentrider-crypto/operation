import * as THREE from "three";

/* =============================================================================
   Post-traitement maison, sans dépendance externe :
   rendu → seuil de brillance → flou séparable → composition (ACES, vignette,
   grain, aberration chromatique). C'est ce qui donne le « grain cinéma ».
   ========================================================================== */

const VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG_SEUIL = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform float seuil;
  uniform float ecart;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float k = smoothstep(seuil - ecart, seuil + ecart, l);
    gl_FragColor = vec4(c * k, 1.0);
  }
`;

const FRAG_FLOU = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tImage;
  uniform vec2 direction;
  void main() {
    vec3 somme = vec3(0.0);
    float poids[5];
    poids[0] = 0.227027;
    poids[1] = 0.1945946;
    poids[2] = 0.1216216;
    poids[3] = 0.054054;
    poids[4] = 0.016216;
    somme += texture2D(tImage, vUv).rgb * poids[0];
    for (int i = 1; i < 5; i++) {
      vec2 d = direction * float(i) * 1.4;
      somme += texture2D(tImage, vUv + d).rgb * poids[i];
      somme += texture2D(tImage, vUv - d).rgb * poids[i];
    }
    gl_FragColor = vec4(somme, 1.0);
  }
`;

const FRAG_FINAL = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float forceBloom;
  uniform float temps;
  uniform vec2 resolution;
  uniform float grain;
  uniform float vignette;
  uniform float aberration;
  uniform float exposition;

  vec3 aces(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }
  float hasard(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 centre = vUv - 0.5;
    float r2 = dot(centre, centre);

    // Aberration chromatique : les bords se séparent légèrement.
    vec2 dir = centre * (0.0009 + r2 * 0.0022) * aberration * 2.4;
    vec3 col;
    col.r = texture2D(tScene, vUv + dir).r;
    col.g = texture2D(tScene, vUv).g;
    col.b = texture2D(tScene, vUv - dir).b;

    col += texture2D(tBloom, vUv).rgb * forceBloom;

    col *= exposition;
    col = aces(col);

    // Vignettage.
    float v = smoothstep(0.85, 0.25, r2 * 2.1);
    col *= mix(1.0, v, vignette);

    // Grain argentique, plus fort dans les ombres.
    float bruit = hasard(vUv * resolution + temps * 43.0) - 0.5;
    float luminance = dot(col, vec3(0.299, 0.587, 0.114));
    col += bruit * grain * (0.35 + (1.0 - luminance) * 0.65);

    // Légère désaturation des ombres (look cinéma).
    col = mix(vec3(luminance), col, 0.92);

    // Encodage sRGB manuel (le rendu s'est fait en linéaire).
    col = pow(max(col, 0.0), vec3(1.0 / 2.2));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class PostFX {
  constructor(renderer, qualite) {
    this.renderer = renderer;
    this.qualite = qualite;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const options = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, { ...options, depthBuffer: true });
    this.rtScene.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.rtA = new THREE.WebGLRenderTarget(2, 2, options);
    this.rtB = new THREE.WebGLRenderTarget(2, 2, options);
    this.rtA.texture.colorSpace = this.rtB.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.matSeuil = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAG_SEUIL,
      uniforms: { tScene: { value: null }, seuil: { value: 1.45 }, ecart: { value: 0.4 } },
      depthTest: false, depthWrite: false,
    });
    this.matFlou = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAG_FLOU,
      uniforms: { tImage: { value: null }, direction: { value: new THREE.Vector2() } },
      depthTest: false, depthWrite: false,
    });
    this.matFinal = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAG_FINAL,
      uniforms: {
        tScene: { value: this.rtScene.texture },
        tBloom: { value: this.rtA.texture },
        forceBloom: { value: 0.34 },
        temps: { value: 0 },
        resolution: { value: new THREE.Vector2(1, 1) },
        grain: { value: 0.012 },
        vignette: { value: 0.48 },
        aberration: { value: 0.55 },
        exposition: { value: 1.32 },
      },
      depthTest: false, depthWrite: false,
    });

    this.largeur = 1; this.hauteur = 1;
    this.actif = true;
  }

  setQualite(qualite) {
    this.qualite = qualite;
    this.actif = qualite.bloom !== false;
  }

  setSize(largeur, hauteur) {
    this.largeur = Math.max(1, Math.floor(largeur));
    this.hauteur = Math.max(1, Math.floor(hauteur));
    this.rtScene.setSize(this.largeur, this.hauteur);
    this.rtScene.samples = this.qualite.msaa || 0;
    const w = Math.max(1, Math.floor(this.largeur / 4));
    const h = Math.max(1, Math.floor(this.hauteur / 4));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.matFinal.uniforms.resolution.value.set(this.largeur, this.hauteur);
  }

  _pleinEcran(materiau, cible) {
    this.quad.material = materiau;
    this.renderer.setRenderTarget(cible);
    this.renderer.render(this.scene, this.camera);
  }

  render(scene, camera, temps) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);
    // Statistiques de la passe 3D (avant les passes plein écran).
    this.stats = { appels: r.info.render.calls, triangles: r.info.render.triangles };

    if (!this.actif) {
      this.quad.material = new THREE.ShaderMaterial({
        uniforms: { tScene: { value: this.rtScene.texture } },
        vertexShader: VERTEX,
        fragmentShader: `varying vec2 vUv; uniform sampler2D tScene;
          void main(){ vec4 c = texture2D(tScene, vUv); gl_FragColor = vec4(pow(max(c.rgb,0.0), vec3(1.0/2.2)), 1.0); }`,
        depthTest: false, depthWrite: false,
      });
      this._pleinEcran(this.quad.material, null);
      r.setRenderTarget(null);
      return;
    }

    // Seuil de brillance.
    this.matSeuil.uniforms.tScene.value = this.rtScene.texture;
    this._pleinEcran(this.matSeuil, this.rtA);

    // Deux passes de flou (horizontal puis vertical).
    const w = this.rtA.width, h = this.rtA.height;
    this.matFlou.uniforms.tImage.value = this.rtA.texture;
    this.matFlou.uniforms.direction.value.set(1 / w, 0);
    this._pleinEcran(this.matFlou, this.rtB);
    this.matFlou.uniforms.tImage.value = this.rtB.texture;
    this.matFlou.uniforms.direction.value.set(0, 1 / h);
    this._pleinEcran(this.matFlou, this.rtA);

    // Composition finale.
    this.matFinal.uniforms.temps.value = temps;
    this.matFinal.uniforms.tScene.value = this.rtScene.texture;
    this.matFinal.uniforms.tBloom.value = this.rtA.texture;
    this._pleinEcran(this.matFinal, null);
    r.setRenderTarget(null);
  }
}
