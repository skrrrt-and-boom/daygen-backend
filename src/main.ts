import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

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
  // Enable CORS for production domains (daygen.ai) and development
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:3000',
      'https://www.daygen.ai',
      'https://daygen.ai',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Configure body parser with larger limits for gallery images
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const express = require('express');
  
  // Raw body parser for Stripe webhooks
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
  
  // JSON parser for all other routes
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  app.use(express.json({ limit: '50mb' }));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Increase request timeout for long-running generation requests
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const server = app.getHttpServer();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  server.timeout = 10 * 60 * 1000; // 10 minutes
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  server.keepAliveTimeout = 10 * 60 * 1000; // 10 minutes
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  server.headersTimeout = 10 * 60 * 1000; // 10 minutes

  const port = process.env.PORT ?? 3000;
  try {
    await app.listen(port, '0.0.0.0');
    console.log(`🚀 Server running on http://0.0.0.0:${port}`);
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (error.code === 'EADDRINUSE') {
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
