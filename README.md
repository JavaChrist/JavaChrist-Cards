# JavaChrist Cards

JavaChrist Cards permet de créer une carte de visite numérique, de la publier, puis de la faire consulter par un lien ou un QR code. La personne qui reçoit la carte peut l’enregistrer dans les contacts de son téléphone, sans créer de compte.

L’application s’adresse aux personnes qui veulent garder des coordonnées à jour, et aux personnes qui consultent une carte publiée. Plusieurs cartes peuvent exister sur un même compte. Aucun tarif ni aucune offre commerciale n’est prévu dans le code.

## Fonctionnalités

### Opérationnelles

- Compte par e-mail et mot de passe : inscription, confirmation d’e-mail, connexion, déconnexion, mot de passe oublié et choix d’un nouveau mot de passe. Le mot de passe se saisit avec un bouton pour l’afficher. L’inscription et le nouveau mot de passe demandent 12 caractères.
- Plusieurs cartes par compte : création, modification, suppression, brouillon ou publication.
- Éditeur avec aperçu : prénom, nom, entreprise, fonction, téléphone, e-mail, adresse, site, LinkedIn, GitHub, signature, présentation, photo, logo et couleur. Les images acceptées sont JPG, PNG ou WebP, jusqu’à 5 Mo.
- Import et export des coordonnées en JSON (`coordonnees.json`). Un exemple de coordonnées est fourni dans `examples/Christian-Grohens.json`. Les images d’exemple citées auparavant ne sont pas dans le dépôt.
- Page publique `/c/IDENTIFIANT`, lisible sans compte. Un brouillon n’est pas lisible. Le même identifiant reste valable quand les coordonnées changent.
- QR code produit dans le navigateur, avec copie du lien de la carte et téléchargement PNG ou SVG. Aucun service extérieur ne génère ce QR.
- Enregistrement du contact : la page publique propose un fichier `.vcf`. La photo de profil y est incluse lorsqu’elle peut être préparée. Le lien d’application placé dans ce fichier est l’accueil du site.
- Partage : le bouton Partager envoie l’adresse d’accueil du site. Le QR code et « Copier le lien » envoient, eux, l’adresse de la carte.
- Raccourci d’écran d’accueil : instructions pour iPhone, Android et ordinateur. Chrome peut proposer l’installation lorsqu’il le permet. Le raccourci ouvert depuis une carte publique rouvre cette carte ; celui de l’espace de gestion rouvre `/app`. Il n’y a pas de copie hors ligne.
- Mise à jour de l’application déjà ouverte : en production, une page encore chargée avec une ancienne construction propose « Une mise à jour est disponible ». Cela vient d’une nouvelle construction du site, pas d’un commit seul. En développement local, cette fenêtre n’apparaît pas. Une page ouverte après la construction charge déjà la nouvelle version.

### Partielles

- Apple Wallet : le pass est préparé et signé côté serveur, avec le QR de la carte. Le bouton est dans l’espace du propriétaire, sur une carte publiée. Il n’est pas affiché sur la page publique. Sans les variables Apple du serveur, le bouton indique que l’ajout n’est pas activé. L’activation sur le site publié reste à confirmer.
- E-mails : les modèles d’inscription, de mot de passe oublié, de lien magique, d’invitation, de changement d’e-mail et de mot de passe modifié sont dans `supabase/emails/`. L’application n’a pas d’écran pour le lien magique, l’invitation ou le changement d’e-mail. Ces trois modèles ne servent que si la fonction correspondante est activée dans Supabase.

### Absentes

Aucun paiement, aucun abonnement, aucune statistique de visite, aucune collecte des personnes qui consultent une carte, et aucune lecture NFC ne sont implémentés.

## Stack

- Interface : React 19, construite avec Vite 8.
- Données et comptes : Supabase (table `cards`, stockage privé `card-images`, authentification).
- Hébergement prévu : Vercel (`vercel.json`).
- QR code : bibliothèque locale `qrcode-generator`.
- Contact : fichier vCard préparé par une fonction du site. La photo est réduite en JPEG avec `sharp`.
- Apple Wallet : `passkit-generator`, uniquement sur le serveur.

## Installation locale

Node.js doit être compatible avec Vite 8.

```powershell
npm ci
Copy-Item .env.example .env.local
```

