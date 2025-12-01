import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { Voice } from '@elevenlabs/elevenlabs-js/api';
import type { GenerateSpeechDto } from './dto/generate-speech.dto';

export type VoiceSummary = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  labels: Record<string, string>;
  previewUrl: string | null;
};

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);
  private readonly client: ElevenLabsClient | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('ELEVENLABS_API_KEY');
    if (!apiKey) {
      this.logger.warn('ElevenLabs API key not configured - audio features will be unavailable');
      this.client = null;
    } else {
      this.client = new ElevenLabsClient({ apiKey });
    }
  }

  private ensureClient(): ElevenLabsClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'ElevenLabs API key not configured',
      );
    }
    return this.client;
  }

  private buildVoiceSummary(voice: Voice): VoiceSummary {
    return {
      id: voice.voiceId,
      name: voice.name ?? 'Unknown Voice',
      description: voice.description ?? null,
      category: voice.category ?? null,
      labels: voice.labels ?? {},
      previewUrl: voice.previewUrl ?? null,
    };
  }

  async listVoices(): Promise<{ success: boolean; voices: VoiceSummary[] }> {
    try {
      const client = this.ensureClient();
      const response = await client.voices.getAll();
      return {
        success: true,
        voices: response.voices.map((voice) => this.buildVoiceSummary(voice)),
      };
    } catch (error) {
      this.logger.error('Failed to fetch voices from ElevenLabs', error);
      throw new ServiceUnavailableException(
        'Unable to contact ElevenLabs at the moment',
      );
    }
  }

  async cloneVoiceFromFile(
    file: Express.Multer.File | undefined,
    options: {
      name?: string;
      description?: string;
      labels?: Record<string, string>;
    },
  ): Promise<{ success: boolean; voice: VoiceSummary; raw: unknown }> {
    if (!file) {
      throw new BadRequestException('A voice sample file is required');
    }

    const resolvedName =
      options.name?.trim() ||
      file.originalname?.replace(/\.[^/.]+$/, '') ||
      `Voice ${new Date().toISOString()}`;

    try {
      const client = this.ensureClient();
      const response = await client.voices.ivc.create({
        name: resolvedName,
        description: options.description,
        labels: JSON.stringify(options.labels ?? {}),
        files: [new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }) as any],
      });

      // The SDK response only contains voiceId and requiresVerification.
      // We construct the summary from the input data and the new ID.
      const summary: VoiceSummary = {
        id: response.voiceId,
        name: resolvedName,
        description: options.description ?? null,
        category: 'generated', // Default category for cloned voices
        labels: options.labels ?? {},
        previewUrl: null, // No preview URL immediately available
      };

      return {
        success: true,
        voice: summary,
        raw: response,
      };
    } catch (error) {
      this.logger.error('Failed to add voice to ElevenLabs', error);
      throw new ServiceUnavailableException(
        'Unable to reach ElevenLabs to save this voice',
      );
    }
  }

  async generateSpeech(dto: GenerateSpeechDto): Promise<{
    success: boolean;
    audioBase64: string;
    contentType: string;
    voiceId: string;
  }> {
    const voiceId = dto.voiceId?.trim() || DEFAULT_VOICE_ID;

    try {
      const client = this.ensureClient();
      const response = await client.textToSpeech.convert(voiceId, {
        text: dto.text,
        modelId: dto.modelId ?? 'eleven_multilingual_v2',
        voiceSettings: {
          stability: dto.stability,
          similarityBoost: dto.similarityBoost,
        },
      });

      const chunks: Buffer[] = [];
      for await (const chunk of response) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      return {
        success: true,
        audioBase64: buffer.toString('base64'),
        contentType: 'audio/mpeg',
        voiceId,
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate speech for voice ${voiceId}`,
        error,
      );
      // Log detailed error if available
      if (error && typeof error === 'object' && 'body' in error) {
        this.logger.error(`ElevenLabs Error Body: ${JSON.stringify(error.body)}`);
      }
      throw new ServiceUnavailableException(
        `Unable to connect to ElevenLabs text-to-speech: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

