<!-- Texte de /privacy. Les blancs « [À COMPLÉTER : …] » et « [À DÉCIDER : …] » sont surlignés sur la page. -->

# Politique de confidentialité

Dernière mise à jour : [À COMPLÉTER : date de publication]

Cette page explique quelles données Qreativ (qreativ.app) collecte, pourquoi, avec qui elles sont partagées, combien de temps elles sont gardées, et ce que vous pouvez faire.

## En bref

- Nous gardons votre compte, vos consignes, vos fichiers, vos créations et vos paiements (dont votre numéro Mobile Money).
- Vos fichiers et consignes sont envoyés à des prestataires d'IA pour réaliser vos créations.
- Vos fichiers (importés ou créés) s'ouvrent avec leur seul lien, sans connexion.
- Aujourd'hui, nous n'effaçons pas automatiquement vos données, et il n'existe pas encore de suppression de compte en un clic.
- Nous ne gardons pas votre adresse IP dans notre base de données.
- Nos statistiques ne contiennent pas vos consignes : un clic n'enregistre ni le texte ni les attributs de l'élément cliqué (voir section 9).

---

## 1. Qui est responsable de vos données

- Responsable : PROGICIEL LABS SARL unipersonnelle, 11 BP 160 CMS Ouagadougou 11, Burkina Faso (RCCM BF-OUA-01-2026-B13-09646)
- Contact pour vos données : [cindy@progiciellabs.xyz](mailto:cindy@progiciellabs.xyz), +226 78 82 27 09
- Déléguée à la protection des données : Cindy OUEDRAOGO

