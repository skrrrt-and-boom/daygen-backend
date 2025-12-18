import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SanitizedUser } from '../users/types';
import { UsageService } from '../usage/usage.service';
import { CreditLedgerService } from '../payments/services/credit-ledger.service';
import { R2Service } from '../upload/r2.service';
import { R2FilesService } from '../r2files/r2files.service';
import { CloudTasksService } from '../jobs/cloud-tasks.service';
import { COMMON_ALLOWED_SUFFIXES, IDEOGRAM_ALLOWED_HOSTS } from '../generation/allowed-hosts';
import { safeDownload } from '../generation/safe-fetch';
import {
  getSceneTemplateById,
  getSceneTemplateByStyleId,
  listPublicSceneTemplates,
  type PublicSceneTemplate,
  type SceneTemplate,
} from './scene-templates';
import type { GenerateSceneDto } from './dto/generate-scene.dto';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { FormData } from 'undici';

type IdeogramPayload = Record<string, unknown>;

const IDEOGRAM_REMIX_ENDPOINT = 'https://api.ideogram.ai/v1/ideogram-v3/remix';
const MAX_CHARACTER_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB
const ALLOWED_CHARACTER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

type CharacterImageInput = Pick<Express.Multer.File, 'buffer' | 'size' | 'mimetype' | 'originalname'>;

type SceneGenerationJobDtoSnapshot = Pick<
  GenerateSceneDto,
  | 'sceneTemplateId'
  | 'styleOptionId'
  | 'stylePreset'
  | 'renderingSpeed'
  | 'personalizationNote'
  | 'characterFocus'
  | 'styleType'
>;

interface CharacterUploadReference {
  url: string;
  mimeType: string;
  originalName: string;
  size: number;
}

export interface SceneGenerationJobPayload {
  dto: SceneGenerationJobDtoSnapshot;
  characterUpload: CharacterUploadReference;
  sceneTemplate: {
    id: string;
    title: string;
    styleOptionId?: string;
  };
  prompt: string;
  aspectRatio: string;
  renderingSpeed: string;
  stylePreset: string;
  styleType: 'AUTO' | 'REALISTIC' | 'FICTION';
}

@Injectable()
export class ScenesService {
  private readonly logger = new Logger(ScenesService.name);
  private readonly costPerScene = 1;

  constructor(
    private readonly configService: ConfigService,
    private readonly usageService: UsageService,
    private readonly creditLedgerService: CreditLedgerService,
    private readonly r2Service: R2Service,
    private readonly r2FilesService: R2FilesService,
    @Inject(forwardRef(() => CloudTasksService))
    private readonly cloudTasksService: CloudTasksService,
  ) { }

  listTemplates(): PublicSceneTemplate[] {
    return listPublicSceneTemplates();
  }

  async generateScene(
    user: SanitizedUser,
    dto: GenerateSceneDto,
    characterImage?: Express.Multer.File,
  ) {
    return this.queueSceneGeneration(user, dto, characterImage);
  }

  private async queueSceneGeneration(
    user: SanitizedUser,
    dto: GenerateSceneDto,
    characterImage?: Express.Multer.File,
  ) {
    const validatedImage = this.validateCharacterImage(characterImage);
    const template = this.resolveTemplate(dto);
    const finalPrompt = this.buildPrompt(template, dto);
    const aspectRatio = this.normalizeAspectRatio(dto, template);
    const renderingSpeed = dto.renderingSpeed ?? template.renderingSpeed ?? 'DEFAULT';
    const stylePreset = dto.stylePreset ?? template.stylePreset ?? 'AUTO';
    const styleType = dto.styleType ?? template.styleType ?? 'AUTO';
    const uploadReference = await this.persistCharacterUpload(validatedImage);

    const jobPayload: SceneGenerationJobPayload = {
      dto: this.buildJobDtoSnapshot(dto, template),
      characterUpload: uploadReference,
      sceneTemplate: {
        id: template.id,
        title: template.title,
        styleOptionId: template.styleOptionId,
      },
      prompt: finalPrompt,
      aspectRatio,
      renderingSpeed,
      stylePreset,
      styleType,
    };

    return this.cloudTasksService.createSceneGenerationJob(user.authUserId, {
      provider: 'scene-placement',
      model: 'ideogram-remix',
      ...jobPayload,
    });
  }

