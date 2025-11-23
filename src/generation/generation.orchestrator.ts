import {
    Injectable,
    Logger,
    BadRequestException,
} from '@nestjs/common';
import { GenerationService } from './generation.service';
import { UsageService } from '../usage/usage.service';
import { PaymentsService } from '../payments/payments.service';
import { GeneratedAssetService } from './generated-asset.service';
import type { SanitizedUser } from '../users/types';
import { ProviderGenerateDto } from './dto/base-generate.dto';
import { GeneratedAsset } from './generated-asset.service';

export interface OrchestrationResult {
    provider: string;
    model: string;
    clientPayload: unknown;
    assets: GeneratedAsset[];
    rawResponse?: unknown;
    usageMetadata?: Record<string, unknown>;
}

@Injectable()
export class GenerationOrchestrator {
    private readonly logger = new Logger(GenerationOrchestrator.name);

    constructor(
        private readonly generationService: GenerationService,
        private readonly usageService: UsageService,
        private readonly paymentsService: PaymentsService,
        private readonly generatedAssetService: GeneratedAssetService,
    ) { }

    /**
     * Central entry point for image generation.
     * Handles validation, credit checks, usage recording, execution, persistence, and error handling/refunds.
     */
    async generate(
        user: SanitizedUser,
        dto: ProviderGenerateDto,
        options: {
            cost?: number;
            skipPersistence?: boolean;
            retries?: number;
            isJob?: boolean;
        } = {},
    ): Promise<OrchestrationResult> {
        const { cost = 1, skipPersistence = false, retries = 0, isJob = false } = options;
        const prompt = dto.prompt?.trim();
        const model = dto.model?.trim();

        if (!prompt) throw new BadRequestException('Prompt is required');
        if (!model) throw new BadRequestException('Model is required');

        // 1. Reserve Credits
        // This checks balance and deducts immediately, creating a RESERVED event
        const { reservationId } = await this.usageService.reserveCredits(user, {
            provider: 'generation', // or specific provider if known
            model,
            prompt,
            cost,
            metadata: { model, prompt: prompt.slice(0, 100), isJob },
        });

        this.logger.log(
            `Starting generation for user ${user.authUserId} with model ${model} (job: ${isJob}, reservation: ${reservationId})`,
        );

        try {
            // 2. Execution with Retries
            const result = await this.executeWithRetries(user, dto, retries);

            // 3. Persistence
            if (!skipPersistence) {
                await this.generatedAssetService.persistResult(
                    user,
                    prompt,
                    result,
                    dto,
                );
            }

            // 4. Capture Credits (Finalize)
            await this.usageService.captureCredits(reservationId, {
                finalStatus: 'COMPLETED',
                assetCount: result.assets.length,
            });

            return result;
        } catch (error) {
            this.logger.error(
                `Generation failed for user ${user.authUserId} with model ${model}`,
                {
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                },
            );

            // 5. Release Reservation (Refund)
            await this.usageService.releaseCredits(
                reservationId,
                error instanceof Error ? error.message : String(error),
            );
            throw error;
        }
    }

    private async executeWithRetries(
        user: SanitizedUser,
        dto: ProviderGenerateDto,
        retries: number,
    ): Promise<OrchestrationResult> {
        let lastError: unknown;

        // Try at least once, plus retries
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                // We call dispatch directly on GenerationService (which we need to expose or refactor)
                // Currently GenerationService.generate does everything. 
                // We need GenerationService to expose a method that JUST generates without credit checks/persistence.
                // Let's assume we'll add `generateOnly` to GenerationService or use `dispatch` if we make it public.
                // For now, I'll assume we refactor GenerationService to expose `dispatch` or similar.
                // Actually, `dispatch` is private. I should make it public or add a new public method.
                return await this.generationService.dispatch(user, dto.model!, dto);
            } catch (err) {
                lastError = err;
                if (attempt < retries) {
                    const delay = Math.pow(2, attempt + 1) * 1000;
                    this.logger.warn(
                        `Attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
                    );
                    await new Promise((r) => setTimeout(r, delay));
                }
            }
        }
        throw lastError;
    }


}
