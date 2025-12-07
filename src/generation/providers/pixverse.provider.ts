import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Replicate from 'replicate';

@Injectable()
export class PixVerseProvider {
    private readonly logger = new Logger(PixVerseProvider.name);
    private readonly replicate: Replicate;
    // PixVerse v5 Model ID
    private readonly modelId = "pixverse/pixverse-v5";

    constructor(private readonly configService: ConfigService) {
        this.replicate = new Replicate({
            auth: this.configService.get<string>('REPLICATE_API_TOKEN'),
        });
    }

    async generateVideoFromImage(imageUrl: string, prompt: string): Promise<string> {
        this.logger.log(`Animating image with PixVerse v5 (${this.modelId})...`);

        const input = {
            prompt: prompt,
            image: imageUrl,
            duration: 5,
            quality: "720p",
            aspect_ratio: "9:16",
            negative_prompt: "static, frozen, text, watermark, low quality, pixelated, blurry"
        };

        try {
            const output = await this.replicate.run(this.modelId as any, { input });
            const videoUrl = Array.isArray(output) ? output[0] : (output as unknown as string);

            if (!videoUrl || !videoUrl.startsWith('http')) {
                throw new Error(`Invalid output from PixVerse: ${JSON.stringify(output)}`);
            }

            this.logger.log(`PixVerse generation successful: ${videoUrl}`);
            return videoUrl;
        } catch (error) {
            this.logger.error("PixVerse generation failed", error);
            throw error;
        }
    }

    async generateVideoFromImageAsync(imageUrl: string, prompt: string, webhookUrl?: string, motionPrompt?: string): Promise<any> {
        this.logger.log(`Starting async animation with PixVerse v5 (${this.modelId})...`);

        // Combine prompt with motion prompt if provided
        const fullPrompt = motionPrompt ? `${prompt}. ${motionPrompt}` : prompt;

        const input = {
            prompt: fullPrompt,
            image: imageUrl,
            duration: 5,
            quality: "720p",
            aspect_ratio: "9:16",
            negative_prompt: "static, frozen, text, watermark, low quality, pixelated, blurry"
        };

        try {
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

            this.logger.log(`PixVerse async generation started. Prediction ID: ${prediction.id}`);
            return prediction;
        } catch (error) {
            this.logger.error("PixVerse async generation failed", error);
            if (error && typeof error === 'object' && 'response' in error) {
                this.logger.error(`Replicate API Error: ${JSON.stringify((error as any).response?.data)}`);
            }
            throw error;
        }
    }
}
