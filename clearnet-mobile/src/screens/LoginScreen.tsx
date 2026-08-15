import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../api/client';
import { useTheme } from '../contexts/ThemeContext';

interface AuthResponse {
  access_token: string;
  user: { id: string; email: string; name: string; industry?: string | null };
}

interface Props {
  onAuthenticated: (token: string, email: string, industryCode?: string | null) => void;
  onRegister: () => void;
}

/**
 * Connexion (V1.3) : POST /auth/login, thème sectoriel appliqué à partir du
 * secteur de l'utilisateur renvoyé par le backend.
 */
export default function LoginScreen({ onAuthenticated, onRegister }: Props) {
  const { palette } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email || !password) {
      setError('Email et mot de passe requis.');
      return;
    }
    setLoading(true);
    try {
      const data = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onAuthenticated(data.access_token, data.user.email, data.user.industry ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: palette.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={[styles.title, { color: palette.primary }]}>ClearNet</Text>
        <Text style={[styles.subtitle, { color: palette.muted }]}>
          Transparence des paiements inter-entreprises
        </Text>

        <TextInput
          testID="login-email"
          style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]}
          placeholder="Email"
          placeholderTextColor={palette.muted}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          testID="login-password"
          style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]}
          placeholder="Mot de passe"
          placeholderTextColor={palette.muted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable testID="login-submit" style={[styles.button, { backgroundColor: palette.primary }]} onPress={submit} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#0b1220" />
          ) : (
            <Text style={styles.buttonText}>Se connecter</Text>
          )}
        </Pressable>

        <Pressable testID="go-register" onPress={onRegister}>
          <Text style={[styles.register, { color: palette.primary }]}>
            Pas de compte ? Créer un compte professionnel
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 40, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 32, marginTop: 4 },
  input: { borderRadius: 10, padding: 14, marginBottom: 12 },
  button: { borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 6 },
  buttonText: { color: '#0b1220', fontWeight: '600', fontSize: 16 },
  error: { color: '#f87171', marginBottom: 8, textAlign: 'center' },
  register: { textAlign: 'center', marginTop: 16, fontSize: 13, fontWeight: '600' },
});
