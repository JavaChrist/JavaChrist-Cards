# JavaChrist Cards

Application indépendante de création de cartes de visite numériques. À déployer sur votre compte Vercel, avec votre projet Supabase. Les visiteurs des cartes publiques n'ont besoin ni de compte ni de ChatGPT.

## Fonctionnalités incluses

- Inscription par e-mail et mot de passe, confirmation d'e-mail, connexion, déconnexion et réinitialisation du mot de passe.
- Plusieurs cartes par compte, création, édition, suppression et brouillon/public.
- Éditeur avec aperçu mobile : identité, activité, coordonnées, adresse, site, LinkedIn, GitHub, avatar, logo et couleur d'accent.
- Stockage durable dans Supabase et images dans un bucket privé, avec règles par propriétaire.
- Pages publiques `/c/IDENTIFIANT` sans authentification dans l'application.
- QR généré dans le navigateur, export PNG et SVG. Aucun générateur externe, aucun QR lié à ChatGPT.
- Lien stable : les changements de coordonnées ne changent pas l'identifiant ni le QR. Le domaine doit rester identique.
- Fichier vCard pour enregistrer le contact ; partage natif lorsque le navigateur le permet.
- Import/export des coordonnées en JSON. Aucun paiement ni abonnement implémenté.

Le nom JavaChrist Cards est modifiable. L'apparence anthracite/orange reprend la carte initiale. Chaque carte peut avoir sa propre couleur, photo et logo.

## Installation Supabase

1. Créer un **nouveau projet Supabase dédié**. Le code ne se connecte à aucun projet existant par défaut.
2. Exécuter `supabase/schema.sql` une fois dans son SQL Editor. La migration est transactionnelle ; elle crée `cards`, le bucket privé `card-images`, les règles RLS et un garde-fou empêchant de changer le propriétaire ou l'identifiant d'une carte.
3. Dans Authentication, activer e-mail/mot de passe et la confirmation d'e-mail. Définir une longueur minimale de mot de passe de 12 caractères côté Supabase aussi.
4. Configurer un SMTP pour les e-mails d'inscription et de récupération destinés au public. Le service d'e-mail de test de Supabase peut limiter les destinataires et les envois.
5. Dans les paramètres API du projet, récupérer l'URL et la **clé publishable** (ou ancienne clé publique anon). Ne jamais utiliser de clé secret/service_role dans le navigateur ou une variable VITE.

## Développement local

Node.js 22.12 minimum recommandé (ou version LTS plus récente compatible).

```powershell
npm ci
Copy-Item .env.example .env.local
```

Renseigner `.env.local` :

```dotenv
VITE_SUPABASE_URL=https://VOTRE-PROJET.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=VOTRE-CLE-PUBLIQUE
VITE_PUBLIC_APP_URL=http://localhost:5173
```

Ajouter `http://localhost:5173/app` et `http://localhost:5173/reset-password` dans les URL de redirection autorisées de Supabase Auth.

```powershell
npm run dev
```

## Déployer sur votre Vercel

1. Décompresser le projet et mettre le **contenu du dossier `javachrist-cards`** dans un nouveau dépôt GitHub privé de votre choix. Ne pas ajouter `.env.local`, `node_modules` ou `dist`.
2. Vercel → Add New → Project → importer ce dépôt. Framework **Vite**, Build `npm run build`, Output `dist`. `vercel.json` est fourni.
3. Ajouter les deux variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` pour la production. Déployer.
4. Noter le domaine **de production stable** (par exemple le domaine attribué par Vercel ou votre domaine personnalisé). Ne pas utiliser l'URL temporaire d'un déploiement pour imprimer les QR.
5. Ajouter `VITE_PUBLIC_APP_URL=https://VOTRE-DOMAINE-STABLE` puis redéployer. Sans cette variable, le QR utilise l'origine actuelle du navigateur.
6. Supabase Auth → URL Configuration : Site URL = ce domaine ; Redirect URLs = `https://VOTRE-DOMAINE-STABLE/app` et `https://VOTRE-DOMAINE-STABLE/reset-password`.
7. Vérifier que le domaine de production Vercel est accessible au public. Les protections des déploiements de prévisualisation peuvent rester actives. Aucune configuration ne désactive les protections d'autres projets.
8. Ouvrir une carte publiée depuis un navigateur privé, non connecté à Vercel, Supabase ou ChatGPT. Elle doit s'afficher sans connexion.

Les variables VITE sont intégrées lors du build : tout changement nécessite un redéploiement. Aucun secret serveur n'est requis par cette application.

## Créer la carte de Christian

1. Créer le compte avec `contact@javachrist.fr`, confirmer l'e-mail puis se connecter.
2. Créer une carte → Importer mes coordonnées → choisir `examples/Christian-Grohens.json`.
3. Ajouter `examples/Avatar-Christian.png` comme avatar et `examples/Logo-JavaChrist.png` comme logo.
4. Cocher la publication et enregistrer. Ouvrir la carte pour vérifier le résultat.
5. Télécharger son QR depuis le tableau de bord. Le lien peut aussi être écrit sur une carte ou un sticker NFC.

Les fichiers d'exemple ne sont pas copiés dans le site public par le build. Le logo de la plateforme, lui, est public.

## Vérifications

```powershell
npm test
npm run build
```

Six tests locaux couvrent les URL stables, les liens dangereux, l'encodage/folding vCard UTF-8, les données de profil mal typées, les validations et la génération SVG du QR. Le build a été vérifié lors de la livraison.

Les scénarios suivants doivent être validés **après connexion à Supabase** ; ils n'ont pas été exécutés sur un backend réel lors de la livraison :

- Inscription, réception des e-mails, confirmation, connexion, réinitialisation et déconnexion.
- Deux comptes A et B : B ne peut modifier, supprimer ni lire les brouillons de A, même via l'API.
- Sans connexion : la carte publiée de A et ses images sont visibles ; un brouillon ne l'est pas.
- Changement de coordonnées : même lien et même QR, nouveau contenu.
- Retrait de publication, suppression et import du contact sur iPhone/Android.

Les règles SQL sont incluses mais ne sont pas appliquées à un service distant par cette archive. L'application n'est pas encore déployée sur Vercel.

## Structure

- `src/main.jsx` : interfaces de compte, tableau de bord, éditeur et carte publique.
- `src/lib.js` : vCard, QR, URL et validation.
- `src/client.js` : client Supabase et URL des images.
- `src/style.css` : design responsive.
- `supabase/schema.sql` : base de données et sécurité.
- `tests/` : tests locaux.
- `examples/` : coordonnées et images pour créer la carte de Christian.

## Comportements à connaître

- Aucune collecte de contacts visiteurs, facturation, analytics ou offre commerciale n'est incluse. Ce sont des capacités distinctes d'un générateur de cartes.
- Le raccourci ajouté depuis une carte publique rouvre cette carte. Celui de l'espace de gestion rouvre `/app`. Le manifeste est résolu selon la page, sans cache hors ligne des données privées.
- Les images privées sont affichées à l'aide d'URL signées valables 120 secondes. Une URL déjà émise peut fonctionner jusqu'à expiration après dépublication. Une copie téléchargée par un visiteur ne peut pas être révoquée.
- La suppression d'une carte tente de nettoyer son dossier d'images. Des téléversements abandonnés avant enregistrement peuvent rester dans le bucket privé jusqu'à nettoyage par l'administrateur.
- Le QR donne accès à la page ; l'enregistrement du contact nécessite toujours une action de confirmation sur le téléphone.
- Avant une ouverture commerciale, ajouter vos informations d'éditeur et les documents de confidentialité adaptés à votre service.
