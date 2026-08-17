import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Toast from 'react-native-toast-message';
import { api } from '../api/client';
import { useTheme } from '../contexts/ThemeContext';

interface BillingStatus {
  tier: 'FREE' | 'ESSENTIAL' | 'PRO' | 'ENTERPRISE';
  customerId: string | null;
  quotaUsed: number;
  quotaMax: number | null;
}

const WARN_COLOR = '#f87171';

/** V1.5 Pricing — Écran « Abonnement » : statut FREE/ESSENTIAL/PRO/ENTERPRISE,
 *  quota du mois civil UTC (barre pour tout niveau à quota fini, « ∞ » pour
 *  Enterprise), lien de checkout Stripe hébergé (deep link clearnet://billing
 *  en retour). 3.2 : libellé « Tx ce mois (mois civil UTC) » + alerte ≥ 80 % ;
 *  3.6 : badge early adopter. */
export default function BillingScreen({ token }: { token: string }) {
  const { palette } = useTheme();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [earlyAdopter, setEarlyAdopter] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api<BillingStatus>('/billing/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStatus(data);
      setEarlyAdopter(false);
      setError(null);
    } catch (e) {
      setError(String(e));
      setStatus(null);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upgrade = async () => {
    setBusy(true);
    try {
      const data = await api<{ url: string }>('/billing/create-checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      await Linking.openURL(data.url);
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Abonnement indisponible', text2: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const used = status?.quotaUsed ?? 0;
  const quota = status?.quotaMax ?? 10;
  const unlimited = quota == null;
  const pct = unlimited ? 0 : Math.round((used / quota) * 100);
  const warn = pct >= 80;

  return (
    <ScrollView style={styles.box} testID="billing-screen">
      <Text style={[styles.title, { color: palette.text }]}>Abonnement ClearNet</Text>
      {error && <Text style={styles.error}>Service indisponible ({error})</Text>}
      {!error && status && (
        <>
          <Text style={[styles.row, { color: palette.text }]} testID="billing-tier">
            Formule : {status.tier}
          </Text>
          {earlyAdopter && (
            <Text style={styles.badge} testID="billing-early-adopter">
              Early Adopter — quota exempté
            </Text>
          )}
          {status.tier !== 'ENTERPRISE' && !earlyAdopter && (
            <>
              <Text style={[styles.row, { color: palette.text }]} testID="billing-quota">
                Tx ce mois (mois civil UTC) : {used} / {unlimited ? '∞' : quota}
              </Text>
              <View style={[styles.bar, { backgroundColor: palette.surface }]}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${Math.min(pct, 100)}%`, backgroundColor: warn ? WARN_COLOR : palette.primary },
                  ]}
                  testID={pct >= 80 ? 'billing-quota-fill-high' : 'billing-quota-fill'}
                />
              </View>
              <Text style={[styles.hint, { color: warn ? WARN_COLOR : palette.muted }]}>
                {warn
                  ? 'Quota presque atteint — passez au niveau supérieur pour continuer'
                  : unlimited
                    ? 'Quota illimité'
                    : `${pct} % du quota mensuel consommé`}
              </Text>
            </>
          )}
          <Pressable
            testID="billing-upgrade"
            onPress={upgrade}
            disabled={busy}
            style={[styles.cta, { backgroundColor: busy ? palette.muted : palette.primary }]}
          >
            <Text style={styles.ctaText}>
              {status.tier === 'FREE' ? 'Passer au niveau supérieur' : 'Gérer mon abonnement'}
            </Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 24 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  row: { fontSize: 16, marginBottom: 10 },
  badge: {
    alignSelf: 'flex-start',
    fontSize: 13,
    fontWeight: '600',
    color: '#065f46',
    backgroundColor: '#d1fae5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 10,
  },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  barFill: { height: 8, borderRadius: 4, backgroundColor: '#38bdf8' },
  hint: { fontSize: 12, marginBottom: 18 },
  cta: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  ctaText: { color: '#0b1220', fontSize: 16, fontWeight: '700' },
  error: { color: '#f87171', fontSize: 13, marginBottom: 12 },
});