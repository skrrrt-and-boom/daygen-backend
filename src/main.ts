import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import express from 'express';
import { randomUUID } from 'node:crypto';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false, // Disable default body parser to configure custom limits
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: '', method: RequestMethod.GET }, // Exclude root path
      { path: 'webhooks/stripe', method: RequestMethod.POST }, // Exclude webhook from prefix
    ],
  });
  // Enable CORS with wildcard or function-based origin for production
  // This ensures CORS works even when there are multiple domains or subdomains
  app.enableCors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
        'http://localhost:3000',
        'https://www.daygen.ai',
        'https://daygen.ai',
      ];
      
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) {
        callback(null, true);
        return;
      }
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log(`⚠️  CORS blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'X-Correlation-Id',
    ],
    exposedHeaders: ['X-Correlation-Id'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Correlation ID middleware
  app.use((req: any, _res: any, next: any) => {
    const id = (req.headers?.['x-correlation-id'] as string) || randomUUID();
    req.correlationId = id;
    next();
  });

  // Raw body parser for Stripe webhooks
  app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

  // JSON parser for all other routes
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Increase request timeout for long-running generation requests
  const server = app.getHttpServer();
  if (server) {
    server.timeout = 10 * 60 * 1000; // 10 minutes
    server.keepAliveTimeout = 10 * 60 * 1000; // 10 minutes
    server.headersTimeout = 10 * 60 * 1000; // 10 minutes
  }

  const port = process.env.PORT ?? 3000;

  console.log(`🔧 Environment check:`);
  console.log(`   - NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`   - PORT: ${port}`);
  console.log(
    `   - DATABASE_URL: ${process.env.DATABASE_URL ? 'Set' : 'Not set'}`,
  );
  console.log(`   - JWT_SECRET: ${process.env.JWT_SECRET ? 'Set' : 'Not set'}`);
  try {
    await app.listen(port, '0.0.0.0');
    console.log(`🚀 Server running on http://0.0.0.0:${port}`);
    console.log(`✅ Health check available at http://0.0.0.0:${port}/health`);
  } catch (error) {
    console.error(`❌ Failed to start server:`, error);
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'EADDRINUSE'
    ) {
      console.error(
        `❌ Port ${port} is already in use. Please kill the existing process or use a different port.`,
      );
      console.error(
        `   You can kill the process using: kill -9 $(lsof -ti:${port})`,
      );
      process.exit(1);
    }
    throw error;
  }
}
void bootstrap();
