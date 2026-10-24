import * as THREE from "three";

/* Textures procédurales : tout est dessiné au chargement dans des canvas.
   Avantage : zéro fichier à héberger, zéro requête, et un rendu qui reste
   cohérent avec la palette du site. */

const TAILLE = 512;

function toile(w = TAILLE, h = TAILLE) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

function hasard(a, b) { return a + Math.random() * (b - a); }

// Bruit de valeur lissé : petite grille aléatoire agrandie en douceur.
function bruitLisse(ctx, w, h, cellules, alpha) {
  const n = toile(cellules, cellules);
  const nc = n.getContext("2d", { willReadFrequently: true });
  const img = nc.createImageData(cellules, cellules);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nc.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(n, 0, 0, w, h);
  ctx.restore();
}

function grain(ctx, w, h, force) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const b = (Math.random() - 0.5) * force;
    d[i] += b; d[i + 1] += b; d[i + 2] += b;
  }
  ctx.putImageData(img, 0, 0);
}

/* Carte de normales dérivée de la luminance (Sobel). */
function normalesDepuis(source) {
  const w = source.width, h = source.height;
  const ctx = source.getContext("2d", { willReadFrequently: true });
  const src = ctx.getImageData(0, 0, w, h).data;
  const out = toile(w, h);
  const octx = out.getContext("2d", { willReadFrequently: true });
  const dst = octx.createImageData(w, h);
  const lum = (x, y) => {
    const i = ((y + h) % h * w + (x + w) % w) * 4;
    return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (lum(x + 1, y) - lum(x - 1, y)) * 2.2;
      const dy = (lum(x, y + 1) - lum(x, y - 1)) * 2.2;
      const nz = 1;
      const l = Math.hypot(dx, dy, nz);
      const i = (y * w + x) * 4;
      dst.data[i]     = ((-dx / l) * 0.5 + 0.5) * 255;
      dst.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      dst.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      dst.data[i + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

function textureDepuis(canvas, { srgb = true, repetition = [1, 1] } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repetition[0], repetition[1]);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ dessins */

function asphalte() {
  const c = toile(), x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#343b3f"; x.fillRect(0, 0, TAILLE, TAILLE);
  bruitLisse(x, TAILLE, TAILLE, 8, 0.5);
  bruitLisse(x, TAILLE, TAILLE, 96, 0.28);

  // gravillons
  for (let i = 0; i < 5200; i++) {
    const v = Math.floor(hasard(22, 78));
    x.fillStyle = `rgba(${v},${v},${v},${hasard(0.15, 0.5)})`;
    const r = hasard(0.5, 1.6);
    x.fillRect(hasard(0, TAILLE), hasard(0, TAILLE), r, r);
  }
  // fissures
  x.strokeStyle = "rgba(12,14,15,0.75)"; x.lineWidth = 1.1;
  for (let i = 0; i < 7; i++) {
    let px = hasard(0, TAILLE), py = hasard(0, TAILLE);
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 14; s++) {
      px += hasard(-16, 16); py += hasard(-16, 16);
      x.lineTo(px, py);
    }
    x.stroke();
  }
  // tache d'huile
  const g = x.createRadialGradient(320, 180, 4, 320, 180, 95);
  g.addColorStop(0, "rgba(8,9,10,0.55)");
  g.addColorStop(1, "rgba(8,9,10,0)");
  x.fillStyle = g; x.fillRect(0, 0, TAILLE, TAILLE);
  grain(x, TAILLE, TAILLE, 11);
  return c;
}

function beton() {
  const c = toile(), x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#949891"; x.fillRect(0, 0, TAILLE, TAILLE);
  bruitLisse(x, TAILLE, TAILLE, 6, 0.45);
  bruitLisse(x, TAILLE, TAILLE, 64, 0.22);
  // coulures
  for (let i = 0; i < 18; i++) {
    const px = hasard(0, TAILLE);
    const lg = hasard(30, 180);
    const g = x.createLinearGradient(px, 0, px, lg);
    g.addColorStop(0, "rgba(40,42,40,0.35)");
    g.addColorStop(1, "rgba(40,42,40,0)");
    x.fillStyle = g; x.fillRect(px, 0, hasard(2, 8), lg);
  }
  // impacts
  for (let i = 0; i < 26; i++) {
    const px = hasard(0, TAILLE), py = hasard(0, TAILLE), r = hasard(1, 5);
    x.fillStyle = "rgba(30,32,30,0.5)";
    x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }
  grain(x, TAILLE, TAILLE, 18);
  return c;
}

function metal() {
  const c = toile(), x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#4c5b58"; x.fillRect(0, 0, TAILLE, TAILLE);
  bruitLisse(x, TAILLE, TAILLE, 12, 0.35);
  // rayures
  for (let i = 0; i < 90; i++) {
    x.strokeStyle = `rgba(${hasard(120, 190)},${hasard(140, 200)},${hasard(140, 190)},${hasard(0.03, 0.14)})`;
    x.lineWidth = hasard(0.4, 1.4);
    const y = hasard(0, TAILLE);
    x.beginPath(); x.moveTo(hasard(0, TAILLE), y); x.lineTo(hasard(0, TAILLE), y + hasard(-3, 3)); x.stroke();
  }
  // rivets
  for (let i = 0; i < 40; i++) {
    const px = hasard(0, TAILLE), py = hasard(0, TAILLE);
    const r = hasard(2, 4);
    const g = x.createRadialGradient(px - 1, py - 1, 0, px, py, r);
    g.addColorStop(0, "rgba(190,200,196,0.55)");
    g.addColorStop(1, "rgba(20,26,24,0.55)");
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }
  grain(x, TAILLE, TAILLE, 12);
  return c;
}

function bois() {
  const c = toile(), x = c.getContext("2d", { willReadFrequently: true });
  const lattes = 4;
  for (let i = 0; i < lattes; i++) {
    const y0 = (TAILLE / lattes) * i;
    const teinte = hasard(92, 124);
    x.fillStyle = `rgb(${teinte},${teinte * 0.72},${teinte * 0.46})`;
    x.fillRect(0, y0, TAILLE, TAILLE / lattes - 2);
    // veines
    for (let v = 0; v < 26; v++) {
      x.strokeStyle = `rgba(60,38,18,${hasard(0.06, 0.2)})`;
      x.lineWidth = hasard(0.5, 1.6);
      const y = y0 + hasard(2, TAILLE / lattes - 4);
      x.beginPath();
      x.moveTo(0, y);
      for (let px = 0; px <= TAILLE; px += 24) x.lineTo(px, y + Math.sin(px * 0.03 + v) * 1.6);
      x.stroke();
    }
    x.fillStyle = "rgba(20,12,6,0.55)";
    x.fillRect(0, y0 + TAILLE / lattes - 2, TAILLE, 2);
  }
  grain(x, TAILLE, TAILLE, 20);
  return c;
}

function jute() {
  const c = toile(), x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#8a7b55"; x.fillRect(0, 0, TAILLE, TAILLE);
  bruitLisse(x, TAILLE, TAILLE, 40, 0.3);
  x.globalAlpha = 0.25;
  for (let i = 0; i < TAILLE; i += 3) {
    x.strokeStyle = i % 6 === 0 ? "#6b5e3f" : "#a2946c";
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, TAILLE); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(TAILLE, i); x.stroke();
  }
  x.globalAlpha = 1;
  grain(x, TAILLE, TAILLE, 22);
  return c;
}

function conteneur() {
  const c = toile(), x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#6a3a2c"; x.fillRect(0, 0, TAILLE, TAILLE);
  bruitLisse(x, TAILLE, TAILLE, 10, 0.3);
  // nervures verticales
  const pas = 32;
  for (let px = 0; px < TAILLE; px += pas) {
    const g = x.createLinearGradient(px, 0, px + pas, 0);
    g.addColorStop(0, "rgba(0,0,0,0.42)");
    g.addColorStop(0.35, "rgba(255,255,255,0.10)");
    g.addColorStop(0.6, "rgba(255,255,255,0.04)");
    g.addColorStop(1, "rgba(0,0,0,0.42)");
    x.fillStyle = g; x.fillRect(px, 0, pas, TAILLE);
  }
  // rouille
  for (let i = 0; i < 120; i++) {
    x.fillStyle = `rgba(${hasard(90, 150)},${hasard(45, 80)},${hasard(15, 40)},${hasard(0.05, 0.3)})`;
    const r = hasard(1, 9);
    x.beginPath(); x.arc(hasard(0, TAILLE), hasard(0, TAILLE), r, 0, 7); x.fill();
  }
  // bandeau de numéro
  x.fillStyle = "rgba(230,230,220,0.75)";
  x.font = "bold 46px monospace";
  x.fillText("FC-2207", 150, 300);
  grain(x, TAILLE, TAILLE, 11);
  return c;
}

function bandesDanger() {
  const c = toile(256, 256), x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#d9a520"; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = "#151513"; x.lineWidth = 26;
  for (let i = -256; i < 512; i += 64) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 256, 256); x.stroke();
  }
  bruitLisse(x, 256, 256, 30, 0.18);
  for (let i = 0; i < 90; i++) {
    x.fillStyle = `rgba(40,35,25,${hasard(0.05, 0.25)})`;
    x.fillRect(hasard(0, 256), hasard(0, 256), hasard(1, 6), hasard(1, 6));
  }
  return c;
}

