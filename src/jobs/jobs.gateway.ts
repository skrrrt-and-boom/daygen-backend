import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

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
  private userSockets = new Map<string, Set<string>>();

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
    
    client.join(`user:${userId}`);
    this.logger.log(`User ${userId} subscribed to job updates`);
    
    // Send confirmation
    client.emit('subscribed', { userId });
  }

  @SubscribeMessage('unsubscribe-jobs')
  handleUnsubscribeJobs(client: Socket, payload: { userId: string }) {
    const { userId } = payload;
    client.leave(`user:${userId}`);
    this.logger.log(`User ${userId} unsubscribed from job updates`);
    
    // Send confirmation
    client.emit('unsubscribed', { userId });
  }

  // Method to broadcast job updates
  async broadcastJobUpdate(userId: string, jobUpdate: any) {
    this.server.to(`user:${userId}`).emit('job-update', jobUpdate);
    this.logger.log(`Broadcasted job update to user ${userId}:`, jobUpdate);
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
