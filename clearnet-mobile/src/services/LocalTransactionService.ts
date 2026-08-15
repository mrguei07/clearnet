import {
  initDb,
  insertLocalTransaction,
  listLocalTransactions,
  updateLocalTransactionStatus,
  clearLocalTransactions,
  LocalTransaction,
} from '../db/initDb';

let initPromise: Promise<void> | null = null;

/**
 * Service de persistance locale des transactions (V1.3, offline-first).
 * CRUD SQLite simple par-dessus initDb — toutes les méthodes sont sûres à
 * appeler plusieurs fois (init idempotent, gestion d'erreur silencieuse).
 */
export const LocalTransactionService = {
  async ensureInit(): Promise<void> {
    if (!initPromise) {
      initPromise = initDb().catch((error) => {
        initPromise = null;
        throw error;
      });
    }
    return initPromise;
  },

  /** Enregistre une transaction avant tout appel réseau (status LOCAL_PENDING). */
  async saveLocal(input: {
    id: string;
    toEmail: string;
    amount: number;
    note?: string | null;
  }): Promise<void> {
    await this.ensureInit();
    await insertLocalTransaction({
      id: input.id,
      toEmail: input.toEmail,
      amount: input.amount,
      note: input.note ?? null,
      createdAt: new Date().toISOString(),
    });
  },

  async pending(): Promise<LocalTransaction[]> {
    await this.ensureInit();
    return listLocalTransactions('LOCAL_PENDING');
  },

  async all(): Promise<LocalTransaction[]> {
    await this.ensureInit();
    return listLocalTransactions();
  },

  async markSynced(id: string, serverId: string): Promise<void> {
    await this.ensureInit();
    await updateLocalTransactionStatus(id, 'LOCAL_SUCCESS', serverId);
  },

  async markFailed(id: string, error: string): Promise<void> {
    await this.ensureInit();
    await updateLocalTransactionStatus(id, 'LOCAL_FAILED', null, error);
  },

  async reset(): Promise<void> {
    await this.ensureInit();
    await clearLocalTransactions();
  },
};

export type { LocalTransaction };
