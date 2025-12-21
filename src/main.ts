import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import express from 'express';
import { randomUUID } from 'node:crypto';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false, // Disable default body parser to configure custom limits
  });

  const configService = app.get(ConfigService);
  const requiredEnvVars = [
    'DATABASE_URL',
    'SUPABASE_JWT_SECRET',
    'CLOUDFLARE_R2_ACCESS_KEY_ID',
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'CLOUDFLARE_R2_BUCKET_NAME',
    'CLOUDFLARE_R2_ACCOUNT_ID',
  ];

  const missingEnvVars = requiredEnvVars.filter(
    (key) => !configService.get(key),
  );

  if (missingEnvVars.length > 0) {
    console.error(
      `❌ Missing required environment variables: ${missingEnvVars.join(', ')}`,
    );
    process.exit(1);
  }

  // Stripe Price ID validation (warnings - not fatal in development)
  const stripePriceIds = [
    'STRIPE_STARTER_PRICE_ID',
    'STRIPE_PRO_PRICE_ID',
    'STRIPE_AGENCY_PRICE_ID',
    'STRIPE_STARTER_YEARLY_PRICE_ID',
    'STRIPE_PRO_YEARLY_PRICE_ID',
    'STRIPE_AGENCY_YEARLY_PRICE_ID',
    'STRIPE_STARTER_TOPUP_PRICE_ID',
    'STRIPE_PRO_TOPUP_PRICE_ID',
    'STRIPE_AGENCY_TOPUP_PRICE_ID',
  ];

  const missingStripeIds = stripePriceIds.filter(
    (key) => !configService.get(key),
  );

  if (missingStripeIds.length > 0) {
    const isProduction = process.env.NODE_ENV === 'production';
    const message = `⚠️  Missing Stripe Price IDs: ${missingStripeIds.join(', ')}`;
    if (isProduction) {
      // Changed from process.exit(1) to warning only - allows app to start without Stripe fully configured
      console.warn(`⚠️  ${message} - Payment processing will fail until configured!`);
    } else {
      console.warn(message);
    }
  } else {
    console.log('✅ All Stripe Price IDs configured');
  }

  // Log configured price IDs for debugging (first 12 chars only for security)
  console.log('📋 Stripe Price ID Configuration:');
  stripePriceIds.forEach(key => {
    const value = configService.get(key);
    console.log(`   - ${key}: ${value ? value.substring(0, 12) + '...' : 'NOT SET'}`);
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
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'X-Correlation-Id',
    ],
    exposedHeaders: ['X-Correlation-Id', 'Retry-After'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400,
  });
  app.use((req: any, res: any, next: any) => {
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:3000',
      'https://www.daygen.ai',
      'https://daygen.ai',
    ];

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    );
    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Accept, Origin, X-Requested-With',
    );

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    next();
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