  async runQueuedSceneGeneration(
    user: SanitizedUser,
    payload: SceneGenerationJobPayload,
  ) {
    const dto: GenerateSceneDto = {
      sceneTemplateId: payload.dto.sceneTemplateId ?? payload.sceneTemplate.id,
      styleOptionId: payload.dto.styleOptionId ?? payload.sceneTemplate.styleOptionId,
      stylePreset: payload.dto.stylePreset,
      renderingSpeed: payload.dto.renderingSpeed,
      personalizationNote: payload.dto.personalizationNote,
      characterFocus: payload.dto.characterFocus,
      styleType: payload.dto.styleType,
    };

    try {
      const downloadedImage = await this.downloadCharacterUpload(payload.characterUpload);
      const validatedImage = this.validateCharacterImage(downloadedImage);
      return await this.performSceneGeneration(user, dto, validatedImage);
    } finally {
      await this.deleteCharacterUpload(payload.characterUpload);
    }
  }

  private buildJobDtoSnapshot(dto: GenerateSceneDto, template: SceneTemplate): SceneGenerationJobDtoSnapshot {
    return {
      sceneTemplateId: dto.sceneTemplateId ?? template.id,
      styleOptionId: dto.styleOptionId ?? template.styleOptionId,
      stylePreset: dto.stylePreset,
      renderingSpeed: dto.renderingSpeed,
      personalizationNote: dto.personalizationNote,
      characterFocus: dto.characterFocus,
      styleType: dto.styleType ?? template.styleType ?? 'AUTO',
    };
  }

  private validateCharacterImage(
    characterImage?: CharacterImageInput | Express.Multer.File,
  ): CharacterImageInput {
    if (!characterImage) {
      throw new BadRequestException('A character image upload is required.');
    }
    if (!characterImage.buffer || !characterImage.buffer.length) {
      throw new BadRequestException('Uploaded character image is empty.');
    }
    if (characterImage.size > MAX_CHARACTER_IMAGE_BYTES) {
      throw new BadRequestException('Character image exceeds the 12MB limit.');
    }
    if (!ALLOWED_CHARACTER_MIME_TYPES.has(characterImage.mimetype)) {
      throw new BadRequestException(`Unsupported character image type: ${characterImage.mimetype}`);
    }

    return {
      buffer: Buffer.isBuffer(characterImage.buffer)
        ? characterImage.buffer
        : Buffer.from(characterImage.buffer as ArrayBufferLike),
      size: characterImage.size,
      mimetype: characterImage.mimetype,
      originalname: characterImage.originalname,
    };
  }

  private async persistCharacterUpload(characterImage: CharacterImageInput): Promise<CharacterUploadReference> {
    const base64 = characterImage.buffer.toString('base64');
    const url = await this.r2Service.uploadBase64Image(base64, characterImage.mimetype, 'scene-character-uploads');
    return {
      url,
      mimeType: characterImage.mimetype,
      originalName: characterImage.originalname ?? 'character-upload.png',
      size: characterImage.size,
    };
  }