Renseigner `.env.local` avec les noms suivants, sans commiter ce fichier :

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_PUBLIC_APP_URL=http://localhost:5173
```

`VITE_SUPABASE_PUBLISHABLE_KEY` est la clé publique du projet Supabase. Ne pas y placer de clé secrète.

```powershell
npm run dev
```

L’application écoute alors sur le réseau local, port 5173.

## Configuration Supabase

1. Créer un projet Supabase dédié.
2. Exécuter une fois `supabase/schema.sql` dans l’éditeur SQL. Le script crée la table `cards`, le dossier privé `card-images` et les règles d’accès : un propriétaire gère ses cartes ; une carte publiée et ses images sont lisibles sans compte ; un brouillon ne l’est pas.
3. Activer la connexion par e-mail et mot de passe. La confirmation d’e-mail est utilisée par l’inscription.
4. Autoriser les adresses de retour `http://localhost:5173/app` et `http://localhost:5173/reset-password`.
5. Pour les e-mails publics, configurer un envoi SMTP. Les modèles HTML sont dans `supabase/emails/`. Le sujet est indiqué en commentaire en tête de chaque fichier. `npm run emails` régénère ces fichiers à partir de `supabase/emails/javachrist-cards.json`.

| Fichier | Usage |
| --- | --- |
| `confirmation.html` | Confirmation d’inscription |
| `reset-password.html` | Lien de nouveau mot de passe |
| `magic-link.html` | Modèle seulement, pas d’écran dans l’application |
| `invite.html` | Modèle seulement, pas d’écran dans l’application |
| `change-email.html` | Modèle seulement, pas d’écran dans l’application |
| `password-changed.html` | Avertissement de mot de passe modifié, si Supabase l’envoie |

## Apple Wallet

Variables du serveur uniquement. Ne pas les préfixer par `VITE_` et ne pas les placer dans le code du navigateur :

```dotenv
APPLE_PASS_TYPE_ID=
APPLE_TEAM_ID=
APPLE_PASS_CERT_PEM=
APPLE_PASS_KEY_PEM=
APPLE_PASS_KEY_PASSPHRASE=
APPLE_WWDR_PEM=
```

Le certificat et la clé peuvent être fournis en PEM. `APPLE_WWDR_PEM` peut rester vide : un certificat intermédiaire Apple public est déjà inclus et choisi selon le certificat de signature. Aucun certificat privé n’est enregistré dans le dépôt.

## Pages

| Adresse | Contenu |
| --- | --- |
| `/` | Connexion, ou l’espace des cartes si une session existe |
| `/auth` | Connexion et inscription |
| `/app` | Espace des cartes une fois connecté |
| `/forgot-password` | Demande du lien de mot de passe |
| `/reset-password` | Enregistrement du nouveau mot de passe |
| `/c/IDENTIFIANT` | Carte publique |
| `/c/IDENTIFIANT/contact.vcf` | Fichier de contact de cette carte |

## Mise en ligne

Le fichier `vercel.json` prévoit une construction Vite, le dossier `dist`, les pages ci-dessus et les fichiers de contact et de Wallet. Les variables `VITE_` sont figées au moment de la construction : un changement demande une nouvelle construction.

L’adresse écrite dans le projet est `https://java-christ-cards.vercel.app/`. Cette adresse a répondu au moment de la rédaction de ce document. `VITE_PUBLIC_APP_URL` doit reprendre l’adresse publique stable, car les QR l’utilisent. Sans elle, le QR reprend l’adresse du navigateur au moment de la construction affichée.

Dans Supabase, l’adresse du site et les retours doivent inclure l’accueil, `/app` et `/reset-password` de cette même adresse.

## Commandes

```powershell
npm test
npm run build
npm run preview
npm run emails
```

`npm test` exécute les tests locaux du dossier `tests/` : liens, contact, partage, QR, mise à jour et Wallet. Ils ne remplacent pas un essai sur téléphone.

## Structure

- `src/main.jsx` : comptes, cartes, éditeur, page publique, installation et mise à jour.
- `src/lib.js` : validation, QR, partage, vCard et adresses.
- `src/client.js` : connexion Supabase et images.
- `src/update.js` : comparaison de version.
- `src/wallet.js` et `server/wallet.js` : contenu et signature du pass.
- `server/contact.js` : fichier de contact et photo.
- `supabase/schema.sql` : table, stockage et règles d’accès.
- `supabase/emails/` : modèles d’e-mails.
- `examples/Christian-Grohens.json` : exemple de coordonnées à importer.

## À savoir

- Les images affichées sur la carte passent par une adresse temporaire d’environ 120 secondes. Une image déjà téléchargée par un visiteur ne peut pas être retirée.
- Supprimer une carte retire aussi son dossier d’images lorsque le nettoyage aboutit. Un envoi d’image abandonné avant l’enregistrement peut rester dans le stockage privé.
- Le QR ouvre la page de la carte. L’ajout du contact demande encore une confirmation sur le téléphone.
- Aucun document de confidentialité n’est inclus dans l’application.
