import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseGuards,
  Body,
  ValidationPipe,
} from '@nestjs/common';
import { JobType } from '@prisma/client';
import { CloudTasksService } from './cloud-tasks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';
import { CreateImageGenerationJobDto } from './dto/create-image-generation-job.dto';
import { CreateVideoGenerationJobDto } from './dto/create-video-generation-job.dto';
import { CreateImageUpscaleJobDto } from './dto/create-image-upscale-job.dto';
import { CreateBatchGenerationJobDto } from './dto/create-batch-generation-job.dto';

const requestValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private readonly cloudTasksService: CloudTasksService) { }

  @Post('image-generation')
  async createImageGeneration(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: CreateImageGenerationJobDto,
  ) {
    return this.cloudTasksService.createImageGenerationJob(
      user.authUserId,
      dto,
    );
  }

  @Post('video-generation')
  async createVideoGeneration(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: CreateVideoGenerationJobDto,
  ) {
    return this.cloudTasksService.createVideoGenerationJob(
      user.authUserId,
      dto,
    );
  }

  @Post('image-upscale')
  async createImageUpscale(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: CreateImageUpscaleJobDto,
  ) {
    return this.cloudTasksService.createImageUpscaleJob(user.authUserId, dto);
  }

  @Post('batch-generation')
  async createBatchGeneration(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: CreateBatchGenerationJobDto,
  ) {
    return this.cloudTasksService.createBatchGenerationJob(
      user.authUserId,
      dto,
    );
  }

  @Get(':jobId')
  async getJobStatus(
    @CurrentUser() user: SanitizedUser,
    @Param('jobId') jobId: string,
  ) {
    return this.cloudTasksService.getJobStatus(jobId, user.authUserId);
  }

  @Get()
  async getUserJobs(
    @CurrentUser() user: SanitizedUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('type') type?: JobType,
  ) {
    console.log('getUserJobs called with:', { userId: user.authUserId, limit, cursor, type });
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 20;
    return this.cloudTasksService.getUserJobs(
      user.authUserId,
      parsedLimit,
      cursor,
      type,
    );
  }
}
