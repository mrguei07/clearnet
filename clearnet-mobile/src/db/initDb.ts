import * as SQLite from 'expo-sqlite';

/**
 * Base SQLite locale ClearNet (V1.3, offline-first).
 * Table `pending_transactions` : transactions créées hors-ligne ou en attente
 * de confirmation serveur (statut LOCAL_PENDING), puis rejouées par le moteur
 * de synchronisation (useBackgroundSync) dès le retour du réseau.
 */
export interface LocalTransaction {
  id: string;
  toEmail: string;
  amount: number;
  note: string | null;
  createdAt: string;
  status: 'LOCAL_PENDING' | 'LOCAL_SUCCESS' | 'LOCAL_FAILED';
  serverId?: string | null;
  error?: string | null;
}

const DB_NAME = 'clearnet.db';

/** API legacy expo-sqlite (openDatabase + executeSql) — compatible SDK 49. */
function withDb<T>(fn: (db: SQLite.Database) => Promise<T>): Promise<T> {
  const db = SQLite.openDatabase(DB_NAME);
  return fn(db).finally(() => db.closeAsync());
}

export function initDb(): Promise<void> {
  return withDb(async (db) => {
    await new Promise<void>((resolve, reject) => {
      db.transaction(
        (tx) => {
          tx.executeSql(
            `CREATE TABLE IF NOT EXISTS pending_transactions (
               id TEXT PRIMARY KEY,
               to_email TEXT NOT NULL,
               amount REAL NOT NULL,
               note TEXT,
               created_at TEXT NOT NULL,
               status TEXT NOT NULL DEFAULT 'LOCAL_PENDING',
               server_id TEXT,
               error TEXT
             )`,
          );
        },
        reject,
        resolve,
      );
    });
  });
}

export function insertLocalTransaction(tx: Omit<LocalTransaction, 'status'>): Promise<void> {
  return withDb(async (db) => {
    await new Promise<void>((resolve, reject) => {
      db.transaction(
        (t) => {
          t.executeSql(
            `INSERT OR REPLACE INTO pending_transactions
               (id, to_email, amount, note, created_at, status)
             VALUES (?, ?, ?, ?, ?, 'LOCAL_PENDING')`,
            [tx.id, tx.toEmail, tx.amount, tx.note ?? null, tx.createdAt],
          );
        },
        reject,
        resolve,
      );
    });
  });
}

export function listLocalTransactions(status?: string): Promise<LocalTransaction[]> {
  return withDb(async (db) => {
    return new Promise((resolve, reject) => {
      db.transaction(
        (t) => {
          t.executeSql(
            status
              ? 'SELECT * FROM pending_transactions WHERE status = ? ORDER BY created_at ASC'
              : 'SELECT * FROM pending_transactions ORDER BY created_at ASC',
            status ? [status] : [],
            (_tx, result) => {
              const rows = result.rows as unknown as Array<Record<string, unknown>>;
              resolve(
                (Array.isArray(rows) ? rows : []).map((row) => ({
                  id: String(row.id),
                  toEmail: String(row.to_email),
                  amount: Number(row.amount),
                  note: (row.note as string | null) ?? null,
                  createdAt: String(row.created_at),
                  status: row.status as LocalTransaction['status'],
                  serverId: (row.server_id as string | null) ?? null,
                  error: (row.error as string | null) ?? null,
                })),
              );
            },
          );
        },
        reject,
        () => resolve([]),
      );
    });
  });
}

export function updateLocalTransactionStatus(
  id: string,
  status: LocalTransaction['status'],
  serverId?: string | null,
  error?: string | null,
): Promise<void> {
  return withDb(async (db) => {
    await new Promise<void>((resolve, reject) => {
      db.transaction(
        (t) => {
          t.executeSql(
            'UPDATE pending_transactions SET status = ?, server_id = ?, error = ? WHERE id = ?',
            [status, serverId ?? null, error ?? null, id],
          );
        },
        reject,
        resolve,
      );
    });
  });
}

export function clearLocalTransactions(): Promise<void> {
  return withDb(async (db) => {
    await new Promise<void>((resolve, reject) => {
      db.transaction((t) => t.executeSql('DELETE FROM pending_transactions'), reject, resolve);
    });
  });
}
