import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UploadedFiles,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AudioService } from './audio.service';
import { GenerateSpeechDto } from './dto/generate-speech.dto';
import { CloneVoiceDto } from './dto/clone-voice.dto';

@Controller('audio')
@UseGuards(JwtAuthGuard)
export class AudioController {
  constructor(private readonly audioService: AudioService) { }

  @Get('voices')
  async listVoices() {
    console.log('GET /audio/voices - Request received');
    try {
      const result = await this.audioService.listVoices();
      console.log('GET /audio/voices - Success', { count: result.voices.length });
      return result;
    } catch (error) {
      console.error('GET /audio/voices - Error', error);
      throw error;
    }
  }

  @Post('voices/clone')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
    }),
  )
  async cloneVoice(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: CloneVoiceDto,
  ) {
    let labels: Record<string, string> | undefined;

    if (body.labels) {
      try {
        const parsed = JSON.parse(body.labels) as unknown;
        if (
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
        ) {
          labels = Object.entries(parsed as Record<string, unknown>).reduce(
            (acc, [key, value]) => {
              if (typeof value === 'string') {
                acc[key] = value;
              }
              return acc;
            },
            {} as Record<string, string>,
          );
        }
      } catch {
        throw new BadRequestException('labels must be valid JSON');
      }
    }

    return this.audioService.cloneVoiceFromFile(file, {
      name: body.name,
      description: body.description,
      labels,
    });
  }

  @Post('voices/generate')
  async generateSpeech(@Body() dto: GenerateSpeechDto) {
    return this.audioService.generateSpeech(dto);
  }
  @Post('pvc/create')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per file
    }),
  )
  async createPVCVoice(
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Body() body: CloneVoiceDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    let labels: Record<string, string> | undefined;

    if (body.labels) {
      try {
        const parsed = JSON.parse(body.labels) as unknown;
        if (
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
        ) {
          labels = Object.entries(parsed as Record<string, unknown>).reduce(
            (acc, [key, value]) => {
              if (typeof value === 'string') {
                acc[key] = value;
              }
              return acc;
            },
            {} as Record<string, string>,
          );
        }
      } catch {
        throw new BadRequestException('labels must be valid JSON');
      }
    }

    return this.audioService.createPVCVoice(
      files,
      req.user.id,
      {
        name: body.name || 'PVC Voice',
        description: body.description,
        labels,
      },
    );
  }

  @Post('pvc/verify')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
    }),
  )
  async verifyPVCVoice(
    @UploadedFile() file: Express.Multer.File,
    @Body('voiceId') voiceId: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    if (!voiceId) {
      throw new BadRequestException('voiceId is required');
    }
    return this.audioService.verifyPVCVoice(voiceId, file, req.user.id);
  }
}


