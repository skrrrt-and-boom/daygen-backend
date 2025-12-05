import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Replicate from 'replicate';

@Injectable()
export class KlingProvider {
    private readonly logger = new Logger(KlingProvider.name);
    private readonly replicate: Replicate;
    // Exact model ID provided by architect
    private readonly modelId = "kwaivgi/kling-v2.5-turbo-pro";

    constructor(private readonly configService: ConfigService) {
        this.replicate = new Replicate({
            auth: this.configService.get<string>('REPLICATE_API_TOKEN'),
        });
    }

    async generateVideoFromImage(imageUrl: string, prompt: string): Promise<string> {
        this.logger.log(`Animating image with Kling (${this.modelId})...`);

        // Input schema based on Kling v2.5 Turbo Pro
        const input = {
            prompt: prompt,
            start_image: imageUrl,
            duration: 5, // Default to 5s for consistency
            cfg_scale: 0.5,
            mode: "std",
            negative_prompt: "static, frozen, slow motiob, motionless, text, watermark"
        };

        try {
            const output = await this.replicate.run(this.modelId as any, { input });
            // Handle Replicate output (usually string URL or array of strings)
            const videoUrl = Array.isArray(output) ? output[0] : (output as unknown as string);

            if (!videoUrl || !videoUrl.startsWith('http')) {
                throw new Error(`Invalid output from Kling: ${JSON.stringify(output)}`);
            }

            this.logger.log(`Kling generation successful: ${videoUrl}`);
            return videoUrl;
        } catch (error) {
            this.logger.error("Kling generation failed", error);
            throw error;
        }
    }

    async generateVideoFromImageAsync(imageUrl: string, prompt: string, webhookUrl?: string, motionPrompt?: string): Promise<any> {
        this.logger.log(`Starting async animation with Kling (${this.modelId})...`);

        const fullPrompt = motionPrompt ? `${prompt} ${motionPrompt}` : prompt;

        const input = {
            prompt: fullPrompt,
            start_image: imageUrl,
            duration: 5,
            cfg_scale: 0.6, // Increased slightly for better prompt adherence
            mode: "std",
            negative_prompt: "static, frozen, slow motion, motionless, text, watermark"
        };

        try {
            // We need to resolve the model version first because predictions.create requires a version ID
            // modelId is "kwaivgi/kling-v2.5-turbo-pro"
            const [owner, name] = this.modelId.split('/');
            const model = await this.replicate.models.get(owner, name);
            const version = model.latest_version?.id;

            if (!version) {
                throw new Error(`Could not find latest version for model ${this.modelId}`);
            }

            const options: any = {
                version: version,
                input: input,
            };

            if (webhookUrl) {
                options.webhook = webhookUrl;
                options.webhook_events_filter = ["completed"];
            }

            const prediction = await this.replicate.predictions.create(options);

            this.logger.log(`Kling async generation started. Prediction ID: ${prediction.id}`);
            return prediction;
        } catch (error) {
            this.logger.error("Kling async generation failed", error);
            if (error && typeof error === 'object' && 'response' in error) {
                this.logger.error(`Replicate API Error: ${JSON.stringify((error).response?.data)}`);
            }
            throw error;
        }
    }
}
