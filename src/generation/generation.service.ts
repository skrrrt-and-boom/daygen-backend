import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LumaAI } from 'lumaai';
import type { ImageCreateParams } from 'lumaai/resources/generations/image';
import type { Generation as LumaGeneration } from 'lumaai/resources/generations/generations';
import type { SanitizedUser } from '../users/types';
import { R2FilesService } from '../r2files/r2files.service';
import { R2Service } from '../upload/r2.service';
import { ProviderGenerateDto } from './dto/base-generate.dto';
import { UnifiedGenerateDto } from './dto/unified-generate.dto';
import { UsageService } from '../usage/usage.service';
import { PaymentsService } from '../payments/payments.service';

interface GeneratedAsset {
  dataUrl: string;
  mimeType: string;
  base64: string;
  remoteUrl?: string;
  r2FileId?: string;
  r2FileUrl?: string;
}

interface GeminiRemoteCandidate {
  url?: string;
  rawUrl?: string;
  fileId?: string;
  mimeType?: string;
}

interface ProviderResult {
  provider: string;
  model: string;
  clientPayload: unknown;
  assets: GeneratedAsset[];
  rawResponse?: unknown;
  usageMetadata?: Record<string, unknown>;
}

interface InlineImage {
  mimeType: string;
  data: string;
}

interface InMemoryFilePayload {
  buffer: ArrayBuffer | ArrayBufferView;
  filename?: string;
  mimeType?: string;
}

interface ReveEditInput {
  prompt: string;
  model?: string;
  negativePrompt?: string;
  guidanceScale?: number;
  steps?: number;
  seed?: number;
  batchSize?: number;
  width?: number;
  height?: number;
  strength?: number;
  aspectRatio?: string;
  image: InMemoryFilePayload;
  mask?: InMemoryFilePayload;
  providerOptions: Record<string, unknown>;
  avatarId?: string;
  avatarImageId?: string;
  productId?: string;
}

const FLUX_OPTION_KEYS = [
  'width',
  'height',
  'aspect_ratio',
  'raw',
  'image_prompt',
  'image_prompt_strength',
  'input_image',
  'input_image_2',
  'input_image_3',
  'input_image_4',
  'seed',
  'output_format',
  'prompt_upsampling',
  'safety_tolerance',
] as const;

const FLUX_ALLOWED_POLL_HOSTS = new Set([
  'api.bfl.ai',
  'api.eu.bfl.ai',
  'api.us.bfl.ai',
  'api.eu1.bfl.ai',
  'api.us1.bfl.ai',
  'api.eu2.bfl.ai',
  'api.us2.bfl.ai',
  'api.eu3.bfl.ai',
  'api.us3.bfl.ai',
  'api.eu4.bfl.ai',
  'api.us4.bfl.ai',
]);

const FLUX_ALLOWED_DOWNLOAD_HOSTS = new Set([
  'delivery.bfl.ai',
  'cdn.bfl.ai',
  'storage.googleapis.com',
]);

const FLUX_POLL_INTERVAL_MS = 5000;
const FLUX_MAX_ATTEMPTS = 60;

const FLUX_ALLOWED_POLL_SUFFIXES = ['.bfl.ai'] as const;
const FLUX_ALLOWED_DOWNLOAD_SUFFIXES = [
  '.bfl.ai',
  '.googleusercontent.com',
] as const;

const GEMINI_API_KEY_CANDIDATES = [
  'GEMINI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_AI_KEY',
  'VITE_GEMINI_API_KEY',
] as const;

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const RUNWAY_API_VERSION = '2024-11-06';
const RUNWAY_POLL_INTERVAL_MS = 6000;
const RUNWAY_MAX_ATTEMPTS = 120;
const RUNWAY_MAX_REFERENCES = 3;
const RUNWAY_ALLOWED_RATIOS = new Set<string>([
  '1920:1080',
  '1080:1920',
  '1024:1024',
  '1360:768',
  '1080:1080',
  '1168:880',
  '1440:1080',
  '1080:1440',
  '1808:768',
  '2112:912',
  '1280:720',
  '720:1280',
  '720:720',
  '960:720',
  '720:960',
  '1680:720',
  '1344:768',
  '768:1344',
  '1184:864',
  '864:1184',
  '1536:672',
]);

type JsonRecord = Record<string, unknown>;

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toJsonRecord = (value: unknown): JsonRecord =>
  isJsonRecord(value) ? value : {};

