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

interface GeneratedAsset {
  dataUrl: string;
  mimeType: string;
  base64: string;
  remoteUrl?: string;
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

    try {
      const providerResult = await this.dispatch(model, {
        ...dto,
        prompt,
        model,
      });

      await this.persistResult(user, prompt, providerResult);

      this.logger.log(
        `Generation completed successfully for user ${user.authUserId}`,
      );
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
      this.logger.error(`Gemini API error ${response.status}: ${errorText}`);
      throw new HttpException(
        { error: `Gemini API error: ${response.status}`, details: errorText },
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
    let remoteUrl: string | undefined;

    const registerRemoteCandidate = (candidate?: string) => {
      if (remoteUrl) {
        return;
      }
      const normalized = this.normalizeGeminiUri(candidate);
      if (normalized) {
        remoteUrl = normalized;
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
        registerRemoteCandidate(
          asString(fileData['fileUri']) ??
            asString(fileData['uri']) ??
            asString(fileData['url']),
        );
      }

      const mediaRecord = optionalJsonRecord(partRecord['media']);
      if (mediaRecord) {
        registerRemoteCandidate(
          asString(mediaRecord['mediaUri']) ??
            asString(mediaRecord['uri']) ??
            asString(mediaRecord['url']),
        );
      }

      registerRemoteCandidate(
        asString(partRecord['url']) ??
          asString(partRecord['uri']) ??
          asString(partRecord['signedUrl']) ??
          asString(partRecord['imageUrl']),
      );

      if (!base64) {
        const dataCandidate = asString(partRecord['data']);
        if (dataCandidate && isProbablyBase64(dataCandidate)) {
          base64 = dataCandidate;
          mimeType = asString(partRecord['mimeType']) ?? mimeType;
        }
      }
    }

    let dataUrl: string | undefined;

    if (!base64 && remoteUrl) {
      const ensured = await this.ensureDataUrl(remoteUrl);
      const asset = this.assetFromDataUrl(ensured);
      base64 = asset.base64;
      mimeType = asset.mimeType;
      dataUrl = asset.dataUrl;
    }

    if (!base64) {
      const fallbackCandidates = this.collectImageCandidates(responsePayload);
      for (const candidate of fallbackCandidates) {
        if (!base64 && candidate.startsWith('data:')) {
          const asset = this.assetFromDataUrl(candidate);
          base64 = asset.base64;
          mimeType = asset.mimeType;
          dataUrl = asset.dataUrl;
          break;
        }
      }
      if (!base64 && !remoteUrl) {
        const remoteFallback = fallbackCandidates.find(
          (candidate) => !candidate.startsWith('data:'),
        );
        if (remoteFallback) {
          registerRemoteCandidate(remoteFallback);
        }
      }
    }

    if (!base64 && remoteUrl) {
      const ensured = await this.ensureDataUrl(remoteUrl);
      const asset = this.assetFromDataUrl(ensured);
      base64 = asset.base64;
      mimeType = asset.mimeType;
      dataUrl = asset.dataUrl;
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

    const response = await fetch('https://api.ideogram.ai/api/v1/text2image', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: dto.prompt,
        model: 'ideogram-v3',
        ...dto.providerOptions,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Ideogram API error ${response.status}: ${errorText}`);
      let errorMessage = `Ideogram API error: ${response.status}`;
      if (response.status === 404) {
        errorMessage =
          'Ideogram API endpoint not found. Please check your API key and endpoint configuration.';
      } else if (response.status === 401) {
        errorMessage =
          'Ideogram API authentication failed. Please check your API key.';
      } else if (response.status === 429) {
        errorMessage =
          'Ideogram API rate limit exceeded. Please try again later.';
      }
      throw new HttpException(
        { error: errorMessage, details: errorText },
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

    const model =
      dto.model === 'runway-gen4-turbo' ? 'gen4_image_turbo' : 'gen4_image';
    const response = await fetch(
      'https://api.dev.runwayml.com/v1/image_generations',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Runway-Version': '1.0',
        },
        body: JSON.stringify({
          model,
          prompt: dto.prompt,
          ratio: dto.providerOptions.ratio ?? '16:9',
          seed: dto.providerOptions.seed,
        }),
      },
    );

    const resultPayload = (await response.json()) as unknown;

    if (!response.ok) {
      const details = this.stringifyUnknown(resultPayload);
      this.logger.error(`Runway API error ${response.status}: ${details}`);
      throw new HttpException(
        {
          error: `Runway API error: ${response.status}`,
          details: resultPayload,
        },
        response.status,
      );
    }

    const remoteUrl = this.extractRunwayImageUrl(resultPayload);
    if (!remoteUrl) {
      this.throwBadRequest('No image URL returned from Runway');
    }

    const dataUrl = await this.ensureDataUrl(remoteUrl);
    const asset = this.assetFromDataUrl(dataUrl);

    return {
      provider: 'runway',
      model,
      clientPayload: {
        dataUrl,
        contentType: asset.mimeType,
        job: resultPayload,
      },
      assets: [asset],
      rawResponse: resultPayload,
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

    const providerOptions = dto.providerOptions ?? {};
    const requestBody: Record<string, unknown> = {
      prompt: dto.prompt,
    };

    // Note: Reve API doesn't accept model parameter, so we skip it
    // const resolvedModel = this.resolveReveModel(
    //   dto.model,
    //   providerOptions.model,
    // );
    // if (resolvedModel) {
    //   requestBody.model = resolvedModel;
    // }

    const width = asNumber(providerOptions.width);
    if (width !== undefined) {
      requestBody.width = width;
    }
    const height = asNumber(providerOptions.height);
    if (height !== undefined) {
      requestBody.height = height;
    }
    const seed = asNumber(providerOptions.seed);
    if (seed !== undefined) {
      requestBody.seed = seed;
    }
    const guidanceScale = asNumber(
      providerOptions.guidance_scale ?? providerOptions.guidanceScale,
    );
    if (guidanceScale !== undefined) {
      requestBody.guidance_scale = guidanceScale;
    }
    const steps = asNumber(providerOptions.steps);
    if (steps !== undefined) {
      requestBody.steps = steps;
    }
    const batchSize = asNumber(
      providerOptions.batch_size ?? providerOptions.batchSize,
    );
    if (batchSize !== undefined) {
      requestBody.batch_size = batchSize;
    }
    const aspectRatio = asString(
      providerOptions.aspect_ratio ?? providerOptions.aspectRatio,
    );
    if (aspectRatio) {
      requestBody.aspect_ratio = aspectRatio;
    }
    const negativePrompt = asString(
      providerOptions.negative_prompt ?? providerOptions.negativePrompt,
    );
    if (negativePrompt) {
      requestBody.negative_prompt = negativePrompt;
    }

    const endpoint = `${this.getReveApiBase()}/v1/image/create`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
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
      this.logger.error(`Reve API error ${response.status}: ${details}`);
      let errorMessage = `Reve API error: ${response.status}`;
      if (response.status === 404) {
        errorMessage =
          'Reve API endpoint not found. Please check your API key and endpoint configuration.';
      } else if (response.status === 401) {
        errorMessage =
          'Reve API authentication failed. Please check your API key.';
      } else if (response.status === 429) {
        errorMessage = 'Reve API rate limit exceeded. Please try again later.';
      }
      throw new HttpException(
        { error: errorMessage, details: resultPayload },
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

    await this.persistResult(user, input.prompt, providerResult);

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

  private async handleLuma(
    dto: UnifiedGenerateDto,
  ): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('LUMAAI_API_KEY');
    if (!apiKey) {
      this.logger.error(
        'LUMAAI_API_KEY environment variable is not configured',
      );
      throw new ServiceUnavailableException(
        'Luma AI API key not configured. Please set LUMAAI_API_KEY environment variable.',
      );
    }

    if (
      dto.model === 'luma-photon-1' ||
      dto.model === 'luma-photon-flash-1'
    ) {
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
      payload.aspect_ratio = aspectRatio.trim() as ImageCreateParams['aspect_ratio'];
    }

    if (Array.isArray(providerOptions.image_ref)) {
      payload.image_ref = providerOptions.image_ref as ImageCreateParams['image_ref'];
    }
    if (Array.isArray(providerOptions.style_ref)) {
      payload.style_ref = providerOptions.style_ref as ImageCreateParams['style_ref'];
    }
    if (providerOptions.character_ref) {
      payload.character_ref = providerOptions.character_ref as ImageCreateParams['character_ref'];
    }
    if (providerOptions.modify_image_ref) {
      payload.modify_image_ref = providerOptions.modify_image_ref as ImageCreateParams['modify_image_ref'];
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
          const fileName = `image-${Date.now()}.${mimeType.split('/')[1] || 'png'}`;
          await this.r2FilesService.create(user.authUserId, {
            fileName,
            fileUrl: publicUrl,
            fileSize: Math.round((base64Data.length * 3) / 4),
            mimeType,
            prompt,
            model: providerResult.model,
          });

          // Update the asset URL to use R2 URL
          asset.dataUrl = publicUrl;

          // Update clientPayload with R2 URL for consistency
          this.updateClientPayloadWithR2Url(
            providerResult.clientPayload,
            publicUrl,
          );
        }
      } catch (error) {
        this.logger.error(`Failed to upload to R2: ${String(error)}`);
        // Continue with original data URL if R2 upload fails
      }
    }
  }

  private updateClientPayloadWithR2Url(
    clientPayload: unknown,
    r2Url: string,
  ): void {
    if (!clientPayload || typeof clientPayload !== 'object') {
      return;
    }

    const payload = clientPayload as Record<string, unknown>;

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

  private async ensureDataUrl(source: string): Promise<string> {
    if (source.startsWith('data:')) {
      return source;
    }
    const normalized = source.startsWith('gs://')
      ? (this.convertGsUriToHttps(source) ?? source)
      : source;
    const { dataUrl } = await this.downloadAsDataUrl(normalized);
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

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const mimeType = response.headers.get('content-type') || 'image/png';
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

  private extractRunwayImageUrl(result: unknown): string | null {
    const resultRecord = optionalJsonRecord(result);
    if (!resultRecord) {
      return null;
    }
    const dataEntries = asArray(resultRecord['data']);
    if (dataEntries.length > 0) {
      const firstEntry = optionalJsonRecord(dataEntries[0]);
      if (firstEntry) {
        const candidate =
          asString(firstEntry['image_url']) ?? asString(firstEntry['url']);
        if (candidate) {
          return candidate;
        }
      }
    }
    for (const entry of asArray(resultRecord['output'])) {
      const entryRecord = optionalJsonRecord(entry);
      if (!entryRecord) {
        continue;
      }
      const candidate =
        asString(entryRecord['image']) ?? asString(entryRecord['url']);
      if (candidate) {
        return candidate;
      }
    }
    return null;
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
