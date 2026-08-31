# ClearNet — Script démo vidéo (3 minutes)

**Usage** : démo commerciale « cycle de compensation en conditions réelles simulées » (feuille de route, étape 4).
**Support visuel** : écrans réels de l'app (ou l'aperçu interactif `docs/apercu-visuel.html`) + animations graphiques simples.
**Voix off** : professionnelle, ton posé. **Durée totale** : 3:00.

---

## Scène 1 — Le problème (0:00 → 0:25)

**Écran** : animation — trois entreprises A → B → C → A, chacune avec une facture en attente ; une jauge « BFR » monte.

**Narration :**
> « En Europe, les entreprises portent en permanence plus de 1 500 milliards d'euros de créances commerciales. Dans chaque chaîne de valeur, A doit à B, B doit à C, et C doit à A. Chacun finance l'attente des autres — par découvert, affacturage ou crédit — à un coût de 8 à 15 % par an. »

**Écran** : zoom sur les trois flèches qui forment un cercle.

> « Mais regardez bien : ces dettes forment un **cycle**. Et un cycle, on peut le **compenser**. »

---

## Scène 2 — Le concept (0:25 → 0:55)

**Écran** : animation du cycle — les trois flèches se contractent en **un seul paiement net** ; compteur « 3 factures de 1 M€ → 1 paiement de 200 k€ ».

**Narration :**
> « ClearNet détecte automatiquement ces cycles dans le graphe des transactions interentreprises, et les solde en un nombre minimal de paiements. Moins d'argent qui dort, moins de frais bancaires, moins de risque. Et surtout : **personne ne voit vos montants** — chaque preuve est chiffrée par un circuit de preuve à divulgation nulle de connaissance. »

**Écran** : logo ClearNet + badge « ZK Groth16 · confidentialité des montants ».

---

## Scène 3 — Démo produit : connexion & tableau de bord (0:55 → 1:25)

**Écran** : téléphone — écran de connexion (email + mot de passe), puis écran **Accueil**.

**Narration :**
> « Concrètement. Un directeur financier se connecte à ClearNet — le thème s'adapte à son secteur d'activité. Il voit son **solde disponible**, sa **dernière opération**, et les **cycles détectés** qui attendent d'être compensés. »

**Écran** : clic sur « Cycles détectés : 2 » → bascule sur l'onglet **Réseau**.

---

## Scène 4 — Le cycle en action (1:25 → 1:55)

**Écran** : graphe multi-secteurs — « Vous » au centre, partenaires autour (maritime, énergie, santé, spatial…) ; un cycle s'allume en surbrillance.

**Narration :**
> « Le graphe montre le réseau de contreparties, coloré par secteur. Ici, un cycle a été identifié : CMR → TransSped → Nova Energy. Un clic, et le bénéfice potentiel de la compensation s'affiche. »

**Écran** : fiche contrepartie (volume, transactions, pays) + bouton **▶ Simuler** — des règlements défilent dans le fil d'activité.

> « La simulation montre les flux en direct : chaque règlement est tracé on-chain, avec un statut en temps réel. »

---

## Scène 5 — Créer un paiement (1:55 → 2:20)

**Écran** : onglet **Transactions** → bouton « ＋ Nouveau » → formulaire (destinataire, montant, note).

**Narration :**
> « Créer un paiement prend dix secondes. Le règlement passe par le moteur de compensation : statut en attente, puis confirmation on-chain en quelques secondes. En cas de coupure réseau, la transaction est mise en file locale et synchronisée automatiquement — rien ne se perd. »

**Écran** : badge ⏳ → ✅ + toast « Règlement confirmé on-chain ».

---

## Scène 6 — La valeur mesurée (2:20 → 2:40)

**Écran** : onglet **Abonnement** — widget « Économies réalisées » + grille tarifaire Free/Essentiel/Pro/Enterprise.

**Narration :**
> « Et la valeur est mesurée : chaque entreprise voit ses **économies réalisées** — frais évités, trésorerie libérée. Le modèle est simple : un abonnement selon le volume, et une commission uniquement sur les règlements réussis. »

**Écran** : chiffres clés — « BFR réduit de X % · DSO raccourci de X jours · ROI 3 à 6 mois ».

---

## Scène 7 — Appel à l'action (2:40 → 3:00)

**Écran** : logo ClearNet + « Rejoignez les 30 entreprises pilotes · transport maritime, construction, pharma ».

**Narration :**
> « Nous recrutons nos **30 premières entreprises pilotes** — transport maritime, construction, industrie pharmaceutique — avec un accompagnement dédié et un accès gratuit pendant l'expérimentation. »

**Écran** : contact — site, email, « Demander une démo ».

> « ClearNet : moins d'argent qui dort, plus de confiance qui circule. Demandez votre démonstration. »

---

## Notes de production

- **Durée par scène** : respecter les repères (5 s de marge max).
- **Musique** : nappe discrète (pas de voix synthétiques).
- **Sous-titres** : FR + EN recommandés (usage investisseurs).
- **Écrans** : utiliser l'aperçu interactif (`docs/apercu-visuel.html`) pour les captures, ou filmer l'app réelle sur émulateur.
- **Chiffres** : ajuster « BFR réduit / DSO » avec les données réelles des premiers pilotes dès qu'elles existent (crédibilité commerciale).
