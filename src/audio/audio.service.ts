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

export type AlignmentData = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);
  private readonly client: ElevenLabsClient;
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('ELEVENLABS_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'ElevenLabs API key not configured',
      );
    }
    this.apiKey = apiKey;
    this.client = new ElevenLabsClient({ apiKey: this.apiKey });
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
      const response = await this.client.voices.getAll();
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
      const response = await this.client.voices.ivc.create({
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
    alignment: AlignmentData | null;
    contentType: string;
    voiceId: string;
  }> {
    const voiceId = dto.voiceId?.trim() || DEFAULT_VOICE_ID;
    const modelId = dto.modelId ?? 'eleven_multilingual_v2';

    this.logger.log(`Generating speech with timestamps for voice ${voiceId} using model ${modelId}`);

    try {
      // Direct fetch to accessing the with-timestamps endpoint
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey,
          },
          body: JSON.stringify({
            text: dto.text,
            model_id: modelId,
            voice_settings: {
              stability: dto.stability ?? 0.5,
              similarity_boost: dto.similarityBoost ?? 0.75,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`ElevenLabs API error: ${response.status} ${errorText}`);
        throw new ServiceUnavailableException(
          `ElevenLabs error: ${response.status}`,
        );
      }

      const data = await response.json();

      return {
        success: true,
        audioBase64: data.audio_base64,
        alignment: data.alignment, // This is the payload we need for the Timing Map
        contentType: 'audio/mpeg',
        voiceId,
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate speech for voice ${voiceId}`,
        error,
      );
      throw new ServiceUnavailableException(
        'Unable to connect to ElevenLabs text-to-speech',
      );
    }
  }
}
