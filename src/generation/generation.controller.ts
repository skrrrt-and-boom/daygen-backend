import { Body, Controller, Post, UseGuards, ValidationPipe } from '@nestjs/common';
import { GenerationService } from './generation.service';
import { UnifiedGenerateDto } from './dto/unified-generate.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';

const requestValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

@UseGuards(JwtAuthGuard)
@Controller('unified-generate')
export class GenerationController {
  constructor(private readonly generationService: GenerationService) {}

  @Post()
  generate(@CurrentUser() user: SanitizedUser, @Body(requestValidationPipe) dto: UnifiedGenerateDto) {
    return this.generationService.generate(user, dto);
  }
}