  private async downloadCharacterUpload(reference: CharacterUploadReference): Promise<CharacterImageInput> {
    const response = await fetch(reference.url);
    if (!response.ok) {
      throw new InternalServerErrorException(
        `Failed to download character upload from R2 (status: ${response.status})`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      size: arrayBuffer.byteLength,
      mimetype: reference.mimeType,
      originalname: reference.originalName,
    };
  }

  private async deleteCharacterUpload(reference: CharacterUploadReference) {
    try {
      await this.r2Service.deleteFile(reference.url);
    } catch (error) {
      this.logger.warn(`Failed to delete character upload ${reference.url}`, error as Error);
    }
  }

  private async performSceneGeneration(
    user: SanitizedUser,
    dto: GenerateSceneDto,
    characterImage: CharacterImageInput,
  ) {
    const template = this.resolveTemplate(dto);

    const ideogramApiKey = this.getIdeogramApiKey();
    const finalPrompt = this.buildPrompt(template, dto);
    const aspectRatio = this.normalizeAspectRatio(dto, template);
    const renderingSpeed = dto.renderingSpeed ?? template.renderingSpeed ?? 'DEFAULT';
    const stylePreset = dto.stylePreset ?? template.stylePreset ?? 'AUTO';
    const styleType = dto.styleType ?? template.styleType ?? 'AUTO';

    await this.assertCredits(user);

    let usageRecorded = false;
    try {
      await this.usageService.recordGeneration(user, {
        provider: 'scene-placement',
        model: 'ideogram-remix',
        prompt: finalPrompt,
        metadata: {
          sceneTemplateId: template.id,
          styleOptionId: template.styleOptionId,
          renderingSpeed,
          aspectRatio,
          styleType,
        },
        cost: this.costPerScene,
      });
      usageRecorded = true;

      const baseImage = await this.loadTemplateImage(template);
      const providerResult = await this.callIdeogramRemix({
        apiKey: ideogramApiKey,
        prompt: finalPrompt,
        aspectRatio,
        renderingSpeed,
        stylePreset,
        styleType,
        baseImage,
        characterImage,
      });

      const generatedImage = await this.downloadProviderImage(providerResult.url);
      const publicUrl = await this.uploadResultToR2(user, template, finalPrompt, generatedImage);

      return {
        success: true,
        template: {
          id: template.id,
          title: template.title,
          styleOptionId: template.styleOptionId,
        },
        prompt: finalPrompt,
        imageUrl: publicUrl.fileUrl,
        r2FileId: publicUrl.id,
        mimeType: generatedImage.mimeType,
        providerResponse: providerResult.rawResponse,
      };
    } catch (error) {
      if (usageRecorded) {
        await this.safeRefund(user, error);
      }
      throw error;
    }
  }

  private async assertCredits(user: SanitizedUser) {
    const hasCredits = await this.usageService.checkCredits(user, this.costPerScene);
    if (!hasCredits) {
      throw new BadRequestException('Insufficient credits for scene generation.');
    }
  }

  private getIdeogramApiKey(): string {
    const key = this.configService.get<string>('IDEOGRAM_API_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException('IDEOGRAM_API_KEY is not configured');
    }
    return key;
  }

  private resolveTemplate(dto: GenerateSceneDto): SceneTemplate {
    if (dto.sceneTemplateId) {
      const template = getSceneTemplateById(dto.sceneTemplateId);
      if (!template) {
        throw new BadRequestException(`Unknown scene template: ${dto.sceneTemplateId}`);
      }
      return template;
    }

    if (dto.styleOptionId) {
      const template = getSceneTemplateByStyleId(dto.styleOptionId);
      if (!template) {
        throw new BadRequestException(`Unknown style preset: ${dto.styleOptionId}`);
      }
      return template;
    }

    throw new BadRequestException('Either sceneTemplateId or styleOptionId is required.');
  }

  private buildPrompt(template: SceneTemplate, dto: GenerateSceneDto): string {
    const parts = [template.prompt.trim()];
    if (dto.personalizationNote) {
      parts.push(`Personalization: ${dto.personalizationNote.trim()}`);
    }
    if (dto.characterFocus) {
      parts.push(`Camera framing: ${dto.characterFocus}`);
    }
    return parts.join('\n\n');
  }

  private normalizeAspectRatio(_dto: GenerateSceneDto, template: SceneTemplate): string {
    const ratio = template.aspectRatio || '1x1';
    return ratio.includes(':') ? ratio.replace(':', 'x') : ratio;
  }

  private async loadTemplateImage(
    template: SceneTemplate,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    if (template.baseImageUrl.startsWith('http')) {
      const response = await fetch(template.baseImageUrl);
      if (!response.ok) {
        throw new InternalServerErrorException(`Failed to load template base image: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        mimeType: response.headers.get('content-type') || template.baseImageMimeType || 'image/png',
        fileName: template.baseImageFileName || `${template.id}-base.png`,
      };
    }

    const resolvedPath = isAbsolute(template.baseImageUrl)
      ? template.baseImageUrl
      : join(process.cwd(), template.baseImageUrl);
    const buffer = await readFile(resolvedPath);
    return {
      buffer,
      mimeType: template.baseImageMimeType || 'image/png',
      fileName: template.baseImageFileName || basename(resolvedPath),
    };
  }

  private async callIdeogramRemix(params: {
    apiKey: string;
    prompt: string;
    aspectRatio: string;
    renderingSpeed: string;
    stylePreset: string;
    styleType: 'AUTO' | 'REALISTIC' | 'FICTION';
    baseImage: { buffer: Buffer; mimeType: string; fileName: string };
    characterImage: CharacterImageInput;
  }): Promise<{ url: string; rawResponse: IdeogramPayload }> {
    const form = new FormData();
    form.set('prompt', params.prompt);
    form.set('aspect_ratio', params.aspectRatio);
    form.set('rendering_speed', params.renderingSpeed);
    if (params.stylePreset && params.stylePreset !== 'AUTO') {
      form.set('style_preset', params.stylePreset);
    }
    form.set('style_type', params.styleType);
    form.set(
      'image',
      new Blob([new Uint8Array(params.baseImage.buffer)], { type: params.baseImage.mimeType }),
      params.baseImage.fileName,
    );
    form.append(
      'character_reference_images',
      new Blob([new Uint8Array(params.characterImage.buffer)], { type: params.characterImage.mimetype }),
      params.characterImage.originalname || 'character.png',
    );

    const response = await fetch(IDEOGRAM_REMIX_ENDPOINT, {
      method: 'POST',
      headers: {
        'Api-Key': params.apiKey,
        Accept: 'application/json',
      },
      body: form as unknown as BodyInit,
    });

    let payload: IdeogramPayload | string = {};
    try {
      payload = (await response.json()) as IdeogramPayload;
    } catch {
      payload = await response.text();
    }
    if (!response.ok) {
      const detailedMessage =
        typeof payload === 'object' ? this.extractMessage(payload) : String(payload);
      const payloadText = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const message = detailedMessage || 'Ideogram remix failed';
      this.logger.error(
        `Ideogram remix API error (status ${response.status}): ${payloadText}`,
      );
      throw new BadRequestException(message);
    }

    const normalizedPayload = typeof payload === 'string' ? {} : payload;
    const urls = this.collectUrls(normalizedPayload);
    if (urls.length === 0) {
      throw new InternalServerErrorException('Ideogram remix returned no images');
    }

    return {
      url: urls[0],
      rawResponse: normalizedPayload,
    };
  }

  private extractMessage(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    if (typeof record['message'] === 'string') {
      return record['message'];
    }
    const error = record['error'];
    if (error && typeof error === 'object') {
      const errMsg = (error as { message?: unknown }).message;
      if (typeof errMsg === 'string') return errMsg;
    }
    return undefined;
  }

  private collectUrls(payload: IdeogramPayload): string[] {
    const urls: string[] = [];
    const push = (candidate: unknown) => {
      if (typeof candidate === 'string' && candidate.trim()) {
        urls.push(candidate.trim());
      }
    };

    const scanArray = (input: unknown) => {
      if (!Array.isArray(input)) return;
      for (const entry of input) {
        if (typeof entry === 'string') {
          push(entry);
        } else if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          push(record['url']);
          push(record['image']);
          push(record['image_url']);
        }
      }
    };

    scanArray(payload['images']);
    if (urls.length) return urls;

    scanArray(payload['data']);
    return urls;
  }

  private async downloadProviderImage(
    url: string,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;,]+);base64,(.*)$/);
      if (!match) {
        throw new InternalServerErrorException('Invalid data URL returned by Ideogram');
      }
      const [, mime, data] = match;
      return {
        buffer: Buffer.from(data, 'base64'),
        mimeType: mime || 'image/png',
        fileName: `scene-${Date.now()}.${this.extensionFromMime(mime)}`,
      };
    }

    const download = await safeDownload(url, {
      allowedHosts: IDEOGRAM_ALLOWED_HOSTS,
      allowedHostSuffixes: COMMON_ALLOWED_SUFFIXES,
    });
    return {
      buffer: Buffer.from(download.arrayBuffer),
      mimeType: download.mimeType || 'image/png',
      fileName: basename(new URL(url).pathname) || `scene-${Date.now()}.${this.extensionFromMime(download.mimeType)}`,
    };
  }

  private extensionFromMime(mimeType?: string | null): string {
    if (!mimeType) return 'png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
    if (mimeType.includes('webp')) return 'webp';
    if (mimeType.includes('gif')) return 'gif';
    return 'png';
  }

  private async uploadResultToR2(
    user: SanitizedUser,
    template: SceneTemplate,
    prompt: string,
    image: { buffer: Buffer; mimeType: string; fileName: string },
  ) {
    const base64Data = `data:${image.mimeType};base64,${image.buffer.toString('base64')}`;
    const publicUrl = await this.r2Service.uploadBase64Image(base64Data, image.mimeType, 'scene-remix');
    const fileRecord = await this.r2FilesService.create(user.authUserId, {
      fileName: image.fileName,
      fileUrl: publicUrl,
      mimeType: image.mimeType,
      prompt,
      model: 'ideogram-remix',
      productId: undefined,
    });
    return fileRecord;
  }

  private async safeRefund(user: SanitizedUser, error: unknown) {
    try {
      const reason = error instanceof Error ? error.message : 'Scene generation failed';
      await this.creditLedgerService.refundCredits(user.authUserId, this.costPerScene, reason);
      this.logger.log(`Refunded ${this.costPerScene} credit(s) to ${user.authUserId} after failure`);
    } catch (refundError) {
      this.logger.error(`Failed to refund credits for ${user.authUserId}`, refundError);
    }
  }
}

