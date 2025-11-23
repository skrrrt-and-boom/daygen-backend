/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { GenerationService } from './generation.service';
import { ConfigService } from '@nestjs/config';
import { R2FilesService } from '../r2files/r2files.service';
import { R2Service } from '../upload/r2.service';
import { UsageService } from '../usage/usage.service';
import { PaymentsService } from '../payments/payments.service';
import { GeneratedAssetService } from './generated-asset.service';
import { ProviderHttpService } from './provider-http.service';
import { ImageProviderRegistry } from './providers/image-provider.registry';
import { SanitizedUser } from '../users/types';
import { ProviderGenerateDto } from './dto/base-generate.dto';
import { ImageProviderAdapter } from './types';

describe('GenerationService', () => {
    let service: GenerationService;
    let registry: ImageProviderRegistry;
    let adapter: ImageProviderAdapter;

    const mockUser = {
        authUserId: 'user-123',
        email: 'test@example.com',
    } as SanitizedUser;

    const mockDto = {
        prompt: 'test prompt',
        model: 'test-model',
        providerOptions: {},
    } as ProviderGenerateDto;

    beforeEach(async () => {
        adapter = {
            providerName: 'test-provider',
            canHandleModel: jest.fn().mockReturnValue(true),
            generate: jest.fn().mockResolvedValue({
                results: [{ url: 'http://example.com/image.png', mimeType: 'image/png' }],
                clientPayload: {},
            }),
            validateOptions: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GenerationService,
                {
                    provide: R2FilesService,
                    useValue: {},
                },
                {
                    provide: R2Service,
                    useValue: {},
                },
                {
                    provide: ConfigService,
                    useValue: { get: jest.fn() },
                },
                {
                    provide: UsageService,
                    useValue: {
                        checkCredits: jest.fn().mockResolvedValue(true),
                        recordGeneration: jest.fn().mockResolvedValue({}),
                    },
                },
                {
                    provide: PaymentsService,
                    useValue: { refundCredits: jest.fn() },
                },
                {
                    provide: GeneratedAssetService,
                    useValue: {
                        persistResult: jest.fn(),
                        ensureDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,...'),
                        assetFromDataUrl: jest.fn().mockReturnValue({}),
                    },
                },
                {
                    provide: ProviderHttpService,
                    useValue: {},
                },
                {
                    provide: ImageProviderRegistry,
                    useValue: {
                        getAdapterForModel: jest.fn().mockReturnValue(adapter),
                    },
                },
            ],
        }).compile();

        service = module.get<GenerationService>(GenerationService);
        registry = module.get<ImageProviderRegistry>(ImageProviderRegistry);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('dispatch', () => {
        it('should use adapter if found', async () => {
            const result = await service.dispatch(mockUser, 'test-model', mockDto);

            expect(registry.getAdapterForModel).toHaveBeenCalledWith('test-model');
            expect(adapter.validateOptions).toHaveBeenCalledWith(mockDto);
            expect(adapter.generate).toHaveBeenCalledWith(mockUser, mockDto);
            expect(result.provider).toBe('test-provider');
        });

        it('should throw if adapter validation fails', async () => {
            (adapter.validateOptions as jest.Mock).mockImplementation(() => {
                throw new Error('Validation failed');
            });

            await expect(service.dispatch(mockUser, 'test-model', mockDto)).rejects.toThrow(
                'Validation failed',
            );
        });
    });
});
