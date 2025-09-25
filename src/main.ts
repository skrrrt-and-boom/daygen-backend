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
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  app.enableCors({
    origin: (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173,https://*.vercel.app,https://daygen0.vercel.app')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
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
  const express = require('express');
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  
  // Increase request timeout for long-running generation requests
  const server = app.getHttpServer();
  server.timeout = 10 * 60 * 1000; // 10 minutes
  server.keepAliveTimeout = 10 * 60 * 1000; // 10 minutes
  server.headersTimeout = 10 * 60 * 1000; // 10 minutes
  
  const port = process.env.PORT ?? 3000;
  try {
    await app.listen(port, '0.0.0.0');
    console.log(`🚀 Server running on http://0.0.0.0:${port}`);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} is already in use. Please kill the existing process or use a different port.`);
      console.error(`   You can kill the process using: kill -9 $(lsof -ti:${port})`);
      process.exit(1);
    }
    throw error;
  }
}
void bootstrap();
