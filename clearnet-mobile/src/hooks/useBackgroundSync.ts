import { useEffect, useRef, useState, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { api } from '../api/client';
import { LocalTransactionService } from '../services/LocalTransactionService';

interface SyncState {
  connected: boolean;
  syncing: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Recalcule le nombre de transactions locales en attente (après enfilement). */
  refreshPending: () => Promise<void>;
  /** Déclenche une passe de synchronisation immédiate. */
  syncNow: () => Promise<void>;
}

/**
 * Moteur de synchronisation en arrière-plan (V1.3, offline-first).
 * Dès que le réseau revient (NetInfo), les transactions LOCAL_PENDING sont
 * rejouées vers POST /api/transactions ; statut local mis à jour
 * (LOCAL_SUCCESS / LOCAL_FAILED). Le hook s'abonne aussi à l'événement
 * `reconnected` pour une sync immédiate.
 */
export function useBackgroundSync(
  token: string,
  onSynced?: (serverId: string, localId: string) => void,
): SyncState {
  const [connected, setConnected] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const busy = useRef(false);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  const refreshCount = useCallback(async () => {
    try {
      const pending = await LocalTransactionService.pending();
      setPendingCount(pending.length);
    } catch {
      setPendingCount(0);
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (busy.current || !token) return;
    busy.current = true;
    setSyncing(true);
    setLastError(null);
    try {
      const pending = await LocalTransactionService.pending();
      for (const tx of pending) {
        try {
          const created = await api<{ id: string }>('/transactions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ toEmail: tx.toEmail, amount: tx.amount, note: tx.note ?? undefined }),
          });
          await LocalTransactionService.markSynced(tx.id, created.id);
          onSyncedRef.current?.(created.id, tx.id);
        } catch (error) {
          await LocalTransactionService.markFailed(tx.id, error instanceof Error ? error.message : 'Erreur réseau');
        }
      }
      setLastSyncAt(new Date().toISOString());
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Synchronisation impossible');
    } finally {
      busy.current = false;
      setSyncing(false);
      await refreshCount();
    }
  }, [token, refreshCount]);

  useEffect(() => {
    void LocalTransactionService.ensureInit();
    void refreshCount();

    const unsubscribe = NetInfo.addEventListener((state) => {
      const isConnected = Boolean(state.isConnected && state.isInternetReachable !== false);
      setConnected(isConnected);
      if (isConnected) void syncNow();
    });
    return unsubscribe;
  }, [refreshCount, syncNow]);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  return { connected, syncing, pendingCount, lastSyncAt, lastError, refreshPending: refreshCount, syncNow };
}
