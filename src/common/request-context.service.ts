import { Injectable, Scope } from '@nestjs/common';
import { randomUUID } from 'crypto';

@Injectable({ scope: Scope.REQUEST })
export class RequestContextService {
  private readonly requestId: string;
  private readonly startTime: number;
  private readonly context: Map<string, unknown> = new Map();

  constructor() {
    this.requestId = randomUUID();
    this.startTime = Date.now();
  }

  getRequestId(): string {
    return this.requestId;
  }

  getDuration(): number {
    return Date.now() - this.startTime;
  }

  setContext(key: string, value: unknown): void {
    this.context.set(key, value);
  }

  getContext(key: string): unknown {
    return this.context.get(key);
  }

  getAllContext(): Record<string, unknown> {
    return Object.fromEntries(this.context);
  }

  getLogContext(): Record<string, unknown> {
    return {
      requestId: this.requestId,
      duration: this.getDuration(),
      ...this.getAllContext(),
    };
  }
}
