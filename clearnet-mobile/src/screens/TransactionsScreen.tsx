import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../api/client';
import { useTheme } from '../contexts/ThemeContext';
import { useBackgroundSync } from '../hooks/useBackgroundSync';
import { LocalTransactionService } from '../services/LocalTransactionService';

interface TransactionDto {
  id: string;
  fromEmail: string;
  toEmail: string;
  amount: number;
  note?: string | null;
  createdAt: string;
}

interface Props {
  token: string;
}

/**
 * Écran Transactions (V1.3) : historique paginé, création de paiement avec
 * persistance offline-first (SQLite + synchronisation dès le retour réseau),
 * suivi temps réel via le WebSocket.
 */
export default function TransactionsScreen({ token }: Props) {
  const { palette } = useTheme();
  const [transactions, setTransactions] = useState<TransactionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [toEmail, setToEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(
    async (pageNumber = 1, append = false) => {
      try {
        const data = await api<{ items: TransactionDto[]; total: number; page: number; limit: number }>(
          `/transactions?page=${pageNumber}&limit=25`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        setTransactions((prev) => (append ? [...prev, ...data.items] : data.items));
        setHasMore(pageNumber * data.limit < data.total);
      } catch {
        // erreur silencieuse : le pull-to-refresh la rend visible
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(1, false);
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    void load(1, false);
  }, [load]);

  const { pendingCount, connected, syncing, lastError, syncNow, refreshPending } = useBackgroundSync(token, () => {
    void load(1, false);
  });

  const submit = async () => {
    setSubmitError(null);
    const amountNum = Number(amount.replace(',', '.'));
    if (!toEmail || !amountNum || amountNum <= 0) {
      setSubmitError('Email du bénéficiaire et montant (positif) requis.');
      return;
    }
    setSubmitting(true);
    const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      // V1.4 J7 (offline-first) : la file locale (SQLite) est la source de
      // vérité — enregistrement AVANT l'appel réseau, statut LOCAL_PENDING.
      await LocalTransactionService.saveLocal({
        id: localId,
        toEmail,
        amount: amountNum,
        note: note || null,
      });
      await refreshPending();
      try {
        const created = await api<TransactionDto>('/transactions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ toEmail, amount: amountNum, note: note || undefined }),
        });
        await LocalTransactionService.markSynced(localId, created.id);
        setModalVisible(false);
        setToEmail('');
        setAmount('');
        setNote('');
        await refreshPending();
        void load(1, false);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Erreur inconnue';
        if (message.includes('réseau') || message.includes('connect') || message.includes('offline')) {
          // Hors ligne : la transaction reste LOCAL_PENDING, la rafraîchit
          // dès le retour du réseau (NetInfo → useBackgroundSync).
          setModalVisible(false);
          setToEmail('');
          setAmount('');
          setNote('');
          Alert.alert('Hors ligne', 'Le paiement sera synchronisé dès le retour du réseau.');
        } else {
          await LocalTransactionService.markFailed(localId, message);
          await refreshPending();
          setSubmitError(message);
        }
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (value: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(value);

  const grouped = useMemo(() => {
    const map = new Map<string, TransactionDto[]>();
    for (const tx of transactions) {
      const day = new Date(tx.createdAt).toLocaleDateString('fr-FR');
      const list = map.get(day) ?? [];
      list.push(tx);
      map.set(day, list);
    }
    return Array.from(map.entries());
  }, [transactions]);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>Transactions</Text>
        <Pressable
          testID="new-payment"
          style={[styles.newButton, { backgroundColor: palette.primary }]}
          onPress={() => setModalVisible(true)}
        >
          <Text style={styles.newButtonText}>Nouveau paiement</Text>
        </Pressable>
      </View>

      {pendingCount > 0 && (
        <Pressable testID="tx-queued-local" style={[styles.syncBanner, { backgroundColor: palette.surface }]} onPress={syncNow}>
          <Text style={[styles.syncText, { color: palette.primary }]}>
            {syncing
              ? 'Synchronisation…'
              : `${pendingCount} paiement${pendingCount > 1 ? 's' : ''} en attente (hors ligne) — appuyez pour synchroniser`}
          </Text>
          {!connected && <Text style={[styles.offlineText, { color: palette.muted }]}>Réseau indisponible</Text>}
        </Pressable>
      )}
      {lastError && <Text style={[styles.syncError, { color: '#f87171' }]}>{lastError}</Text>}

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      )}

      {!loading && transactions.length === 0 && (
        <Text style={[styles.empty, { color: palette.muted }]}>
          Aucune transaction pour le moment.
        </Text>
      )}

      {grouped.map(([day, txs]) => (
        <View key={day}>
          <Text style={[styles.dayLabel, { color: palette.muted }]}>{day}</Text>
          {txs.map((tx, index) => (
            <View key={tx.id} testID={index === 0 ? 'tx-history-first' : undefined} style={[styles.txCard, { backgroundColor: palette.surface }]}>
              <View style={styles.txRow}>
                <Text style={[styles.txAmount, { color: palette.primary }]} numberOfLines={1}>
                  {fmt(tx.amount)}
                </Text>
                <Text style={[styles.txTime, { color: palette.muted }]}>
                  {new Date(tx.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <Text style={[styles.txDetail, { color: palette.text }]} numberOfLines={1}>
                {tx.fromEmail} → {tx.toEmail}
              </Text>
              {tx.note && <Text style={[styles.txNote, { color: palette.muted }]} numberOfLines={2}>{tx.note}</Text>}
            </View>
          ))}
        </View>
      ))}

      {hasMore && (
        <Pressable
          style={[styles.moreButton, { borderColor: palette.primary }]}
          onPress={() => {
            const next = page + 1;
            setPage(next);
            void load(next, true);
          }}
        >
          <Text style={[styles.moreText, { color: palette.primary }]}>Charger la suite</Text>
        </Pressable>
      )}

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={[styles.modalBackdrop, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <View style={[styles.modalCard, { backgroundColor: palette.background }]}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>Nouveau paiement</Text>
            <TextInput
              testID="tx-to"
              style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]}
              placeholder="Email du bénéficiaire"
              placeholderTextColor={palette.muted}
              value={toEmail}
              onChangeText={setToEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <TextInput
              testID="tx-amount"
              style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]}
              placeholder="Montant (EUR)"
              placeholderTextColor={palette.muted}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
            <TextInput
              testID="tx-note"
              style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]}
              placeholder="Note (optionnel)"
              placeholderTextColor={palette.muted}
              value={note}
              onChangeText={setNote}
              multiline
            />
            {submitError && <Text style={styles.error}>{submitError}</Text>}
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, { borderColor: palette.muted }]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={[styles.modalButtonText, { color: palette.muted }]}>Annuler</Text>
              </Pressable>
              <Pressable
                testID="tx-submit"
                style={[styles.modalButton, { backgroundColor: palette.primary }]}
                onPress={submit}
                disabled={submitting}
              >
                <Text style={styles.modalButtonTextDark}>{submitting ? 'Envoi…' : 'Envoyer'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
  },
  title: { fontSize: 22, fontWeight: '700' },
  newButton: { borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 },
  newButtonText: { color: '#0b1220', fontWeight: '600', fontSize: 13 },
  syncBanner: {
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  syncText: { fontSize: 12, fontWeight: '600', flex: 1 },
  offlineText: { fontSize: 11, marginLeft: 8 },
  syncError: { marginHorizontal: 20, marginBottom: 8, fontSize: 12 },
  center: { padding: 40, alignItems: 'center' },
  empty: { textAlign: 'center', padding: 30, fontSize: 13 },
  dayLabel: { fontSize: 12, fontWeight: '600', marginHorizontal: 20, marginTop: 12, marginBottom: 6 },
  txCard: { marginHorizontal: 20, marginBottom: 8, borderRadius: 12, padding: 14 },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  txAmount: { fontSize: 17, fontWeight: '700' },
  txTime: { fontSize: 11 },
  txDetail: { fontSize: 13, marginTop: 4 },
  txNote: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  moreButton: {
    margin: 20,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
  },
  moreText: { fontWeight: '600', fontSize: 13 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 14 },
  input: { borderRadius: 10, padding: 13, marginBottom: 10 },
  error: { color: '#f87171', marginBottom: 8, fontSize: 12 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 13,
    alignItems: 'center',
  },
  modalButtonText: { fontWeight: '600', fontSize: 14 },
  modalButtonTextDark: { color: '#0b1220', fontWeight: '600', fontSize: 14 },
});
