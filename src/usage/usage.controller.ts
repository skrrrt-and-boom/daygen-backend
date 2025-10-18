import {
  Controller,
  Get,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UsageService } from './usage.service';
import { UsageEventsQueryDto } from './dto/usage-events-query.dto';

const queryValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

@Controller('usage')
@UseGuards(JwtAuthGuard, AdminGuard)
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get('events')
  listEvents(@Query(queryValidationPipe) query: UsageEventsQueryDto) {
    return this.usageService.listEvents(query);
  }
}
