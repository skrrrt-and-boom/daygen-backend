import { Body, Controller, Post, InternalServerErrorException } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { GenerateTimelineDto } from './dto/generate-timeline.dto';
import { TimelineResponse } from './dto/timeline-response.dto';

@Controller('timeline')
export class TimelineController {
    constructor(private readonly timelineService: TimelineService) { }

    @Post('generate')
    async generate(@Body() dto: GenerateTimelineDto): Promise<TimelineResponse> {
        try {
            return await this.timelineService.createTimeline(dto);
        } catch (error) {
            console.error('Timeline generation failed:', error);
            throw new InternalServerErrorException(error instanceof Error ? error.message : String(error));
        }
    }
}
