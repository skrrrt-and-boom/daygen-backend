import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import pino from 'pino';

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: pino.Logger;

  constructor() {
    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      ...(process.env.NODE_ENV === 'development' && {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }),
    });
  }

  log(message: string, context?: string | Record<string, unknown>) {
    this.logger.info(this.formatContext(context), message);
  }

  error(
    message: string,
    trace?: string,
    context?: string | Record<string, unknown>,
  ) {
    this.logger.error(
      {
        ...this.formatContext(context),
        trace,
      },
      message,
    );
  }

  warn(message: string, context?: string | Record<string, unknown>) {
    this.logger.warn(this.formatContext(context), message);
  }

  debug(message: string, context?: string | Record<string, unknown>) {
    this.logger.debug(this.formatContext(context), message);
  }

  verbose(message: string, context?: string | Record<string, unknown>) {
    this.logger.trace(this.formatContext(context), message);
  }

  private formatContext(
    context?: string | Record<string, unknown>,
  ): Record<string, unknown> {
    if (typeof context === 'string') {
      return { context };
    }
    return context || {};
  }

  // Custom methods for structured logging
  logJobEvent(event: string, data: Record<string, unknown>) {
    this.logger.info({
      event,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  logError(error: Error, context: Record<string, unknown> = {}) {
    this.logger.error({
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...context,
      timestamp: new Date().toISOString(),
    });
  }

  logPerformance(
    operation: string,
    duration: number,
    metadata: Record<string, unknown> = {},
  ) {
    this.logger.info({
      event: 'performance',
      operation,
      duration,
      ...metadata,
      timestamp: new Date().toISOString(),
    });
  }
}
