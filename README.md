# 🃏 Ça va mal finir

**Jeu de cartes d'ambiance multijoueur, en temps réel, dans le navigateur.** Inspiré des jeux type *Cards Against Humanity* : une carte noire avec un ou plusieurs trous, chaque joueur invente une réponse pour compléter la phrase, un juge élit la meilleure. Premier à atteindre le score cible gagne.

Le jeu est pensé pour être joué **en soirée, entre adultes consentants, à but 100% humoristique** — voir [`public/legal.html`](public/legal.html) pour la Charte d'utilisation, les CGU et la politique de confidentialité.

---

## 📑 Sommaire

- [🎯 Le but du projet](#-le-but-du-projet)
- [🧠 Comment ça fonctionne (vue d'ensemble)](#-comment-ça-fonctionne-vue-densemble)
- [🏗️ Architecture technique](#️-architecture-technique)
- [📂 Structure des fichiers](#-structure-des-fichiers)
- [🎮 Machine à états d'une manche](#-machine-à-états-dune-manche)
- [🗄️ Base de données](#️-base-de-données)
- [🃏 Format des cartes](#-format-des-cartes)
- [🔌 Événements Socket.IO](#-événements-socketio)
- [👑 Panel admin](#-panel-admin)
- [🎓 Mode pratique (tutoriel / démo)](#-mode-pratique-tutoriel--démo)
- [📱 Mobile & PWA](#-mobile--pwa)
- [⚖️ Légal & conformité](#️-légal--conformité)
- [🚀 Installation & lancement](#-installation--lancement)
- [☁️ Déploiement (Replit)](#️-déploiement-replit)
- [🧪 Comment tester](#-comment-tester)
- [🗺️ Historique / décisions notables](#️-historique--décisions-notables)

---

## 🎯 Le but du projet

Un jeu de société numérique pour jouer **entre amis, en local ou à distance**, sans rien installer : on ouvre un lien dans un navigateur (mobile ou desktop), on rejoint avec un code à 6 caractères, et c'est parti. Objectif produit : que ce soit **drôle, fluide, mobile-first, et sans friction** (pas de compte obligatoire pour jouer).

Projet à vocation **lucrative** (hébergement + potentiel modèle payant à venir), d'où l'attention portée à la conformité légale (RGPD, CGU, charte d'utilisation — voir plus bas) avant tout déploiement public.

---

## 🧠 Comment ça fonctionne (vue d'ensemble)

1. Un joueur **crée une partie** : choisit un pseudo, un avatar, configure les réglages (packs de cartes, visibilité publique/privée, score pour gagner, temps de réponse, nombre de changements de carte autorisés). Un **code à 6 caractères** est généré.
2. Les autres joueurs **rejoignent** avec ce code (ou via un lien direct, ou via la liste des parties publiques).
3. La partie tourne en boucle de **manches** :
   - Un joueur est tiré au sort comme **juge** de la manche.
   - Une **carte noire** (avec 1 à 3 trous, ou une mention `{user}` désignant un joueur) est piochée ; le juge peut en changer (nombre de fois limité), puis la valide.
   - Tous les autres joueurs **écrivent leurs réponses** pour compléter les trous, dans le temps imparti.
   - Le juge **lit les réponses mélangées** (sans savoir qui a écrit quoi) et **élit la meilleure**.
   - Le gagnant marque un point, résultat affiché, manche suivante.
4. Premier joueur à atteindre le score cible → **victoire**, écran de fin, possibilité de rejouer.

Il existe aussi un **mode pratique** (tutoriel guidé ou démo) : partie solo contre 2 bots, scénarios entièrement déterministes (aucun hasard), pour découvrir le jeu sans dépendre d'autres joueurs.

---

## 🏗️ Architecture technique

**Stack minimaliste, zéro framework front, zéro étape de build.**

| Côté | Techno |
|---|---|
| Serveur | Node.js + [Express](https://expressjs.com/) (HTTP statique + API REST minimale) + [Socket.IO](https://socket.io/) (temps réel) |
| Base de données | SQLite via `node:sqlite` (module natif Node ≥ 22, pas de dépendance externe) |
| Client | HTML/CSS/JS **vanilla**, pas de React/Vue, pas de bundler — les fichiers `public/*.js` sont chargés tels quels via `<script>` |
| Notifications push | [web-push](https://www.npmjs.com/package/web-push) (VAPID) |
| Config | [dotenv](https://www.npmjs.com/package/dotenv) (`.env`) |

**Pourquoi pas de framework front ?** Projet volontairement simple à déployer et à maintenir : pas de `npm run build`, pas de bundle à invalider, un simple `node server.js` suffit. Le rendu est un système de "screens" : chaque état du jeu correspond à une fonction JS qui retourne une chaîne HTML injectée dans `#app` (`public/js/screens.js`).

**Modèle serveur-autoritaire** : le serveur est la seule source de vérité de l'état du jeu (qui est juge, quelle carte, qui a répondu, qui a gagné...). Le client ne fait qu'afficher l'état reçu et envoyer des actions (`socket.emit`) — aucune logique de jeu côté client ne peut être trichée.

**Deux flux d'état distincts envoyés à chaque client** (voir `server/gameState.js` → `getPublicState()` / `getPrivateState()`) :
- **`gameState`** (public) : ce que tout le monde voit (état de la manche, joueurs, carte visible...).
- **`privateState`** (privé, par joueur) : ce que CE joueur précis doit voir en plus (ex. les réponses mélangées si c'est lui le juge) — jamais diffusé aux autres.

---

## 📂 Structure des fichiers

```
blanc-manger/
├── server.js                  # Point d'entrée : Express + Socket.IO, enregistrement de tous les events
├── package.json
├── .env                       # Secrets (voir Installation) — NE JAMAIS exposer publiquement en dehors de ce repo privé
├── data/                      # Contenu + état persistant
│   ├── *.json                 # Packs de cartes (normal, spicy, adult, adults, halloween, noel, ete, community)
│   ├── app.db                 # Base SQLite (comptes, stats, logs...) — générée au 1er lancement, PAS versionnée
│   ├── community_pending.json # Cartes communautaires en attente de modération
│   └── reports.json           # Signalements de cartes
├── server/
│   ├── db.js                  # Connexion SQLite + définition de TOUTES les tables (CREATE TABLE IF NOT EXISTS)
│   ├── gameState.js           # Classe Game + machine à états (STATES) + vues publique/privée
│   ├── gameManager.js         # Cœur de la logique de jeu : tous les handlers socket liés à une partie
│   ├── playerManager.js       # Classe Player
│   ├── cardManager.js         # Chargement/validation des packs JSON, parsing des trous, decks, admin cartes
│   ├── cardStats.js           # Stats d'usage/victoire par carte (SQLite)
│   ├── practiceScenarios.js   # Scénarios du mode tutoriel/démo (DB-backed, éditable admin)
│   ├── accountManager.js      # Comptes joueurs persistants (optionnels) : login, XP, amis, succès
│   ├── adminManager.js        # Tout le panel admin (auth, modération, dashboard, stats globales)
│   ├── adminBootstrap.js      # Création du 1er compte admin depuis .env au premier démarrage
│   ├── appSettings.js         # Réglages globaux modifiables par le superadmin (ex. longueur max réponse)
│   ├── siteStats.js           # Compteurs globaux (visites, parties jouées)
│   ├── logRetention.js        # Purge auto du journal d'activité après 12 mois (RGPD)
│   ├── pushManager.js         # Envoi de notifications push (web-push / VAPID)
│   ├── validation.js          # Fonctions de validation partagées (pseudo, code partie, réglages...)
│   ├── envCheck.js            # Vérifie que les variables d'environnement requises sont présentes au démarrage
│   ├── startupBanner.js       # Bannière affichée dans la console au démarrage
│   └── utils.js                # Helpers génériques (ids, shuffle, échappement HTML...)
└── public/                    # Tout ce qui est servi au navigateur
    ├── index.html              # Page principale (le jeu)
    ├── admin.html               # Page du panel admin (indépendante)
    ├── legal.html                # Charte d'utilisation + CGU + politique de confidentialité
    ├── manifest.json / sw.js    # PWA (installable, service worker de cache-busting)
    ├── style.css / admin.css   # Tout le style (pas de préprocesseur)
    ├── app.js                  # Bootstrap client (connexion socket, actions UI, render loop, service worker)
    └── js/
        ├── state.js             # État global client (AppState) + constantes (options de réglages...)
        ├── i18n.js               # Petites chaînes traduisibles (FR par défaut)
        ├── cards.js              # Rendu du texte des cartes (trous, mentions {user}, ajustement de taille)
        ├── screens.js            # LE gros fichier : une fonction par écran de jeu
        ├── account.js            # Écrans compte joueur (login/register/profil/amis)
        ├── ui.js                 # Modales de confirmation/info, toasts, presse-papier
        ├── animations.js, cardImage.js, chat.js, scoreboard.js, socket.js, timers.js, tutorialtips.js, push.js
        └── admin.js               # Toute la logique du panel admin (SPA indépendante de l'app joueur)
```

---

## 🎮 Machine à états d'une manche

Chaque partie (`Game`, voir `server/gameState.js`) traverse ces états dans l'ordre (boucle jusqu'à victoire) :

```
LOBBY → JUDGE_SELECTION → CARD_SELECTION → ANSWERING → JUDGING → RESULTS → NEXT_ROUND ─┐
  ▲                                                                                      │
  └──────────────────────────────── (boucle jusqu'à score cible atteint) ────────────────┘
                                                                                          ▼
                                                                                    GAME_OVER
```

+ deux états transverses : `PAUSED` (admin peut mettre en pause n'importe quand) et `STOPPED` (partie arrêtée définitivement).

| État | Ce qu'il se passe |
|---|---|
| `LOBBY` | Joueurs se rassemblent, l'admin (créateur) configure les réglages en direct |
| `JUDGE_SELECTION` | Tirage du juge de la manche (court, ~3s, pour l'effet dramatique) |
| `CARD_SELECTION` | Le juge voit la carte, peut la reroll (si non-mode pratique), résout une éventuelle mention `{user}`, puis valide |
| `ANSWERING` | Tous les autres joueurs écrivent leur(s) réponse(s), minuté |
| `JUDGING` | Le juge parcourt les réponses mélangées (jamais d'association auteur visible) et en élit une |
| `RESULTS` | Révélation du gagnant de la manche, +1 point |
| `NEXT_ROUND` | Court délai avant la manche suivante (nouveau juge) |
| `GAME_OVER` | Un joueur a atteint le score cible : classement final, options rejouer |

---

## 🗄️ Base de données

SQLite (`data/app.db`, fichier unique, pas de serveur DB à gérer), tables principales (voir `server/db.js` pour le schéma complet) :

| Table | Contenu |
|---|---|
| `accounts` | Comptes joueurs optionnels (pseudo, mot de passe **haché/salé**, XP, stats) |
| `friendships` | Relations d'amitié entre comptes |
| `achievements` | Succès débloqués par compte |
| `card_stats` | Taux d'usage/victoire par carte (alimente le classement admin) |
| `admins` | Comptes admin du panel (email, mot de passe haché, rôle `superadmin`/`moderator`) |
| `admin_audit_log` | Journal de toutes les actions admin (traçabilité) |
| `app_settings` | Réglages globaux (ex. longueur max des réponses, réglable par curseur) |
| `practice_scenarios` | Cartes + réponses fixes des bots pour le tutoriel/démo (éditable admin) |
| `activity_log` | Journal technique (IP + pseudo + horodatage) — **purge automatique après 12 mois** |
| `site_stats` | Compteurs globaux (visites totales, parties jouées totales) |

**Important** : `data/app.db` n'est **pas versionné** (dans `.gitignore`) — il contient des données réelles d'utilisateurs (mots de passe hachés, IP), pas juste du code. Il se régénère automatiquement au premier lancement (`CREATE TABLE IF NOT EXISTS`).

---

## 🃏 Format des cartes

Chaque pack est un fichier JSON dans `data/*.json` (un tableau d'objets) :

```json
[
  { "text": "Le pire cadeau à offrir à ______, c'est ______.", "blanks": 2 },
  { "text": "______ pense que ______ devrait être interdit à ______.", "blanks": 3 }
]
```

- **`text`** : le texte de la carte. Le trou est représenté par exactement **6 underscores** : `______`.
- Les trous peuvent être **n'importe où dans la phrase** (début, milieu, fin) — le moteur ne fait aucune hypothèse de position, il découpe le texte sur le token et recolle les réponses dans l'ordre (`server/cardManager.js` → `parseCard` / `fillCard`).
- **1 à 3 trous maximum** par carte (au-delà, la carte est ignorée au chargement).
- **`blanks`** : purement informatif/sanity-check (juste comparé au nombre réel de `______` trouvés, avec un warning si incohérent) — le nombre réel de trous vient **toujours** du texte.
- **Mention d'un joueur** : une carte peut contenir le token `{user}` (ex. `"...pour la mère de {user}."`). Au moment où le juge valide la carte, il doit désigner **qui** parmi les autres joueurs est visé — le token est alors remplacé par le pseudo choisi, pour tout le monde, pour le reste de la manche.
- Un fichier édité à la main avec une erreur de format (pas de `______`, doublon exact, plus de 3 trous) voit l'entrée fautive **silencieusement ignorée** au chargement (avec un `console.warn` côté serveur) — elle n'apparaît jamais en jeu, mais ne fait pas planter le serveur.

**Packs existants :** `normal`, `spicy`, `halloween`, `noel`, `ete`, `community` (alimenté par les joueurs, modéré), `adult` (`-18`, réservé aux adultes) et `adults` (`-18 Vol.2`, second pack adulte indépendant). Les packs `ageRestricted: true` nécessitent une **certification d'âge explicite** (case à cocher, pas de vérification d'identité) avant activation — voir [Légal](#️-légal--conformité).

---

## 🔌 Événements Socket.IO

Tous enregistrés dans `server.js`, chaque handler suit le pattern `withAck` (try/catch systématique + réponse `{ ok: boolean, ... }` via callback). Catégories principales :

- **Partie** : `createGame`, `createPracticeGame`, `checkNickname`, `joinGame`, `reconnectPlayer`, `updateSettings`, `kickPlayer`, `stopGame`, `startGame`, `leaveGame`
- **Manche** : `rerollCard`, `confirmCard`, `submitAnswer`, `submitVote`, `playAgain`
- **Social** : `chatSend`, `sendReaction`, `submitCommunityCard`, `reportCard`, `listPublicGames`
- **Compte joueur** : `accountRegister`, `accountLogin`, `accountResumeSession`, `accountLogout`, `accountDeleteAccount`, `accountGetProfile`, `accountSendFriendRequest`, `accountRespondFriendRequest`, `accountRemoveFriend`, `accountListFriends`
- **Admin** (préfixe `admin*`) : auth (`adminLogin`/`adminLogout`/`adminWhoAmI`), gestion parties, éditeur de cartes, modération communauté/signalements, bannissements, gestion admins, journaux, stats globales, scénarios pratique — voir `server/adminManager.js`

**Diffusion d'état** : à chaque changement, le serveur appelle `broadcastState(game)` qui envoie `gameState` (broadcast à toute la room Socket.IO du code de partie) puis `privateState` individuellement à chaque socket concerné.

---

## 👑 Panel admin

Page indépendante (`public/admin.html` + `public/js/admin.js`), authentification séparée du jeu (table `admins`, sessions en mémoire avec TTL, rate-limiting anti-bruteforce sur le login par IP). Deux rôles : `superadmin` (accès total, y compris gestion des autres admins et réglages sensibles) et `moderator`.

Onglets disponibles :
- **📊 Dashboard** — parties en cours en temps réel, actions (forcer une carte, rejoindre, pause, arrêt, suppression)
- **📈 Statistiques** — parties jouées, joueurs en ligne, visites totales, comptes créés, liste de tous les pseudos vus, graphique des cartes les plus gagnantes
- **🃏 Éditeur de cartes** — CRUD complet par pack, import/export JSON
- **👥 Communauté** — modération des cartes proposées par les joueurs (validation/refus)
- **🚩 Signalements** — cartes signalées par les joueurs
- **🚫 Comptes bannis** — gestion des bannissements
- **📜 Journal admin** — audit trail de toutes les actions admin
- **🕵️ Journal joueurs** — activité (créations/jonctions de partie), géolocalisation IP **à la demande uniquement** (jamais en arrière-plan)
- **🤖 Bots tuto/démo** — configuration des cartes et réponses fixes du mode pratique
- **🛡️ Administrateurs** (superadmin uniquement) — gestion des comptes admin, curseur de longueur max des réponses (100–800 caractères)

Le tout premier compte admin est créé automatiquement au démarrage depuis `ADMIN_EMAIL`/`ADMIN_PASSWORD` du `.env` (`server/adminBootstrap.js`).

---

## 🎓 Mode pratique (tutoriel / démo)

Partie **solo contre 2 bots** (Zoé et Max), entièrement **déterministe** : cartes et réponses des bots fixées à l'avance (pas de hasard), configurables depuis le panel admin (`practice_scenarios` en DB). Deux variantes :
- **🎓 Tutoriel guidé** : bulles d'explication à chaque étape (`public/js/tutorialtips.js`).
- **🤖 Partie démo** : même déroulé, sans les explications.

But : permettre de découvrir le jeu sans dépendre d'autres joueurs réels, avec un résultat toujours cohérent pour la démonstration.

---

## 📱 Mobile & PWA

- **Mobile-first** : tout le CSS est pensé pour petit écran d'abord, avec breakpoints `@media (max-width: 480px)` / `420px` / `400px` pour les cas les plus étroits (barre du haut, mini-classement flottant, bulles de tutoriel).
- **Installable** (`manifest.json` + `sw.js`) : peut être ajoutée à l'écran d'accueil comme une vraie app.
- **Cache-busting automatique** : chaque script/style reçoit `?v=<timestamp de démarrage serveur>` (voir `injectCacheBust` dans `server.js`), et le client compare périodiquement `/api/version` pour forcer un rechargement complet si le serveur a redémarré avec du nouveau code — même dans un PWA resté ouvert plusieurs jours.

---

## ⚖️ Légal & conformité

Tout est centralisé dans **[`public/legal.html`](public/legal.html)** (accessible en ligne à `/legal.html`), en trois sections :

1. **Charte d'utilisation** — esprit du jeu (humour/second degré assumé), ce que le jeu n'est *pas* (harcèlement, haine, propagande — explicitement exclus), responsabilité de chaque joueur pour son propre contenu, clause spécifique cartes 18+.
2. **CGU** — objet, éditeur (⚠️ champs à compléter avant mise en ligne publique, voir plus bas), description du service, âge/capacité, comportement, contenu communautaire, comptes, propriété intellectuelle, **responsabilité et limitation**, modération, données personnelles, droit applicable.
3. **Politique de confidentialité** — quelles données sont collectées (pseudo, IP, compte) et **pourquoi** : *exclusivement* à des fins de sécurité (détection d'injections SQL, tentatives de piratage, abus) — jamais revendues, jamais exploitées commercialement. Durée de conservation, droits RGPD, transfert hors UE (hébergeur US).

**Mécanismes appliqués dans le code** :
- 🚪 **Porte d'entrée bloquante** au tout premier lancement : acceptation obligatoire Charte + CGU avant tout accès (`legalGateModal` dans `public/js/ui.js`, versionnée via `LEGAL_VERSION` dans `public/app.js`).
- 🔞 **Certification d'âge** avant d'activer un pack 18+ (créateur de partie **et** joueur qui rejoint une partie qui en contient déjà un) — déclaratif, pas de vérification d'identité, l'utilisateur assume la responsabilité d'une fausse déclaration.
- 🎂 **Déclaration 15 ans ou plus** obligatoire à la création d'un compte (majorité numérique RGPD en France).
- 🗑️ **Droit à l'effacement** : bouton "Supprimer mon compte définitivement" dans le profil (suppression immédiate et complète — compte, amis, succès, sessions).
- 🧹 **Purge automatique** du journal d'activité après 12 mois (`server/logRetention.js`, tâche quotidienne).

**⚠️ Avant tout déploiement commercial**, il reste à compléter dans `legal.html` : raison sociale, SIRET, adresse, e-mail de contact, directeur de publication (obligatoire légalement en France — LCEN art. 6-III). Une relecture par un professionnel du droit est recommandée vu la vocation lucrative du projet.

---

## 🚀 Installation & lancement

**Prérequis** : Node.js ≥ 18 (le module natif `node:sqlite` nécessite Node ≥ 22 en pratique).

```bash
git clone <ce repo>
cd blanc-manger
npm install
```

Créer un fichier `.env` à la racine (déjà présent dans ce repo pour référence — à ne jamais rendre public en dehors d'un dépôt privé) :

```env
PORT=1563
ADMIN_EMAIL=ton-email@exemple.com
ADMIN_PASSWORD=un-mot-de-passe-fort   # utilisé UNE FOIS au tout premier démarrage pour créer le compte admin, peut être retiré ensuite
VAPID_PUBLIC_KEY=...                  # notifications push, généré via `npx web-push generate-vapid-keys`
VAPID_PRIVATE_KEY=...
```

Lancer :

```bash
npm start
```

Le jeu est accessible sur `http://localhost:1563/`, le panel admin sur `http://localhost:1563/admin.html`.

**⚠️ Important** : les packs de cartes (`data/*.json`) et les scénarios pratique sont chargés **en mémoire au démarrage** — toute modification manuelle d'un fichier JSON de cartes nécessite un **redémarrage du serveur** pour être prise en compte en jeu.

---

## ☁️ Déploiement (Replit)

Hébergement prévu sur [Replit](https://replit.com). Points d'attention critiques pour l'agent/l'IA qui configure le déploiement :

- **Persistance obligatoire** : `data/app.db` (SQLite) et `data/*.json` doivent survivre aux redémarrages/redéploiements. Utiliser un déploiement **Reserved VM** (pas *Autoscale*, qui peut faire tourner plusieurs instances éphémères sans disque partagé et corromprait/perdrait la base).
- Le serveur respecte déjà `process.env.PORT` — ne rien forcer en dur.
- Commande de démarrage : `npm start`.
- **Secrets à configurer** dans l'outil Secrets de Replit (jamais en dur dans le code) : `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
- Endpoint de santé pour monitoring : `GET /health` → `{"ok": true, "uptime": ...}`.

---

## 🧪 Comment tester

Pas de suite de tests automatisés (`npm test`) à ce jour. Vérifications utilisées pendant le développement :

- **Syntaxe** : `node --check <fichier>` sur chaque fichier JS modifié (serveur ET client — vanilla JS, aucun transpileur).
- **Chargement croisé** : `node -e "require('./server/xxx')"` pour chaque module serveur, afin d'attraper les erreurs de `require` entre modules.
- **Cartes** : charger via `cardManager.getPackMeta()` pour vérifier qu'aucun pack ne plante et obtenir le compte réel de cartes valides par pack (les entrées invalides sont silencieusement ignorées avec un `console.warn`, jamais une crash).
- **Bout en bout** : tests manuels via navigateur réel (Chrome/Firefox) et [Playwright](https://playwright.dev/) avec émulation mobile (`iPhone 13`) pour vérifier le rendu responsive en situation de partie réelle (pas juste la page d'accueil).
- **CSS** : vérification d'équilibre des accolades (`{` / `}`) après chaque édition de `style.css`/`admin.css`, avant de considérer la modif propre.

---

## 🗺️ Historique / décisions notables

Quelques choix qui ne sont pas évidents en lisant juste le code :

- **`node:sqlite`** (module natif Node) plutôt que `better-sqlite3` ou un ORM : zéro dépendance native à compiler, déploiement plus simple.
- **Pas de framework front** : projet volontairement simple, un seul `node server.js` à lancer, pas de pipeline de build à maintenir.
- **`{user}` (mention de joueur dans une carte)** est résolu **côté serveur**, jamais côté client, et **avant** que la carte ne soit diffusée à tout le monde (sinon les autres joueurs verraient le token brut le temps que le juge choisisse) — le client affiche un placeholder `🎯 ???` en attendant.
- **Snapshot des réglages à la création de partie** (ex. longueur max des réponses) : un changement de réglage global par l'admin n'affecte que les **nouvelles** parties, jamais celles déjà en cours — évite de casser une partie en cours de route.
- **`pointer-events: none` sur les bulles de tutoriel** : le texte des bulles ne doit jamais bloquer les clics sur le bouton en dessous (bug réel rencontré : bulle qui grossit sur petit écran et avale les clics du CTA principal).
- **Cache-busting agressif** (`?v=timestamp` + comparaison `/api/version` côté client) : nécessaire car le jeu est installable en PWA et peut rester ouvert plusieurs jours sans recharger naturellement — sans ça, un déploiement de nouveau code ne serait jamais vu par un client PWA déjà ouvert.
