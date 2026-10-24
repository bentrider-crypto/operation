# OPÉRATION — FPS WebGL pour raspi-web

Jeu de tir à la première personne, en une page, servi par Apache comme le reste du site.
Aucune dépendance réseau : Three.js est vendorisé, toutes les textures sont générées au
chargement, tout le son est synthétisé. Le jeu fonctionne donc même si la fibre tombe.

## Contenu

```
cod/
├── index.html        page du jeu (menus, HUD, import map)
├── style.css         interface, menus, HUD
├── lib/
│   ├── three.module.js   Three.js 0.186.1 (vendorisé)
│   └── three.core.js
└── js/
    ├── config.js     réglages et équilibrage (un seul endroit à toucher)
    ├── main.js       boucle, états de jeu, HUD, menus
    ├── world.js      niveau, lumières, ciel, collisionneurs
    ├── player.js     entrées, déplacement, collisions, caméra
    ├── weapon.js     modèle d'arme, tir, recul, effets
    ├── enemies.js    hostiles, IA, vagues
    ├── postfx.js     bloom, vignette, grain, aberration
    ├── textures.js   textures procédurales (canvas)
    └── audio.js      sons synthétisés (WebAudio)
```

## Commandes (clavier / souris)

| Touche | Action |
|---|---|
| ZQSD / flèches | se déplacer |
| Souris | viser |
| Clic gauche | tirer |
| Clic droit | viser (ADS) |
| Maj | sprint |
| Ctrl | accroupi |
| Espace | sauter |
| R | recharger |
| M | couper/rétablir le son |
| Échap | pause |
| F3 | compteur de performance (fps, ms, appels, triangles) |

Réglages (sensibilité, volume, qualité, axe Y) conservés dans `localStorage`.

## Commandes (téléphone / tablette)

Le jeu démarre en mode tactile quand l'appareil n'a pas de pointeur fin.
En paysage :
- **glisser n'importe où** sur l'image pour viser (le canon suit le doigt) ;
- **deux tapes rapides** pour tirer — maintenir le doigt après la seconde tape
  entretient le tir ;
- **joystick virtuel** à gauche pour se déplacer (il apparaît là où tu poses le pouce) ;
- boutons **TIR**, **VISER**, **RECH.**, **SAUT** et **pause** en complément.

La qualité passe automatiquement en « Basse » au premier lancement ; en portrait,
le jeu demande de tourner l'appareil.

## Tester en local

```bash
cd raspi-cod
python3 -m http.server 8123
# ouvrir http://127.0.0.1:8123/
```

Un serveur est nécessaire : les modules ES ne se chargent pas en `file://`.

## Déployer sur raspi-web

1. Copier le dossier dans la racine web du site (`/var/www/default/public/jeu/cod`) :

```bash
rsync -av --delete \
  --exclude 'qa' --exclude 'preview' --exclude 'integration' --exclude 'screens' \
  ./ pi@raspi-web.local:/tmp/operation-cascade/
ssh pi@raspi-web.local
sudo mkdir -p /var/www/default/public/jeu/cod
sudo rsync -a /tmp/operation-cascade/ /var/www/default/public/jeu/cod/
sudo chown -R root:www-data /var/www/default/public/jeu/cod
```

2. Ajouter la passerelle dans `CASCADE` (`/var/www/default/public/jeu/index.html`).
   La version déjà patchée est fournie : `integration/cascade-patche.html`.
   Elle ne change que trois choses :

   - un bloc CSS `.bouton-lien` avant `</style>` ;
   - un lien `<a class="bouton-lien" href="cod/">Opération ▸</a>` sous le bouton « Jouer » ;
   - un lien « Opération Cascade » dans le pied de page.

```bash
sudo cp integration/cascade-patche.html /var/www/default/public/jeu/index.html
sudo chown root:www-data /var/www/default/public/jeu/index.html
```

3. Ouvrir `https://raspi-web.local/jeu/` puis « Opération ▸ ».

### Revenir en arrière

```bash
sudo rm -rf /var/www/default/public/jeu/cod
# et restaurer l'ancienne page CASCADE depuis une sauvegarde
```

## Qualité — ce que c'est, ce que ce n'est pas

C'est un FPS **soigné et jouable**, pas un AAA : pas de campagne, pas de multijoueur,
pas de capture de mouvement, pas d'assets scannés. Les personnages sont des silhouettes
articulées, le niveau tient sur une arène, l'IA se résume à patrouille → détection →
tir → couverture.

Ce qui est réellement en place : éclairage dynamique avec ombres, post-traitement
(bloom, vignette, grain, aberration), textures procédurales avec cartes de normales,
arme avec recul/visée/rechargement, impacts, douilles, traçantes, son synthétisé,
vagues, score, HUD complet, réglages persistants.

## Compatibilité

- WebGL 2 obligatoire ; sans lui, une page « WEBGL 2 REQUIS » s'affiche au lieu d'un écran cassé.
- Téléphone et tablette : le jeu demande un clavier et une souris et renvoie vers CASCADE
  (aucune tentative de pointer lock tactile).

## Notes techniques

- WebGL2 requis ; prévoir un GPU même modeste. Le Raspberry Pi ne fait que servir les
  fichiers, il ne rend rien.
- Le rendu passe par une cible HalfFloat + composition maison : `renderer.toneMapping`
  reste à `NoToneMapping`, l'ACES est appliqué dans `postfx.js`.
- Les captures de contrôle sont dans `qa/screens/` ; les scripts Playwright de `qa/`
  ne font pas partie du site et sont exclus du déploiement.
