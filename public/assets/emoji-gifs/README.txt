Dossier pour les GIFs qui REMPLACENT DES EMOJIS DE L'INTERFACE.

⚠️ ATTENTION : PAS les avatars des joueurs. C'est un système totalement
séparé — les avatars GIF se déposent dans
public/assets/avatars/gif/ (ou s'uploadent depuis le panel admin, onglet
"Avatars GIF").

Comment ça marche :
1. Dépose ton GIF ici (n'importe quel nom de fichier, ex. manette.gif).
2. Ouvre le fichier .env à la racine du projet : il contient la liste
   complète de TOUS les emojis utilisés dans le site (générée
   automatiquement en scannant tout le code), chacun en commentaire avec
   sa variable EMOJI_xxxxx correspondante.
3. Repère la ligne du bon emoji (ex. "# 🎮  EMOJI_1f3ae=") et décommente-la
   en renseignant le chemin vers ton GIF :
     EMOJI_1f3ae=assets/emoji-gifs/manette.gif
4. Redémarre le serveur. Partout où 🎮 apparaissait dans l'appli (boutons,
   titres, menu admin...), le GIF s'affiche à la place, en boucle.

Variable vide ou absente = l'emoji d'origine reste affiché, rien ne change.

Aucune limite de taille imposée côté code, mais reste raisonnable pour ne
pas ralentir le chargement.
