import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

/** Payload de l'événement `transaction:status` (diffusé dans la room de l'émetteur). */
export interface TransactionStatusEvent {
  txId: string;
  /** V1.4 Axe 4 : PENDING_MULTISIG = soumise au multisig 2/3, en attente d'exécution. */
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'PENDING_MULTISIG';
  hash?: string;
  error?: string;
  at: string;
}

/**
 * Passerelle temps réel (socket.io) — fin du "fire-and-forget" silencieux.
 * Connexion authentifiée par JWT (handshake auth.token ou query token) ;
 * le client rejoint la room `user:<email>` et reçoit `transaction:status`
 * à chaque évolution du règlement on-chain de ses transactions.
 *
 * Rétrocompatibilité : aucun impact si le socket n'est pas utilisé — le flux
 * HTTP reste inchangé ; le gateway ne fait que diffuser des événements.
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: 'transactions',
})
export class TransactionGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TransactionGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  /** Authentifie le handshake et inscrit le client dans sa room. */
  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ||
        (client.handshake.query?.token as string | undefined);
      if (!token) throw new Error('token manquant');
      const payload = await this.jwtService.verifyAsync<{ email: string }>(token);
      const room = `user:${payload.email}`;
      await client.join(room);
      this.logger.log(`Socket connecté — ${payload.email} (${client.id}) → room ${room}`);
    } catch (error) {
      this.logger.warn(`Socket rejeté (${client.id}) : ${(error as Error).message}`);
      client.disconnect(true);
    }
  }

  /** Diffuse l'évolution du statut d'une transaction au propriétaire. */
  notifyTransactionStatus(email: string, event: TransactionStatusEvent) {
    const room = `user:${email}`;
    if (!this.server) {
      this.logger.warn(`Gateway non initialisé — statut ${event.txId} non diffusé`);
      return;
    }
    this.server.to(room).emit('transaction:status', event);
  }
}
