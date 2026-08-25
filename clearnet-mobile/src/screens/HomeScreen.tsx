import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../api/client';
import { useTheme } from '../contexts/ThemeContext';
import { useTransactionWebSocket, LiveEvent } from '../hooks/useTransactionWebSocket';

interface BalanceResponse {
  balance: number;
  currency: string;
  lastTransaction?: {
    id: string;
    fromEmail: string;
    toEmail: string;
    amount: number;
    createdAt: string;
  } | null;
}
interface Props {
  token: string;
  onLogout: () => void;
  onOpenTransactions: () => void;
}

/**
 * Écran d'accueil (V1.3) : solde temps réel + dernière transaction, rafraîchi
 * par WebSocket à chaque événement transactionnel. Pull-to-refresh REST.
 */
export default function HomeScreen({ token, onLogout, onOpenTransactions }: Props) {
  const { palette } = useTheme();
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [livePulse, setLivePulse] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<BalanceResponse>('/transactions/balance', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setBalance(data);
    } catch {
      // silencieux : le pull-to-refresh montrera l'erreur au prochain essai
    }
  }, [token]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleLiveEvent = useCallback((event: LiveEvent) => {
    if (event.type === 'transaction') {
      setLivePulse(Date.now());
    }
  }, []);

  useTransactionWebSocket({ enabled: true, token, onEvent: handleLiveEvent });

  useEffect(() => {
    if (livePulse === null) return;
    const timer = setTimeout(() => void load(), 300);
    return () => clearTimeout(timer);
  }, [livePulse, load]);

  const fmt = (value: number | undefined | null) =>
    new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: balance?.currency ?? 'EUR',
      maximumFractionDigits: 2,
    }).format(value ?? 0);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Supprimer mon compte',
      'Cette action est irréversible : vos données personnelles seront effacées et vous perdrez l’accès à votre compte.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await api('/auth/account', {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              onLogout();
            } catch {
              Alert.alert('Erreur', 'Impossible de supprimer le compte pour le moment.');
            }
          },
        },
      ],
    );
  }, [token, onLogout]);

  return (
    <ScrollView
      testID="home-screen"
      style={[styles.container, { backgroundColor: palette.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>Bonjour</Text>
        <Pressable testID="logout" onPress={onLogout}>
          <Text style={[styles.logout, { color: palette.muted }]}>Déconnexion</Text>
        </Pressable>
      </View>

      {!balance && (
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      )}

      {balance && (
        <>
          <View style={[styles.balanceCard, { backgroundColor: palette.primary }]}>
            <Text style={styles.balanceLabel}>Solde disponible</Text>
            <Text style={styles.balanceValue}>{fmt(balance.balance)}</Text>
            {balance.lastTransaction && (
              <Text style={styles.lastTx}>
                Dernière opération : {fmt(balance.lastTransaction.amount)} (
                {new Date(balance.lastTransaction.createdAt).toLocaleDateString('fr-FR')})
              </Text>
            )}
          </View>

          <Pressable
            testID="go-transactions"
            style={[styles.card, { backgroundColor: palette.surface }]}
            onPress={onOpenTransactions}
          >
            <View>
              <Text style={[styles.cardTitle, { color: palette.text }]}>Transactions</Text>
              <Text style={[styles.cardSub, { color: palette.muted }]}>
                Historique complet, création et suivi en direct
              </Text>
            </View>
            <Text style={[styles.cardArrow, { color: palette.primary }]}>→</Text>
          </Pressable>

          {livePulse !== null && (
            <View testID="toast-network-restored" style={styles.liveBanner}>
              <View style={[styles.liveDot, { backgroundColor: palette.accent }]} />
              <Text style={[styles.liveText, { color: palette.muted }]}>
                Mise à jour temps réel effectuée
              </Text>
            </View>
          )}
        </>
      )}

      <View style={styles.dangerZone}>
        <Pressable testID="delete-account" onPress={handleDeleteAccount}>
          <Text style={styles.deleteAccount}>Supprimer mon compte</Text>
        </Pressable>
      </View>
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
  title: { fontSize: 26, fontWeight: '700' },
  logout: { fontSize: 13, fontWeight: '600' },
  center: { padding: 40, alignItems: 'center' },
  balanceCard: {
    borderRadius: 18,
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 16,
  },
  balanceLabel: { fontSize: 13, color: '#0b1220', opacity: 0.75, fontWeight: '600' },
  balanceValue: { fontSize: 34, fontWeight: '800', color: '#0b1220', marginTop: 2 },
  lastTx: { fontSize: 12, color: '#0b1220', opacity: 0.7, marginTop: 8 },
  card: {
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardSub: { fontSize: 12, marginTop: 2 },
  cardArrow: { fontSize: 20, fontWeight: '700' },
  liveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 20,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 12 },
  dangerZone: { marginHorizontal: 20, marginTop: 24, marginBottom: 40 },
  deleteAccount: { color: '#ef4444', fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
