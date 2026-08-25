import * as SQLite from 'expo-sqlite';

/**
 * Base SQLite locale ClearNet (offline-first).
 * Table `pending_transactions` : transactions créées hors-ligne ou en attente
 * de confirmation serveur (statut LOCAL_PENDING), puis rejouées par le moteur
 * de synchronisation (useBackgroundSync) dès le retour du réseau.
 *
 * Migré vers l'API async d'expo-sqlite (SDK 57) : openDatabaseAsync /
 * execAsync / runAsync / getAllAsync (l'ancienne API openDatabase+executeSql
 * a été retirée d'expo-sqlite à partir du SDK 57).
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

/** Ligne brute en base (colonnes snake_case). */
interface PendingTransactionRow {
  id: string;
  to_email: string;
  amount: number;
  note: string | null;
  created_at: string;
  status: LocalTransaction['status'];
  server_id: string | null;
  error: string | null;
}

function toLocalTransaction(row: PendingTransactionRow): LocalTransaction {
  return {
    id: row.id,
    toEmail: row.to_email,
    amount: row.amount,
    note: row.note ?? null,
    createdAt: row.created_at,
    status: row.status,
    serverId: row.server_id ?? null,
    error: row.error ?? null,
  };
}

function openDb(): Promise<SQLite.SQLiteDatabase> {
  return SQLite.openDatabaseAsync(DB_NAME);
}

export async function initDb(): Promise<void> {
  const db = await openDb();
  try {
    await db.execAsync(
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
  } finally {
    await db.closeAsync();
  }
}

export async function insertLocalTransaction(tx: Omit<LocalTransaction, 'status'>): Promise<void> {
  const db = await openDb();
  try {
    await db.runAsync(
      `INSERT OR REPLACE INTO pending_transactions
         (id, to_email, amount, note, created_at, status)
       VALUES (?, ?, ?, ?, ?, 'LOCAL_PENDING')`,
      tx.id,
      tx.toEmail,
      tx.amount,
      tx.note ?? null,
      tx.createdAt,
    );
  } finally {
    await db.closeAsync();
  }
}

export async function listLocalTransactions(status?: string): Promise<LocalTransaction[]> {
  const db = await openDb();
  try {
    const rows = status
      ? await db.getAllAsync<PendingTransactionRow>(
          'SELECT * FROM pending_transactions WHERE status = ? ORDER BY created_at ASC',
          status,
        )
      : await db.getAllAsync<PendingTransactionRow>(
          'SELECT * FROM pending_transactions ORDER BY created_at ASC',
        );
    return rows.map(toLocalTransaction);
  } finally {
    await db.closeAsync();
  }
}

export async function updateLocalTransactionStatus(
  id: string,
  status: LocalTransaction['status'],
  serverId?: string | null,
  error?: string | null,
): Promise<void> {
  const db = await openDb();
  try {
    await db.runAsync(
      'UPDATE pending_transactions SET status = ?, server_id = ?, error = ? WHERE id = ?',
      status,
      serverId ?? null,
      error ?? null,
      id,
    );
  } finally {
    await db.closeAsync();
  }
}

export async function clearLocalTransactions(): Promise<void> {
  const db = await openDb();
  try {
    await db.runAsync('DELETE FROM pending_transactions');
  } finally {
    await db.closeAsync();
  }
}