[À COMPLÉTER : formalités auprès de l'autorité de protection des données compétente (au Burkina Faso, la CIL), si elles sont nécessaires].

---

## 2. Les données que nous collectons

| Catégorie | Ce que c'est | Où c'est gardé |
|---|---|---|
| Compte | Identifiant de compte, e-mail, nom, adresse de votre photo de profil, date d'inscription, date de dernière visite | Clerk (connexion) et notre base chez Cloudflare |
| Pays | Pays de votre première connexion, déduit par Cloudflare (code pays seulement) | Notre base chez Cloudflare |
| Fichiers pour une création | Photos (y compris de visages), voix, sons, vidéos que vous envoyez pour une création, avec le nom du fichier | Chez fal (stockage de fichiers) ; leur durée et leur taille sont gardées dans le stockage de votre compte chez Cloudflare |
| Fichiers de « Ma bibliothèque » | Fichiers que vous importez dans votre bibliothèque, avec le nom du fichier, et le logo de votre kit de marque | Notre stockage et notre base chez Cloudflare |
| Consignes et réglages | Texte de vos consignes, réglages choisis, style choisi, phrase de style de votre marque, nom et offre de votre marque dans Spot | Notre base chez Cloudflare ; envoyés aux prestataires d'IA |
| Texte à « Améliorer » | Le texte que vous demandez de réécrire | Envoyé à fal (puis OpenRouter / Google Gemini) ; non gardé par nous |
| Créations | Images, vidéos et sons produits | Notre stockage chez Cloudflare ; copie chez le prestataire d'IA |
| Historique | Pour chaque création : modèle, statut, coût, dates, identifiant chez le prestataire, raison d'un échec, remboursement | Notre base chez Cloudflare |
| Favoris | Les éléments que vous marquez comme favoris | Notre base chez Cloudflare et votre navigateur |
| Paiements | Référence, pack, montant, pays, opérateur, **numéro de téléphone Mobile Money**, statut, identifiant chez la passerelle | Notre base chez Cloudflare et la passerelle de paiement |
| Solde | Solde de cauris et opérations (débits, remboursements, recharges) | Notre base chez Cloudflare |
| Stockage de votre compte | Solde, créations (consignes, liens des résultats), recharges (avec numéro de téléphone), durée et taille des fichiers envoyés | Espace de stockage propre à votre compte chez Cloudflare (Durable Object) |
| Administration | Blocages de compte, actions de notre équipe (remboursements, corrections de solde, annulations) avec leur motif | Notre base chez Cloudflare |
| Statistiques d'usage | Pages vues (adresse sans ses paramètres), clics (type et place de l'élément cliqué, sans son texte ni ses attributs ; aucun sur les pages d'administration), événements (type de création, modèle, coût, réussite ou échec), type d'appareil et de navigateur, taille d'écran, page d'origine (sans ses paramètres), localisation approximative (pays, ville) déduite par PostHog, identifiant anonyme stocké dans un cookie, identifiant de compte | PostHog (serveurs dans l'Union européenne) |
| Rapports d'erreurs | Messages d'erreur, identifiant de compte, extraits de messages d'erreur des prestataires (sans les champs qui reprennent votre consigne, numéros de téléphone masqués), adresses techniques sans leurs paramètres | Sentry (si activé) |
| Journaux techniques | Adresses des requêtes (qui peuvent contenir votre identifiant de compte, par exemple l'adresse d'un fichier), messages d'erreur (numéros de téléphone masqués dans ceux des prestataires), identifiant de compte | Journaux Cloudflare |
| Données dans votre navigateur | Kit de marque (sauf le logo), préférences d'affichage, copie locale de la bibliothèque | Votre appareil |

**À propos de l'e-mail, du nom et de la photo :** nous les recevons de Clerk seulement si Clerk est réglé pour nous les transmettre. [À COMPLÉTER : confirmer que ce réglage est actif en production].

**Journaux techniques.** [À COMPLÉTER : vérifier dans le tableau de bord Cloudflare ce que gardent les journaux d'appels (adresse IP, localisation)]. Votre numéro de téléphone (pour une recharge) et le texte d'une recherche de notre équipe partent dans le corps de la requête, pas dans son adresse : les journaux qui gardent les adresses ne les voient pas. Une page du site ouverte avant cette mise à jour peut encore les mettre dans l'adresse, au plus tard jusqu'au 31 décembre 2026.

**Le code Orange Money** (code à usage unique) est transmis à la passerelle de paiement. Nous ne le gardons pas.

**Ce que nous ne faisons pas :**

- Nous ne gardons pas votre adresse IP dans notre base de données. Elle est vue par Cloudflare, par les services chargés dans votre navigateur (Clerk, PostHog, Google Fonts), et par un prestataire d'IA quand votre navigateur télécharge un résultat directement chez lui (voir section 10).
- Nous n'analysons pas les visages ni les voix pour vous identifier.
- Nous n'enregistrons pas vos sessions à l'écran.

**Votre identifiant de compte.** Pour suivre une création, fal reçoit une adresse de rappel avec un jeton chiffré, qui ne montre pas votre compte. Les adresses de vos fichiers, elles, contiennent l'identifiant technique de votre compte : une personne à qui vous donnez un lien le voit.

---

## 3. Pourquoi nous utilisons vos données, et sur quelle base

| Pourquoi | Base légale |
|---|---|
| Vous connecter et gérer votre compte | Exécution du contrat (nos conditions) |
| Réaliser vos créations, les stocker, vous les montrer | Exécution du contrat |
| Encaisser vos recharges et tenir votre solde | Exécution du contrat ; [À COMPLÉTER : obligations comptables ou fiscales applicables] |
| Assistance, remboursements, corrections | Exécution du contrat |
| Prévenir les abus et bloquer un compte si nécessaire | Intérêt légitime (sécurité du service) |
| Corriger les erreurs techniques | Intérêt légitime |
| Mesurer l'usage pour améliorer le service | [À DÉCIDER : consentement ou intérêt légitime ; aujourd'hui aucun bandeau ne demande votre accord] |

**Photos et voix d'autres personnes.** Si vous envoyez la photo ou la voix de quelqu'un d'autre, vous devez avoir son accord (voir nos conditions d'utilisation).

[À COMPLÉTER : vérifier ces bases légales avec la loi applicable, par exemple la loi burkinabè sur la protection des données personnelles].

---

## 4. Qui reçoit vos données

Nous partageons vos données uniquement avec les prestataires ci-dessous, pour faire fonctionner le service.

**Hébergement**

- **Cloudflare** : héberge le site, notre serveur, nos bases, nos fichiers et nos journaux techniques. Reçoit tout ce qui passe par le service.

**Connexion**

- **Clerk** : inscription, connexion et sécurité des sessions (e-mail, nom, photo, adresse IP, appareil et navigateur). [À COMPLÉTER : moyens de connexion actifs en production (par exemple Google ou Apple) ; le service d'identité choisi reçoit alors aussi des données]. [À COMPLÉTER : confirmer si la protection anti-robots de Clerk (par exemple Cloudflare Turnstile) est active].

**Intelligence artificielle**

- **fal** : reçoit les fichiers que vous envoyez pour une création (pour tous les modèles) avec leur nom, vos consignes et réglages, le texte à « Améliorer », et une adresse de rappel (un jeton chiffré, sans l'identifiant de votre compte).
- **Modèles servis via fal** : par exemple Kling, ByteDance Seedance, Alibaba Wan, Black Forest Labs Flux, MiniMax, Lightricks LTX, Google, Krea, ElevenLabs, Stability, FASHN, Bria, Qwen, Topaz, VEED.
- **OpenRouter et Google Gemini** (via fal) : le texte à « Améliorer ».
- **Runware** : consignes, réglages et liens vers vos fichiers, pour les modèles Seedance 2.5, Kling 3.0 et Veo 3.1 Lite.
- **Higgsfield** : consignes, photos et vidéos, pour les modèles Soul, Cinema Studio et Genjutsu.

**Paiement**

- **Notre passerelle de paiement** [À COMPLÉTER : nom légal et pays de la passerelle de paiement] : référence, montant, opérateur, numéro de téléphone, code Orange, identifiant de compte et pack.
- **Opérateurs Mobile Money** (Orange, Moov, et Wave dans certains pays) : via la passerelle.

**Mesure et erreurs**

- **PostHog** (serveurs dans l'Union européenne) : statistiques d'usage (voir section 9).
- **Sentry** : rapports d'erreurs, avec votre identifiant de compte. Nous retirons les jetons de connexion, les cookies, le corps des requêtes, les paramètres des adresses et les messages de la console. Un rapport peut contenir un extrait de message d'erreur d'un prestataire : nous en retirons les champs qui reprennent votre consigne et masquons les numéros de téléphone.

**Autres**

- **Google Fonts** : votre navigateur télécharge nos polices chez Google.
- **WhatsApp** : seulement si vous cliquez sur un lien de contact WhatsApp.

**Notre équipe.** Les administrateurs peuvent voir, pour tous les comptes, les profils (e-mail, nom, photo, pays), les recharges avec numéros de téléphone, les créations récentes avec leurs consignes et résultats, et l'historique des soldes ; ils peuvent rechercher un compte par numéro de téléphone. Ils s'en servent pour l'assistance, la facturation et la sécurité. Les personnes qui gèrent notre compte Cloudflare peuvent aussi lire directement notre base et nos fichiers.

---

## 5. Données envoyées hors de votre pays

Nos prestataires sont établis hors de votre pays. Cloudflare, Inc. est une société américaine avec des serveurs dans le monde entier. PostHog traite nos statistiques dans l'Union européenne.

[À COMPLÉTER : pays où Clerk, fal, Runware, Higgsfield, Sentry et la passerelle de paiement hébergent les données].

[À COMPLÉTER : garanties prévues pour ces transferts (contrats, clauses) et formalités auprès de l'autorité de protection des données].

---

## 6. Combien de temps nous gardons vos données

Aujourd'hui, **aucune suppression automatique** n'est en place. Les durées ci-dessous restent à fixer.

- **Compte** : [À DÉCIDER : durée de conservation après la dernière connexion ou après fermeture du compte]
- **Consignes et historique des créations** : [À DÉCIDER : durée de conservation de l'historique et des consignes]
- **Fichiers de « Ma bibliothèque »** : jusqu'à ce que vous les supprimiez. [À DÉCIDER : durée maximale de conservation des fichiers de bibliothèque]
- **Paiements, numéros de téléphone et solde** : [À DÉCIDER : durée de conservation des paiements, numéros et solde, en tenant compte des obligations comptables]
- **Gestes et blocages de notre équipe** : [À DÉCIDER : durée de conservation du journal d'administration]
- **Journaux techniques Cloudflare** : [À COMPLÉTER : durée réglée chez Cloudflare]
- **Fichiers chez fal** (envoyés pour une création, ou résultats avant copie) : nous ne les supprimons pas. [À COMPLÉTER : durée de conservation chez fal]
- **Données chez Runware et Higgsfield** : [À COMPLÉTER : durée de conservation chez Runware et chez Higgsfield]
- **Statistiques PostHog** : [À COMPLÉTER : durée de conservation réglée chez PostHog]
- **Erreurs Sentry** : [À COMPLÉTER : durée de conservation réglée chez Sentry]
- **Votre navigateur** : jusqu'à ce que vous effaciez les données du site, que vous vous déconnectiez ou qu'un autre compte se connecte (voir section 7).

---

## 7. Ce que la suppression efface vraiment

**Quand vous supprimez un fichier de « Ma bibliothèque » :**

- nous effaçons le fichier de notre stockage (sauf si le même fichier sert encore à un autre élément visible de votre bibliothèque) ; si un incident l'empêche, il est effacé lors d'une nouvelle demande de suppression. [À DÉCIDER : ajouter un nettoyage automatique des fichiers dont l'effacement a échoué] ;
- il disparaît de votre bibliothèque et de vos favoris.

**Ce qui reste malgré tout :**

- une trace de l'élément supprimé dans notre base, avec son nom et sa consigne ;
- l'historique de la création : consigne, réglages et lien du fichier ;
- les copies chez les prestataires d'IA (fal, Runware, Higgsfield), y compris les photos et voix que vous avez envoyées pour la création ;
- les copies en cache : nos fichiers peuvent être gardés jusqu'à un an par les navigateurs et les réseaux de diffusion. Un lien déjà ouvert peut donc encore fonctionner un temps ;
- les copies que vous ou d'autres avez téléchargées ou partagées.

**Déconnexion sur un appareil partagé.** À la déconnexion, ou si un autre compte se connecte, nous effaçons de ce navigateur la liste de la bibliothèque, le kit de marque et les fichiers importés (le thème d'affichage reste). [À COMPLÉTER : tester en production que la déconnexion efface bien ces données ; sinon, corriger le code avant de publier cette phrase]. Sur un appareil partagé, vous pouvez aussi effacer les données du site dans votre navigateur.

**Supprimer votre compte.** Il n'existe pas encore de suppression automatique du compte et de ses données, ni d'export. Pour le demander, écrivez-nous (section 8). Une suppression complète doit couvrir : votre compte chez Clerk ; notre base (profil, photo, créations, bibliothèque, opérations de solde, recharges, favoris, actions et blocages de notre équipe) ; nos fichiers (créations et imports) ; le stockage propre à votre compte ; vos statistiques chez PostHog ; vos rapports chez Sentry. Nous ne pouvons pas effacer nous-mêmes les copies chez fal, Runware et Higgsfield, ni celles gardées dans les caches. [À DÉCIDER : procédure de suppression du compte : qui la fait, dans quel délai, et ce qui est gardé pour la comptabilité].

---

## 8. Vos droits

Selon la loi applicable, vous pouvez demander :

- à **voir** les données que nous avons sur vous ;
- à les **corriger** ;
- à les **effacer** (voir section 7 : il n'existe pas encore de suppression automatique) ;
- à vous **opposer** à certains usages, comme les statistiques. Aujourd'hui, le studio n'a pas de réglage pour cela : écrivez-nous à l'adresse ci-dessous. [À DÉCIDER : ajouter un interrupteur pour refuser les statistiques] ;
- [À COMPLÉTER : autres droits prévus par la loi applicable, par exemple la portabilité].

**Comment faire :** écrivez à [cindy@progiciellabs.xyz](mailto:cindy@progiciellabs.xyz). Nous pourrons vous demander de prouver que le compte est bien le vôtre. Nous répondons sous [À DÉCIDER : délai de réponse].

Vous pouvez aussi porter plainte auprès de [À COMPLÉTER : autorité de protection des données compétente et ses coordonnées].

---

## 9. Cookies, stockage local et statistiques

**Cookies de connexion (Clerk).** Clerk utilise des cookies et du stockage pour vous garder connecté. Ils sont nécessaires au service.

**Statistiques (PostHog).** Nous mesurons les pages vues, les clics et quelques événements (création lancée, réussie ou échouée, recharge ouverte, outil ouvert, modèle prêt à l'emploi utilisé). PostHog reçoit aussi le type d'appareil et de navigateur, la taille d'écran et la page d'origine (sans ses paramètres). Il déduit une localisation approximative (pays, ville). Il dépose un identifiant anonyme dans un cookie et dans le stockage du navigateur. Avant connexion, vos visites sont mesurées de façon anonyme ; quand vous vous connectez, elles sont rattachées à votre identifiant de compte.

Nos événements nommés ne contiennent pas vos consignes. Quand vous cliquez, PostHog note seulement le type de l'élément cliqué, sa place dans la page et la position du clic : ni son texte, ni ses attributs (par exemple l'adresse d'un lien), ni ce que vous tapez ou copiez. Rien n'est noté au clic sur les pages d'administration. Nous retirons les paramètres de toutes les adresses envoyées (page visitée, page d'origine, page d'entrée). Nous n'enregistrons pas vos sessions à l'écran, et nous ne faisons ni carte de chaleur ni mesure de performance. [À COMPLÉTER : confirmer que l'anonymisation des adresses IP est active dans le projet PostHog].

[À COMPLÉTER : liste exacte des cookies déposés par Clerk et PostHog, avec leur durée].

**Erreurs (Sentry).** Si Sentry est activé sur le site, il reçoit les erreurs avec votre identifiant de compte, sans les paramètres des adresses, sans les messages de la console et sans la valeur des attributs des éléments cliqués.

**Polices (Google Fonts).** Votre navigateur contacte Google pour charger nos polices. Google voit alors votre adresse IP.

**Stockage dans votre navigateur.** Nous gardons sur votre appareil :

- une copie locale de la liste de votre bibliothèque (les fichiers que vous importez sont gardés dans notre stockage chez Cloudflare, pour vous suivre d'un appareil à l'autre) ;
- votre kit de marque (nom, WhatsApp, logo, couleurs, ton, notes) : il reste sur votre appareil, sauf le logo (gardé dans votre bibliothèque) et les éléments que vous ajoutez à une création (phrase de style, nom et offre dans Spot), qui sont envoyés au prestataire d'IA ;
- vos favoris, projets et enchaînements ;
- vos préférences d'affichage (thème, panneaux) ;
- l'identifiant anonyme de PostHog.

**Votre accord.** Aujourd'hui, aucun bandeau ne vous demande votre accord pour les statistiques. [À DÉCIDER : ajouter un bandeau de consentement, ou justifier une autre base légale pour les statistiques].

---

## 10. Sécurité

- Vos demandes passent toujours par notre serveur. Si la copie d'un résultat dans notre stockage échoue, votre navigateur le télécharge directement chez le prestataire, qui voit alors votre adresse IP.
- Chaque demande liée à votre compte (créations, solde, recharges, bibliothèque) est vérifiée avec votre jeton de connexion ; vos fichiers, eux, s'ouvrent avec leur seul lien.
- Les confirmations de paiement sont signées et vérifiées.
- L'accès d'administration est réservé à une liste fermée de comptes. Chaque action de notre équipe sur un solde, une création, une recharge ou un blocage est enregistrée avec son motif. Lors d'une panne de notre base, une action peut toutefois ne pas être enregistrée. La consultation de vos données n'est pas enregistrée.

**Limites à connaître :** vos fichiers (importés ou créés) sont lisibles par toute personne qui a leur lien (les liens sont difficiles à deviner, mais contiennent l'identifiant de votre compte). Notre équipe peut voir vos consignes, vos créations et vos numéros de paiement.

[À DÉCIDER : comment nous vous prévenons en cas de fuite de données].

---

## 11. Mineurs

[À DÉCIDER : âge minimum pour utiliser Qreativ]. Le service ne vérifie pas l'âge aujourd'hui.

N'envoyez jamais la photo ou la voix d'un mineur sans l'accord de ses parents.

---

## 12. Changements de cette politique

Nous pouvons modifier cette politique. La date en haut de la page indique la dernière version. [À DÉCIDER : comment nous vous prévenons d'un changement important].

---

## 13. Nous contacter

- E-mail : [À COMPLÉTER : adresse e-mail de contact]
- WhatsApp : [À COMPLÉTER : numéro WhatsApp de contact]
