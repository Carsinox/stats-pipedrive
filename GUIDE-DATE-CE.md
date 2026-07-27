# Dater le CE exactement (champ « Date CE » + automatisation Pipedrive)

## Pourquoi

Le CE doit être compté **le jour où tu passes le champ « résultat d'appel » à « Contact établi »** — même pour un prospect importé (LeBonCoin) créé avant. Pipedrive ne fournit pas cette date via l'API. La solution : faire inscrire la date par Pipedrive dans un **champ dédié**, qu'on lit ensuite directement (rapide et exact).

Résultat : exact **à partir du moment où tu actives l'automatisation**. Pour l'historique d'avant, le dashboard retombe automatiquement sur la date de création (approximatif) — sans rien casser.

## Étape 1 — Créer le champ date « Date Contact établi »

1. Dans Pipedrive : **Paramètres** (roue crantée) → **Champs de données** → onglet **Affaire**.
2. **+ Champ personnalisé** → type **Date** → nom : **Date Contact établi** → **Enregistrer**.
   (Ce champ d'affaire est automatiquement partagé avec les leads.)

## Étape 2 — Automatisation pour les AFFAIRES

1. Pipedrive → **Automatisations** → **Nouvelle automatisation** (partir de zéro).
2. **Déclencheur** : *Affaire mise à jour* (Deal updated).
3. **Conditions** :
   - *Résultat de l'appel* **est** *Contact établi*
   - **ET** *Date Contact établi* **est vide** (pour ne dater qu'une seule fois, la première).
4. **Action** : *Mettre à jour l'affaire* → champ **Date Contact établi** = **la date du jour** (choisis l'option « date d'exécution de l'automatisation » / date du jour).
5. Active l'automatisation.

## Étape 3 — Automatisation pour les PROSPECTS (leads)

Refais la même chose avec le déclencheur **Lead mis à jour** (Lead updated), mêmes conditions et action. Ainsi un prospect marqué « Contact établi » avant conversion est daté correctement lui aussi.

> Si tu ne trouves pas l'option « date du jour » dans l'action, dis-le moi : on ajustera (certains plans nomment ça différemment, ou on passera par une autre astuce).

## Étape 4 — Brancher le champ dans le dashboard

1. Ouvre `.../api/discover` : le champ **Date Contact établi** apparaît dans « Champs date d'affaire » (marqué *← Date CE* s'il est détecté). Copie sa **clé**.
2. Dans Vercel → **Environment Variables**, ajoute :
   - **Key** : `PIPEDRIVE_CE_DATE_FIELD`
   - **Value** : la clé du champ (ex. `abcdef123…`)
3. **Redeploy**.

C'est fini : le CE est maintenant daté au jour exact du passage à « Contact établi », imports compris. Tant que ce champ n'est pas branché, le dashboard fonctionne quand même (il date à la création en attendant).
