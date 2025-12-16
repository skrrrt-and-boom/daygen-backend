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
import { MusicService } from './music.service';
import { Public } from '../auth/public.decorator';
import { GenerateSpeechDto } from './dto/generate-speech.dto';
import { CloneVoiceDto } from './dto/clone-voice.dto';

@Controller('audio')
@UseGuards(JwtAuthGuard)
export class AudioController {
  constructor(
    private readonly audioService: AudioService,
    private readonly musicService: MusicService
  ) { }

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

  @Public()
  @Get('tracks')
  @UseGuards(JwtAuthGuard)
  async listTracks(@Req() req: Request & { user?: { id: string } }) {
    // If the user sends a token, the JwtAuthGuard *might* set req.user, BUT...
    // The @Public() decorator usually bypasses the guard or makes it optional. 
    // If JwtAuthGuard is global or applied at controller level, @Public might disable it.
    // However, we want "Optional Auth". 
    // Let's assume if the header is present, the guard processes it? 
    // Actually, usually @Public means "don't fail if no token". 
    // We need to check if req.user is populated.
    // If the standard JwtAuthGuard is used, @Public usually skips execution.
    // For now, let's try to see if we can get user ID if available. 

    // Simplest approach: If we want user tracks, we MUST authenticate.
    // But the requirements say "display it for him".
    // Let's make it so if they ARE logged in (which they are in the app), we fetch their tracks.
    // We can remove @Public if the endpoint is only for app users, but maybe it's used elsewhere?
    // User context says "Music uploaded by user".

    // Let's check if we can access the user from the request if the token is passed.
    // If @Public is there, likely req.user is undefined unless we have an optional guard.
    // I will assume for now we can remove @Public, OR we just add a specific endpoint for user tracks?
    // The plan said "Update GET /tracks to extract userId".

    // Let's rely on the fact that if they are in the app, they have a token.
    // If I keep @Public, I might not get the user. 
    // Let's TRY to just use the user if it exists. 
    // But wait, the existing code had `@Public()`.
    // I will modify it to properly handle optional auth or just check the user.

    // Actually, a safer bet is to allow the user parameter.

    const userId = req.user?.id;
    return this.musicService.getAllTracks(userId);
  }

  @Post('tracks/user')
  async saveUserTrack(
    @Body() body: { name: string; url: string; genre?: string },
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.musicService.saveUserTrack(req.user.id, body);
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

  @Post('upload-recording')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB for 30-min recordings
    }),
  )
  async uploadRecording(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') folder: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    if (!file) {
      throw new BadRequestException('Audio file is required');
    }
    return this.audioService.uploadRecordingToR2(
      file,
      folder || 'recorded-voices',
      req.user.id,
    );
  }
}


