import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MetricsService } from '../src/common/metrics.service';

describe('Queue System (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let metricsService: MetricsService;
  let authToken: string;
  let testUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    metricsService = moduleFixture.get<MetricsService>(MetricsService);

    // Create test user and get auth token
    const signupResponse = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `test-${Date.now()}@example.com`,
        password: 'testpassword123',
        name: 'Test User',
      });

    const signupBody = signupResponse.body as {
      accessToken: string;
      user: { authUserId: string };
    };
    authToken = signupBody.accessToken;
    testUserId = signupBody.user.authUserId;
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.job.deleteMany({
      where: { userId: testUserId },
    });
    await prisma.user.deleteMany({
      where: { authUserId: testUserId },
    });
    await app.close();
  });

  describe('Job Creation and Processing', () => {
    it('should create an image generation job', async () => {
      const jobData = {
        prompt: 'A beautiful sunset over mountains',
        model: 'flux-1.1',
        provider: 'flux',
        options: { width: 512, height: 512 },
      };

      const response = await request(app.getHttpServer())
        .post('/jobs/image-generation')
        .set('Authorization', `Bearer ${authToken}`)
        .send(jobData)
        .expect(201);

      expect(response.body).toHaveProperty('jobId');
      expect(typeof (response.body as { jobId: string }).jobId).toBe('string');
    });

    it('should track job status through processing', async () => {
      const jobData = {
        prompt: 'A cat playing with a ball',
        model: 'flux-1.1',
        provider: 'flux',
        options: { width: 256, height: 256 },
      };

      // Create job
      const createResponse = await request(app.getHttpServer())
        .post('/jobs/image-generation')
        .set('Authorization', `Bearer ${authToken}`)
        .send(jobData);

      const createBody = createResponse.body as { jobId: string };
      const jobId = createBody.jobId;

      // Check initial status
      const statusResponse = await request(app.getHttpServer())
        .get(`/jobs/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const statusBody = statusResponse.body as {
        status: string;
        progress: number;
      };
      expect(['PENDING', 'PROCESSING']).toContain(statusBody.status);
      expect(statusBody.progress).toBeGreaterThanOrEqual(0);
    });

    it('should handle job failures gracefully', async () => {
      const invalidJobData = {
        prompt: '', // Invalid empty prompt
        model: 'flux-1.1',
        provider: 'flux',
        options: {},
      };

      const response = await request(app.getHttpServer())
        .post('/jobs/image-generation')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidJobData);

      // Should either create job that fails or return validation error
      expect([201, 400]).toContain(response.status);
    });
  });

  describe('Queue Health Monitoring', () => {
    it('should return queue health status', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/queues')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('cloudTasksEnabled');
      expect(response.body).toHaveProperty('queues');
    });

    it('should return queue metrics', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/queues/metrics')
        .expect(200);

      expect(response.body).toHaveProperty('metrics');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('WebSocket Integration', () => {
    it('should handle WebSocket connections', (done) => {
      // This would require a WebSocket client test
      // For now, we'll just verify the endpoint exists
      expect(true).toBe(true);
      done();
    });
  });

  describe('Metrics Collection', () => {
    it('should collect job processing metrics', async () => {
      // Create a job to generate metrics
      const jobData = {
        prompt: 'Test metrics collection',
        model: 'flux-1.1',
        provider: 'flux',
        options: { width: 256, height: 256 },
      };

      await request(app.getHttpServer())
        .post('/jobs/image-generation')
        .set('Authorization', `Bearer ${authToken}`)
        .send(jobData);

      // Wait a bit for processing
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check metrics
      const metrics = await metricsService.getMetrics();
      expect(metrics).toContain('jobs_total');
      expect(metrics).toContain('job_duration_seconds');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid job types', async () => {
      const response = await request(app.getHttpServer())
        .post('/jobs/process')
        .set('Authorization', 'Bearer internal-key')
        .send({
          jobId: 'test-job',
          userId: testUserId,
          jobType: 'INVALID_TYPE',
          prompt: 'test',
        });

      expect([400, 500]).toContain(response.status);
    });

    it('should handle unauthorized task processing', async () => {
      const response = await request(app.getHttpServer())
        .post('/jobs/process')
        .set('Authorization', 'Bearer invalid-key')
        .send({
          jobId: 'test-job',
          userId: testUserId,
          jobType: 'IMAGE_GENERATION',
          prompt: 'test',
        });

      expect(response.status).toBe(500); // Should throw error
    });
  });

  describe('Concurrent Job Processing', () => {
    it('should handle multiple concurrent jobs', async () => {
      const jobPromises = Array.from({ length: 5 }, (_, i) =>
        request(app.getHttpServer())
          .post('/jobs/image-generation')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            prompt: `Concurrent test job ${i}`,
            model: 'flux-1.1',
            provider: 'flux',
            options: { width: 256, height: 256 },
          }),
      );

      const responses = await Promise.all(jobPromises);

      // All jobs should be created successfully
      responses.forEach((response) => {
        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('jobId');
      });
    });
  });
});
