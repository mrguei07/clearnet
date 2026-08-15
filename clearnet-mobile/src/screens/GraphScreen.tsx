import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '../api/client';
import ForceGraph, { GraphData, GraphLink } from '../components/ForceGraph';
import { useTheme } from '../contexts/ThemeContext';
import { useTransactionWebSocket, LiveEvent } from '../hooks/useTransactionWebSocket';

interface EgoNetworkResponse {
  ego: string;
  nodes: Array<{
    id: string;
    label: string;
    email: string;
    balance?: number;
    urgency?: boolean;
  }>;
  links: Array<{
    source: string;
    target: string;
    value: number;
    kind: 'debt' | 'credit';
  }>;
  depth: number;
  oracleEnabled: boolean;
  generatedAt: string;
}

interface Props {
  token: string;
}

/** Adapte EgoNetwork (contrat backend) au format du composant ForceGraph. */
function toGraphData(response: EgoNetworkResponse): GraphData {
  const volumes = new Map<string, { incoming: number; outgoing: number; count: number }>();
  const links: GraphLink[] = response.links.map((link) => {
    const outgoing = link.source === response.ego;
    const amount = link.value;
    const v = volumes.get(link.source) ?? { incoming: 0, outgoing: 0, count: 0 };
    if (outgoing) v.outgoing += amount;
    v.count += 1;
    volumes.set(link.source, v);
    const t = volumes.get(link.target) ?? { incoming: 0, outgoing: 0, count: 0 };
    if (!outgoing) t.incoming += amount;
    t.count += 1;
    volumes.set(link.target, t);
    return {
      source: link.source,
      target: link.target,
      direction: outgoing ? 'out' : 'in',
      amount,
    };
  });
  return {
    nodes: response.nodes.map((node) => {
      const v = volumes.get(node.id) ?? { incoming: 0, outgoing: 0, count: 0 };
      return {
        id: node.id,
        label: node.id === response.ego ? 'Vous' : node.label,
        isSelf: node.id === response.ego,
        incomingVolume: v.incoming,
        outgoingVolume: v.outgoing,
        txCount: v.count,
      };
    }),
    links,
  };
}

/**
 * Écran Réseau (V1.3) : ForceGraph centré sur l'utilisateur + flux live
 * (WebSocket) qui rafraîchit le graphe à chaque transaction créée sur le
 * réseau, sans nécessiter de reload manuel.
 */
export default function GraphScreen({ token }: Props) {
  const { palette } = useTheme();
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string>('connexion…');

  const loadGraph = useCallback(async () => {
    try {
      const graph = await api<EgoNetworkResponse>('/graph/egonet?depth=2', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(toGraphData(graph));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de charger le graphe');
    }
  }, [token]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadGraph();
    setRefreshing(false);
  }, [loadGraph]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const handleLiveEvent = useCallback(
    (event: LiveEvent) => {
      if (event.type === 'transaction') {
        setLiveStatus(`Live · ${new Date(event.payload.at).toLocaleTimeString('fr-FR')}`);
        void loadGraph();
      } else if (event.type === 'connection') {
        setLiveStatus('Connecté');
      } else if (event.type === 'error') {
        setLiveStatus('Flux coupé — polling actif');
      }
    },
    [loadGraph],
  );

  const { status } = useTransactionWebSocket({ enabled: true, token, onEvent: handleLiveEvent });

  useEffect(() => {
    if (status === 'connected') setLiveStatus('Connecté');
    if (status === 'connecting') setLiveStatus('Connexion…');
  }, [status]);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>Réseau de paiement</Text>
        <View style={styles.liveRow}>
          <View
            style={[
              styles.liveDot,
              { backgroundColor: status === 'connected' ? palette.accent : palette.muted },
            ]}
          />
          <Text style={[styles.liveText, { color: palette.muted }]}>{liveStatus}</Text>
        </View>
      </View>

      {error && (
        <View style={[styles.errorBox, { backgroundColor: palette.surface }]}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={refresh}>
            <Text style={[styles.retry, { color: palette.primary }]}>Réessayer</Text>
          </Pressable>
        </View>
      )}

      {!data && !error && (
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
        </View>
      )}

      {data && <ForceGraph data={data} style={styles.graph} />}

      {data && data.nodes.length <= 1 && (
        <Text style={[styles.empty, { color: palette.muted }]}>
          Aucun partenaire détecté : les liens apparaîtront dès les premières transactions.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 12 },
  center: { padding: 40, alignItems: 'center' },
  graph: { margin: 20, marginTop: 12 },
  empty: { textAlign: 'center', paddingHorizontal: 24, paddingBottom: 24, fontSize: 13 },
  errorBox: {
    margin: 20,
    marginTop: 8,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorText: { color: '#f87171', fontSize: 13, flex: 1 },
  retry: { fontWeight: '600', fontSize: 13, marginLeft: 12 },
});
