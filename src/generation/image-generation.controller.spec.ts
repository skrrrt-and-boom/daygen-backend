/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ImageGenerationController } from './image-generation.controller';
import { CloudTasksService } from '../jobs/cloud-tasks.service';
import { GenerationService } from './generation.service';
import { GenerationOrchestrator } from './generation.orchestrator';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SanitizedUser } from '../users/types';
import { ProviderGenerateDto } from './dto/base-generate.dto';

describe('ImageGenerationController', () => {
    let controller: ImageGenerationController;
    let cloudTasksService: CloudTasksService;
    let generationService: GenerationService;
    let generationOrchestrator: GenerationOrchestrator;

    const mockUser: SanitizedUser = {
        authUserId: 'user-123',
        email: 'test@example.com',
        id: 'user-123',
        displayName: 'Test User',
        credits: 100,
        profileImage: null,
        role: 'USER',
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [ImageGenerationController],
            providers: [
                {
                    provide: CloudTasksService,
                    useValue: {
                        createImageGenerationJob: jest.fn(),
                    },
                },
                {
                    provide: GenerationService,
                    useValue: {
                        variateRecraftImage: jest.fn(),
                    },
                },
                {
                    provide: GenerationOrchestrator,
                    useValue: {
                        generate: jest.fn(),
                    },
                },
            ],
        }).compile();

        controller = module.get<ImageGenerationController>(ImageGenerationController);
        cloudTasksService = module.get<CloudTasksService>(CloudTasksService);
        generationService = module.get<GenerationService>(GenerationService);
        generationOrchestrator = module.get<GenerationOrchestrator>(GenerationOrchestrator);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('generate', () => {
        it('should throw NotFoundException for unknown provider', async () => {
            const dto: ProviderGenerateDto = { prompt: 'test', providerOptions: {} };
            await expect(controller.generate('unknown', mockUser, dto)).rejects.toThrow(
                NotFoundException,
            );
        });

        it('should use default model if not provided', async () => {
            const dto: ProviderGenerateDto = { prompt: 'test', providerOptions: {} };
            await controller.generate('flux', mockUser, dto);

            expect(cloudTasksService.createImageGenerationJob).toHaveBeenCalledWith(
                mockUser.authUserId,
                expect.objectContaining({
                    provider: 'flux',
                    model: 'flux.2',
                }),
            );
        });

        it('should validate allowed models', async () => {
            const dto: ProviderGenerateDto = { prompt: 'test', model: 'invalid-model', providerOptions: {} };
            await expect(controller.generate('flux', mockUser, dto)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('should allow valid models', async () => {
            const dto: ProviderGenerateDto = { prompt: 'test', model: 'flux.2', providerOptions: {} };
            await controller.generate('flux', mockUser, dto);

            expect(cloudTasksService.createImageGenerationJob).toHaveBeenCalledWith(
                mockUser.authUserId,
                expect.objectContaining({
                    provider: 'flux',
                    model: 'flux.2',
                }),
            );
        });

        it('should queue job by default', async () => {
            const dto: ProviderGenerateDto = { prompt: 'test', providerOptions: {} };
            await controller.generate('flux', mockUser, dto);

            expect(cloudTasksService.createImageGenerationJob).toHaveBeenCalled();
            expect(generationOrchestrator.generate).not.toHaveBeenCalled();
        });

        it('should allow inline generation for supported providers (gemini)', async () => {
            const dto: ProviderGenerateDto = {
                prompt: 'test',
                providerOptions: { useInline: true },
            };
            await controller.generate('gemini', mockUser, dto);

            expect(generationOrchestrator.generate).toHaveBeenCalledWith(
                mockUser,
                expect.objectContaining({
                    model: 'gemini-3.0-pro-image',
                }),
            );
            expect(cloudTasksService.createImageGenerationJob).not.toHaveBeenCalled();
        });

        it('should throw BadRequest for unsupported inline gemini model', async () => {
            const dto: ProviderGenerateDto = {
                prompt: 'test',
                model: 'gemini-pro-vision', // unsupported
                providerOptions: { useInline: true },
            };
            await expect(controller.generate('gemini', mockUser, dto)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('should queue gemini if requested', async () => {
            const dto: ProviderGenerateDto = {
                prompt: 'test',
                providerOptions: { useQueue: true },
            };
            await controller.generate('gemini', mockUser, dto);

            expect(cloudTasksService.createImageGenerationJob).toHaveBeenCalled();
            expect(generationOrchestrator.generate).not.toHaveBeenCalled();
        });
    });

    describe('variateRecraftImage', () => {
        it('should call generationService.variateRecraftImage', async () => {
            const file = {} as Express.Multer.File;
            const body = { prompt: 'test' };
            await controller.variateRecraftImage(mockUser, file, body);

            expect(generationService.variateRecraftImage).toHaveBeenCalledWith(
                mockUser,
                expect.objectContaining({
                    file,
                    prompt: 'test',
                }),
            );
        });

        it('should throw BadRequest if file is missing', async () => {
            const body = { prompt: 'test' };
            await expect(
                controller.variateRecraftImage(mockUser, undefined as any, body),
            ).rejects.toThrow(BadRequestException);
        });
    });
});
