import { Controller, GoneException, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('unified-generate')
export class GenerationController {
  @Post()
  handleDeprecatedRoute(): never {
    throw new GoneException(
      'POST /api/unified-generate has been removed. Call /api/image/<provider> instead (e.g., /api/image/gemini).',
    );
  }
}
