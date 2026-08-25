import { Component, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import Toast from 'react-native-toast-message';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import HomeScreen from './src/screens/HomeScreen';
import TransactionsScreen from './src/screens/TransactionsScreen';
import GraphScreen from './src/screens/GraphScreen';
import BillingScreen from './src/screens/BillingScreen';

const TOKEN_KEY = 'clearnet.token';
const EMAIL_KEY = 'clearnet.email';
const INDUSTRY_KEY = 'clearnet.industry';

// ---- DIAGNOSTIC TEMPORAIRE (écran d'erreur visible) ----
let globalError: string | null = null;
function formatError(e: unknown): string {
  if (e instanceof Error) return `${e.message}\n\n${e.stack ?? ''}`;
  return String(e);
}
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: formatError(e) };
  }
  render() {
    if (this.state.error) return <ErrorScreen message={this.state.error} />;
    return this.props.children;
  }
}
function ErrorScreen({ message }: { message: string }) {
  return (
    <View style={styles.fatal}>
      <Text style={styles.fatalTitle}>ERREUR (diagnostic)</Text>
      <ScrollView>
        <Text style={styles.fatalText}>{message}</Text>
      </ScrollView>
    </View>
  );
}
// ---- FIN DIAGNOSTIC TEMPORAIRE ----

type Tab = 'home' | 'transactions' | 'graph' | 'billing';

function MainTabs({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { palette } = useTheme();
  const [tab, setTab] = useState<Tab>('home');

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'home', label: 'Accueil' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'graph', label: 'Réseau' },
    { key: 'billing', label: 'Abonnement' },
  ];

  // V1.4 Axe 2 : deep link clearnet://billing (retour du checkout Stripe) → onglet Abonnement
  useEffect(() => {
    const onUrl = (e: { url: string }) => {
      if (String(e.url).includes('billing')) setTab('billing');
    };
    void Linking.getInitialURL().then((url) => {
      if (url && String(url).includes('billing')) setTab('billing');
    });
    const sub = Linking.addEventListener('url', onUrl);
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.tabContainer}>
      <View style={styles.tabContent}>
        {tab === 'home' && <HomeScreen token={token} onLogout={onLogout} onOpenTransactions={() => setTab('transactions')} />}
        {tab === 'transactions' && <TransactionsScreen token={token} />}
        {tab === 'graph' && <GraphScreen token={token} />}
        {tab === 'billing' && <BillingScreen token={token} />}
      </View>
      <View style={[styles.tabBar, { backgroundColor: palette.surface }]}>
        {tabs.map((item) => {
          const active = item.key === tab;
          return (
            <Pressable key={item.key} style={styles.tabItem} onPress={() => setTab(item.key)}>
              <Text style={[styles.tabLabel, { color: active ? palette.primary : palette.muted }]}>
                {item.label}
              </Text>
              <View
                style={[
                  styles.tabIndicator,
                  { backgroundColor: active ? palette.primary : 'transparent' },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [industry, setIndustry] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.multiGet([TOKEN_KEY, EMAIL_KEY, INDUSTRY_KEY]);
        if (stored[0][1] && stored[1][1]) {
          setToken(stored[0][1]);
          setEmail(stored[1][1]);
          setIndustry(stored[2][1] ?? null);
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    const ErrorUtilsGlobal = (globalThis as { ErrorUtils?: { setGlobalHandler: (fn: (e: unknown) => void) => void } }).ErrorUtils;
    if (ErrorUtilsGlobal) {
      ErrorUtilsGlobal.setGlobalHandler((e: unknown) => {
        globalError = formatError(e);
        setFatalError(globalError);
      });
    }
    const onError = (e: unknown) => setFatalError(formatError(e));
    (globalThis as { HermesInternal?: unknown }).HermesInternal;
    globalThis.addEventListener?.('error', onError as EventListener);
    return () => globalThis.removeEventListener?.('error', onError as EventListener);
  }, []);

  const [fatalError, setFatalError] = useState<string | null>(globalError);

  const onAuthenticated = async (newToken: string, newEmail: string, newIndustry?: string | null) => {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, newToken],
      [EMAIL_KEY, newEmail],
      [INDUSTRY_KEY, newIndustry ?? ''],
    ]);
    setToken(newToken);
    setEmail(newEmail);
    setIndustry(newIndustry ?? null);
    setShowRegister(false);
  };

  const onLogout = async () => {
    await AsyncStorage.multiRemove([TOKEN_KEY, EMAIL_KEY, INDUSTRY_KEY]);
    setToken(null);
    setEmail(null);
    setIndustry(null);
  };

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#38bdf8" />
      </View>
    );
  }

  if (fatalError) {
    return <ErrorScreen message={fatalError} />;
  }

  return (
    <ErrorBoundary>
      <ThemeProvider industryCode={industry}>
        <View style={styles.container}>
          <StatusBar style="light" />
          {token && email ? (
            <MainTabs token={token} onLogout={onLogout} />
          ) : showRegister ? (
            <RegisterScreen onAuthenticated={onAuthenticated} onBack={() => setShowRegister(false)} />
          ) : (
            <LoginScreen onAuthenticated={onAuthenticated} onRegister={() => setShowRegister(true)} />
          )}
        </View>
        <Toast />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1220' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0b1220' },
  tabContainer: { flex: 1 },
  tabContent: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingBottom: 8,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingTop: 10, gap: 4 },
  tabLabel: { fontSize: 12, fontWeight: '600' },
  tabIndicator: { width: 28, height: 3, borderRadius: 2 },
  fatal: { flex: 1, backgroundColor: '#111a2c', padding: 24, justifyContent: 'center' },
  fatalTitle: { color: '#f87171', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  fatalText: { color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 },
});
