/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { GenerationOrchestrator } from './generation.orchestrator';
import { GenerationService } from './generation.service';
import { UsageService } from '../usage/usage.service';
import { PaymentsService } from '../payments/payments.service';
import { GeneratedAssetService } from './generated-asset.service';

describe('GenerationOrchestrator', () => {
    let orchestrator: GenerationOrchestrator;
    let usageService: UsageService;
    let generationService: GenerationService;
    let generatedAssetService: GeneratedAssetService;

    const mockUser = { authUserId: 'user-1' } as any;
    const mockDto = { prompt: 'test prompt', model: 'test-model', providerOptions: {} };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GenerationOrchestrator,
                {
                    provide: GenerationService,
                    useValue: {
                        dispatch: jest.fn(),
                    },
                },
                {
                    provide: UsageService,
                    useValue: {
                        checkCredits: jest.fn(),
                        recordGeneration: jest.fn(),
                        reserveCredits: jest.fn(),
                        captureCredits: jest.fn(),
                        releaseCredits: jest.fn(),
                    },
                },
                {
                    provide: PaymentsService,
                    useValue: {
                        refundCredits: jest.fn(),
                    },
                },
                {
                    provide: GeneratedAssetService,
                    useValue: {
                        persistResult: jest.fn(),
                    },
                },
            ],
        }).compile();

        orchestrator = module.get<GenerationOrchestrator>(GenerationOrchestrator);
        usageService = module.get<UsageService>(UsageService);
        generationService = module.get<GenerationService>(GenerationService);
        generatedAssetService = module.get<GeneratedAssetService>(GeneratedAssetService);
    });

    it('should be defined', () => {
        expect(orchestrator).toBeDefined();
    });

    describe('generate', () => {
        it('should reserve, execute, persist, and capture on success', async () => {
            // Mock setup
            (usageService.reserveCredits as jest.Mock).mockResolvedValue({ reservationId: 'res-1' });
            (generationService.dispatch as jest.Mock).mockResolvedValue({ assets: ['asset1'] });
            (generatedAssetService.persistResult as jest.Mock).mockResolvedValue(undefined);
            (usageService.captureCredits as jest.Mock).mockResolvedValue(undefined);

            const result = await orchestrator.generate(mockUser, mockDto);

            // Verify flow
            expect(usageService.reserveCredits).toHaveBeenCalledWith(mockUser, expect.objectContaining({
                cost: 1,
                model: 'test-model',
            }));
            expect(generationService.dispatch).toHaveBeenCalledWith(
                mockUser,
                'test-model',
                expect.objectContaining({
                    model: 'test-model',
                    prompt: 'test prompt',
                }),
            );
            expect(generatedAssetService.persistResult).toHaveBeenCalled();
            expect(usageService.captureCredits).toHaveBeenCalledWith('res-1', expect.objectContaining({
                finalStatus: 'COMPLETED',
            }));
            expect(result).toEqual({ assets: ['asset1'] });
        });

        it('should release credits if execution fails', async () => {
            // Mock setup
            (usageService.reserveCredits as jest.Mock).mockResolvedValue({ reservationId: 'res-1' });
            (generationService.dispatch as jest.Mock).mockRejectedValue(new Error('Generation failed'));

            await expect(orchestrator.generate(mockUser, mockDto)).rejects.toThrow('Generation failed');

            // Verify release
            expect(usageService.releaseCredits).toHaveBeenCalledWith('res-1', 'Generation failed');
            expect(usageService.captureCredits).not.toHaveBeenCalled();
        });

        it('should release credits if persistence fails', async () => {
            // Mock setup
            (usageService.reserveCredits as jest.Mock).mockResolvedValue({ reservationId: 'res-1' });
            (generationService.dispatch as jest.Mock).mockResolvedValue({ assets: ['asset1'] });
            (generatedAssetService.persistResult as jest.Mock).mockRejectedValue(new Error('Persistence failed'));

            await expect(orchestrator.generate(mockUser, mockDto)).rejects.toThrow('Persistence failed');

            // Verify release
            expect(usageService.releaseCredits).toHaveBeenCalledWith('res-1', 'Persistence failed');
            expect(usageService.captureCredits).not.toHaveBeenCalled();
        });
    });
});
