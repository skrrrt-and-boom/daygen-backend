import { Body, Controller, Post, InternalServerErrorException, UseGuards } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { GenerateTimelineDto } from './dto/generate-timeline.dto';
import { TimelineResponse } from './dto/timeline-response.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';

@Controller('timeline')
@UseGuards(JwtAuthGuard)
export class TimelineController {
    constructor(private readonly timelineService: TimelineService) { }

    @Post('generate')
    async generate(
        @CurrentUser() user: SanitizedUser,
        @Body() dto: GenerateTimelineDto
    ): Promise<TimelineResponse> {
        try {
            return await this.timelineService.createTimeline(dto, user.authUserId);
        } catch (error) {
            console.error('Timeline generation failed:', error);
            throw new InternalServerErrorException(error instanceof Error ? error.message : String(error));
        }
    }
}
