/**
 * Constantes partagées du module transactions.
 * Isolées ici pour casser l'import circulaire
 * transactions.service ↔ transaction.processor (les métadonnées DI émises par
 * TypeScript deviennent `undefined` en cas de cycle — erreur « can't resolve
 * dependencies » sous ts-jest/Nest en test).
 */
export const ONCHAIN_QUEUE = 'onchain-settlement';
