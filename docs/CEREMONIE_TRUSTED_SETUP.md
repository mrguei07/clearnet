# 🗓 CÉRÉMONIES TRUSTED SETUP (Groth16) — CIRCUIT CLEARNET `clearing.circom`

**Rôle** : Lead Architect Full‑Stack — organisation de la cérémonie Phase 2 + outillage sécurisé.
**Base** : `IZkVerifier.sol` (interface), `CompensationEngine.sol` (netting), plan L2 (RECOMMANDATION_DEPLOIEMENT_L2.md).
**Statut** : recommandation consolidée — décision produit requise (liste des participants, dates).

---

## 1. VERDICT EXÉCUTIF

**Oui à une cérémonie Phase 2 publique, oui au protocole Perpetual Powers of Tau (PPoT), oui à
l'outillage Web (snarkjs) — avec trois corrections obligatoires (cf. §2) et UN prérequis
bloquant : le circuit n'existe pas encore dans le dépôt.**

Le socle ZK de ClearNet est aujourd'hui une **interface** (`IZkVerifier.sol`) et un moteur
(`CompensationEngine.sol`) ; aucun `*.circom` n'est présent. **Toute cérémonie avant le gel du
circuit est à refaire intégralement** (le Paramètre Phase 2 est spécifique au `r1cs`, la moindre
contrainte ajoutée invalide la cérémonie). L'ordre est donc : circuit figé → cérémonie → vk.

---

## 2. CORRECTIONS CRITIQUES DU MESSAGE REÇU

| Affirmation reçue | Correction | Conséquence concrète |
|:---|:---|:---|
| « Si les paramètres de la Phase 2 sont interceptés, un acteur malveillant pourrait forger » | **Faux tel quel.** Les paramètres (ptau, zkey) sont **publics par construction** — les intercepter ne permet rien. La soundness casse si (a) tous les contributeurs sont malveillants coordonnés, ou (b) l'aléa (« toxic waste ») d'une contribution est connu/computé, ou (c) le coordinateur fournit/représente un aléa connu. | Les fichiers de cérémonie vivent sur un dépôt public ; c'est le **secret éphémère** qui doit être impossible à déduire. |
| « Il suffit qu'un seul participant honnête » | **Vrai, avec deux conditions** : (1) son aléa est **produit sur sa machine** (jamais fourni par le coordinateur), (2) il est **détruit** (vraiment). | Le coordinateur ne doit **jamais** générer l'entropie, seulement distribuer/enchaîner les fichiers publics. |
| « Clés privées générées par les mouvements de souris » | **Non.** Le navigateur utilise `crypto.getRandomValues` (CSPRNG). La souris ne fournit qu'une **entropie auxiliaire** facultative (pratique des cérémonies web : seed additionnel). S'appuyer uniquement sur la souris = faux sentiment de sécurité. | Documenter : CSPRNG + seed souris/dés, jamais l'inverse. |
| « SnarkJS Web CLI » | **Faisable** : `snarkjs` est du JS/wasm (groth16 setup, contribute, verify) — la version web existe déjà en pratique (cérémonies zkParty). **Condition** : binaire statique audité, chargé avec SRI, fallback air‑gapped. | Une « interface éphémère » sans SRI + code publié = porte ouverte → paramétrage impératif §5.2. |
| « Coordinateur centralisé » | Acceptable comme **couche logistique** (jamais comme détenteur de secret). Il peut censurer ou substituer : contre‑mesure = chaîne de hashes publiée **et vérifiée** à chaque contribution + vérification finale. | Serveur = stateless, publish‑only, code open source + audit log intègre (§5.1). |

---

## 3. PRÉREQUIS — GEL DU CIRCUIT (bloquant)

1. Rédiger la spécification : preuve de clearing/compensation (entrées : soldes nettes, paramètres
   du moteur, signatures MultiSig ; sortie : transitions validées) — validée avec le produit.
2. Rédiger `circuits/clearing.circom` (circom 2.x épinglé, `--O1`, build **hermétique** — Docker
   multistage, feed sources commitées) ; sorties `clearing.r1cs`, `clearing.wasm`, `clearing.sym`,
   **hashes SHA‑256 publiés** + tag git `circuit-v1.0.0` + CI non‑régression (tests proof happy path
   + preuve altérée rejetée).
3. Écrire `IZkVerifier` concret (vérifieur Groth16 BN254 généré par `snarkjs zkey export vk` →
   `zkverify`).
