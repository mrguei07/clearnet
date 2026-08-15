import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../api/client';
import { INDUSTRIES } from '../constants/industries';
import { useTheme } from '../contexts/ThemeContext';

interface AuthResponse {
  access_token: string;
  user: { id: string; email: string; name: string; industry?: string | null };
}

interface Props {
  onAuthenticated: (token: string, email: string, industryCode?: string | null) => void;
  onBack: () => void;
}

/**
 * Inscription sectorielle (V1.3) : picker obligatoire des 15 secteurs avec
 * icône et description courte. Le champ `industry` est validé par le backend
 * (register.dto) ; le thème de l'application est dérivé du secteur.
 */
export default function RegisterScreen({ onAuthenticated, onBack }: Props) {
  const theme = useTheme();
  const { palette } = theme;
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [industry, setIndustry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (!industry) {
      setError('Veuillez sélectionner votre secteur d’activité.');
      return;
    }
    if (!email || !name || password.length < 6) {
      setError('Nom, email et mot de passe (6+ caractères) sont requis.');
      return;
    }
    setLoading(true);
    try {
      const data = await api<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, name, password, industry }),
      });
      onAuthenticated(data.access_token, data.user.email, data.user.industry ?? industry);
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
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: palette.primary }]}>ClearNet</Text>
        <Text style={[styles.subtitle, { color: palette.muted }]}>
          Créez votre compte professionnel
        </Text>

        <TextInput
          testID="register-name"
          style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]}
          placeholder="Nom de l'entreprise"
          placeholderTextColor={palette.muted}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <TextInput
          testID="register-email"
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
          testID="register-password"
          style={[styles.input, { backgroundColor: palette.surface, color: palette.text }]}
          placeholder="Mot de passe (6+ caractères)"
          placeholderTextColor={palette.muted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Text style={[styles.sectionLabel, { color: palette.text }]}>
          Secteur d'activité (obligatoire)
        </Text>
        <View style={styles.chips}>
          {INDUSTRIES.map((sector) => {
            const selected = sector.code === industry;
            return (
              <Pressable
                key={sector.code}
                testID={`register-industry-${sector.code}`}
                onPress={() => setIndustry(selected ? null : sector.code)}
                style={[
                  styles.chip,
                  {
                    borderColor: selected ? sector.palette.primary : palette.surface,
                    backgroundColor: selected ? sector.palette.primary : palette.surface,
                  },
                ]}
              >
                <Text style={[styles.chipGlyph, { color: selected ? '#0b1220' : sector.palette.primary }]}>
                  {sector.glyph}
                </Text>
                <Text
                  style={[styles.chipLabel, { color: selected ? '#0b1220' : palette.text }]}
                  numberOfLines={2}
                >
                  {sector.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable testID="register-submit" style={[styles.button, { backgroundColor: palette.primary }]} onPress={submit} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Création…' : 'Créer un compte'}</Text>
        </Pressable>

        <Pressable onPress={onBack}>
          <Text style={[styles.back, { color: palette.muted }]}>← Retour à la connexion</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 24, paddingTop: 60, paddingBottom: 40 },
  title: { fontSize: 34, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 28 },
  input: {
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  sectionLabel: { fontSize: 14, fontWeight: '600', marginTop: 10, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    maxWidth: '48%',
  },
  chipGlyph: { fontSize: 14, fontWeight: '700' },
  chipLabel: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  button: { borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 6 },
  buttonText: { color: '#0b1220', fontWeight: '600', fontSize: 16 },
  error: { color: '#f87171', marginBottom: 8, textAlign: 'center' },
  back: { textAlign: 'center', marginTop: 16, fontSize: 13 },
});
