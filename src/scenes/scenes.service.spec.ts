import { ScenesService } from './scenes.service';
import type { ConfigService } from '@nestjs/config';
import type { UsageService } from '../usage/usage.service';
import type { PaymentsService } from '../payments/payments.service';
import type { R2Service } from '../upload/r2.service';
import type { R2FilesService } from '../r2files/r2files.service';
import type { SanitizedUser } from '../users/types';
import type { GenerateSceneDto } from './dto/generate-scene.dto';
import type { CloudTasksService } from '../jobs/cloud-tasks.service';

describe('ScenesService', () => {
  let service: ScenesService;
  let configService: jest.Mocked<ConfigService>;
  let usageService: jest.Mocked<UsageService>;
  let paymentsService: jest.Mocked<PaymentsService>;
  let r2Service: jest.Mocked<R2Service>;
  let r2FilesService: jest.Mocked<R2FilesService>;
  let cloudTasksService: jest.Mocked<CloudTasksService>;

  beforeEach(() => {
    configService = {
      get: jest.fn().mockReturnValue('test-ideogram-key'),
    } as unknown as jest.Mocked<ConfigService>;

    usageService = {
      checkCredits: jest.fn().mockResolvedValue(true),
      recordGeneration: jest.fn().mockResolvedValue({
        status: 'COMPLETED',
        balanceAfter: 10,
      }),
    } as unknown as jest.Mocked<UsageService>;

    paymentsService = {
      refundCredits: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PaymentsService>;

    r2Service = {
      uploadBase64Image: jest.fn().mockResolvedValue('https://cdn.daygen.ai/result.png'),
    } as unknown as jest.Mocked<R2Service>;

    r2FilesService = {
      create: jest.fn(),
    } as unknown as jest.Mocked<R2FilesService>;

    cloudTasksService = {
      createSceneGenerationJob: jest.fn().mockResolvedValue({ jobId: 'job-123' }),
    } as unknown as jest.Mocked<CloudTasksService>;

    service = new ScenesService(
      configService,
      usageService,
      paymentsService,
      r2Service,
      r2FilesService,
      cloudTasksService,
    );
  });

  it('returns public-facing template metadata', () => {
    const templates = service.listTemplates();
    expect(Array.isArray(templates)).toBe(true);
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0]).toHaveProperty('id');
    expect(templates[0]).not.toHaveProperty('prompt');
    expect(templates[0]).toHaveProperty('styleOptionId');
  });

  it('throws when character image is missing', async () => {
    const user = { authUserId: 'user-1' } as SanitizedUser;
    const dto = { sceneTemplateId: 'helicopter-elephant' } as GenerateSceneDto;

    await expect(service.generateScene(user, dto, undefined as unknown as Express.Multer.File)).rejects.toThrow(
      'A character image upload is required.',
    );
  });

  it('enqueues jobs when style options are selected', async () => {
    const user = { authUserId: 'user-3' } as SanitizedUser;
    const dto = {
      styleOptionId: 'female-lifestyle-black-suit-studio',
    } as GenerateSceneDto;

    const characterImage = {
      buffer: Buffer.from('avatar'),
      size: 1024,
      mimetype: 'image/png',
      originalname: 'avatar.png',
    } as Express.Multer.File;

    const jobHandle = await service.generateScene(user, dto, characterImage);

    expect(jobHandle).toEqual({ jobId: 'job-123' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const uploadMock = r2Service.uploadBase64Image as jest.Mock;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const createSceneJobMock = cloudTasksService.createSceneGenerationJob as jest.Mock;

    expect(uploadMock).toHaveBeenCalled();
    expect(createSceneJobMock).toHaveBeenCalledWith(
      user.authUserId,
      expect.objectContaining({
        provider: 'scene-placement',
        model: 'ideogram-remix',
        dto: expect.objectContaining({
          styleOptionId: 'female-lifestyle-black-suit-studio',
        }),
        sceneTemplate: expect.objectContaining({
          styleOptionId: 'female-lifestyle-black-suit-studio',
        }),
      }),
    );
  });
});


