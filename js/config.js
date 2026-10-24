// Réglages globaux — un seul endroit pour équilibrer le jeu.
export const CONFIG = {
  joueur: {
    taille: 1.70,          // hauteur des yeux
    rayon: 0.38,
    vitesseMarche: 5.6,    // m/s
    vitesseSprint: 8.4,
    vitesseAccroupi: 2.9,
    acceleration: 46,
    friction: 11,
    gravite: 22,
    saut: 6.4,
    vieMax: 100,
    regen: 7.5,            // PV/s après 4 s sans dégâts
    delaiRegen: 4.0,
    hauteurAccroupi: 1.18,
  },

  arme: {
    nom: "MK-7",
    cadence: 720,          // coups/minute
    degats: 24,
    degatsTete: 68,
    chargeur: 30,
    reserveMax: 180,
    tempsRechargement: 1.95,
    dispersion: 0.011,     // radians, debout
    dispersionVise: 0.0022,
    dispersionMouvement: 0.02,
    recul: 0.9,
    portee: 140,
    auto: true,
    zoomVise: 55,          // FOV en visée
    punchCamera: 0.012,
  },

  ennemis: {
    vie: 100,
    vitesse: 2.4,
    vitesseAssaut: 4.2,
    degats: 6,
    cadence: 420,
    precision: 0.055,
    porteeVision: 46,
    porteeTir: 34,
    tempsReaction: 0.45,
  },

  vagues: {
    premiere: 5,
    increment: 2,
    maxSimultanes: 9,
    pauseEntreVagues: 4.0,
  },

  rendu: {
    brouillard: 0.0125,
    exposition: 1.05,
    ombres: true,
    pixelRatioMax: 1.5,
    qualite: {
      basse:   { ombres: false, bloom: false, pixelRatioMax: 1.0, particules: 0.4, msaa: 0 },
      normale: { ombres: true,  bloom: true,  pixelRatioMax: 1.35, particules: 1.0, msaa: 2 },
      haute:   { ombres: true,  bloom: true,  pixelRatioMax: 2.0, particules: 1.6, msaa: 4 },
    },
  },

  couleurs: {
    cielHaut: 0x0a1420,
    cielBas: 0x1b2a2e,
    soleil: 0x9fc4d8,
    sodium: 0xffa244,
    vert: 0x7cf2a8,
  },
};

export const ETATS = Object.freeze({
  CHARGEMENT: "chargement",
  ACCUEIL: "accueil",
  JEU: "jeu",
  PAUSE: "pause",
  FIN: "fin",
});
