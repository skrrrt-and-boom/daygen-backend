import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { LoggerService } from '../common/logger.service';

@WebSocketGateway({
  cors: {
    origin: [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://daygen0.vercel.app',
      'https://daygen.ai',
      /^https:\/\/.*\.vercel\.app$/,
      /^https:\/\/.*\.vercel\.dev$/,
    ],
    credentials: true,
  },
})
export class JobsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(JobsGateway.name);
  private readonly structuredLogger: LoggerService;
  private userSockets = new Map<string, Set<string>>();

  constructor(structuredLogger: LoggerService) {
    this.structuredLogger = structuredLogger;
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Clean up user socket mapping
    for (const [userId, sockets] of this.userSockets.entries()) {
      sockets.delete(client.id);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  @SubscribeMessage('subscribe-jobs')
  handleSubscribeJobs(client: Socket, payload: { userId: string }) {
    const { userId } = payload;

    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(client.id);

    void client.join(`user:${userId}`);
    this.logger.log(`User ${userId} subscribed to job updates`);

    // Send confirmation
    client.emit('subscribed', { userId });
  }

  @SubscribeMessage('unsubscribe-jobs')
  handleUnsubscribeJobs(client: Socket, payload: { userId: string }) {
    const { userId } = payload;
    void client.leave(`user:${userId}`);
    this.logger.log(`User ${userId} unsubscribed from job updates`);

    // Send confirmation
    client.emit('unsubscribed', { userId });
  }

  // Method to broadcast job updates
  broadcastJobUpdate(userId: string, jobUpdate: Record<string, unknown>) {
    try {
      this.server.to(`user:${userId}`).emit('job-update', jobUpdate);
      this.structuredLogger.logJobEvent('websocket_broadcast', {
        userId,
        jobId: jobUpdate.jobId,
        status: jobUpdate.status,
        progress: jobUpdate.progress,
        connectedSockets: this.getUserSocketsCount(userId),
      });
      this.logger.log(`Broadcasted job update to user ${userId}:`, jobUpdate);
    } catch (error) {
      this.structuredLogger.logError(error as Error, {
        context: 'websocket_broadcast',
        userId,
        jobId: jobUpdate.jobId,
      });
      this.logger.error(
        `Failed to broadcast job update to user ${userId}:`,
        error,
      );

      // Implement fallback mechanism - could store in database for polling
      this.handleBroadcastFailure(userId, jobUpdate);
    }
  }

  private handleBroadcastFailure(
    userId: string,
    jobUpdate: Record<string, unknown>,
  ) {
    // Store failed broadcast for later retry or polling fallback
    this.structuredLogger.logJobEvent('websocket_broadcast_failed', {
      userId,
      jobId: jobUpdate.jobId,
      fallback: 'database_storage',
    });

    // TODO: Implement database storage for failed broadcasts
    // This could be used by a polling mechanism as fallback
  }

  // Method to get connected users count
  getConnectedUsersCount(): number {
    return this.userSockets.size;
  }

  // Method to get user's connected sockets count
  getUserSocketsCount(userId: string): number {
    return this.userSockets.get(userId)?.size || 0;
  }
}
