import { useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../api/client';

/** Contrat réel du gateway backend (namespace /transactions, room user:<email>). */
export interface TransactionStatusEvent {
  txId: string;
  /** V1.4 Axe 4 : PENDING_MULTISIG = soumise au multisig 2/3, en attente d'exécution. */
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'PENDING_MULTISIG';
  hash?: string;
  error?: string;
  at: string;
}

export type LiveEvent =
  | { type: 'transaction'; payload: TransactionStatusEvent }
  | { type: 'connection'; payload: { message?: string } }
  | { type: 'error'; payload: { message: string } };

interface UseSocketOptions {
  enabled: boolean;
  token?: string | null;
  onEvent?: (event: LiveEvent) => void;
}

/**
 * WebSocket temps réel (V1.3) : s'abonne au gateway NestJS
 * (socket.io, namespace `/transactions`, handshake authentifié JWT via
 * `auth.token`, room `user:<email>`) et écoute `transaction:status`
 * ({txId, status: PENDING|SUCCESS|FAILED|PENDING_MULTISIG, hash?, error?, at}).
 * Web : aucun flux live (fallback REST).
 */
export function useTransactionWebSocket({ enabled, token, onEvent }: UseSocketOptions) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const socketRef = useRef<Socket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled || !token) {
      setStatus('disconnected');
      return;
    }
    if (Platform.OS === 'web') {
      setStatus('disconnected');
      return;
    }

    const wsUrl = API_BASE_URL.replace('/api', '');
    const socket = io(`${wsUrl}/transactions`, {
      transports: ['websocket'],
      auth: { token },
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      timeout: 8000,
    });
    socketRef.current = socket;
    setStatus('connecting');

    socket.on('connect', () => {
      setStatus('connected');
      onEventRef.current?.({ type: 'connection', payload: {} });
    });
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', () => setStatus('disconnected'));
    socket.on('transaction:status', (payload: TransactionStatusEvent) => {
      onEventRef.current?.({ type: 'transaction', payload });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, token]);

  const reconnect = useCallback(() => {
    socketRef.current?.connect();
  }, []);

  return { status, reconnect };
}
