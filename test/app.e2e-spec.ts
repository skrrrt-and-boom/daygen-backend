import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import type { HealthCheckResult } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { AppModule } from './../src/app.module';

describe('App e2e', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL) {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    }

    process.env.SKIP_DATABASE_HEALTHCHECK =
      process.env.SKIP_DATABASE_HEALTHCHECK ?? 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api', {
      exclude: [{ path: 'health', method: RequestMethod.GET }],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns Hello World on the API root', async () => {
    const response = await request(httpServer).get('/api');

    expect(response.status).toBe(200);
    expect(response.text).toBe('Hello World!');
  });

  it('reports service health without the API prefix', async () => {
    const response = await request(httpServer).get('/health');
    const health = response.body as HealthCheckResult;

    expect(response.status).toBe(200);
    expect(health.status).toBe('ok');
    if (process.env.SKIP_DATABASE_HEALTHCHECK === 'true') {
      expect(health.details).toEqual({});
    } else {
      expect(health.details?.database?.status).toBe('up');
    }
  });
});
