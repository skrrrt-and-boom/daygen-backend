import { Body, Controller, Post, Get, Param, InternalServerErrorException, UseGuards } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { GenerateTimelineDto } from './dto/generate-timeline.dto';
import { RegenerateSegmentDto } from './dto/regenerate-segment.dto';
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
    ): Promise<any> {
        try {
            // Returns the job immediately (processing in background)
            return await this.timelineService.createTimeline(dto, user.authUserId);
        } catch (error) {
            console.error('Timeline generation failed:', error);
            throw new InternalServerErrorException(error instanceof Error ? error.message : String(error));
        }
    }

    @Get(':jobId')
    async getJobStatus(@Param('jobId') jobId: string) {
        return await this.timelineService.getJobStatus(jobId);
    }

    @Post(':jobId/segments/:index/regenerate')
    async regenerateSegment(
        @Param('jobId') jobId: string,
        @Param('index') index: string,
        @Body() dto: RegenerateSegmentDto
    ) {
        return await this.timelineService.regenerateSegment(jobId, parseInt(index), dto);
    }
}
