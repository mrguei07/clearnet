import { Platform } from 'react-native';

/**
 * Résolution cross-platform de l'URL de l'API :
 * - Émulateur Android : 10.0.2.2 pointe vers le localhost de la machine hôte.
 * - Simulateur iOS / web : localhost fonctionne directement.
 * - Appareil physique : définir EXPO_PUBLIC_API_URL (IP LAN de la machine).
 */
function resolveBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return envUrl;
  if (Platform.OS === 'android') return 'http://10.0.2.2:3000/api';
  return 'http://localhost:3000/api';
}

export const API_BASE_URL = resolveBaseUrl();

export interface ApiError {
  message?: string | string[];
  statusCode?: number;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const data = (await response.json().catch(() => ({}))) as T & ApiError;

  if (!response.ok) {
    const message =
      typeof data.message === 'string'
        ? data.message
        : Array.isArray(data.message)
          ? data.message.join(', ')
          : `Erreur ${response.status}`;
    throw new Error(message);
  }
  return data;
}