const optionalJsonRecord = (value: unknown): JsonRecord | undefined =>
  isJsonRecord(value) ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const getFirstString = (
  source: JsonRecord,
  keys: readonly string[],
): string | undefined => {
  for (const key of keys) {
    const candidate = asString(source[key]);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
};

const getNestedString = (
  source: JsonRecord,
  path: readonly string[],
): string | undefined => {
  let current: unknown = source;
  for (const segment of path) {
    if (!isJsonRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return asString(current);
};

const isProbablyBase64 = (value: string): boolean => {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 32) {
    return false;
  }
  if (trimmed.includes(':') && !trimmed.startsWith('data:')) {
    return false;
  }
  return /^[A-Za-z0-9+/=\s]+$/.test(trimmed);
};

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private readonly fluxExtraPollHosts: Set<string>;
  private readonly fluxExtraDownloadHosts: Set<string>;
  private readonly fluxExtraPollSuffixes: string[];
  private readonly fluxExtraDownloadSuffixes: string[];

  constructor(
    private readonly configService: ConfigService,
    private readonly r2FilesService: R2FilesService,
    private readonly r2Service: R2Service,
    private readonly usageService: UsageService,
    private readonly paymentsService: PaymentsService,
  ) {
    this.fluxExtraPollHosts = this.readFluxHostSet('BFL_ALLOWED_POLL_HOSTS');
    this.fluxExtraDownloadHosts = this.readFluxHostSet(
      'BFL_ALLOWED_DOWNLOAD_HOSTS',
    );
    this.fluxExtraPollSuffixes = this.readFluxSuffixList(
      'BFL_ALLOWED_POLL_SUFFIXES',
    );
    this.fluxExtraDownloadSuffixes = this.readFluxSuffixList(
      'BFL_ALLOWED_DOWNLOAD_SUFFIXES',
    );
  }

  async generate(user: SanitizedUser, dto: UnifiedGenerateDto) {
    const prompt = dto.prompt?.trim();
    if (!prompt) {
      this.throwBadRequest('Prompt is required');
    }

    const model = dto.model?.trim();
    if (!model) {
      this.throwBadRequest('Model is required');
    }

    // Check if user has sufficient credits
    const hasCredits = await this.usageService.checkCredits(user, 1);
    if (!hasCredits) {
      throw new ForbiddenException(
        'Insufficient credits. Each generation costs 1 credit. Please purchase more credits to continue.',
      );
    }

    this.logger.log(
      `Starting generation for user ${user.authUserId} with model ${model}`,
    );

    // Record usage and deduct credits first
    const usageResult = await this.usageService.recordGeneration(user, {
      provider: 'generation',
      model,
      prompt,
      cost: 1,
      metadata: { model, prompt: prompt.slice(0, 100) },
    });

    try {
      const providerResult = await this.dispatch(model, {
        ...dto,
        prompt,
        model,
      });

      await this.persistResult(user, prompt, providerResult, dto);

      this.logger.log(
        `Generation completed successfully for user ${user.authUserId}`,
      );

      // Return a consistent structure for the frontend
      const clientPayload = providerResult.clientPayload as Record<
        string,
        unknown
      >;
      const firstAsset = providerResult.assets[0];

      if (firstAsset) {
        return {
          ...clientPayload,
          // Ensure frontend can find the image data
          imageUrl:
            clientPayload.dataUrl || firstAsset.dataUrl || firstAsset.remoteUrl,
          url:
            clientPayload.dataUrl || firstAsset.dataUrl || firstAsset.remoteUrl,
          dataUrl: clientPayload.dataUrl || firstAsset.dataUrl,
          remoteUrl: firstAsset.remoteUrl,
          mimeType: clientPayload.contentType || 'image/jpeg',
          contentType: clientPayload.contentType || 'image/jpeg',
        };
      }

      return providerResult.clientPayload;
    } catch (error) {
      this.logger.error(
        `Generation failed for user ${user.authUserId} with model ${model}`,
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          dto: { prompt, model, providerOptions: dto.providerOptions },
        },
      );

      // Auto-refund credits on generation failure
      try {
        await this.paymentsService.refundCredits(
          user.authUserId,
          1,
          `Generation failed: ${error instanceof Error ? error.message : String(error)}`
        );
        this.logger.log(
          `Refunded 1 credit to user ${user.authUserId} due to generation failure`
        );
      } catch (refundError) {
        this.logger.error(
          `Failed to refund credits to user ${user.authUserId}:`,
          refundError
        );
      }

      throw error;
    }
  }

  async generateForModel(
    user: SanitizedUser,
    fallbackModel: string,
    dto: ProviderGenerateDto,
  ) {
    const normalizedModel = dto.model?.trim() || fallbackModel?.trim();
    if (!normalizedModel) {
      this.throwBadRequest('Model is required');
    }

    const mergedDto = {
      ...dto,
      model: normalizedModel,
    } as UnifiedGenerateDto;

    return this.generate(user, mergedDto);
  }

  private async dispatch(
    model: string,
    dto: UnifiedGenerateDto,
  ): Promise<ProviderResult> {
    // Handle FLUX models
    if (model.startsWith('flux-')) {
      return this.handleFlux(dto);
    }

    switch (model) {
      case 'gemini-2.5-flash-image-preview':
        return this.handleGemini(dto);
      case 'ideogram':
        return this.handleIdeogram(dto);
      case 'qwen-image':
        return this.handleQwen(dto);
      case 'runway-gen4':
      case 'runway-gen4-turbo':
        return this.handleRunway(dto);
      case 'seedream-3.0':
        return this.handleSeedream(dto);
      case 'chatgpt-image':
        return this.handleChatGpt(dto);
      case 'reve-image':
      case 'reve-image-1.0':
      case 'reve-v1':
        return this.handleReve(dto);
      case 'recraft-v2':
      case 'recraft-v3':
        return this.handleRecraft(dto);
      case 'luma-dream-shaper':
      case 'luma-realistic-vision':
      case 'luma-photon-1':
      case 'luma-photon-flash-1':
        return this.handleLuma(dto);
      default:
        this.throwBadRequest('Unsupported model', { model });
    }
  }

  private async handleFlux(dto: UnifiedGenerateDto): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('BFL_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('BFL_API_KEY is not configured');
    }

    const apiBase =
      this.configService.get<string>('BFL_API_BASE') ?? 'https://api.bfl.ai';
    const endpointBase = apiBase.replace(/\/$/, '');
    const endpoint = `${endpointBase}/v1/${dto.model}`;

    const providerOptions = dto.providerOptions ?? {};
    const payload: Record<string, unknown> = {
      prompt: dto.prompt,
    };

    for (const key of FLUX_OPTION_KEYS) {
      const value = providerOptions[key];
      if (value !== undefined && value !== null) {
        payload[key] = value;
      }
    }

    if (Array.isArray(dto.references) && dto.references.length > 0) {
      payload.references = dto.references;
    }

    const createResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-key': apiKey,
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const createPayload = (await createResponse.json().catch(async () => {
      const text = await createResponse.text().catch(() => '<unavailable>');
      return { raw: text };
    })) as unknown;
    const createRecord = toJsonRecord(createPayload);

    if (createResponse.status === 402) {
      throw new HttpException(
        { error: 'BFL credits exceeded (402). Add credits to proceed.' },
        402,
      );
    }

    if (createResponse.status === 429) {
      throw new HttpException(
        { error: 'BFL rate limit: too many active tasks (429). Try later.' },
        429,
      );
    }

    if (!createResponse.ok) {
      this.logger.error(
        `Flux create job failed ${createResponse.status}: ${JSON.stringify(createPayload)}`,
      );
      throw new HttpException(
        {
          error: `BFL error ${createResponse.status}`,
          details: createPayload,
        },
        createResponse.status,
      );
    }

    const jobId = getFirstString(createRecord, [
      'id',
      'job_id',
      'task_id',
      'jobId',
    ]);
    const pollingUrl = getFirstString(createRecord, [
      'polling_url',
      'pollingUrl',
      'polling_url_v2',
    ]);

    if (!pollingUrl || typeof pollingUrl !== 'string') {
      throw new InternalServerErrorException(
        'BFL response missing polling URL',
      );
    }

    this.ensureFluxHost(
      pollingUrl,
      FLUX_ALLOWED_POLL_HOSTS,
      'polling URL',
      FLUX_ALLOWED_POLL_SUFFIXES,
      this.fluxExtraPollHosts,
      this.fluxExtraPollSuffixes,
    );

    const pollResult = await this.pollFluxJob(pollingUrl, apiKey);
    const sampleUrl = this.extractFluxSampleUrl(pollResult.payload);

    if (!sampleUrl) {
      throw new InternalServerErrorException(
        'Flux response did not include an image URL',
      );
    }

    if (!sampleUrl.startsWith('data:')) {
      this.ensureFluxHost(
        sampleUrl,
        FLUX_ALLOWED_DOWNLOAD_HOSTS,
        'download URL',
        FLUX_ALLOWED_DOWNLOAD_SUFFIXES,
        this.fluxExtraDownloadHosts,
        this.fluxExtraDownloadSuffixes,
      );
    }

    const dataUrl = await this.ensureDataUrl(sampleUrl);
    const asset = { ...this.assetFromDataUrl(dataUrl), remoteUrl: sampleUrl };

    return {
      provider: 'flux',
      model: dto.model,
      clientPayload: {
        dataUrl,
        contentType: asset.mimeType,
        jobId: jobId ?? null,
        status: pollResult.status,
      },
      assets: [asset],
      rawResponse: {
        create: createPayload,
        final: pollResult.raw,
      },
      usageMetadata: {
        jobId: jobId ?? null,
        pollingUrl,
        status: pollResult.status,
      },
    };
  }

  private async handleGemini(dto: UnifiedGenerateDto): Promise<ProviderResult> {
    const apiKey = this.getGeminiApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException({
        error: 'Gemini API key not configured',
        hint: 'Set GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) on the backend.',
      });
    }

    const targetModel = 'gemini-2.5-flash-image-preview';
    const parts: Array<{
      text?: string;
      inlineData?: { mimeType: string; data: string };
    }> = [{ text: dto.prompt }];

    const primaryInline = this.normalizeInlineImage(
      dto.imageBase64,
      dto.mimeType || 'image/png',
    );
    if (primaryInline) {
      parts.push({ inlineData: primaryInline });
    }

    if (Array.isArray(dto.references)) {
      for (const ref of dto.references) {
        const referenceInline = this.normalizeInlineImage(ref, 'image/png');
        if (referenceInline) {
          parts.push({ inlineData: referenceInline });
        }
      }
    }

    const requestPayload: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
    };

    const generationConfig: Record<string, number> = {};
    if (dto.temperature !== undefined) {
      generationConfig.temperature = dto.temperature;
    }
    if (dto.topP !== undefined) {
      generationConfig.topP = dto.topP;
    }
    if (dto.outputLength !== undefined) {
      generationConfig.maxOutputTokens = dto.outputLength;
    }
    if (Object.keys(generationConfig).length > 0) {
      requestPayload.generationConfig = generationConfig;
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Gemini API error ${response.status}: ${errorText}`, {
        status: response.status,
        statusText: response.statusText,
        url: endpoint,
        requestPayload: requestPayload,
        errorResponse: errorText,
      });

      // Try to parse error response for more details
      let errorDetails = errorText;
      try {
        const errorJson = JSON.parse(errorText) as Record<string, unknown>;
        if (
          errorJson.error &&
          typeof errorJson.error === 'object' &&
          errorJson.error !== null
        ) {
          const errorObj = errorJson.error as Record<string, unknown>;
          if (typeof errorObj.message === 'string') {
            errorDetails = errorObj.message;
          }
        } else if (typeof errorJson.message === 'string') {
          errorDetails = errorJson.message;
        }
      } catch {
        // Keep original error text if parsing fails
      }

      throw new HttpException(
        {
          error: `Gemini API error: ${response.status}`,
          details: errorDetails,
          status: response.status,
          statusText: response.statusText,
        },
        response.status,
      );
    }

    const responsePayload = (await response.json()) as unknown;
    const resultRecord = toJsonRecord(responsePayload);
    const candidates = asArray(resultRecord['candidates']);
    const firstCandidate = optionalJsonRecord(candidates[0]);
    const contentRecord = firstCandidate
      ? optionalJsonRecord(firstCandidate['content'])
      : undefined;
    const partCandidates = contentRecord ? asArray(contentRecord['parts']) : [];

    let base64: string | undefined;
    let mimeType: string | undefined;
    let dataUrl: string | undefined;
    let remoteUrl: string | undefined;

    const remoteCandidates: GeminiRemoteCandidate[] = [];
    const remoteCandidateKeys = new Set<string>();

    const pushRemoteCandidate = (candidate: GeminiRemoteCandidate) => {
      const normalizedUrl = candidate.url
        ? this.normalizeGeminiUri(candidate.url)
        : undefined;
      const resolvedUrl = normalizedUrl ?? candidate.url;
      let resolvedFileId = candidate.fileId;
      if (!resolvedFileId && resolvedUrl) {
        resolvedFileId = this.normalizeGeminiFilePath(resolvedUrl) ?? undefined;
      }
      if (!resolvedFileId && candidate.rawUrl) {
        resolvedFileId =
          this.normalizeGeminiFilePath(candidate.rawUrl) ?? undefined;
      }
      if (!resolvedUrl && !candidate.fileId) {
        return;
      }
      const key = `${resolvedUrl ?? ''}|${resolvedFileId ?? ''}`;
      if (remoteCandidateKeys.has(key)) {
        return;
      }
      remoteCandidateKeys.add(key);
      const entry: GeminiRemoteCandidate = {
        url: resolvedUrl,
        rawUrl: candidate.rawUrl ?? candidate.url ?? resolvedUrl,
        fileId: resolvedFileId,
        mimeType: candidate.mimeType,
      };
      remoteCandidates.push(entry);
      if (!remoteUrl && entry.url) {
        remoteUrl = entry.url;
      }
    };

    for (const part of partCandidates) {
      const partRecord = optionalJsonRecord(part);
      if (!partRecord) {
        continue;
      }

      if (!base64) {
        const inlineRecord = optionalJsonRecord(partRecord['inlineData']);
        if (inlineRecord) {
          const data = asString(inlineRecord['data']);
          if (data) {
            base64 = data;
            mimeType = asString(inlineRecord['mimeType']) ?? mimeType;
            continue;
          }
        }
      }

      const fileData = optionalJsonRecord(partRecord['fileData']);
      if (fileData) {
        const fileUri =
          asString(fileData['fileUri']) ??
          asString(fileData['uri']) ??
          asString(fileData['url']);
        const fileId =
          asString(fileData['fileId']) ??
          asString(fileData['id']) ??
          asString(fileData['name']);
        const fileMime =
          asString(fileData['mimeType']) ??
          asString(fileData['contentType']) ??
          undefined;
        pushRemoteCandidate({
          url: fileUri ?? undefined,
          rawUrl: fileUri ?? undefined,
          fileId:
            fileId ??
            (fileUri
              ? (this.normalizeGeminiFilePath(fileUri) ?? undefined)
              : undefined),
          mimeType: fileMime,
        });
      }

      const mediaRecord = optionalJsonRecord(partRecord['media']);
      if (mediaRecord) {
        const mediaUri =
          asString(mediaRecord['mediaUri']) ??
          asString(mediaRecord['uri']) ??
          asString(mediaRecord['url']);
        const mediaMime =
          asString(mediaRecord['mimeType']) ??
          asString(mediaRecord['contentType']) ??
          undefined;
        pushRemoteCandidate({
          url: mediaUri ?? undefined,
          rawUrl: mediaUri ?? undefined,
          fileId: mediaUri
            ? (this.normalizeGeminiFilePath(mediaUri) ?? undefined)
            : undefined,
          mimeType: mediaMime,
        });
      }

      const genericUrl =
        asString(partRecord['url']) ??
        asString(partRecord['uri']) ??
        asString(partRecord['signedUrl']) ??
        asString(partRecord['imageUrl']);
      if (genericUrl) {
        const partMime =
          asString(partRecord['mimeType']) ??
          asString(partRecord['contentType']) ??
          undefined;
        pushRemoteCandidate({
          url: genericUrl,
          rawUrl: genericUrl,
          fileId: this.normalizeGeminiFilePath(genericUrl) ?? undefined,
          mimeType: partMime,
        });
      }

      if (!base64) {
        const dataCandidate = asString(partRecord['data']);
        if (dataCandidate && isProbablyBase64(dataCandidate)) {
          base64 = dataCandidate;
          mimeType = asString(partRecord['mimeType']) ?? mimeType;
        }
      }
    }

    const responseFiles = asArray(resultRecord['files']);
    for (const fileEntry of responseFiles) {
      const fileRecord = optionalJsonRecord(fileEntry);
      if (!fileRecord) {
        continue;
      }
      const fileUri =
        asString(fileRecord['uri']) ??
        asString(fileRecord['fileUri']) ??
        asString(fileRecord['url']);
      const fileId =
        asString(fileRecord['name']) ??
        asString(fileRecord['fileId']) ??
        asString(fileRecord['id']);
      const fileMime =
        asString(fileRecord['mimeType']) ??
        asString(fileRecord['contentType']) ??
        undefined;
      pushRemoteCandidate({
        url: fileUri ?? undefined,
        rawUrl: fileUri ?? undefined,
        fileId:
          fileId ??
          (fileUri
            ? (this.normalizeGeminiFilePath(fileUri) ?? undefined)
            : undefined),
        mimeType: fileMime,
      });
    }

    const generatedImages = asArray(
      resultRecord['generatedImages'] ?? resultRecord['generated_images'],
    );
    for (const imageEntry of generatedImages) {
      const imageRecord = optionalJsonRecord(imageEntry);
      if (!imageRecord) {
        continue;
      }
      const imageUri =
        asString(imageRecord['downloadUri']) ??
        asString(imageRecord['uri']) ??
        asString(imageRecord['imageUri']) ??
        asString(imageRecord['url']);
      const imageFileId =
        asString(imageRecord['fileId']) ??
        asString(imageRecord['name']) ??
        asString(imageRecord['id']);
      const imageMime =
        asString(imageRecord['mimeType']) ??
        asString(imageRecord['contentType']) ??
        undefined;
      pushRemoteCandidate({
        url: imageUri ?? undefined,
        rawUrl: imageUri ?? undefined,
        fileId:
          imageFileId ??
          (imageUri
            ? (this.normalizeGeminiFilePath(imageUri) ?? undefined)
            : undefined),
        mimeType: imageMime,
      });
    }

    const fallbackCandidates = this.collectImageCandidates(responsePayload);
    for (const candidate of fallbackCandidates) {
      pushRemoteCandidate({
        url: candidate,
        rawUrl: candidate,
        fileId: this.normalizeGeminiFilePath(candidate) ?? undefined,
      });
    }

    if (!base64) {
      for (const candidate of remoteCandidates) {
        const asset = await this.tryResolveGeminiCandidate(candidate, apiKey);
        if (asset) {
          base64 = asset.base64;
          mimeType = asset.mimeType ?? mimeType;
          dataUrl = asset.dataUrl;
          remoteUrl =
            asset.remoteUrl ?? remoteUrl ?? candidate.url ?? undefined;
          break;
        }
      }
    }

    if (!base64) {
      this.throwBadRequest('No image returned from Gemini 2.5 Flash Image');
    }

    const resolvedMimeType = mimeType ?? 'image/png';
    const resolvedDataUrl =
      dataUrl ?? `data:${resolvedMimeType};base64,${base64}`;
    const asset: GeneratedAsset = {
      dataUrl: resolvedDataUrl,
      mimeType: resolvedMimeType,
      base64,
      ...(remoteUrl ? { remoteUrl } : {}),
    };

    return {
      provider: 'gemini',
      model: targetModel,
      clientPayload: {
        success: true,
        mimeType: resolvedMimeType,
        imageBase64: base64,
        dataUrl: resolvedDataUrl,
        model: targetModel,
        remoteUrl: remoteUrl ?? null,
      },
      assets: [asset],
      rawResponse: responsePayload,
    };
  }

  private getGeminiApiKey(): string | undefined {
    for (const key of GEMINI_API_KEY_CANDIDATES) {
      const value = this.configService.get<string>(key);
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  }

  private async handleIdeogram(
    dto: UnifiedGenerateDto,
  ): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('IDEOGRAM_API_KEY');
    if (!apiKey) {
      this.logger.error(
        'IDEOGRAM_API_KEY environment variable is not configured',
      );
      throw new ServiceUnavailableException(
        'Ideogram API key not configured. Please set IDEOGRAM_API_KEY environment variable.',
      );
    }

    const endpoint = 'https://api.ideogram.ai/v1/ideogram-v3/generate';
    const form = new FormData();
    form.set('prompt', dto.prompt);

    const providerOptions = dto.providerOptions ?? {};

    const setStringOption = (keys: string[]) => {
      for (const key of keys) {
        const value = providerOptions[key];
        if (typeof value === 'string' && value.trim()) {
          form.set(keys[0], value.trim());
          return;
        }
      }
    };

    const setNumberOption = (keys: string[]) => {
      for (const key of keys) {
        const value = providerOptions[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          form.set(keys[0], String(value));
          return;
        }
      }
    };

    setStringOption(['aspect_ratio', 'aspectRatio']);
    setStringOption(['resolution']);
    setStringOption(['rendering_speed', 'renderingSpeed']);
    setStringOption(['magic_prompt', 'magicPrompt']);
    setStringOption(['style_preset', 'stylePreset']);
    setStringOption(['style_type', 'styleType']);
    setStringOption(['negative_prompt', 'negativePrompt']);
    setNumberOption(['num_images', 'numImages']);
    setNumberOption(['seed']);

    // Convert aspect ratio from "16:9" format to "16x9" format for Ideogram API
    if (form.has('aspect_ratio')) {
      const aspectRatio = form.get('aspect_ratio') as string;
      const ideogramAspectRatio = aspectRatio.replace(':', 'x');
      form.set('aspect_ratio', ideogramAspectRatio);
    }

    const styleCodes =
      providerOptions.style_codes ?? providerOptions.styleCodes;
    if (Array.isArray(styleCodes)) {
      for (const code of styleCodes) {
        if (typeof code === 'string' && code.trim()) {
          form.append('style_codes', code.trim());
        }
      }
    }

    const colorPalette =
      providerOptions.color_palette ?? providerOptions.colorPalette;
    if (colorPalette !== undefined) {
      const serialized =
        typeof colorPalette === 'string'
          ? colorPalette
          : this.stringifyUnknown(colorPalette);
      if (serialized.trim()) {
        form.set('color_palette', serialized.trim());
      }
    }

    if (!form.has('aspect_ratio')) {
      form.set('aspect_ratio', '1x1');
    }
    if (!form.has('rendering_speed')) {
      form.set('rendering_speed', 'DEFAULT');
    }
    if (!form.has('magic_prompt')) {
      form.set('magic_prompt', 'AUTO');
    }
    if (!form.has('num_images')) {
      form.set('num_images', '1');
    }

    const sanitizedIdeogramLog = {
      promptPreview: dto.prompt.slice(0, 120),
      aspectRatio: form.get('aspect_ratio') ?? null,
      renderingSpeed: form.get('rendering_speed') ?? null,
      magicPrompt: form.get('magic_prompt') ?? null,
      numImages: form.get('num_images') ?? null,
      hasResolution: form.has('resolution'),
      hasColorPalette: form.has('color_palette'),
      styleCodesCount: Array.isArray(styleCodes) ? styleCodes.length : 0,
    };
    this.logger.debug('Ideogram request payload', sanitizedIdeogramLog);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        Accept: 'application/json',
      },
      body: form,
    });

    if (!response.ok) {
      const errorPayload = await this.safeJson(response);
      const providerMessage =
        this.extractProviderMessage(errorPayload) ||
        `Ideogram API error: ${response.status}`;
      this.logger.error('Ideogram API error', {
        status: response.status,
        message: providerMessage,
        response: errorPayload,
        request: sanitizedIdeogramLog,
      });
      throw new HttpException(
        { error: providerMessage, details: errorPayload },
        response.status,
      );
    }

    const resultPayload = (await response.json()) as unknown;
    const urls = this.collectIdeogramUrls(resultPayload);
    if (urls.length === 0) {
      this.throwBadRequest('No images returned from Ideogram');
    }

    const dataUrls: string[] = [];
    for (const url of urls) {
      const ensured = await this.ensureDataUrl(url);
      dataUrls.push(ensured);
    }

    const assets = dataUrls.map((dataUrl) => this.assetFromDataUrl(dataUrl));

    return {
      provider: 'ideogram',
      model: 'ideogram-v3',
      clientPayload: { dataUrls },
      assets,
      rawResponse: resultPayload,
    };
  }

  private async handleQwen(dto: UnifiedGenerateDto): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('DASHSCOPE_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'DASHSCOPE_API_KEY is not configured',
      );
    }

    const endpoint = `${this.configService.get('DASHSCOPE_BASE') ?? 'https://dashscope-intl.aliyuncs.com/api/v1'}/services/aigc/multimodal-generation/generation`;

    const body = {
      model: 'qwen-image',
      input: {
        messages: [
          {
            role: 'user',
            content: [{ text: dto.prompt }],
          },
        ],
      },
      parameters: {
        ...(dto.providerOptions.size ? { size: dto.providerOptions.size } : {}),
        ...(typeof dto.providerOptions.seed === 'number'
          ? { seed: dto.providerOptions.seed }
          : {}),
        ...(dto.providerOptions.negative_prompt
          ? { negative_prompt: dto.providerOptions.negative_prompt }
          : {}),
        prompt_extend: dto.providerOptions.prompt_extend ?? true,
        watermark: dto.providerOptions.watermark ?? false,
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const resultPayload = (await response.json()) as unknown;
    const resultRecord = toJsonRecord(resultPayload);

    if (!response.ok) {
      const serialized = this.stringifyUnknown(resultPayload);
      this.logger.error(`DashScope error ${response.status}: ${serialized}`);
      const errorMessage =
        asString(resultRecord['message']) ?? 'DashScope error';
      throw new HttpException(
        { error: errorMessage, code: resultRecord['code'] },
        response.status,
      );
    }

    const imageUrl = this.extractDashscopeImageUrl(resultPayload);
    if (!imageUrl) {
      this.throwBadRequest('No image returned from DashScope');
    }

    const dataUrl = await this.ensureDataUrl(imageUrl);
    const asset = this.assetFromDataUrl(dataUrl);

    return {
      provider: 'qwen',
      model: 'qwen-image',
      clientPayload: {
        dataUrl,
        contentType: asset.mimeType,
        usage: resultRecord['usage'] ?? null,
      },
      assets: [asset],
      rawResponse: resultPayload,
    };
  }

  private async handleRunway(dto: UnifiedGenerateDto): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('RUNWAY_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('Runway API key not configured');
    }

    const runwayModel = this.resolveRunwayModel(dto.model);
    const ratio = this.resolveRunwayRatio(dto.providerOptions?.ratio);
    const seed = asNumber(dto.providerOptions?.seed);
    const referenceImages = this.buildRunwayReferenceImages(dto);

    if (runwayModel === 'gen4_image_turbo' && referenceImages.length === 0) {
      this.throwBadRequest(
        'Runway Gen-4 Turbo requires at least one reference image.',
      );
    }

    const contentModeration = this.resolveRunwayModeration(dto.providerOptions);

    const requestBody: Record<string, unknown> = {
      model: runwayModel,
      promptText: dto.prompt,
      ratio,
    };

    if (referenceImages.length > 0) {
      requestBody.referenceImages = referenceImages;
    }
    if (seed !== undefined) {
      requestBody.seed = seed;
    }
    if (contentModeration) {
      requestBody.contentModeration = contentModeration;
    }

    const sanitizedLog = {
      model: runwayModel,
      ratio,
      referenceCount: referenceImages.length,
      hasSeed: seed !== undefined,
      hasModeration: Boolean(contentModeration),
      promptPreview: dto.prompt.slice(0, 120),
    };
    this.logger.debug('Runway request payload', sanitizedLog);

    const createResponse = await fetch(
      'https://api.dev.runwayml.com/v1/text_to_image',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Runway-Version': RUNWAY_API_VERSION,
        },
        body: JSON.stringify(requestBody),
      },
    );

    const createPayload = await this.safeJson(createResponse);

    if (!createResponse.ok) {
      const message =
        this.extractProviderMessage(createPayload) ||
        `Runway API error: ${createResponse.status}`;
      this.logger.error('Runway create error', {
        status: createResponse.status,
        message,
        response: createPayload,
        request: sanitizedLog,
      });
      throw new HttpException(
        { error: message, details: createPayload },
        createResponse.status,
      );
    }

    const createRecord = optionalJsonRecord(createPayload);
    const taskId = createRecord ? asString(createRecord['id']) : undefined;
    if (!taskId) {
      this.logger.error(
        'Runway create response missing task ID',
        createPayload,
      );
      this.throwBadRequest('Runway did not return a task identifier');
    }

    const taskPayload = await this.pollRunwayTask(apiKey, taskId);
    const taskRecord = optionalJsonRecord(taskPayload);
    const outputs = taskRecord ? asArray(taskRecord['output']) : [];
    const remoteUrlCandidate = outputs
      .map((entry) => asString(entry))
      .find(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      );

    if (!remoteUrlCandidate) {
      this.logger.error(
        'Runway task completed without output URL',
        taskPayload,
      );
      this.throwBadRequest('Runway did not return an output image URL');
    }

    const dataUrl = await this.ensureDataUrl(remoteUrlCandidate);
    const asset = this.assetFromDataUrl(dataUrl);
    asset.remoteUrl = remoteUrlCandidate;

    return {
      provider: 'runway',
      model: runwayModel,
      clientPayload: {
        dataUrl,
        contentType: asset.mimeType,
        taskId,
        status: asString(taskRecord?.['status']) ?? null,
        output: outputs,
      },
      assets: [asset],
      rawResponse: {
        create: createPayload,
        task: taskPayload,
      },
      usageMetadata: {
        taskId,
        status: asString(taskRecord?.['status']) ?? null,
      },
    };
  }

  private async handleSeedream(
    dto: UnifiedGenerateDto,
  ): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('ARK_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('Seedream API key not configured');
    }

    const response = await fetch(
      'https://ark.ap-southeast.bytepluses.com/api/v3/image/generate',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'seedream-v3',
          prompt: dto.prompt,
          width: dto.providerOptions.width ?? 1024,
          height: dto.providerOptions.height ?? 1024,
          num_images: dto.providerOptions.n ?? 1,
        }),
      },
    );

    const resultPayload = (await response.json()) as unknown;
    if (!response.ok) {
      const details = this.stringifyUnknown(resultPayload);
      this.logger.error(`Seedream API error ${response.status}: ${details}`);
      throw new HttpException(
        {
          error: `Seedream API error: ${response.status}`,
          details: resultPayload,
        },
        response.status,
      );
    }

    const urls = this.extractSeedreamImages(resultPayload);
    if (urls.length === 0) {
      this.throwBadRequest('No images returned from Seedream');
    }

    const dataUrls: string[] = [];
    const assets: GeneratedAsset[] = [];
    for (const url of urls) {
      const remoteUrl = url.startsWith('data:') ? undefined : url;
      const ensured = await this.ensureDataUrl(url);
      const asset = this.assetFromDataUrl(ensured);
      dataUrls.push(asset.dataUrl);
      assets.push(remoteUrl ? { ...asset, remoteUrl } : asset);
    }

    return {
      provider: 'seedream',
      model: 'seedream-v3',
      clientPayload: { images: dataUrls },
      assets,
      rawResponse: resultPayload,
    };
  }

  private async handleChatGpt(
    dto: UnifiedGenerateDto,
  ): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('OpenAI API key not configured');
    }

    const response = await fetch(
      'https://api.openai.com/v1/images/generations',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: dto.prompt,
          n: 1,
          size: dto.providerOptions.size ?? '1024x1024',
        }),
      },
    );

    const resultPayload = (await response.json()) as unknown;
    const resultRecord = toJsonRecord(resultPayload);
    if (!response.ok) {
      const details = this.stringifyUnknown(resultPayload);
      this.logger.error(`OpenAI API error ${response.status}: ${details}`);
      throw new HttpException(
        {
          error: `OpenAI API error: ${response.status}`,
          details: resultPayload,
        },
        response.status,
      );
    }

    const url = this.extractOpenAiImage(resultPayload);
    if (!url) {
      this.throwBadRequest('No image returned from OpenAI');
    }

    const dataUrl = await this.ensureDataUrl(url);
    const asset = this.assetFromDataUrl(dataUrl);

    const revisedPrompt = (() => {
      const dataEntries = asArray(resultRecord['data']);
      const first = optionalJsonRecord(dataEntries[0]);
      if (!first) {
        return undefined;
      }
      return asString(first['revised_prompt']);
    })();

    return {
      provider: 'openai',
      model: 'dall-e-3',
      clientPayload: {
        dataUrl,
        contentType: asset.mimeType,
        revisedPrompt: revisedPrompt ?? null,
      },
      assets: [asset],
      rawResponse: resultPayload,
    };
  }

  private async handleReve(dto: UnifiedGenerateDto): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('REVE_API_KEY');
    if (!apiKey) {
      this.logger.error('REVE_API_KEY environment variable is not configured');
      throw new ServiceUnavailableException(
        'Reve API key not configured. Please set REVE_API_KEY environment variable.',
      );
    }

    const requestBody: Record<string, unknown> = {
      prompt: dto.prompt,
    };

    // Remove model parameter as it might not be supported by Reve API
    // const resolvedModel = this.resolveReveModel(
    //   dto.model,
    //   providerOptions.model,
    // );
    // if (resolvedModel && resolvedModel !== 'reve-image-1.0') {
    //   requestBody.model = resolvedModel;
    // }

    // Remove width and height as they might not be supported by Reve API
    // const width = asNumber(providerOptions.width);
    // if (width !== undefined) {
    //   requestBody.width = width;
    // }
    // const height = asNumber(providerOptions.height);
    // if (height !== undefined) {
    //   requestBody.height = height;
    // }
    // Remove seed as it might not be supported by Reve API
    // const seed = asNumber(providerOptions.seed);
    // if (seed !== undefined) {
    //   requestBody.seed = seed;
    // }
    // Remove guidance_scale and steps as they might not be supported by Reve API
    // const guidanceScale = asNumber(
    //   providerOptions.guidance_scale ?? providerOptions.guidanceScale,
    // );
    // if (guidanceScale !== undefined) {
    //   requestBody.guidance_scale = guidanceScale;
    // }
    // const steps = asNumber(providerOptions.steps);
    // if (steps !== undefined) {
    //   requestBody.steps = steps;
    // }

    // Remove aspect_ratio as it might not be supported by Reve API
    // const aspectRatio = asString(
    //   providerOptions.aspect_ratio ?? providerOptions.aspectRatio,
    // );
    // if (aspectRatio) {
    //   if (width === undefined && height === undefined) {
    //     requestBody.aspect_ratio = aspectRatio;
    //   } else {
    //     this.logger.debug(
    //       'Reve payload includes aspect_ratio along with width/height; favouring explicit dimensions.',
    //     );
    //   }
    // }
    // Remove negative_prompt as it might not be supported by Reve API
    // const negativePrompt = asString(
    //   providerOptions.negative_prompt ?? providerOptions.negativePrompt,
    // );
    // if (negativePrompt) {
    //   requestBody.negative_prompt = negativePrompt;
    // }

    const sanitizedReveLog = {
      requestedModel: dto.model ?? null,
      modelInRequest: null, // Removed model parameter
      width: null, // Removed width parameter
      height: null, // Removed height parameter
      aspectRatio: null, // Removed aspect_ratio parameter
      guidanceScale: null, // Removed guidance_scale parameter
      steps: null, // Removed steps parameter
      seed: null, // Removed seed parameter
      hasNegativePrompt: false, // Removed negative_prompt parameter
      referenceCount: Array.isArray(dto.references) ? dto.references.length : 0,
    };
    this.logger.debug('Reve request payload', sanitizedReveLog);

    const endpoint = `${this.getReveApiBase()}/v1/image/create`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const resultPayload = await this.safeJson(response);

    if (!response.ok) {
      const providerMessage =
        this.extractProviderMessage(resultPayload) ||
        `Reve API error: ${response.status}`;
      this.logger.error('Reve API error', {
        status: response.status,
        message: providerMessage,
        response: resultPayload,
        request: sanitizedReveLog,
      });

      throw new HttpException(
        { error: providerMessage, details: resultPayload },
        response.status,
      );
    }

    const payloadRecord = toJsonRecord(resultPayload);
    if (payloadRecord['content_violation']) {
      throw new HttpException(
        {
          error: 'Reve rejected the prompt for policy reasons.',
          details: resultPayload,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const jobId = getFirstString(payloadRecord, ['job_id', 'request_id', 'id']);

    const { dataUrls, assets } = await this.resolveReveAssets(resultPayload);

    if (dataUrls.length === 0) {
      this.throwBadRequest('No images returned from Reve');
    }

    const clientPayload = this.buildReveClientPayload(
      payloadRecord,
      dataUrls,
      jobId,
    );

    return {
      provider: 'reve',
      model: 'reve-image-1.0',
      clientPayload,
      assets,
      rawResponse: resultPayload,
      usageMetadata: {
        jobId: jobId ?? null,
        status:
          asString(payloadRecord['status']) ??
          (dataUrls.length > 0 ? 'completed' : null),
      },
    };
  }

  async getReveJobStatus(jobId: string) {
    const trimmedId = jobId?.trim?.() ?? '';
    if (!trimmedId) {
      this.throwBadRequest('Job ID is required');
    }

    const apiKey = this.configService.get<string>('REVE_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('Reve API key not configured');
    }

    const endpoint = `${this.getReveApiBase()}/v1/images/${encodeURIComponent(trimmedId)}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    const textPayload = await response.text();
    let resultPayload: unknown;
    try {
      resultPayload = textPayload ? (JSON.parse(textPayload) as unknown) : {};
    } catch {
      resultPayload = { raw: textPayload };
    }

    if (!response.ok) {
      const details = this.stringifyUnknown(resultPayload);
      this.logger.error(`Reve job status error ${response.status}: ${details}`);
      throw new HttpException(
        {
          error: `Reve job status error: ${response.status}`,
          details: resultPayload,
        },
        response.status,
      );
    }

    const payloadRecord = toJsonRecord(resultPayload);
    const { dataUrls } = await this.resolveReveAssets(resultPayload);
    const clientPayload = this.buildReveClientPayload(
      payloadRecord,
      dataUrls,
      trimmedId,
    );

    return clientPayload;
  }

  async editReveImage(user: SanitizedUser, input: ReveEditInput) {
    const apiKey = this.configService.get<string>('REVE_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('Reve API key not configured');
    }

    const endpoint = `${this.getReveApiBase()}/v1/image/edit`;
    const form = new FormData();
    form.set('prompt', input.prompt);

    const resolvedModel = this.resolveReveModel(input.model);
    if (resolvedModel) {
      form.set('model', resolvedModel);
    }

    if (input.negativePrompt) {
      form.set('negative_prompt', input.negativePrompt);
    }

    const appendNumber = (key: string, value?: number) => {
      if (value !== undefined && Number.isFinite(value)) {
        form.set(key, String(value));
      }
    };

    appendNumber('guidance_scale', input.guidanceScale);
    appendNumber('steps', input.steps);
    appendNumber('seed', input.seed);
    appendNumber('batch_size', input.batchSize);
    appendNumber('width', input.width);
    appendNumber('height', input.height);
    appendNumber('strength', input.strength);
    if (input.aspectRatio) {
      form.set('aspect_ratio', input.aspectRatio);
    }

    const imageBlob = new Blob([this.cloneToArrayBuffer(input.image.buffer)], {
      type: input.image.mimeType ?? 'application/octet-stream',
    });
    form.set('image', imageBlob, input.image.filename ?? 'image.png');

    if (input.mask) {
      const maskBlob = new Blob([this.cloneToArrayBuffer(input.mask.buffer)], {
        type: input.mask.mimeType ?? 'application/octet-stream',
      });
      form.set('mask', maskBlob, input.mask.filename ?? 'mask.png');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    const textPayload = await response.text();
    let resultPayload: unknown;
    try {
      resultPayload = textPayload ? (JSON.parse(textPayload) as unknown) : {};
    } catch {
      resultPayload = { raw: textPayload };
    }

    if (!response.ok) {
      const details = this.stringifyUnknown(resultPayload);
      this.logger.error(`Reve edit error ${response.status}: ${details}`);
      throw new HttpException(
        {
          error: `Reve edit error: ${response.status}`,
          details: resultPayload,
        },
        response.status,
      );
    }

    const payloadRecord = toJsonRecord(resultPayload);
    if (payloadRecord['content_violation']) {
      throw new HttpException(
        {
          error: 'Reve rejected the edit for policy reasons.',
          details: resultPayload,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const jobId = getFirstString(payloadRecord, ['job_id', 'request_id', 'id']);

    const { dataUrls, assets } = await this.resolveReveAssets(resultPayload);

    const providerModel =
      this.resolveReveModel(payloadRecord['model'], resolvedModel) ??
      resolvedModel ??
      'reve-image-1.0';

    const clientPayload = this.buildReveClientPayload(
      payloadRecord,
      dataUrls,
      jobId,
    );
    clientPayload.model = providerModel;

    const providerResult: ProviderResult = {
      provider: 'reve',
      model: providerModel,
      clientPayload,
      assets,
      rawResponse: resultPayload,
      usageMetadata: {
        jobId: jobId ?? null,
        status:
          asString(payloadRecord['status']) ??
          (dataUrls.length > 0 ? 'completed' : null),
        requestType: 'edit',
      },
    };

    // Create a DTO-like object for persistResult
    const dto = {
      prompt: input.prompt,
      model: input.model || 'reve-image-1.0',
      avatarId: input.avatarId,
      avatarImageId: input.avatarImageId,
      productId: input.productId,
      providerOptions: input.providerOptions || {},
    };
    await this.persistResult(user, input.prompt, providerResult, dto);

    return clientPayload;
  }

  private async handleRecraft(
    dto: UnifiedGenerateDto,
  ): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('RECRAFT_API_KEY');
    if (!apiKey) {
      this.logger.error(
        'RECRAFT_API_KEY environment variable is not configured',
      );
      throw new ServiceUnavailableException(
        'Recraft API key not configured. Please set RECRAFT_API_KEY environment variable.',
      );
    }

    const model = dto.model === 'recraft-v2' ? 'recraftv2' : 'recraftv3';
    const response = await fetch(
      'https://external.api.recraft.ai/v1/images/generations',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: dto.prompt,
          model,
          style: dto.providerOptions.style ?? 'realistic_image',
          substyle: dto.providerOptions.substyle,
          size: dto.providerOptions.size ?? '1024x1024',
          n: dto.providerOptions.n ?? 1,
          negative_prompt: dto.providerOptions.negative_prompt,
          controls: dto.providerOptions.controls,
          text_layout: dto.providerOptions.text_layout,
          response_format: dto.providerOptions.response_format ?? 'url',
        }),
      },
    );

    const resultPayload = (await response.json()) as unknown;
    if (!response.ok) {
      const details = this.stringifyUnknown(resultPayload);
      this.logger.error(`Recraft API error ${response.status}: ${details}`);
      throw new HttpException(
        {
          error: `Recraft API error: ${response.status}`,
          details: resultPayload,
        },
        response.status,
      );
    }

    const urls = this.extractRecraftImages(resultPayload);
    if (urls.length === 0) {
      this.throwBadRequest('No images returned from Recraft');
    }

    const dataUrls = [] as string[];
    const assets: GeneratedAsset[] = [];
    for (const url of urls) {
      const ensured = await this.ensureDataUrl(url);
      dataUrls.push(ensured);
      assets.push(this.assetFromDataUrl(ensured));
    }

    return {
      provider: 'recraft',
      model,
      clientPayload: { dataUrls },
      assets,
      rawResponse: resultPayload,
    };
  }

  private async handleLuma(dto: UnifiedGenerateDto): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('LUMAAI_API_KEY');
    if (!apiKey) {
      this.logger.error(
        'LUMAAI_API_KEY environment variable is not configured',
      );
      throw new ServiceUnavailableException(
        'Luma AI API key not configured. Please set LUMAAI_API_KEY environment variable.',
      );
    }

    if (dto.model === 'luma-photon-1' || dto.model === 'luma-photon-flash-1') {
      return this.handleLumaPhoton(dto, apiKey);
    }

    return this.handleLegacyLuma(dto, apiKey);
  }

  private async handleLumaPhoton(
    dto: UnifiedGenerateDto,
    apiKey: string,
  ): Promise<ProviderResult> {
    const luma = new LumaAI({ authToken: apiKey });
    const normalizedModel = dto.model.replace(/^luma-/, '');

    const payload: ImageCreateParams = {
      prompt: dto.prompt,
      model: normalizedModel as ImageCreateParams['model'],
    };

    const providerOptions = dto.providerOptions ?? {};

    const aspectRatio =
      providerOptions.aspect_ratio ?? providerOptions.aspectRatio;
    if (typeof aspectRatio === 'string' && aspectRatio.trim()) {
      payload.aspect_ratio =
        aspectRatio.trim() as ImageCreateParams['aspect_ratio'];
    }

    if (Array.isArray(providerOptions.image_ref)) {
      payload.image_ref =
        providerOptions.image_ref as ImageCreateParams['image_ref'];
    }
    if (Array.isArray(providerOptions.style_ref)) {
      payload.style_ref =
        providerOptions.style_ref as ImageCreateParams['style_ref'];
    }
    if (providerOptions.character_ref) {
      payload.character_ref =
        providerOptions.character_ref as ImageCreateParams['character_ref'];
    }
    if (providerOptions.modify_image_ref) {
      payload.modify_image_ref =
        providerOptions.modify_image_ref as ImageCreateParams['modify_image_ref'];
    }
    if (typeof providerOptions.format === 'string') {
      payload.format = providerOptions.format as ImageCreateParams['format'];
    }

    const callbackUrl =
      providerOptions.callback_url ?? providerOptions.callbackUrl;
    if (typeof callbackUrl === 'string' && callbackUrl.trim()) {
      payload.callback_url = callbackUrl.trim();
    }

    const generation = await luma.generations.image.create(payload);

    const resolvedGeneration = await this.pollLumaGeneration(
      luma,
      generation.id ?? '',
    );
    const assetsRecord = resolvedGeneration?.assets ?? {};
    const assetUrl = assetsRecord?.image;

    if (typeof assetUrl !== 'string' || !assetUrl.trim()) {
      this.throwBadRequest('Luma generation did not return an image asset');
    }

    const { dataUrl, mimeType, base64 } = await this.downloadAsDataUrl(
      assetUrl,
      { Authorization: `Bearer ${apiKey}` },
    );

    const asset: GeneratedAsset = {
      dataUrl,
      mimeType,
      base64,
      remoteUrl: assetUrl,
    };

    return {
      provider: 'luma',
      model: dto.model,
      clientPayload: {
        dataUrl,
        mimeType,
        generationId: resolvedGeneration?.id ?? null,
        state: resolvedGeneration?.state ?? null,
      },
      assets: [asset],
      rawResponse: resolvedGeneration,
      usageMetadata: {
        generationId: resolvedGeneration?.id ?? null,
        state: resolvedGeneration?.state ?? null,
      },
    };
  }

  private async handleLegacyLuma(
    dto: UnifiedGenerateDto,
    apiKey: string,
  ): Promise<ProviderResult> {
    const model =
      dto.model === 'luma-realistic-vision'
        ? 'luma-realistic-vision'
        : 'luma-dream-shaper';
    const response = await fetch(
      'https://api.lumalabs.ai/dream-machine/v1/generations',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: dto.prompt,
          model,
          aspect_ratio: dto.providerOptions.aspectRatio || '1:1',
          style: dto.providerOptions.style || 'realistic',
          quality: dto.providerOptions.quality || 'standard',
          negative_prompt: dto.providerOptions.negativePrompt,
          seed: dto.providerOptions.seed,
          steps: dto.providerOptions.steps,
          guidance_scale: dto.providerOptions.guidanceScale,
        }),
      },
    );

    const resultPayload = (await response.json()) as unknown;
    if (!response.ok) {
      const details = this.stringifyUnknown(resultPayload);
      this.logger.error(`Luma AI API error ${response.status}: ${details}`);
      let errorMessage = `Luma AI API error: ${response.status}`;
      if (response.status === 404) {
        errorMessage =
          'Luma AI API endpoint not found. Please check your API key and endpoint configuration.';
      } else if (response.status === 401) {
        errorMessage =
          'Luma AI API authentication failed. Please check your API key.';
      } else if (response.status === 429) {
        errorMessage =
          'Luma AI API rate limit exceeded. Please try again later.';
      }
      throw new HttpException(
        {
          error: errorMessage,
          details: resultPayload,
        },
        response.status,
      );
    }

    const urls = this.extractLumaImages(resultPayload);
    if (urls.length === 0) {
      this.throwBadRequest('No images returned from Luma AI');
    }

    const dataUrls = [] as string[];
    const assets: GeneratedAsset[] = [];
    for (const url of urls) {
      const ensured = await this.ensureDataUrl(url);
      dataUrls.push(ensured);
      assets.push(this.assetFromDataUrl(ensured));
    }

    return {
      provider: 'luma',
      model,
      clientPayload: { dataUrls },
      assets,
      rawResponse: resultPayload,
    };
  }

  private async pollLumaGeneration(
    luma: LumaAI,
    id: string,
  ): Promise<LumaGeneration> {
    const trimmedId = id?.trim?.();
    if (!trimmedId) {
      this.throwBadRequest('Luma generation id is required');
    }

    const maxAttempts = 60;
    const delayMs = 2000;
    let latest: LumaGeneration | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      latest = await luma.generations.get(trimmedId);
      const state = String(latest?.state ?? '')
        .toLowerCase()
        .trim();

      if (state === 'completed') {
        return latest;
      }

      if (state === 'failed') {
        throw new HttpException(
          {
            error: 'Luma generation failed',
            details: latest,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      await this.sleep(delayMs);
    }

    throw new HttpException(
      {
        error: 'Luma generation timed out',
        details: { id: trimmedId, lastKnown: latest },
      },
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async persistResult(
    user: SanitizedUser,
    prompt: string,
    providerResult: ProviderResult,
    dto: UnifiedGenerateDto,
  ) {
    try {
      await this.usageService.recordGeneration(user, {
        provider: providerResult.provider,
        model: providerResult.model,
        prompt,
        metadata: {
          rawResponse: providerResult.rawResponse,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to record usage event: ${String(error)}`);
    }

    const [firstAsset] = providerResult.assets;
    if (!firstAsset) {
      return;
    }

    // Metadata for usage tracking (currently not used but kept for future use)
    // const metadata: Record<string, unknown> = {
    //   provider: providerResult.provider,
    //   model: providerResult.model,
    //   prompt,
    //   options: providerOptions,
    // };

    // Upload to R2 and create R2File record
    const [asset] = providerResult.assets;
    if (asset && this.r2Service.isConfigured()) {
      try {
        // Extract base64 data from data URL
        const base64Match = asset.dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
        if (base64Match) {
          const [, mimeType, base64Data] = base64Match;
          const publicUrl = await this.r2Service.uploadBase64Image(
            base64Data,
            mimeType,
            'generated-images',
          );

          // Create R2File record
          const fileName = `image-${Date.now()}.${
            mimeType.split('/')[1] || 'png'
          }`;
          const r2File = await this.r2FilesService.create(user.authUserId, {
            fileName,
            fileUrl: publicUrl,
            fileSize: Math.round((base64Data.length * 3) / 4),
            mimeType,
            prompt,
            model: providerResult.model,
            avatarId: dto.avatarId,
            avatarImageId: dto.avatarImageId,
            productId: dto.productId,
          });

          // Update the asset URL to use R2 URL
          asset.dataUrl = publicUrl;
          asset.remoteUrl = publicUrl;
          asset.r2FileId = r2File.id;
          asset.r2FileUrl = r2File.fileUrl;

          // Update clientPayload with R2 metadata for consistency
          this.updateClientPayloadWithR2Info(
            providerResult.clientPayload,
            r2File,
          );
        }
      } catch (error) {
        this.logger.error(`Failed to upload to R2: ${String(error)}`);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw new Error(
          `R2 upload failed: ${errorMessage}. Please ensure R2 is properly configured and bucket has public access enabled.`,
        );
      }
    } else if (asset && !this.r2Service.isConfigured()) {
      this.logger.error('R2 is not configured but image generation attempted');
      throw new Error(
        'R2 storage is not configured. Please configure Cloudflare R2 credentials.',
      );
    }
  }

  private updateClientPayloadWithR2Info(
    clientPayload: unknown,
    r2File: { id: string; fileUrl: string },
  ): void {
    if (!clientPayload || typeof clientPayload !== 'object') {
      return;
    }

    const payload = clientPayload as Record<string, unknown>;
    const r2Url = r2File.fileUrl;

    // Update common URL fields
    if (payload.dataUrl) {
      payload.dataUrl = r2Url;
    }
    if (payload.image) {
      payload.image = r2Url;
    }
    if (payload.image_url) {
      payload.image_url = r2Url;
    }

    // Handle arrays of URLs
    if (Array.isArray(payload.dataUrls)) {
      payload.dataUrls = [r2Url];
    }
    if (Array.isArray(payload.images)) {
      payload.images = [r2Url];
    }

    // Attach metadata so downstream consumers can avoid duplicate persistence
    payload.r2FileId = r2File.id;
    payload.r2FileUrl = r2Url;
  }

  private normalizeInlineImage(
    value: unknown,
    fallbackMime: string,
  ): InlineImage | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const dataUrlMatch = trimmed.match(/^data:([^;,]+);base64,(.*)$/);
    if (dataUrlMatch) {
      return {
        mimeType: dataUrlMatch[1] || fallbackMime,
        data: dataUrlMatch[2].replace(/\s+/g, ''),
      };
    }

    return {
      mimeType: fallbackMime,
      data: trimmed.replace(/\s+/g, ''),
    };
  }

  private async ensureDataUrl(
    source: string,
    headers?: Record<string, string>,
  ): Promise<string> {
    if (source.startsWith('data:')) {
      return source;
    }
    const normalized = source.startsWith('gs://')
      ? (this.convertGsUriToHttps(source) ?? source)
      : source;
    const { dataUrl } = await this.downloadAsDataUrl(normalized, headers);
    return dataUrl;
  }

  private async downloadAsDataUrl(
    url: string,
    headers?: Record<string, string>,
  ) {
    const response = await fetch(url, {
      headers,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '<no-body>');
      throw new HttpException(
        { error: `Failed to download image`, details: text },
        response.status,
      );
    }

    const contentTypeHeader =
      response.headers.get('content-type')?.toLowerCase() ?? '';

    if (contentTypeHeader.includes('json')) {
      const text = await response.text();
      let payload: unknown = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      const payloadRecord = optionalJsonRecord(payload);
      if (payloadRecord) {
        const inlineRecord =
          optionalJsonRecord(payloadRecord['inlineData']) ??
          optionalJsonRecord(payloadRecord['inline_data']);
        const base64 =
          asString(inlineRecord?.['data']) ??
          asString(payloadRecord['data']) ??
          asString(payloadRecord['base64']);
        const mimeType =
          asString(inlineRecord?.['mimeType']) ??
          asString(payloadRecord['mimeType']) ??
          'image/png';

        if (base64) {
          return {
            dataUrl: `data:${mimeType};base64,${base64}`,
            mimeType,
            base64,
          };
        }

        for (const candidate of this.collectImageCandidates(payloadRecord)) {
          if (candidate.startsWith('data:')) {
            return this.assetFromDataUrl(candidate);
          }
        }
      }

      throw new HttpException(
        {
          error: 'Failed to extract image data from response',
          details: payload ?? text.slice(0, 2000),
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const mimeType =
      contentTypeHeader.split(';')[0]?.trim() ||
      response.headers.get('content-type') ||
      'image/png';
    return {
      dataUrl: `data:${mimeType};base64,${base64}`,
      mimeType,
      base64,
    };
  }

  private assetFromDataUrl(dataUrl: string): GeneratedAsset {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) {
      throw new InternalServerErrorException('Invalid data URL format');
    }
    return {
      dataUrl,
      mimeType: match[1],
      base64: match[2],
    };
  }

  private extractDashscopeImageUrl(result: unknown): string | null {
    const resultRecord = optionalJsonRecord(result);
    if (!resultRecord) {
      return null;
    }
    const outputRecord = optionalJsonRecord(resultRecord['output']);
    if (!outputRecord) {
      return null;
    }
    for (const choice of asArray(outputRecord['choices'])) {
      const choiceRecord = optionalJsonRecord(choice);
      if (!choiceRecord) {
        continue;
      }
      const messageRecord = optionalJsonRecord(choiceRecord['message']);
      if (!messageRecord) {
        continue;
      }
      for (const item of asArray(messageRecord['content'])) {
        const itemRecord = optionalJsonRecord(item);
        const image = itemRecord ? asString(itemRecord['image']) : undefined;
        if (image) {
          return image;
        }
      }
    }
    return null;
  }

  private resolveRunwayModel(
    model?: string | null,
  ): 'gen4_image' | 'gen4_image_turbo' {
    const normalized = (model ?? '').toString().toLowerCase();
    if (normalized.includes('turbo')) {
      return 'gen4_image_turbo';
    }
    return 'gen4_image';
  }

  private resolveRunwayRatio(value: unknown): string {
    const defaultRatio = '1920:1080';
    if (typeof value === 'string') {
      const cleaned = value.trim();
      if (cleaned) {
        const candidate = cleaned.replace(/x/gi, ':').replace(/\s+/g, '');
        if (RUNWAY_ALLOWED_RATIOS.has(candidate)) {
          return candidate;
        }
        this.logger.warn(
          'Runway ratio not supported, falling back to default.',
          {
            requested: cleaned,
          },
        );
      }
    }
    return defaultRatio;
  }

  private buildRunwayReferenceImages(
    dto: UnifiedGenerateDto,
  ): Array<{ uri: string; tag?: string }> {
    const providerOptions = dto.providerOptions ?? {};
    const referenceImages: Array<{ uri: string; tag?: string }> = [];

    const tagCandidatesRaw =
      providerOptions.reference_image_tags ??
      providerOptions.referenceImageTags;
    const tagCandidates = Array.isArray(tagCandidatesRaw)
      ? tagCandidatesRaw
      : [];

    const addReference = (uriCandidate: unknown, tagCandidate?: unknown) => {
      if (referenceImages.length >= RUNWAY_MAX_REFERENCES) {
        return;
      }
      const normalizedUri = this.normalizeRunwayReferenceUri(uriCandidate);
      if (!normalizedUri) {
        return;
      }
      const tag = this.sanitizeRunwayTag(tagCandidate, referenceImages.length);
      if (tag) {
        referenceImages.push({ uri: normalizedUri, tag });
      } else {
        referenceImages.push({ uri: normalizedUri });
      }
    };

    const directReferences = Array.isArray(dto.references)
      ? dto.references
      : [];
    for (let i = 0; i < directReferences.length; i += 1) {
      addReference(directReferences[i], tagCandidates[i]);
    }

    const providerReferenceImages =
      providerOptions.referenceImages ?? providerOptions.reference_images;
    if (Array.isArray(providerReferenceImages)) {
      for (const entry of providerReferenceImages) {
        if (referenceImages.length >= RUNWAY_MAX_REFERENCES) {
          break;
        }
        if (typeof entry === 'string') {
          addReference(entry);
          continue;
        }
        const entryRecord = optionalJsonRecord(entry);
        if (!entryRecord) {
          continue;
        }
        addReference(entryRecord['uri'], entryRecord['tag']);
      }
    }

    return referenceImages;
  }

  private resolveRunwayModeration(
    providerOptions?: Record<string, unknown>,
  ): { publicFigureThreshold: 'auto' | 'low' } | undefined {
    if (!providerOptions) {
      return undefined;
    }

    const moderation = optionalJsonRecord(
      providerOptions.contentModeration ?? providerOptions.content_moderation,
    );

    const thresholdCandidate =
      asString(moderation?.['publicFigureThreshold']) ??
      asString(moderation?.['public_figure_threshold']) ??
      asString(providerOptions.publicFigureThreshold) ??
      asString(providerOptions.public_figure_threshold);

    if (!thresholdCandidate) {
      return undefined;
    }

    const normalized = thresholdCandidate.trim().toLowerCase();
    if (normalized !== 'auto' && normalized !== 'low') {
      this.logger.warn('Unsupported Runway publicFigureThreshold value', {
        value: thresholdCandidate,
      });
      return undefined;
    }

    return { publicFigureThreshold: normalized };
  }

  private sanitizeRunwayTag(value: unknown, index: number): string | undefined {
    const fallback = `ref${index + 1}`;
    if (typeof value !== 'string') {
      return fallback;
    }
    let normalized = value.trim().replace(/[^A-Za-z0-9_]/g, '');
    if (!normalized) {
      return fallback;
    }
    if (!/^[A-Za-z]/.test(normalized)) {
      normalized = `R${normalized}`;
    }
    if (normalized.length < 3) {
      normalized = normalized.padEnd(3, 'x');
    }
    if (normalized.length > 16) {
      normalized = normalized.slice(0, 16);
    }
    if (!/^[A-Za-z][A-Za-z0-9_]{2,15}$/.test(normalized)) {
      return fallback;
    }
    return normalized;
  }

  private normalizeRunwayReferenceUri(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('data:')
    ) {
      return trimmed;
    }
    if (isProbablyBase64(trimmed)) {
      return `data:image/png;base64,${trimmed.replace(/\s+/g, '')}`;
    }
    return trimmed;
  }

  private async pollRunwayTask(apiKey: string, taskId: string) {
    for (let attempt = 0; attempt < RUNWAY_MAX_ATTEMPTS; attempt += 1) {
      const response = await fetch(
        `https://api.dev.runwayml.com/v1/tasks/${taskId}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'X-Runway-Version': RUNWAY_API_VERSION,
            Accept: 'application/json',
          },
        },
      );

      const payload = await this.safeJson(response);

      if (!response.ok) {
        const providerMessage =
          this.extractProviderMessage(payload) ||
          `Runway task error: ${response.status}`;
        this.logger.error('Runway task polling error', {
          status: response.status,
          message: providerMessage,
          response: payload,
          taskId,
          attempt: attempt + 1,
        });
        throw new HttpException(
          { error: providerMessage, details: payload },
          response.status,
        );
      }

      const record = optionalJsonRecord(payload);
      const status = asString(record?.['status'])?.toUpperCase() ?? '';
      const progress = asNumber(record?.['progress']);

      this.logger.debug('Runway task poll', {
        taskId,
        attempt: attempt + 1,
        status,
        progress,
      });

      if (status === 'SUCCEEDED') {
        return payload;
      }

      if (status === 'FAILED' || status === 'CANCELLED') {
        const failureMessage =
          asString(record?.['failure']) ??
          this.extractProviderMessage(payload) ??
          `Runway task ${status.toLowerCase()}`;
        throw new HttpException(
          { error: failureMessage, details: payload },
          HttpStatus.BAD_GATEWAY,
        );
      }

      await this.sleep(RUNWAY_POLL_INTERVAL_MS);
    }

    this.logger.error('Runway task timed out', { taskId });
    throw new HttpException(
      { error: 'Runway generation timed out', details: { taskId } },
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }

  private async safeJson(response: globalThis.Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    const isJson =
      contentType.includes('application/json') || contentType.endsWith('+json');
    try {
      if (isJson) {
        return await response.json();
      }
      const text = await response.text();
      if (!text) {
        return {};
      }
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    } catch {
      return {};
    }
  }

  private extractProviderMessage(value: unknown): string | undefined {
    return this.extractProviderMessageInternal(value, new WeakSet<object>());
  }

  private extractProviderMessageInternal(
    value: unknown,
    seen: WeakSet<object>,
  ): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || undefined;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const result = this.extractProviderMessageInternal(entry, seen);
        if (result) {
          return result;
        }
      }
      return undefined;
    }
    if (!isJsonRecord(value)) {
      return undefined;
    }
    if (seen.has(value)) {
      return undefined;
    }
    seen.add(value);

    const candidateKeys = [
      'message',
      'error',
      'detail',
      'error_message',
      'failure',
      'title',
      'description',
      'reason',
    ] as const;

    for (const key of candidateKeys) {
      const result = this.extractProviderMessageInternal(value[key], seen);
      if (result) {
        return result;
      }
    }

    return undefined;
  }

  private extractSeedreamImages(result: unknown): string[] {
    const images: string[] = [];
    const resultRecord = optionalJsonRecord(result);
    if (!resultRecord) {
      return images;
    }

    for (const entry of asArray(resultRecord['data'])) {
      if (typeof entry === 'string') {
        images.push(entry);
        continue;
      }
      const entryRecord = optionalJsonRecord(entry);
      if (!entryRecord) {
        continue;
      }
      const b64 = asString(entryRecord['b64_json']);
      if (b64) {
        images.push(`data:image/png;base64,${b64}`);
      }
      const url = asString(entryRecord['url']);
      if (url) {
        images.push(url);
      }
    }

    for (const url of asArray(resultRecord['images'])) {
      if (typeof url === 'string') {
        images.push(url);
      }
    }

    return images;
  }

  private extractOpenAiImage(result: unknown): string | null {
    const resultRecord = optionalJsonRecord(result);
    if (!resultRecord) {
      return null;
    }
    const dataEntries = asArray(resultRecord['data']);
    const firstEntry = optionalJsonRecord(dataEntries[0]);
    if (firstEntry) {
      const b64 = asString(firstEntry['b64_json']);
      if (b64) {
        return `data:image/png;base64,${b64}`;
      }
      const url = asString(firstEntry['url']);
      if (url) {
        return url;
      }
    }
    return null;
  }

  private getReveApiBase(): string {
    const base =
      this.configService.get<string>('REVE_BASE_URL') ?? 'https://api.reve.com';
    return base.replace(/\/+$/, '');
  }

  private resolveReveModel(
    primary?: unknown,
    override?: unknown,
  ): string | undefined {
    const overrideValue = asString(override)?.trim();
    if (overrideValue) {
      return overrideValue === 'reve-image' ? 'reve-image-1.0' : overrideValue;
    }
    const primaryValue =
      typeof primary === 'string' ? primary.trim() : asString(primary)?.trim();
    if (!primaryValue) {
      return undefined;
    }
    if (primaryValue === 'reve-image') {
      return 'reve-image-1.0';
    }
    return primaryValue;
  }

  private async resolveReveAssets(result: unknown) {
    const candidates = this.extractReveImages(result);
    const unique = new Set<string>();
    const dataUrls: string[] = [];
    const assets: GeneratedAsset[] = [];

    for (const candidate of candidates) {
      try {
        const dataUrl = await this.ensureReveDataUrl(candidate);
        if (unique.has(dataUrl)) {
          continue;
        }
        unique.add(dataUrl);
        dataUrls.push(dataUrl);
        assets.push(this.assetFromDataUrl(dataUrl));
      } catch (error) {
        this.logger.warn(
          `Failed to normalize Reve image candidate: ${String(error)}`,
        );
      }
    }

    return { dataUrls, assets };
  }

  private async ensureReveDataUrl(source: string): Promise<string> {
    const trimmed = source.trim();
    if (!trimmed) {
      this.throwBadRequest('Empty image reference from Reve');
    }
    if (trimmed.startsWith('data:')) {
      return trimmed;
    }
    if (isProbablyBase64(trimmed)) {
      return `data:image/png;base64,${trimmed.replace(/\s+/g, '')}`;
    }
    return this.ensureDataUrl(trimmed);
  }

  private buildReveClientPayload(
    payloadRecord: JsonRecord,
    dataUrls: string[],
    jobId?: string | null,
  ): Record<string, unknown> {
    const clientPayload: Record<string, unknown> = { ...payloadRecord };
    const primary = dataUrls[0] ?? null;

    clientPayload.images = dataUrls;
    clientPayload.image = primary ?? clientPayload.image ?? null;
    clientPayload.image_url =
      clientPayload.image_url ?? clientPayload.image ?? primary ?? null;
    clientPayload.job_id = jobId ?? clientPayload.job_id ?? null;
    clientPayload.request_id =
      clientPayload.request_id ?? jobId ?? clientPayload.job_id ?? null;

    const status = asString(payloadRecord['status']);
    if (!status && primary) {
      clientPayload.status = 'completed';
    } else if (status) {
      clientPayload.status = status;
    }

    return clientPayload;
  }

  private cloneToArrayBuffer(
    value: ArrayBuffer | ArrayBufferView,
  ): ArrayBuffer {
    if (value instanceof ArrayBuffer) {
      return value.slice(0);
    }
    const view = value;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return copy.buffer;
  }

  private extractReveImages(result: unknown): string[] {
    const resultRecord = optionalJsonRecord(result);
    if (!resultRecord) {
      return [];
    }

    const collected = new Set<string>();
    const addCandidate = (candidate: unknown) => {
      if (typeof candidate !== 'string') {
        return;
      }
      const trimmed = candidate.trim();
      if (trimmed) {
        collected.add(trimmed);
      }
    };

    addCandidate(resultRecord['image']);
    addCandidate(resultRecord['image_url']);
    addCandidate(resultRecord['url']);
    addCandidate(resultRecord['signed_url']);

    const candidateKeys = [
      'images',
      'image_urls',
      'urls',
      'data',
      'outputs',
      'result',
    ] as const;

    for (const key of candidateKeys) {
      for (const entry of asArray(resultRecord[key])) {
        if (typeof entry === 'string') {
          addCandidate(entry);
          continue;
        }
        const entryRecord = optionalJsonRecord(entry);
        if (!entryRecord) {
          continue;
        }
        addCandidate(entryRecord['image']);
        addCandidate(entryRecord['image_url']);
        addCandidate(entryRecord['url']);
        addCandidate(entryRecord['signed_url']);
        addCandidate(entryRecord['data']);
      }
    }

    const outputRecord = optionalJsonRecord(resultRecord['output']);
    if (outputRecord) {
      for (const entry of asArray(outputRecord['images'])) {
        if (typeof entry === 'string') {
          addCandidate(entry);
        } else {
          const entryRecord = optionalJsonRecord(entry);
          if (entryRecord) {
            addCandidate(entryRecord['image']);
            addCandidate(entryRecord['image_url']);
            addCandidate(entryRecord['url']);
          }
        }
      }
    }

    return [...collected];
  }

  private extractRecraftImages(result: unknown): string[] {
    return this.collectImageCandidates(result);
  }

  private extractLumaImages(result: unknown): string[] {
    return this.collectImageCandidates(result);
  }

  private collectImageCandidates(source: unknown): string[] {
    const results = new Set<string>();
    const seen = new WeakSet<object>();

    const addCandidate = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        return;
      }
      if (trimmed.startsWith('data:')) {
        results.add(trimmed);
        return;
      }
      if (trimmed.startsWith('gs://')) {
        const converted = this.convertGsUriToHttps(trimmed);
        results.add(converted ?? trimmed);
        return;
      }
      if (isProbablyBase64(trimmed)) {
        const normalized = trimmed.replace(/\s+/g, '');
        results.add(`data:image/png;base64,${normalized}`);
        return;
      }
      if (/^https?:\/\//i.test(trimmed)) {
        results.add(trimmed);
      }
    };

    const visit = (node: unknown, depth: number) => {
      if (node === null || node === undefined) {
        return;
      }
      if (typeof node === 'string') {
        addCandidate(node);
        return;
      }
      if (depth > 6) {
        return;
      }
      if (Array.isArray(node)) {
        if (seen.has(node)) {
          return;
        }
        seen.add(node);
        for (const entry of node) {
          visit(entry, depth + 1);
        }
        return;
      }
      if (!isJsonRecord(node)) {
        return;
      }
      if (seen.has(node)) {
        return;
      }
      seen.add(node);

      for (const [key, value] of Object.entries(node)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('image') ||
          lowerKey.includes('url') ||
          lowerKey.includes('media') ||
          lowerKey.includes('file') ||
          lowerKey.includes('asset') ||
          lowerKey.includes('signed') ||
          lowerKey.includes('uri') ||
          lowerKey.includes('link') ||
          lowerKey === 'data' ||
          lowerKey.includes('b64') ||
          lowerKey.includes('base64')
        ) {
          visit(value, depth + 1);
        }
      }
    };

    visit(source, 0);
    return [...results];
  }

  private normalizeGeminiUri(candidate?: string): string | undefined {
    if (!candidate) {
      return undefined;
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      return undefined;
    }
    if (trimmed.startsWith('gs://')) {
      return this.convertGsUriToHttps(trimmed) ?? trimmed;
    }
    return trimmed;
  }

  private async tryResolveGeminiCandidate(
    candidate: GeminiRemoteCandidate,
    apiKey: string,
  ): Promise<GeneratedAsset | null> {
    if (candidate.url?.startsWith('data:')) {
      const asset = this.assetFromDataUrl(candidate.url);
      return {
        ...asset,
        remoteUrl: candidate.rawUrl ?? candidate.url,
      };
    }

    const fileReference =
      candidate.fileId ??
      (candidate.url
        ? (this.normalizeGeminiFilePath(candidate.url) ?? undefined)
        : undefined) ??
      (candidate.rawUrl
        ? (this.normalizeGeminiFilePath(candidate.rawUrl) ?? undefined)
        : undefined);

    if (fileReference) {
      const downloaded = await this.downloadGeminiFileById(
        fileReference,
        apiKey,
      );
      if (downloaded) {
        if (candidate.mimeType && downloaded.mimeType !== candidate.mimeType) {
          downloaded.mimeType = candidate.mimeType;
          downloaded.dataUrl = `data:${candidate.mimeType};base64,${downloaded.base64}`;
        }
        if (!downloaded.remoteUrl) {
          downloaded.remoteUrl = candidate.url ?? candidate.rawUrl;
        }
        return downloaded;
      }
    }

    const urlsToTry = new Set<string>();
    const registerUrl = (value?: string) => {
      if (!value) {
        return;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      urlsToTry.add(trimmed);
    };

    registerUrl(candidate.url);
    registerUrl(candidate.rawUrl);

    for (const url of urlsToTry) {
      if (url.startsWith('data:')) {
        const asset = this.assetFromDataUrl(url);
        return {
          ...asset,
          remoteUrl: candidate.rawUrl ?? candidate.url ?? url,
        };
      }

      let resolvedUrl = url;
      if (url.startsWith('gs://')) {
        resolvedUrl = this.convertGsUriToHttps(url) ?? url;
      }

      const directAsset = await this.fetchGeminiBinary(resolvedUrl, apiKey);
      if (directAsset) {
        if (candidate.mimeType && directAsset.mimeType !== candidate.mimeType) {
          directAsset.mimeType = candidate.mimeType;
          directAsset.dataUrl = `data:${candidate.mimeType};base64,${directAsset.base64}`;
        }
        if (!directAsset.remoteUrl) {
          directAsset.remoteUrl = resolvedUrl;
        }
        return directAsset;
      }

      const derivedReference = this.normalizeGeminiFilePath(resolvedUrl);
      if (derivedReference) {
        const downloaded = await this.downloadGeminiFileById(
          derivedReference,
          apiKey,
        );
        if (downloaded) {
          if (
            candidate.mimeType &&
            downloaded.mimeType !== candidate.mimeType
          ) {
            downloaded.mimeType = candidate.mimeType;
            downloaded.dataUrl = `data:${candidate.mimeType};base64,${downloaded.base64}`;
          }
          if (!downloaded.remoteUrl) {
            downloaded.remoteUrl = resolvedUrl;
          }
          return downloaded;
        }
      }
    }

    return null;
  }

  private async downloadGeminiFileById(
    fileId: string,
    apiKey: string,
    visited = new Set<string>(),
  ): Promise<GeneratedAsset | null> {
    const normalizedPath = this.normalizeGeminiFilePath(fileId);
    if (!normalizedPath) {
      const directUrl = this.maybeAttachGeminiApiKey(fileId, apiKey);
      return this.fetchGeminiBinary(directUrl, apiKey, visited);
    }

    if (visited.has(normalizedPath)) {
      return null;
    }
    visited.add(normalizedPath);

    const baseEndpoint = `${GEMINI_API_BASE_URL}/${normalizedPath}`;

    const attemptDownload = async (url: string) => {
      if (visited.has(url)) {
        return null;
      }
      visited.add(url);
      const asset = await this.fetchGeminiBinary(url, apiKey, visited);
      return asset;
    };

    const altMediaUrl = this.maybeAttachGeminiApiKey(
      `${baseEndpoint}?alt=media`,
      apiKey,
    );
    const altAsset = await attemptDownload(altMediaUrl);
    if (altAsset) {
      if (!altAsset.remoteUrl) {
        altAsset.remoteUrl = altMediaUrl;
      }
      return altAsset;
    }

    const downloadUrl = this.maybeAttachGeminiApiKey(
      `${baseEndpoint}:download`,
      apiKey,
    );
    const downloadAsset = await attemptDownload(downloadUrl);
    if (downloadAsset) {
      if (!downloadAsset.remoteUrl) {
        downloadAsset.remoteUrl = downloadUrl;
      }
      return downloadAsset;
    }

    const metadataUrl = this.maybeAttachGeminiApiKey(baseEndpoint, apiKey);
    if (!visited.has(metadataUrl)) {
      visited.add(metadataUrl);
      try {
        const headers =
          this.getGeminiDownloadHeaders(metadataUrl, apiKey) ?? {};
        const metadataResponse = await fetch(metadataUrl, {
          method: 'GET',
          headers: { accept: 'application/json', ...headers },
        });

        if (metadataResponse.ok) {
          const text = await metadataResponse.text();
          let metadataPayload: unknown = null;
          try {
            metadataPayload = text ? JSON.parse(text) : null;
          } catch {
            metadataPayload = null;
          }

          const metadataRecord = optionalJsonRecord(metadataPayload);
          if (metadataRecord) {
            const inlineRecord =
              optionalJsonRecord(metadataRecord['inlineData']) ??
              optionalJsonRecord(metadataRecord['inline_data']);
            const inlineBase64 =
              asString(inlineRecord?.['data']) ??
              asString(metadataRecord['data']);
            const inlineMime =
              asString(inlineRecord?.['mimeType']) ??
              asString(metadataRecord['mimeType']) ??
              'image/png';

            if (inlineBase64) {
              return {
                dataUrl: `data:${inlineMime};base64,${inlineBase64}`,
                mimeType: inlineMime,
                base64: inlineBase64,
                remoteUrl: metadataUrl,
              };
            }

            const candidateStrings = new Set<string>();
            const pushCandidate = (value?: string) => {
              if (value && value.trim()) {
                candidateStrings.add(value.trim());
              }
            };

            pushCandidate(asString(metadataRecord['downloadUri']));
            pushCandidate(asString(metadataRecord['uri']));
            pushCandidate(asString(metadataRecord['fileUri']));
            pushCandidate(asString(metadataRecord['signedUri']));
            pushCandidate(asString(metadataRecord['signedUrl']));
            pushCandidate(asString(metadataRecord['gcsUri']));

            const generationOutput = optionalJsonRecord(
              metadataRecord['generationOutput'],
            );
            if (generationOutput) {
              for (const imageEntry of asArray(
                generationOutput['images'] ??
                  generationOutput['generatedImages'],
              )) {
                if (typeof imageEntry === 'string') {
                  pushCandidate(imageEntry);
                  continue;
                }
                const imageRecord = optionalJsonRecord(imageEntry);
                if (!imageRecord) {
                  continue;
                }
                pushCandidate(asString(imageRecord['downloadUri']));
                pushCandidate(asString(imageRecord['uri']));
                pushCandidate(asString(imageRecord['imageUri']));
                pushCandidate(asString(imageRecord['fileUri']));
                pushCandidate(asString(imageRecord['signedUri']));
                pushCandidate(asString(imageRecord['gcsUri']));
              }
            }

            for (const candidate of this.collectImageCandidates(
              metadataRecord,
            )) {
              pushCandidate(candidate);
            }

            for (const candidate of candidateStrings) {
              const normalizedCandidate =
                this.normalizeGeminiFilePath(candidate);
              if (normalizedCandidate && visited.has(normalizedCandidate)) {
                continue;
              }
              if (!normalizedCandidate && visited.has(candidate)) {
                continue;
              }

              if (candidate.startsWith('data:')) {
                const asset = this.assetFromDataUrl(candidate);
                return { ...asset, remoteUrl: candidate };
              }

              if (candidate.startsWith('gs://')) {
                const converted = this.convertGsUriToHttps(candidate);
                if (converted) {
                  const asset = await this.fetchGeminiBinary(
                    converted,
                    apiKey,
                    visited,
                  );
                  if (asset) {
                    return asset;
                  }
                }
                continue;
              }

              if (
                candidate.includes('generativelanguage.googleapis.com') ||
                candidate.startsWith('files/')
              ) {
                const nested = await this.downloadGeminiFileById(
                  candidate,
                  apiKey,
                  visited,
                );
                if (nested) {
                  return nested;
                }
                continue;
              }

              const directAsset = await this.fetchGeminiBinary(
                candidate,
                apiKey,
                visited,
              );
              if (directAsset) {
                return directAsset;
              }
            }
          }
        } else {
          this.logger.debug('Gemini metadata request failed', {
            fileId: normalizedPath,
            status: metadataResponse.status,
          });
        }
      } catch (error) {
        this.logger.debug('Gemini metadata fetch failed', {
          fileId: normalizedPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return null;
  }

  private buildGeminiFilePath(fileId: string): string {
    const normalized = this.normalizeGeminiFilePath(fileId);
    if (normalized) {
      return normalized
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    }
    const trimmed = fileId.trim();
    if (!trimmed) {
      return '';
    }
    const fallback = trimmed.startsWith('files/')
      ? trimmed
      : `files/${trimmed}`;
    return fallback
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  private appendApiKeyQuery(url: string, apiKey: string): string {
    if (!apiKey) {
      return url;
    }
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has('key')) {
        parsed.searchParams.set('key', apiKey);
      }
      return parsed.toString();
    } catch {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}key=${encodeURIComponent(apiKey)}`;
    }
  }

  private maybeAttachGeminiApiKey(url: string, apiKey: string): string {
    if (!apiKey || !url) {
      return url;
    }
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      if (
        host.includes('googleapis.com') ||
        host.includes('googleusercontent.com') ||
        host.includes('storage.googleapis.com')
      ) {
        return this.appendApiKeyQuery(url, apiKey);
      }
      return url;
    } catch {
      return url;
    }
  }

  private getGeminiDownloadHeaders(
    url: string,
    apiKey: string,
  ): Record<string, string> | undefined {
    if (!apiKey) {
      return undefined;
    }
    try {
      const host = new URL(url).hostname;
      if (
        host.includes('googleapis.com') ||
        host.includes('googleusercontent.com') ||
        host.includes('storage.googleapis.com')
      ) {
        return { 'x-goog-api-key': apiKey };
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private async fetchGeminiBinary(
    url: string,
    apiKey: string,
    visited?: Set<string>,
  ): Promise<GeneratedAsset | null> {
    if (!url) {
      return null;
    }

    const effectiveUrl = this.maybeAttachGeminiApiKey(url, apiKey);
    const visitSet = visited ?? new Set<string>();
    const visitKey = this.normalizeGeminiFilePath(effectiveUrl) ?? effectiveUrl;
    if (visitSet.has(visitKey)) {
      return null;
    }
    visitSet.add(visitKey);

    try {
      const headers =
        this.getGeminiDownloadHeaders(effectiveUrl, apiKey) ?? undefined;
      const response = await fetch(effectiveUrl, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        return null;
      }

      const rawContentType = response.headers.get('content-type') ?? '';
      const contentType = rawContentType.toLowerCase();

      if (contentType.includes('json')) {
        const text = await response.text();
        let payload: unknown = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }

        const record = optionalJsonRecord(payload);
        if (record) {
          const inlineRecord =
            optionalJsonRecord(record['inlineData']) ??
            optionalJsonRecord(record['inline_data']);
          const base64 =
            asString(inlineRecord?.['data']) ??
            asString(record['data']) ??
            asString(record['base64']);
          const mimeType =
            asString(inlineRecord?.['mimeType']) ??
            asString(record['mimeType']) ??
            'image/png';
          if (base64) {
            return {
              dataUrl: `data:${mimeType};base64,${base64}`,
              mimeType,
              base64,
              remoteUrl: effectiveUrl,
            };
          }

          const candidates = this.collectImageCandidates(record);
          for (const candidate of candidates) {
            if (!candidate) {
              continue;
            }

            if (candidate.startsWith('data:')) {
              const asset = this.assetFromDataUrl(candidate);
              return { ...asset, remoteUrl: effectiveUrl };
            }

            if (candidate.startsWith('gs://')) {
              const converted = this.convertGsUriToHttps(candidate);
              if (converted) {
                const nested = await this.fetchGeminiBinary(
                  converted,
                  apiKey,
                  visitSet,
                );
                if (nested) {
                  return nested;
                }
              }
              continue;
            }

            if (
              candidate.includes('generativelanguage.googleapis.com') ||
              candidate.startsWith('files/')
            ) {
              const nested = await this.downloadGeminiFileById(
                candidate,
                apiKey,
                visitSet,
              );
              if (nested) {
                return nested;
              }
              continue;
            }

            const direct = await this.fetchGeminiBinary(
              candidate,
              apiKey,
              visitSet,
            );
            if (direct) {
              return direct;
            }
          }
        }

        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const mimeType = rawContentType.split(';')[0]?.trim() || 'image/png';

      return {
        dataUrl: `data:${mimeType};base64,${base64}`,
        mimeType,
        base64,
        remoteUrl: effectiveUrl,
      };
    } catch (error) {
      this.logger.debug('Gemini fetch failed', {
        url: effectiveUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private normalizeGeminiFilePath(reference: string): string | null {
    if (!reference) {
      return null;
    }
    let working = reference.trim();
    if (!working) {
      return null;
    }

    if (working.startsWith('http://') || working.startsWith('https://')) {
      try {
        const parsed = new URL(working);
        working = parsed.pathname;
      } catch {
        return null;
      }
    }

    working = working.replace(/^\/+/, '');
    const filesIndex = working.indexOf('files/');
    if (filesIndex >= 0) {
      working = working.slice(filesIndex);
    }

    working = working.replace(/\?.*$/, '');
    const colonIndex = working.indexOf(':');
    if (colonIndex >= 0) {
      working = working.slice(0, colonIndex);
    }

    if (!working.startsWith('files/')) {
      if (/^[a-z0-9\-_]+$/i.test(working)) {
        working = `files/${working}`;
      } else {
        return null;
      }
    }

    return working || null;
  }

  private convertGsUriToHttps(uri: string): string | undefined {
    const trimmed = uri.trim();
    if (!trimmed.startsWith('gs://')) {
      return undefined;
    }
    const path = trimmed.slice('gs://'.length).replace(/^\/+/, '');
    if (!path) {
      return undefined;
    }
    return `https://storage.googleapis.com/${path}`;
  }

  private async pollFluxJob(
    pollingUrl: string,
    apiKey: string,
  ): Promise<{ payload: JsonRecord; raw: unknown; status: string }> {
    let lastPayloadRaw: unknown = null;

    for (let attempt = 0; attempt < FLUX_MAX_ATTEMPTS; attempt += 1) {
      const response = await fetch(pollingUrl, {
        method: 'GET',
        headers: {
          'x-key': apiKey,
          accept: 'application/json',
        },
      });

      const text = await response.text().catch(() => '');
      let payloadRaw: unknown;
      if (text) {
        try {
          payloadRaw = JSON.parse(text) as unknown;
        } catch {
          payloadRaw = { raw: text };
        }
      } else {
        payloadRaw = {};
      }

      const payloadRecord = toJsonRecord(payloadRaw);

      if (!response.ok) {
        throw new HttpException(
          { error: 'Flux polling failed', details: payloadRaw },
          response.status,
        );
      }

      lastPayloadRaw = payloadRaw;

      const resultRecord = optionalJsonRecord(payloadRecord['result']);
      const statusValue =
        getFirstString(payloadRecord, ['status', 'task_status', 'state']) ??
        (resultRecord ? getFirstString(resultRecord, ['status']) : undefined);
      const status = this.normalizeFluxStatus(statusValue);

      if (status === 'READY') {
        return { payload: payloadRecord, raw: payloadRaw, status };
      }

      if (status === 'FAILED' || status === 'ERROR') {
        const failureDetails =
          payloadRecord['error'] ?? payloadRecord['details'] ?? payloadRaw;
        throw new HttpException(
          {
            error: 'Flux generation failed',
            details: failureDetails,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      await this.wait(FLUX_POLL_INTERVAL_MS);
    }

    throw new HttpException(
      {
        error: 'Flux generation timed out',
        details: { lastPayload: lastPayloadRaw },
      },
      HttpStatus.REQUEST_TIMEOUT,
    );
  }

  private normalizeFluxStatus(
    status: unknown,
  ): 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'ERROR' {
    if (
      status === undefined ||
      status === null ||
      (typeof status !== 'string' &&
        typeof status !== 'number' &&
        typeof status !== 'boolean')
    ) {
      return 'PROCESSING';
    }
    const normalized = String(status).trim().toUpperCase();
    if (['READY', 'COMPLETED', 'FINISHED', 'DONE'].includes(normalized)) {
      return 'READY';
    }
    if (['FAILED', 'FAILURE'].includes(normalized)) {
      return 'FAILED';
    }
    if (normalized === 'ERROR') {
      return 'ERROR';
    }
    if (['QUEUED', 'PENDING', 'QUEUING'].includes(normalized)) {
      return 'QUEUED';
    }
    return 'PROCESSING';
  }

  private extractFluxSampleUrl(result: JsonRecord): string | null {
    const directSample =
      getNestedString(result, ['result', 'sample']) ??
      getNestedString(result, ['result', 'sample_url']) ??
      asString(result['sample']) ??
      asString(result['image']);
    if (directSample) {
      return directSample;
    }

    const resultRecord = optionalJsonRecord(result['result']);
    if (resultRecord) {
      const sampleFromNested = getNestedString(resultRecord, ['sample', 'url']);
      if (sampleFromNested) {
        return sampleFromNested;
      }

      for (const entry of asArray(resultRecord['samples'])) {
        const stringEntry = asString(entry);
        if (stringEntry) {
          return stringEntry;
        }
        const entryRecord = optionalJsonRecord(entry);
        if (!entryRecord) {
          continue;
        }
        const candidate =
          getFirstString(entryRecord, ['url', 'image', 'sample']) ??
          getNestedString(entryRecord, ['asset', 'url']);
        if (candidate) {
          return candidate;
        }
      }

      for (const entry of asArray(resultRecord['images'])) {
        const entryRecord = optionalJsonRecord(entry);
        if (entryRecord) {
          const candidate = getFirstString(entryRecord, ['url', 'image']);
          if (candidate) {
            return candidate;
          }
        } else if (typeof entry === 'string') {
          return entry;
        }
      }
    }

    for (const entry of asArray(result['images'])) {
      if (typeof entry === 'string') {
        return entry;
      }
      const entryRecord = optionalJsonRecord(entry);
      if (!entryRecord) {
        continue;
      }
      const candidate = getFirstString(entryRecord, ['url', 'image']);
      if (candidate) {
        return candidate;
      }
    }

    for (const key of ['output', 'outputs'] as const) {
      for (const entry of asArray(result[key])) {
        const entryRecord = optionalJsonRecord(entry);
        if (!entryRecord) {
          continue;
        }
        const candidate = getFirstString(entryRecord, ['image', 'url']);
        if (candidate) {
          return candidate;
        }
      }
    }

    return null;
  }

  private throwBadRequest(message: string, details?: unknown): never {
    const payload: Record<string, unknown> = { error: message };
    if (details !== undefined) {
      payload.details = details;
    }
    throw new HttpException(payload, HttpStatus.BAD_REQUEST);
  }

  private ensureFluxHost(
    url: string,
    allowedHosts: Set<string>,
    label: string,
    allowedSuffixes: readonly string[] = [],
    extraHosts: Set<string> = new Set(),
    extraSuffixes: readonly string[] = [],
  ): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      this.throwBadRequest(`Invalid ${label}`);
    }
    const host = parsed.hostname.toLowerCase();
    if (
      allowedHosts.has(host) ||
      extraHosts.has(host) ||
      this.matchesSuffix(host, allowedSuffixes) ||
      this.matchesSuffix(host, extraSuffixes)
    ) {
      return;
    }

    this.throwBadRequest(`Invalid ${label} host`, {
      host,
    });
  }

  private matchesSuffix(host: string, suffixes: readonly string[]): boolean {
    for (const suffix of suffixes) {
      const trimmed = suffix.trim();
      if (!trimmed) {
        continue;
      }
      const normalized = trimmed.startsWith('.') ? trimmed.slice(1) : trimmed;
      if (host === normalized || host.endsWith(`.${normalized}`)) {
        return true;
      }
    }
    return false;
  }

  private readFluxHostSet(configKey: string): Set<string> {
    const raw = this.configService.get<string>(configKey);
    if (!raw) {
      return new Set();
    }
    const entries = raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return new Set(entries);
  }

  private readFluxSuffixList(configKey: string): string[] {
    const raw = this.configService.get<string>(configKey);
    if (!raw) {
      return [];
    }
    const entries = raw
      .split(',')
      .map((value) => this.normalizeFluxSuffix(value))
      .filter(Boolean);
    return [...new Set(entries)];
  }

  private normalizeFluxSuffix(value: string): string {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      return '';
    }
    const withoutWildcard = trimmed.replace(/^[*]+\./, '').replace(/^[.]+/, '');
    if (!withoutWildcard) {
      return '';
    }
    return `.${withoutWildcard}`;
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private collectIdeogramUrls(result: unknown): string[] {
    const urls: string[] = [];
    const resultRecord = optionalJsonRecord(result);
    if (!resultRecord) {
      return urls;
    }

    for (const item of asArray(resultRecord['data'])) {
      const itemRecord = optionalJsonRecord(item);
      if (!itemRecord) {
        continue;
      }
      const imageUrl = asString(itemRecord['image_url']);
      if (imageUrl) {
        urls.push(imageUrl);
      }
      const url = asString(itemRecord['url']);
      if (url) {
        urls.push(url);
      }
    }

    for (const entry of asArray(resultRecord['images'])) {
      if (typeof entry === 'string') {
        urls.push(entry);
        continue;
      }
      const entryRecord = optionalJsonRecord(entry);
      if (!entryRecord) {
        continue;
      }
      const url = asString(entryRecord['url']);
      if (url) {
        urls.push(url);
      }
    }

    const nestedResult = optionalJsonRecord(resultRecord['result']);
    if (nestedResult) {
      for (const entry of asArray(nestedResult['images'])) {
        const entryRecord = optionalJsonRecord(entry);
        if (!entryRecord) {
          continue;
        }
        const url = asString(entryRecord['url']);
        if (url) {
          urls.push(url);
        }
      }
    }

    return urls;
  }

  private stringifyUnknown(value: unknown): string {
    try {
      return typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }
}
