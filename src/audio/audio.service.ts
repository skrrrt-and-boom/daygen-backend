import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GenerateSpeechDto } from './dto/generate-speech.dto';

type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  labels?: Record<string, string>;
  preview_url?: string | null;
  samples?: Array<{ preview_url?: string | null }>;
};

export type VoiceSummary = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  labels: Record<string, string>;
  previewUrl: string | null;
};

const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Fallback to Rachel if user voice not provided

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(private readonly configService: ConfigService) {}

  private ensureApiKey(): string {
    const apiKey = this.configService.get<string>('ELEVENLABS_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'ElevenLabs API key not configured',
      );
    }
    return apiKey;
  }

  private buildVoiceSummary(voice: ElevenLabsVoice): VoiceSummary {
    const previewUrl =
      voice.preview_url ??
      voice.samples?.find((sample) => Boolean(sample.preview_url))
        ?.preview_url ??
      null;
    return {
      id: voice.voice_id,
      name: voice.name,
      description: voice.description ?? null,
      category: voice.category ?? null,
      labels: voice.labels ?? {},
      previewUrl,
    };
  }

  async listVoices(): Promise<{ success: boolean; voices: VoiceSummary[] }> {
    const apiKey = this.ensureApiKey();
    let response: Response;
    try {
      response = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: {
          'xi-api-key': apiKey,
        },
      });
    } catch (error) {
      this.logger.error('Failed to reach ElevenLabs voices endpoint', error);
      throw new ServiceUnavailableException(
        'Unable to contact ElevenLabs at the moment',
      );
    }

    const payload = (await response.json().catch(() => ({}))) as {
      voices?: ElevenLabsVoice[];
      detail?: string;
      message?: string;
    };

    if (!response.ok) {
      const message =
        payload?.message ||
        payload?.detail ||
        `ElevenLabs responded with status ${response.status}`;
      throw new HttpException(message, response.status);
    }

    const voices = Array.isArray(payload.voices) ? payload.voices : [];
    return {
      success: true,
      voices: voices.map((voice) => this.buildVoiceSummary(voice)),
    };
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

    const apiKey = this.ensureApiKey();
    const form = new FormData();
    const resolvedName =
        options.name?.trim() ||
        file.originalname?.replace(/\.[^/.]+$/, '') ||
        `Voice ${new Date().toISOString()}`;
    form.set('name', resolvedName);
    if (options.description) {
      form.set('description', options.description);
    }
    if (options.labels && Object.keys(options.labels).length > 0) {
      form.set('labels', JSON.stringify(options.labels));
    }

    const voiceBlob = new Blob([Uint8Array.from(file.buffer)], {
      type: file.mimetype || 'audio/webm',
    });
    form.append('files', voiceBlob, file.originalname || 'voice-sample.webm');

    let response: Response;
    try {
      response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
        },
        body: form,
      });
    } catch (error) {
      this.logger.error('Failed to call ElevenLabs add voice endpoint', error);
      throw new ServiceUnavailableException(
        'Unable to reach ElevenLabs to save this voice',
      );
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        payload?.message ||
        payload?.detail ||
        `ElevenLabs responded with status ${response.status}`;
      throw new HttpException(message, response.status);
    }

    const summary = this.buildVoiceSummary({
      voice_id: payload?.voice_id || payload?.id || resolvedName,
      name: payload?.name || resolvedName,
      description: payload?.description ?? options.description ?? null,
      category: payload?.category ?? null,
      labels: payload?.labels ?? options.labels ?? {},
      preview_url: payload?.preview_url ?? null,
      samples: payload?.samples,
    });

    return {
      success: true,
      voice: summary,
      raw: payload,
    };
  }

  async generateSpeech(dto: GenerateSpeechDto): Promise<{
    success: boolean;
    audioBase64: string;
    contentType: string;
    voiceId: string;
  }> {
    const apiKey = this.ensureApiKey();
    const voiceId = dto.voiceId?.trim() || DEFAULT_VOICE_ID;
    const requestBody: Record<string, unknown> = {
      text: dto.text,
      model_id: dto.modelId ?? 'eleven_multilingual_v2',
    };

    const voiceSettings: Record<string, number> = {};
    const clamp = (value: number) =>
      Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
    if (typeof dto.stability === 'number') {
      voiceSettings.stability = clamp(dto.stability);
    }
    if (typeof dto.similarityBoost === 'number') {
      voiceSettings.similarity_boost = clamp(dto.similarityBoost);
    }
    if (Object.keys(voiceSettings).length > 0) {
      requestBody.voice_settings = voiceSettings;
    }

    let response: Response;
    try {
      response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to call ElevenLabs text-to-speech for voice ${voiceId}`,
        error,
      );
      throw new ServiceUnavailableException(
        'Unable to connect to ElevenLabs text-to-speech',
      );
    }

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      const message =
        errorPayload?.message ||
        errorPayload?.detail ||
        `ElevenLabs responded with status ${response.status}`;
      throw new HttpException(message, response.status);
    }

    try {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType =
        response.headers.get('content-type') || 'audio/mpeg';

      return {
        success: true,
        audioBase64: buffer.toString('base64'),
        contentType,
        voiceId,
      };
    } catch (error) {
      this.logger.error('Failed to decode ElevenLabs audio payload', error);
      throw new InternalServerErrorException(
        'Unable to decode ElevenLabs audio response',
      );
    }
  }
}

