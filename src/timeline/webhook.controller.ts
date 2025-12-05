import { Controller, Post, Body, Headers, Logger, BadRequestException, Query } from '@nestjs/common';
import { TimelineService } from './timeline.service';

@Controller('webhooks')
export class WebhookController {
    private readonly logger = new Logger(WebhookController.name);

    constructor(private readonly timelineService: TimelineService) { }

    @Post('replicate')
    async handleReplicateWebhook(
        @Body() payload: any,
        @Headers('replicate-prediction-id') predictionId: string,
        @Headers('replicate-prediction-status') status: string,
        @Query() query: any
    ) {
        this.logger.log(`Received Replicate webhook for prediction ${predictionId}, status: ${status}`);

        // Replicate sends the prediction object in the body
        // We can also use the ID from headers or body.id
        const id = payload.id || predictionId;

        if (!id) {
            throw new BadRequestException('Missing prediction ID');
        }

        await this.timelineService.handleWebhookUpdate(payload, query);
        return { received: true };
    }
}
