import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect((res.body as { status: string }).status).toBe('ok');
      });
  });

  it('/auth/signup (POST)', () => {
    const timestamp = Date.now();
    return request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `test${timestamp}@example.com`,
        password: 'password123',
        displayName: 'Test User',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('accessToken');
        expect(res.body).toHaveProperty('user');
        expect((res.body as { user: { email: string } }).user.email).toBe(
          `test${timestamp}@example.com`,
        );
      });
  });

  it('/auth/login (POST)', async () => {
    const timestamp = Date.now();
    const email = `login${timestamp}@example.com`;

    // First create a user
    await request(app.getHttpServer()).post('/auth/signup').send({
      email,
      password: 'password123',
      displayName: 'Login User',
    });

    // Then test login
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email,
        password: 'password123',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('accessToken');
        expect(res.body).toHaveProperty('user');
        expect((res.body as { user: { email: string } }).user.email).toBe(
          email,
        );
      });
  });

  it('/auth/forgot-password (POST)', () => {
    return request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({
        email: 'test@example.com',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('message');
      });
  });
});
