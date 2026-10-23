# Farming's Folies

Jeu de team building (≤ 2 h) : gestion de ferme en relais, bocal de stress, marché et fête du Phoenix.
Console animateur, écran joueurs (1920×1080) et mobile par équipe, en temps réel (Express + Socket.IO).

## Utilisation
- `/` : créer une partie (code à 4 lettres)
- `/admin?s=CODE&k=CLE` : console animateur
- `/display?s=CODE` : écran externe pour les joueurs
- `/team?s=CODE&t=TOKEN` : mobile d'une équipe (liens et QR dans la console)

## Lancer seul
    npm install
    npm start        # http://localhost:3000
    npm test         # moteur de jeu

Variables : `PORT`, `FF_DATA_DIR` (dossier des sauvegardes JSON, défaut `./data`).

## Déploiement sur node-gateway
L'app exporte l'`app` Express et `app.attachToServer(httpServer, { mountPath })` (Socket.IO sur `mountPath + '/socket.io'`).
Le bloc `gateway` de package.json donne la route `/farming-folies`. Tous les chemins côté navigateur sont relatifs.

    cd node-gateway/apps
    git clone <repo> farming-folies   # ou copie du dossier
    cd .. && npm install && npm start   # le postinstall installe les dépendances de chaque app

`apps/*` est ignoré par git dans node-gateway : ne pas y committer. Aucun module natif (compatible hébergement mutualisé).

## Équilibrage
Prix, quotas, cartes, roue et fête : `lib/data.js`. À calibrer après un premier test.


## Accès animateur et historique

- **Mot de passe unique** (même politique que The Big Team Quiz). **Aucun mot de passe par défaut** : à la première visite de la page d'accueil après l'installation, l'animateur crée le mot de passe (une seule fois). Variante sans interface : définir `FF_ADMIN_PASSWORD` impose un mot de passe initial. Une fois changé depuis l'accueil (« Mot de passe »), seule une empreinte salée (scrypt) est stockée dans `data/settings.json`.
- 5 échecs depuis une même adresse IP = verrouillage de 5 minutes. La connexion délivre un jeton signé valable 12 h ; changer le mot de passe invalide tous les jetons.
- Seuls les écrans joueurs (code à 4 lettres) et les mobiles d'équipe (lien personnel) sont accessibles sans mot de passe. Créer, lister, renommer, exporter, supprimer une partie et ouvrir la console exigent la connexion.
- **Historique** : toutes les parties sont conservées dans `data/` jusqu'à suppression depuis l'accueil (reprendre, écran, renommer, exporter en JSON, supprimer).
- Chrono : ±15/30 s, durée libre, et option « garder pour les saisons suivantes » dans la console.

## Règles et guide dans la console

Les boutons « 📖 Règles » et « 🧭 Guide » de la console animateur ouvrent les textes de `docs/regles.md` et `docs/guide.md`. Après modification, régénérer : `node docs/build-guide.js` (écrit `public/guide.js`).
