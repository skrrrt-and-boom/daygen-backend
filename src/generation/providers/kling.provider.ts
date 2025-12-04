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
            mode: "std"
        };

        try {
            const output = await this.replicate.run(this.modelId as any, { input });
            // Handle Replicate output (usually string URL or array of strings)
            const videoUrl = Array.isArray(output) ? output[0] : String(output);

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
}
