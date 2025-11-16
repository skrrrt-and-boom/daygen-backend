import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';
import { ScenesService } from './scenes.service';
import { GenerateSceneDto } from './dto/generate-scene.dto';
import { memoryStorage } from 'multer';

const requestValidationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

@UseGuards(JwtAuthGuard)
@Controller('scene')
export class ScenesController {
  constructor(private readonly scenesService: ScenesService) {}

  @Get('templates')
  listTemplates() {
    return {
      templates: this.scenesService.listTemplates(),
    };
  }

  @Post('generate')
  @UseInterceptors(
    FileInterceptor('characterImage', {
      storage: memoryStorage(),
      limits: { fileSize: 12 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          callback(new Error('Only image uploads are supported'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  generateScene(
    @CurrentUser() user: SanitizedUser,
    @Body(requestValidationPipe) dto: GenerateSceneDto,
    @UploadedFile() characterImage?: Express.Multer.File,
  ) {
    return this.scenesService.generateScene(user, dto, characterImage);
  }
}

