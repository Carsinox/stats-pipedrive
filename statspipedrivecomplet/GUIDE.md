# Guide pas à pas (pour débutant)

Objectif : mettre ton dashboard en ligne **gratuitement** et l'afficher avec **tes vraies données Pipedrive**, sans rien installer et sans ligne de commande. Compte ~20 minutes la première fois.

On va faire 4 étapes :
1. Créer 2 comptes gratuits (GitHub + Vercel)
2. Mettre le projet en ligne
3. Le connecter à ton Pipedrive
4. Régler tes champs (page ⚙ Configuration) — tout se fait dans le navigateur

---

## Avant de commencer : décompresser le dossier

Le fichier reçu est un **.zip**. Décompresse-le :
- **Windows** : clic droit sur le fichier → « Extraire tout ».
- **Mac** : double-clique dessus.

Tu obtiens un dossier `pipedrive-dashboard` contenant plein de fichiers. Garde-le sous la main.

---

## Étape 1 — Créer les comptes (gratuit)

1. Va sur **github.com** et crée un compte gratuit (bouton *Sign up*).
2. Va sur **vercel.com**, clique *Sign Up*, puis choisis **« Continue with GitHub »** (ça relie les deux comptes automatiquement). Accepte les autorisations.

> GitHub = l'endroit où vivent les fichiers du projet. Vercel = ce qui transforme ces fichiers en site web accessible par un lien.

---

## Étape 2 — Mettre le projet en ligne

**2a. Déposer les fichiers sur GitHub**

1. Sur github.com, en haut à droite, clique le **+** → **New repository**.
2. Donne un nom, ex. `stats-pipedrive`. Laisse le reste par défaut. Clique **Create repository**.
3. Sur la page suivante, clique le lien **« uploading an existing file »** (ou *Add file → Upload files*).
4. Ouvre ton dossier `pipedrive-dashboard` décompressé, **sélectionne tout ce qu'il y a dedans** et **glisse-dépose** dans la fenêtre du navigateur.
   - ⚠️ Glisse le **contenu** du dossier (les fichiers et sous-dossiers `api`, `public`, etc.), pas le dossier lui-même.
5. En bas, clique **Commit changes**.

**2b. Déployer avec Vercel**

1. Sur vercel.com, clique **Add New… → Project**.
2. Tu vois la liste de tes dépôts GitHub. À côté de `stats-pipedrive`, clique **Import**.
3. Ne touche à rien, clique **Deploy**. Attends ~1 minute.
4. 🎉 Vercel affiche « Congratulations ». Clique **Continue to Dashboard**, puis **Visit** : ton site s'ouvre en **mode démo** (données d'exemple). C'est normal, on branche tes données maintenant.

Note l'adresse de ton site, du type `https://stats-pipedrive-xxxx.vercel.app`.

---

## Étape 3 — Connecter ton Pipedrive

**3a. Récupérer tes 2 identifiants**

- **Ton domaine** : regarde l'adresse quand tu es dans Pipedrive. Si c'est `https://macompagnie.pipedrive.com`, ton domaine est **`macompagnie`**.
- **Ton token API** : dans Pipedrive, clique ton **avatar** (en haut à droite) → **Paramètres personnels** → **API**. Copie la longue suite de caractères (« Your personal API token »).

> 🔒 Ce token est comme un mot de passe : ne le partage avec personne. Ici il reste stocké côté serveur (Vercel), jamais visible sur le site.

**3b. Les enregistrer dans Vercel**

1. Sur vercel.com, ouvre ton projet → onglet **Settings** → menu de gauche **Environment Variables**.
2. Ajoute une première variable :
   - *Key* : `PIPEDRIVE_DOMAIN`  — *Value* : ton domaine (ex. `macompagnie`)
   - clique **Save**.
3. Ajoute une deuxième variable :
   - *Key* : `PIPEDRIVE_API_TOKEN`  — *Value* : ton token
   - clique **Save**.
4. Il faut **redéployer** pour appliquer : onglet **Deployments** → sur la ligne du haut, clique le menu **⋯** → **Redeploy** → confirme.

---

## Étape 4 — Régler tes champs (le plus important, et c'est automatique)

1. Dans ton navigateur, ouvre **l'adresse de ton site suivie de `/api/discover`**
   (ex. `https://stats-pipedrive-xxxx.vercel.app/api/discover`).
2. La page **détecte automatiquement** tes champs et affiche un bloc bleu foncé « Configuration détectée », par exemple :

   ```
   PIPEDRIVE_MANDAT_DATE_FIELD=a1b2c3...
   PIPEDRIVE_CE_FIELD=f9e8d7...
   PIPEDRIVE_CE_VALUES=21
   PIPEDRIVE_CE_ACTIVITY_TYPES=call
   PIPEDRIVE_MANDAT_VALUE=500
   ```

3. Retourne dans **Vercel → Settings → Environment Variables** et ajoute **chacune de ces lignes** comme une variable (le mot avant le `=` est la *Key*, ce qui suit est la *Value*).
4. **Redeploy** une dernière fois (comme à l'étape 3b, point 4).
5. Ouvre ton site : il affiche maintenant **tes vraies statistiques** ! Le bandeau orange « démonstration » a disparu.

> Si la page `/api/discover` affiche « Détection partielle », pas de panique : les tableaux en dessous listent tous tes champs. Repère à la main le champ date de règlement mandat et le résultat d'appel « Contact établi », et remplace les valeurs `REMPLACER` par les bonnes (colonne *Clé* pour les champs, *option id* pour « Contact établi »). Tu peux aussi me coller une capture de cette page et je te donne les valeurs exactes.

---

## C'est fait ✅

- Ton dashboard est en ligne à ton adresse Vercel, accessible depuis ton ordi ou ton téléphone.
- Le bouton **⚙** en haut du dashboard ramène toujours vers la page de configuration.
- Le bouton **↻** actualise les chiffres. Les données se rafraîchissent aussi seules à chaque visite.

## Questions fréquentes

**Je veux juste voir l'app avant de me lancer.** L'étape 2 suffit : après le déploiement, le site tourne en mode démo, tu peux cliquer partout sans risque.

**Je préfère tester sur mon ordinateur d'abord.** C'est possible mais ça demande d'installer *Node.js* (nodejs.org, version LTS) puis, dans un terminal ouvert sur le dossier, de taper `node dev-server.js` et d'ouvrir `http://localhost:3000`. La voie Vercel ci-dessus est plus simple pour débuter.

**Comment modifier plus tard ?** Change une variable dans Vercel → Redeploy. Pour changer le code, modifie les fichiers sur GitHub → Vercel redéploie tout seul.

**Un seul commercial ou plusieurs ?** Le token est personnel : par défaut le dashboard montre les affaires visibles par ce token. Dis-le moi si tu veux filtrer par commercial.