4. **Congélation** : aucun changement de contraintes après le tag ; toute évolution = nouvelle
   cérémonie Phase 2 (coût maîtrisé : moins d'une journée de cérémonie).

---

## 4. ORGANISATION DE LA CÉRÉMONIE (PHASE 2)

### 4.1. Chronologie (fenêtre de 3 semaines calendaires)

| Étape | Fenêtre | Contenu |
|:---|:---|:---|
| T−14 j | Annonce | Publication publique : circuit tagué + hashes, procédure, liste des participants, règles (SRI, hashes transcript) |
| T−7 j | Pré‑session | Test drive du coordinateur (environnement staging), revue du code du coordinateur par 2 auditeurs externes |
| T0 → T+14 j | Contributions | 8–12 contributeurs, ordre publié, fenêtres de 48 h chacun |
| T+14 j | Finalisation | Beacon public facultatif (« Mannequin » : phrase publique certify), `zkey verify` final, export `vk`, tag git + hash sur chaîne |
| T+21 j | Rideau | Revue croisée, rapport de cérémonie, bascule du contrat (MultiSig) vers le vk publié |

### 4.2. Participants (8–12, mix exigé)

| Groupe | Rôle | Nombre |
|:---|:---|:---|
| Partenaires distributeurs (Maritime, Aviation, Biotech, Commerce) | Contributeurs opérationnels | 3–4 |
| Auditeurs de sécurité externes (≠ équipe ClearNet) | Contributeurs + revue code coordinateur | 2–3 |
| Core team ClearNet | Contributeurs (minorité) | 2 |
| Ingénierie ZK indépendante (2 prix optionnels, budget < 4 k€) | Participation garantie + attestation | 1–2 |
| Coordinateur (serveur automatisé §5.1) | Logistique uniquement — zéro détention de secret | 1 (dispositif) |

> Règle d'or : **jamais moins de 4 contributeurs**, dont au moins 2 hors ClearNet ; l'hypothèse
> « un seul honnête » doit rester crédible face à une compromission partielle de l'écosystème.

### 4.3. Rôles et responsabilités

- **Coordinateur** : distribue `ptau` + `r1cs` (`SHA‑256` publiés), collecte les contributions
  séquentiellement, vérifie chaque transition (`snarkjs zkey verify`), publie les hashes
  intermédiaires — offre HTTP publique + code source.
- **Contributeur** : récupère le fichier `zkey` courant et la **procédure 5.2** (web ou air‑gap),
  exécute la contribution, **détruit son aléa**, remonte `zkey` résultat + hash.
- **Vérificateurs** (2) : rejouent toute la chaîne `zkey_0 → zkey_final` indépendamment et
  attestent le `vk` final (signature + horodatage).

---

## 5. OUTILLAGE — PERPETUAL POWERS OF TAU + SNARKJS (WEB & AIR‑GAP)

### 5.1. Coordinateur de cérémonie (spécification minimale)

```
API :
  GET  /ceremony/params      → { circuit, ptau.url, ptau.sha256, r1cs.sha256, chain:[H_i] }
  GET  /ceremony/transcript  → zkey courant (H_i) — lecture seule
  POST /ceremony/contribute  → { contributionSha256, signature? } → 200 + H_{i+1} | 409
  GET  /ceremony/chain       → log intègre (hash chain : H_0 ← H_1 ← … ← H_N)
Workflow : H_0 = snarkjs groth16 setup <r1cs> <ptau> ; H_{i+1} = snarkjs zkey contribute <H_i>
Exigences : code 100 % public (tag git), contention par contribution (verrou logique), reprise
d'état après panne = rejouer la chaîne (aucun secret stocké). Le serveur n'affiche JAMAIS
d'entropie : il n'en génère pas.
Final : snarkjs zkey verify <H_N> ; snarkjs zkey export verificationkey → verification_key.json
(hash SHA‑256 publié sur chaîne via MultiSigWallet + tag git).
```

### 5.2. Contribution web (snarkjs en navigateur) — exigences de sécurité

- **Statique + SRI** : binaire HTML/JS/wasm servi depuis un tag git vérifié, `integrity=SHA‑384`
  publié, aucune ressource tierce (aucun CDN), `CSP: default-src 'none'; script-src 'sha384-…'`.
- Pages éphémères : fenêtre de contribution ouvrable **uniquement pendant la fenêtre du
  contributeur** (le fichier `zkey` circule via la page, jamais par e‑mail).
- Entropie : `crypto.getRandomValues` (CSPRNG) + entropie auxiliaire (souris/dés) affichée comme
  telle ; option « mode Tails » documentée (cf. 5.3).
- **Fallback air‑gap obligatoire** : la même contribution doit être possible localement
  (`snarkjs zkey contribute` sur machine déconnectée) — un participant sur deux l'utilise
  (recommandé), tous les autres l'ont en secours. Preuve de non‑court‑circuit : hash du zkey
  transmis hors bande (visio/SMS) et vérifié par le coordinateur.

### 5.3. Destruction des déchets toxiques (checklist contributeur)

```
[ ] Machine isolée (VM jetable OU clé USB Live OS — recommandé : Tails, persistance désactivée)
[ ] Aucun réseau pendant l'étape critique (web : passphrase éphémère, jamais sauvegardée)
[ ] Aléa affiché une seule fois à l'écran, jamais saisi ailleurs
[ ] Après contribution : éteindre (pas de suspension), retirer le support, destruction physique
    (déchiquetage/clé USB crushée) OU effacement ≥ 1 passe (shred -n 2 > écrasement + poweroff)
[ ] Remplir le formulaire « attestation de destruction » (nom, méthode, horodatage)
[ ] ⚠️ Interdit : réutiliser l'aléa, garder un screenshot, partager le zkey intermédiaire hors canal
```

---

## 6. PUBLICATION, RÉVOCATION & SÉCURITÉ OPÉRATIONNELLE

| Sujet | Dispositif |
|:---|:---|
| Pérénisation | Tag git `ceremony-v1.0.0` (zip : ptau, r1cs, zkey_final, vk, hashes, rapport signé) |
| Chaîne | Hash du `verification_key.json` enregistré via `MultiSigWallet` (2/3) ; contrat `IZkVerifier` (non mutable) pointe vers ce vk |
| Rotation | Toute évolution du circuit → nouvelle Phase 2 (procédure 4.1 repliable en 5 jours utiles) |
| Reprise de cérémonie | Corrompue/interrompue → on **recommence à H_0** (zkey protocole n'est pas réparable à mi‑chemin) ; coût : une journée |
| Coût estimé | ~3–4 jours‑homme (dont 1 auditeur) + 0–4 k€ (contributeurs indépendants) ; aucune dépense on‑chain |

> Rappel d'échelle coût < 0,01 $/tx (voir RECOMMANDATION_DEPLOIEMENT_L2.md §4.1) : la cérémonie
> est un coût **fixe unique** — amortie sur n'importe quel volume raisonnable ; le dièse eût été
> de la transformer en coût récurrent (ne le faites pas : cérémonie = once).

---

## 7. VALIDATION AVANT MISE EN PRODUCTION

1. `snarkjs zkey verify` final OK côté coordinateur **et** 2 vérificateurs indépendants ;
2. Preuve happy path + preuve altérée → `assertFail` sur l'instance déployée (zkEVM testnet puis
   mainnet — cf. RECOMMANDATION_DEPLOIEMENT_L2.md J2) ;
3. Rapport de cérémonie diffusé (participants, hashes, attestations de destruction), revue par le
   Lead Architect, bascule MultiSig en prod ;
4. Tests backend `src/compensation/**` (commit de lot + proof, rejet preuve invalide en testnet).

---

## 8. PLAN D'EXÉCUTION (3 semaines calendaires ; 3,5 j de travail effectif)

| Jour | Livrable |
|:---|:---|
| **Semaine 1** — J1 | Spéc. circuit + `clearing.circom` v0 → revue croisée interne |
| Semaine 1 — J2 | Build hermétique (Docker), `r1cs/wasm`, tests proof, tag `circuit-v1.0.0`, hashes publiés |
| Semaine 2 — J3 | Coordinator (api/chain/verif) + UI web (SRI) + procédures 5.2/5.3 + staging |
| Semaine 2 — J4 | Pré‑session avec 2 auditeurs ; invitations + distribution des fenêtres |
| Semaine 2→3 | Fenêtre de contributions T0→T+14 j (8–12 contributeurs, 48 h chacun) |
| Semaine 3 — J5 | Beacon, `zkey verify`, export vk, tag cérémonie, attestations, rapport final, bascule MultiSig + déploiement zkEVM |
| Buffer | ½ j (rattrapage contributeur en retard ; jamais de contribution « à la place ») |

---

**Conformité** : aucun secret de cérémonie dans le dépôt (seuls hashes et fichiers publics) ;
dispositif d'attestation (signatures des contributeurs) ; alternative juridique documentée
(l'attestation est morale — la blockchain mise sur « un seul honnête », pas sur un contrat).