function murParpaings() {
  const c = toile(), x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#6e6f68"; x.fillRect(0, 0, TAILLE, TAILLE);
  bruitLisse(x, TAILLE, TAILLE, 8, 0.4);
  const hb = 64, lb = 128;
  for (let row = 0; row < TAILLE / hb; row++) {
    const dec = (row % 2) * (lb / 2);
    for (let col = -1; col < TAILLE / lb + 1; col++) {
      const px = col * lb + dec, py = row * hb;
      const v = Math.floor(hasard(96, 122));
      x.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
      x.fillRect(px + 2, py + 2, lb - 4, hb - 4);
      x.strokeStyle = "rgba(35,36,32,0.7)";
      x.lineWidth = 3;
      x.strokeRect(px + 2, py + 2, lb - 4, hb - 4);
    }
  }
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `rgba(30,32,28,${hasard(0.04, 0.18)})`;
    x.fillRect(hasard(0, TAILLE), hasard(0, TAILLE), hasard(4, 40), hasard(4, 30));
  }
  grain(x, TAILLE, TAILLE, 14);
  return c;
}

/* ------------------------------------------------------------------ cache */
export class Textures {
  constructor() {
    this._cache = new Map();
  }

  _obtenir(nom, fabrique, opts) {
    if (this._cache.has(nom)) return this._cache.get(nom);
    const canvas = fabrique();
    const map = textureDepuis(canvas, opts);
    const normal = textureDepuis(normalesDepuis(canvas), { srgb: false, repetition: opts?.repetition });
    const paquet = { map, normal };
    this._cache.set(nom, paquet);
    return paquet;
  }

  asphalte(rep = [14, 14]) { return this._obtenir("asphalte", asphalte, { repetition: rep }); }
  beton(rep = [4, 4])      { return this._obtenir("beton", beton, { repetition: rep }); }
  metal(rep = [2, 2])      { return this._obtenir("metal", metal, { repetition: rep }); }
  bois(rep = [2, 2])       { return this._obtenir("bois", bois, { repetition: rep }); }
  jute(rep = [1, 1])       { return this._obtenir("jute", jute, { repetition: rep }); }
  conteneur(rep = [1, 1])  { return this._obtenir("conteneur", conteneur, { repetition: rep }); }
  danger(rep = [1, 1])     { return this._obtenir("danger", bandesDanger, { repetition: rep }); }
  parpaings(rep = [3, 1])  { return this._obtenir("parpaings", murParpaings, { repetition: rep }); }
}
