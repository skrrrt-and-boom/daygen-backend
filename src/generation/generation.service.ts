import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,

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
import { UsageService } from '../usage/usage.service';
import { PaymentsService } from '../payments/payments.service';
import { FluxImageAdapter } from './providers/flux.adapter';
import { GeminiImageAdapter } from './providers/gemini.adapter';
import { IdeogramImageAdapter } from './providers/ideogram.adapter';
import { QwenImageAdapter } from './providers/qwen.adapter';
import { GrokImageAdapter } from './providers/grok.adapter';
import { ImageProviderRegistry } from './providers/image-provider.registry';
import { GeneratedAssetService, GeneratedAsset } from './generated-asset.service';
import { ProviderHttpService } from './provider-http.service';
import { buildHttpErrorPayload } from './utils/provider-helpers';



interface GeminiRemoteCandidate {
  url?: string;
  rawUrl?: string;
  fileId?: string;
  mimeType?: string;
}

interface GeminiAuthContext {
  apiKey?: string;
  accessToken?: string;
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

const FLUX_POLL_INTERVAL_MS = 5000;
const FLUX_MAX_ATTEMPTS = 60;

const GEMINI_API_KEY_CANDIDATES = [
  'GEMINI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_AI_KEY',
  'VITE_GEMINI_API_KEY',
] as const;

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const GEMINI_OAUTH_SCOPE =
  'https://www.googleapis.com/auth/generative-language';

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
  private geminiAccessTokenCache: { token: string; expiresAt: number } | null =
    null;
  private geminiAccessTokenRetryAfter = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly r2FilesService: R2FilesService,
    private readonly r2Service: R2Service,
    private readonly usageService: UsageService,
    private readonly paymentsService: PaymentsService,
    private readonly registry: ImageProviderRegistry,
    private readonly generatedAssetService: GeneratedAssetService,
    private readonly providerHttpService: ProviderHttpService,
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

  async generate(user: SanitizedUser, dto: ProviderGenerateDto) {
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

    // Record usage and deduct credits once per request
    await this.usageService.recordGeneration(user, {
      provider: 'generation',
      model,
      prompt,
      cost: 1,
      metadata: { model, prompt: prompt.slice(0, 100) },
    });

    try {
      const providerResult = await this.dispatch(user, model, {
        ...dto,
        prompt,
        model,
      });

      await this.generatedAssetService.persistResult(user, prompt, providerResult, dto);

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
          `Generation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.logger.log(
          `Refunded 1 credit to user ${user.authUserId} due to generation failure`,
        );
      } catch (refundError) {
        this.logger.error(
          `Failed to refund credits to user ${user.authUserId}:`,
          refundError,
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

    return this.generate(user, {
      ...dto,
      model: normalizedModel,
    });
  }

  public async dispatch(
    user: SanitizedUser,
    model: string,
    dto: ProviderGenerateDto,
  ): Promise<ProviderResult> {
    const adapter = this.registry.getAdapterForModel(model);
    if (adapter) {
      if (adapter.validateOptions) {
        try {
          adapter.validateOptions(dto);
        } catch (err) {
          const status = (err as { status?: number }).status || 400;
          const message = err instanceof Error ? err.message : 'Validation failed';
          throw new HttpException(buildHttpErrorPayload(message), status);
        }
      }

      try {
        const res = await adapter.generate(user, dto);
        const assets = res.results.map((r) => {
          if (typeof r.url === 'string' && r.url.startsWith('data:')) {
            return this.generatedAssetService.assetFromDataUrl(r.url);
          }

          return {
            remoteUrl: r.url,
            mimeType: r.mimeType,
            // We might need to fetch dataUrl if not present, but GeneratedAssetService handles persistence from remoteUrl
          } as GeneratedAsset;
        });

        return {
          provider: adapter.providerName,
          model: model,
          clientPayload: res.clientPayload,
          assets,
          rawResponse: res.rawResponse,
          usageMetadata: res.usageMetadata,
        };
      } catch (err) {
        const status = (err as { status?: number }).status || 502;
        const details = (err as { details?: unknown }).details;
        const message = err instanceof Error ? err.message : 'Provider error';
        throw new HttpException(
          buildHttpErrorPayload(message, details),
          status,
        );
      }
    }

    // Fallback to legacy handlers
    // Handle FLUX models
    if (model.startsWith('flux-')) {
      return this.withCircuit('flux', () => this.handleFlux(dto));
    }

    switch (model) {
      case 'gemini-3.0-pro-image':
      case 'gemini-3.0-pro':
      case 'gemini-3.0-pro-exp-01':
      case 'imagen-4.0-generate-001':
      case 'imagen-4.0-fast-generate-001':
      case 'imagen-4.0-ultra-generate-001':
      case 'imagen-3.0-generate-002':
        return this.withCircuit('gemini', () => this.handleGemini({
          ...dto,
          model: model, // Pass through the model name to adapter for proper mapping
        }));
      case 'ideogram':
        return this.withCircuit('ideogram', () => this.handleIdeogram(dto));
      case 'qwen-image':
        return this.withCircuit('qwen', () => this.handleQwen(dto));
      case 'grok-2-image':
      case 'grok-2-image-1212':
      case 'grok-2-image-latest':
        return this.withCircuit('grok', () => this.handleGrok(dto));
      case 'runway-gen4':
      case 'runway-gen4-turbo':
        return this.withCircuit('runway', () => this.handleRunway(dto));
      case 'seedream-3.0':
        return this.withCircuit('seedream', () => this.handleSeedream(dto));
      case 'chatgpt-image':
        return this.withCircuit('openai', () => this.handleChatGpt(dto));
      case 'reve-image':
      case 'reve-image-1.0':
      case 'reve-v1':
        return this.withCircuit('reve', () => this.handleReve(dto));
      case 'recraft-v2':
      case 'recraft-v3':
        return this.withCircuit('recraft', () => this.handleRecraft(dto));
      case 'luma-dream-shaper':
      case 'luma-realistic-vision':
      case 'luma-photon-1':
      case 'luma-photon-flash-1':
        return this.withCircuit('luma', () => this.handleLuma(dto));
      default:
        this.throwBadRequest('Unsupported model', { model });
    }
  }

  private async handleFlux(dto: ProviderGenerateDto): Promise<ProviderResult> {
    this.validateProviderOptions('flux', dto);
    try {
      const adapter = new FluxImageAdapter(
        () => this.configService.get<string>('BFL_API_KEY'),
        () => this.configService.get<string>('BFL_API_BASE'),
        (key: string) => this.configService.get<string>(key),
      );
      const res = await adapter.generate({} as unknown as SanitizedUser, dto);
      const assets = res.results.map((r) => this.generatedAssetService.assetFromDataUrl(r.url));
      const out: ProviderResult = {
        provider: 'flux',
        model: dto.model || 'flux-2-pro',
        clientPayload: res.clientPayload,
        assets,
        rawResponse: res.rawResponse,
        usageMetadata: (res as any)?.usageMetadata as Record<string, unknown> | undefined,
      };
      return out;
    } catch (err) {
      const status = (err as { status?: number }).status;
      const details = (err as { details?: unknown }).details;
      const message = err instanceof Error ? err.message : 'Flux provider error';
      throw new HttpException(
        buildHttpErrorPayload(message, details),
        typeof status === 'number' ? status : 502,
      );
    }
  }

  private async handleGemini(
    dto: ProviderGenerateDto,
  ): Promise<ProviderResult> {
    this.validateProviderOptions('gemini', dto);
    try {
      const adapter = new GeminiImageAdapter(() => this.getGeminiApiKey());
      const res = await adapter.generate({} as unknown as SanitizedUser, dto);
      const assets = res.results.map((r) => this.generatedAssetService.assetFromDataUrl(r.url));
      // Use the model from the result (which will be the Imagen model) or fallback to DTO model
      const modelUsed = res.results[0]?.model || dto.model || 'gemini-3.0-pro-exp-01';
      const out: ProviderResult = {
        provider: 'gemini',
        model: modelUsed,
        clientPayload: res.clientPayload,
        assets,
        rawResponse: res.rawResponse,
      };
      return out;
    } catch (err) {
      const status = (err as { status?: number }).status;
      const details = (err as { details?: unknown }).details;
      const message = err instanceof Error ? err.message : 'Gemini provider error';
      throw new HttpException(
        buildHttpErrorPayload(message, details),
        typeof status === 'number' ? status : 502,
      );
    }
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

  private async getGeminiAuthContext(
    apiKey: string,
  ): Promise<GeminiAuthContext> {
    const context: GeminiAuthContext = {};
    if (apiKey?.trim()) context.apiKey = apiKey.trim();

    const accessToken = await this.getGeminiAccessToken().catch(() => null);
    if (accessToken) context.accessToken = accessToken;
    return context;
  }

  private async getGeminiAccessToken(): Promise<string | null> {
    const now = Date.now();
    if (
      this.geminiAccessTokenCache &&
      this.geminiAccessTokenCache.expiresAt - now > 60_000
    ) {
      return this.geminiAccessTokenCache.token;
    }
    if (
      this.geminiAccessTokenRetryAfter &&
      now < this.geminiAccessTokenRetryAfter
    ) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const tokenUrl = `${GEMINI_METADATA_TOKEN_URL}?scopes=${encodeURIComponent(
        GEMINI_OAUTH_SCOPE,
      )}`;
      const res = await fetch(tokenUrl, {
        method: 'GET',
        headers: { 'Metadata-Flavor': 'Google' },
        signal: controller.signal,
      });
      if (!res.ok) {
        this.geminiAccessTokenRetryAfter = now + 5 * 60 * 1000;
        return null;
      }
      const json = (await res.json().catch(() => null)) as {
        access_token?: string;
        expires_in?: number;
      } | null;
      const token = json?.access_token;
      if (!token) {
        this.geminiAccessTokenRetryAfter = now + 5 * 60 * 1000;
        return null;
      }
      const expiresIn = json?.expires_in ?? 300;
      this.geminiAccessTokenCache = {
        token,
        expiresAt: now + Math.max(expiresIn - 30, 60) * 1000,
      };
      this.geminiAccessTokenRetryAfter = 0;
      return token;
    } catch {
      this.geminiAccessTokenRetryAfter = now + 5 * 60 * 1000;
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async handleIdeogram(
    dto: ProviderGenerateDto,
  ): Promise<ProviderResult> {
    this.validateProviderOptions('ideogram', dto);
    try {
      const adapter = new IdeogramImageAdapter(() => this.configService.get<string>('IDEOGRAM_API_KEY'));
      const res = await adapter.generate({} as unknown as SanitizedUser, dto);
      const assets = res.results.map((r) => this.generatedAssetService.assetFromDataUrl(r.url));
      const out: ProviderResult = {
        provider: 'ideogram',
        model: 'ideogram-v3',
        clientPayload: res.clientPayload,
        assets,
        rawResponse: res.rawResponse,
      };
      return out;
    } catch (err) {
      const status = (err as { status?: number }).status;
      const details = (err as { details?: unknown }).details;
      const message = err instanceof Error ? err.message : 'Ideogram provider error';
      throw new HttpException(
        buildHttpErrorPayload(message, details),
        typeof status === 'number' ? status : 502,
      );
    }
  }

  private validateProviderOptions(
    provider: 'ideogram' | 'flux' | 'gemini',
    dto: ProviderGenerateDto,
  ): void {
    const badRequest = (msg: string, details?: unknown) =>
      new HttpException(buildHttpErrorPayload(msg, details), HttpStatus.BAD_REQUEST);
    const opts = dto.providerOptions ?? {};

    if (provider === 'ideogram') {
      const num =
        typeof opts['num_images'] === 'number'
          ? opts['num_images']
          : opts['numImages'];
      if (typeof num === 'number') {
        if (!Number.isInteger(num) || num < 1 || num > 4) {
          throw badRequest('num_images must be an integer between 1 and 4');
        }
      }
      const arRaw = opts['aspect_ratio'] ?? opts['aspectRatio'];
      if (typeof arRaw === 'string' && arRaw.trim()) {
        const ar = arRaw.trim();
        if (!/^\d{1,4}[:x]\d{1,4}$/i.test(ar)) {
          throw badRequest('aspect_ratio must be like 1:1, 16:9, or 16x9');
        }
      }
    }

    if (provider === 'flux') {
      const width = opts['width'];
      const height = opts['height'];
      const checkDim = (v: unknown, name: string) => {
        if (v === undefined) return;
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw badRequest(`${name} must be a number`);
        }
        if (v < 64 || v > 2048) {
          throw badRequest(`${name} must be between 64 and 2048`);
        }
      };
      checkDim(width, 'width');
      checkDim(height, 'height');
      const ar = opts['aspect_ratio'];
      if (typeof ar === 'string' && ar.trim()) {
        if (!/^\d{1,4}[:x]\d{1,4}$/i.test(ar.trim())) {
          throw badRequest('aspect_ratio must be like 1:1, 16:9, or 16x9');
        }
      }
    }

    if (provider === 'gemini') {
      const clamp = (v: number, min: number, max: number) =>
        Math.max(min, Math.min(max, v));
      if (dto.temperature !== undefined) {
        if (typeof dto.temperature !== 'number' || !Number.isFinite(dto.temperature)) {
          throw badRequest('temperature must be a number');
        }
        const t = clamp(dto.temperature, 0, 2);
        if (t !== dto.temperature) {
          throw badRequest('temperature must be between 0 and 2');
        }
      }
      if (dto.topP !== undefined) {
        if (typeof dto.topP !== 'number' || !Number.isFinite(dto.topP)) {
          throw badRequest('topP must be a number');
        }
        if (dto.topP < 0 || dto.topP > 1) {
          throw badRequest('topP must be between 0 and 1');
        }
      }
      if (dto.outputLength !== undefined) {
        if (
          typeof dto.outputLength !== 'number' ||
          !Number.isFinite(dto.outputLength) ||
          !Number.isInteger(dto.outputLength)
        ) {
          throw badRequest('outputLength must be an integer');
        }
        if (dto.outputLength < 1 || dto.outputLength > 8192) {
          throw badRequest('outputLength must be between 1 and 8192');
        }
      }
    }
  }

  private async handleQwen(dto: ProviderGenerateDto): Promise<ProviderResult> {
    try {
      const adapter = new QwenImageAdapter(
        () => this.configService.get<string>('DASHSCOPE_API_KEY'),
        () => this.configService.get<string>('DASHSCOPE_BASE'),
      );
      const res = await adapter.generate({} as unknown as SanitizedUser, dto);
      const assets = res.results.map((r) => this.generatedAssetService.assetFromDataUrl(r.url));
      return {
        provider: 'qwen',
        model: 'qwen-image',
        clientPayload: res.clientPayload,
        assets,
        rawResponse: res.rawResponse,
      };
    } catch (err) {
      const status = (err as { status?: number }).status;
      const details = (err as { details?: unknown }).details;
      const message = err instanceof Error ? err.message : 'DashScope provider error';
      throw new HttpException(
        buildHttpErrorPayload(message, details),
        typeof status === 'number' ? status : 502,
      );
    }
  }

  private async handleGrok(dto: ProviderGenerateDto): Promise<ProviderResult> {
    try {
      const adapter = new GrokImageAdapter(
        () => this.configService.get<string>('XAI_API_KEY'),
        () => this.configService.get<string>('XAI_API_BASE'),
      );
      const res = await adapter.generate({} as unknown as SanitizedUser, dto);
      const assets = res.results.map((r) => this.generatedAssetService.assetFromDataUrl(r.url));
      return {
        provider: 'grok',
        model: dto.model ?? 'grok-2-image',
        clientPayload: res.clientPayload,
        assets,
        rawResponse: res.rawResponse,
        usageMetadata: res.usageMetadata,
      };
    } catch (err) {
      const status = (err as { status?: number }).status;
      const details = (err as { details?: unknown }).details;
      const message =
        err instanceof Error ? err.message : 'Grok provider error';
      throw new HttpException(
        buildHttpErrorPayload(message, details),
        typeof status === 'number' ? status : 502,
      );
    }
  }

  private async handleRunway(
    dto: ProviderGenerateDto,
  ): Promise<ProviderResult> {
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

    const createResponse = await this.providerHttpService.fetchWithTimeout(
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
      20000,
    );

    const createPayload = await this.providerHttpService.safeJson(createResponse);

    if (!createResponse.ok) {
      const message =
        this.providerHttpService.extractProviderMessage(createPayload) ||
        `Runway API error: ${createResponse.status}`;
      this.logger.error('Runway create error', {
        status: createResponse.status,
        message,
        response: createPayload,
        request: sanitizedLog,
      });
      throw new HttpException(
        buildHttpErrorPayload(message, createPayload),
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

    const dataUrl = await this.generatedAssetService.ensureDataUrl(remoteUrlCandidate);
    const asset = this.generatedAssetService.assetFromDataUrl(dataUrl);
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
    dto: ProviderGenerateDto,
  ): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('ARK_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('Seedream API key not configured');
    }

    const response = await this.providerHttpService.fetchWithTimeout(
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
      20000,
    );

    const resultPayload = (await response.json()) as unknown;
    if (!response.ok) {
      const details = this.stringifyUnknown(resultPayload);
      this.logger.error(`Seedream API error ${response.status}: ${details}`);
      throw new HttpException(
        buildHttpErrorPayload(
          `Seedream API error: ${response.status}`,
          resultPayload,
        ),
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
      const ensured = await this.generatedAssetService.ensureDataUrl(url);
      const asset = this.generatedAssetService.assetFromDataUrl(ensured);
      if (asset.dataUrl) {
        dataUrls.push(asset.dataUrl);
      }
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
    dto: ProviderGenerateDto,
  ): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('OpenAI API key not configured');
    }

    const response = await this.providerHttpService.fetchWithTimeout(
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
      20000,
    );

    const resultPayload = (await response.json()) as unknown;
    const resultRecord = toJsonRecord(resultPayload);
    if (!response.ok) {
      const details = this.stringifyUnknown(resultPayload);
      this.logger.error(`OpenAI API error ${response.status}: ${details}`);
      throw new HttpException(
        buildHttpErrorPayload(
          `OpenAI API error: ${response.status}`,
          resultPayload,
        ),
        response.status,
      );
    }

    const url = this.extractOpenAiImage(resultPayload);
    if (!url) {
      this.throwBadRequest('No image returned from OpenAI');
    }

    const dataUrl = await this.generatedAssetService.ensureDataUrl(url || '');
    const asset = this.generatedAssetService.assetFromDataUrl(dataUrl);

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

  private async handleReve(dto: ProviderGenerateDto): Promise<ProviderResult> {
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

    const response = await this.providerHttpService.fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
    }, 20000);

    const resultPayload = await this.providerHttpService.safeJson(response);

    if (!response.ok) {
      const providerMessage =
        this.providerHttpService.extractProviderMessage(resultPayload) ||
        `Reve API error: ${response.status}`;
      this.logger.error('Reve API error', {
        status: response.status,
        message: providerMessage,
        response: resultPayload,
        request: sanitizedReveLog,
      });

      throw new HttpException(
        buildHttpErrorPayload(providerMessage, resultPayload),
        response.status,
      );
    }

    const payloadRecord = toJsonRecord(resultPayload);
    if (payloadRecord['content_violation']) {
      throw new HttpException(
        buildHttpErrorPayload(
          'Reve rejected the prompt for policy reasons.',
          resultPayload,
        ),
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
    const response = await this.providerHttpService.fetchWithTimeout(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }, 15000);

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
        buildHttpErrorPayload(
          `Reve job status error: ${response.status}`,
          resultPayload,
        ),
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

    const response = await this.providerHttpService.fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    }, 20000);

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
        buildHttpErrorPayload(
          `Reve edit error: ${response.status}`,
          resultPayload,
        ),
        response.status,
      );
    }

    const payloadRecord = toJsonRecord(resultPayload);
    if (payloadRecord['content_violation']) {
      throw new HttpException(
        buildHttpErrorPayload(
          'Reve rejected the edit for policy reasons.',
          resultPayload,
        ),
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
    dto: ProviderGenerateDto,
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
        buildHttpErrorPayload(
          `Recraft API error: ${response.status}`,
          resultPayload,
        ),
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
      const ensured = await this.generatedAssetService.ensureDataUrl(url);
      dataUrls.push(ensured);
      assets.push(this.generatedAssetService.assetFromDataUrl(ensured));
    }

    return {
      provider: 'recraft',
      model,
      clientPayload: { dataUrls },
      assets,
      rawResponse: resultPayload,
    };
  }

  async variateRecraftImage(
    user: SanitizedUser,
    options: {
      file: Express.Multer.File;
      size: string;
      image_format?: 'png' | 'webp';
      n?: number;
      prompt?: string;
      model?: string;
    },
  ) {
    const apiKey = this.configService.get<string>('RECRAFT_API_KEY');
    if (!apiKey) {
      this.logger.error(
        'RECRAFT_API_KEY environment variable is not configured',
      );
      throw new ServiceUnavailableException(
        'Recraft API key not configured. Please set RECRAFT_API_KEY environment variable.',
      );
    }

    const formData = new FormData();
    const fileBlob = new Blob([new Uint8Array(options.file.buffer)], {
      type: options.file.mimetype || 'application/octet-stream',
    });
    formData.append('file', fileBlob, options.file.originalname || 'image.png');
    formData.append('size', options.size);
    if (options.image_format) {
      formData.append('image_format', options.image_format);
    }
    if (options.n) {
      formData.append('n', String(options.n));
    }
    formData.append('response_format', 'url');

    const response = await fetch(
      'https://external.api.recraft.ai/v1/images/variateImage',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData as unknown as BodyInit,
      },
    );

    const resultPayload = (await response.json()) as unknown;
    if (!response.ok) {
      const details = this.stringifyUnknown(resultPayload);
      this.logger.error(`Recraft variate API error ${response.status}: ${details}`);
      throw new HttpException(
        buildHttpErrorPayload(
          `Recraft variate API error: ${response.status}`,
          resultPayload,
        ),
        response.status,
      );
    }

    const urls = this.extractRecraftImages(resultPayload);
    if (urls.length === 0) {
      this.throwBadRequest('No variations returned from Recraft');
    }

    const resolvedPrompt =
      options.prompt && options.prompt.trim().length > 0
        ? options.prompt.trim()
        : undefined;
    const resolvedModel =
      options.model && options.model.trim().length > 0
        ? options.model.trim()
        : 'recraft-v3';

    const items: Array<{
      url: string;
      mimeType: string;
      r2FileId?: string;
      r2FileUrl?: string;
      prompt?: string;
      model?: string;
    }> = [];

    for (const url of urls) {
      const ensured = await this.generatedAssetService.ensureDataUrl(url);
      const match = ensured.match(/^data:([^;,]+);base64,(.*)$/);
      if (!match) {
        // If Recraft returns a direct URL, fall back to original URL
        items.push({
          url: ensured,
          mimeType: 'image/png',
          prompt: resolvedPrompt ?? 'Variation',
          model: resolvedModel,
        });
        continue;
      }

      const [, mimeType, base64Data] = match;
      let publicUrl = ensured;
      let r2FileId: string | undefined;
      let r2FileUrl: string | undefined;

      if (this.r2Service.isConfigured()) {
        publicUrl = await this.r2Service.uploadBase64Image(
          base64Data,
          mimeType,
          'generated-images',
        );

        const fileName = `variation-${Date.now()}-${items.length}.${mimeType.split('/')[1] || 'png'
          }`;

        const r2File = await this.r2FilesService.create(user.authUserId, {
          fileName,
          fileUrl: publicUrl,
          fileSize: Math.round((base64Data.length * 3) / 4),
          mimeType,
          prompt: resolvedPrompt,
          model: resolvedModel,
          aspectRatio: '1:1',
        });

        r2FileId = r2File.id;
        r2FileUrl = r2File.fileUrl;
        items.push({
          url: publicUrl,
          mimeType,
          r2FileId,
          r2FileUrl,
          prompt: r2File.prompt ?? resolvedPrompt ?? 'Variation',
          model: r2File.model ?? resolvedModel,
        });
        continue;
      }

      items.push({
        url: publicUrl,
        mimeType,
        r2FileId,
        r2FileUrl,
        prompt: resolvedPrompt ?? 'Variation',
        model: resolvedModel,
      });
    }

    return {
      success: true,
      items,
    };
  }

  private async handleLuma(dto: ProviderGenerateDto): Promise<ProviderResult> {
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
    dto: ProviderGenerateDto,
    apiKey: string,
  ): Promise<ProviderResult> {
    const luma = new LumaAI({ authToken: apiKey });
    const normalizedModel = (dto.model || 'luma-photon-1').replace(
      /^luma-/,
      '',
    );

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

    const dataUrl = await this.generatedAssetService.ensureDataUrl(
      assetUrl,
      { Authorization: `Bearer ${apiKey}` },
    );

    const asset = this.generatedAssetService.assetFromDataUrl(dataUrl);

    return {
      provider: 'luma',
      model: dto.model || 'luma-photon-1',
      clientPayload: {
        dataUrl,
        mimeType: asset.mimeType,
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
    dto: ProviderGenerateDto,
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
        buildHttpErrorPayload(errorMessage, resultPayload),
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
      const ensured = await this.generatedAssetService.ensureDataUrl(url);
      dataUrls.push(ensured);
      assets.push(this.generatedAssetService.assetFromDataUrl(ensured));
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
          buildHttpErrorPayload('Luma generation failed', latest),
          HttpStatus.BAD_GATEWAY,
        );
      }

      await this.sleep(delayMs);
    }

    throw new HttpException(
      buildHttpErrorPayload('Luma generation timed out', {
        id: trimmedId,
        lastKnown: latest,
      }),
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
    dto: ProviderGenerateDto,
  ) {
    // Do not record another usage event here to avoid double-charging
    // and do not persist raw provider responses into the database
    // (they should be kept in object storage if needed).

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
        if (asset.dataUrl) {
          const base64Match = asset.dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
          if (base64Match) {
            const [, mimeType, base64Data] = base64Match;
            const publicUrl = await this.r2Service.uploadBase64Image(
              base64Data,
              mimeType,
              'generated-images',
            );

            // Create R2File record
            const fileName = `image-${Date.now()}.${mimeType.split('/')[1] || 'png'
              }`;
            const r2File = await this.r2FilesService.create(user.authUserId, {
              fileName,
              fileUrl: publicUrl,
              fileSize: Math.round((base64Data.length * 3) / 4),
              mimeType,
              prompt,
              model: providerResult.model,
              aspectRatio: this.extractAspectRatio(dto) ?? '1:1',
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
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        this.logger.error(`Failed to upload to R2 during Gemini generation`, {
          error: errorMessage,
          provider: 'gemini',
          userId: user?.authUserId,
        });

        // Check if this is a signature error specifically
        if (
          errorMessage.includes('signature') ||
          errorMessage.includes('Signature')
        ) {
          throw new Error(
            `R2 upload failed due to signature mismatch: ${errorMessage}. ` +
            `This typically indicates malformed credentials in Google Cloud Run environment variables. ` +
            `Please check that CLOUDFLARE_R2_SECRET_ACCESS_KEY has no extra spaces, newlines, or encoding issues.`,
          );
        }

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



  private async downloadAsDataUrl(
    url: string,
    headers?: Record<string, string>,
  ) {
    const response = await this.providerHttpService.fetchWithTimeout(url, {
      headers,
    }, 10000);

    if (!response.ok) {
      const text = await response.text().catch(() => '<no-body>');
      throw new HttpException(
        buildHttpErrorPayload('Failed to download image', text),
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
            return this.generatedAssetService.assetFromDataUrl(candidate);
          }
        }
      }

      throw new HttpException(
        buildHttpErrorPayload(
          'Failed to extract image data from response',
          payload ?? text.slice(0, 2000),
        ),
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
    dto: ProviderGenerateDto,
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
      const response = await this.providerHttpService.fetchWithTimeout(
        `https://api.dev.runwayml.com/v1/tasks/${taskId}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'X-Runway-Version': RUNWAY_API_VERSION,
            Accept: 'application/json',
          },
        },
        15000,
      );

      const payload = await this.providerHttpService.safeJson(response);

      if (!response.ok) {
        const providerMessage =
          this.providerHttpService.extractProviderMessage(payload) ||
          `Runway task error: ${response.status}`;
        this.logger.error('Runway task polling error', {
          status: response.status,
          message: providerMessage,
          response: payload,
          taskId,
          attempt: attempt + 1,
        });
        throw new HttpException(
          buildHttpErrorPayload(providerMessage, payload),
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
          this.providerHttpService.extractProviderMessage(payload) ??
          `Runway task ${status.toLowerCase()}`;
        throw new HttpException(
          buildHttpErrorPayload(failureMessage, payload),
          HttpStatus.BAD_GATEWAY,
        );
      }

      await this.sleep(RUNWAY_POLL_INTERVAL_MS);
    }

    this.logger.error('Runway task timed out', { taskId });
    throw new HttpException(
      buildHttpErrorPayload('Runway generation timed out', { taskId }),
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
        assets.push(this.generatedAssetService.assetFromDataUrl(dataUrl));
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
    return this.generatedAssetService.ensureDataUrl(trimmed);
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
    return this.generatedAssetService.collectImageCandidates(result);
  }

  private extractLumaImages(result: unknown): string[] {
    return this.generatedAssetService.collectImageCandidates(result);
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
        const converted = this.generatedAssetService.convertGsUriToHttps(trimmed);
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
      return this.generatedAssetService.convertGsUriToHttps(trimmed) ?? trimmed;
    }
    return trimmed;
  }

  private async tryResolveGeminiCandidate(
    candidate: GeminiRemoteCandidate,
    authContext: GeminiAuthContext,
  ): Promise<GeneratedAsset | null> {
    if (candidate.url?.startsWith('data:')) {
      const asset = this.generatedAssetService.assetFromDataUrl(candidate.url);
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
        authContext,
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
        const asset = this.generatedAssetService.assetFromDataUrl(url);
        return {
          ...asset,
          remoteUrl: candidate.rawUrl ?? candidate.url ?? url,
        };
      }

      let resolvedUrl = url;
      if (url.startsWith('gs://')) {
        resolvedUrl = this.generatedAssetService.convertGsUriToHttps(url) ?? url;
      }

      const directAsset = await this.fetchGeminiBinary(
        resolvedUrl,
        authContext,
      );
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
          authContext,
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
    authContext: GeminiAuthContext,
    visited = new Set<string>(),
  ): Promise<GeneratedAsset | null> {
    const normalizedPath = this.normalizeGeminiFilePath(fileId);
    if (!normalizedPath) {
      const directUrl = this.maybeAttachGeminiApiKey(
        fileId,
        authContext.apiKey,
      );
      return this.fetchGeminiBinary(directUrl, authContext, visited);
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
      const asset = await this.fetchGeminiBinary(url, authContext, visited);
      return asset;
    };

    const altMediaUrl = this.maybeAttachGeminiApiKey(
      `${baseEndpoint}?alt=media`,
      authContext.apiKey,
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
      authContext.apiKey,
    );
    const downloadAsset = await attemptDownload(downloadUrl);
    if (downloadAsset) {
      if (!downloadAsset.remoteUrl) {
        downloadAsset.remoteUrl = downloadUrl;
      }
      return downloadAsset;
    }

    const metadataUrl = this.maybeAttachGeminiApiKey(
      baseEndpoint,
      authContext.apiKey,
    );
    if (!visited.has(metadataUrl)) {
      visited.add(metadataUrl);
      try {
        const headers =
          this.getGeminiDownloadHeaders(metadataUrl, authContext) ?? {};
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
                const asset = this.generatedAssetService.assetFromDataUrl(candidate);
                return { ...asset, remoteUrl: candidate };
              }

              if (candidate.startsWith('gs://')) {
                const converted = this.generatedAssetService.convertGsUriToHttps(candidate);
                if (converted) {
                  const asset = await this.fetchGeminiBinary(
                    converted,
                    authContext,
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
                  authContext,
                  visited,
                );
                if (nested) {
                  return nested;
                }
                continue;
              }

              const directAsset = await this.fetchGeminiBinary(
                candidate,
                authContext,
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

  private appendApiKeyQuery(url: string, apiKey?: string): string {
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

  private maybeAttachGeminiApiKey(url: string, apiKey?: string): string {
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
    context: GeminiAuthContext,
  ): Record<string, string> | undefined {
    let host: string | undefined;
    try {
      host = new URL(url).hostname;
    } catch {
      host = undefined;
    }

    const headers: Record<string, string> = {};
    const isGoogleHost = host
      ? host.includes('googleapis.com') ||
      host.includes('googleusercontent.com') ||
      host.includes('storage.googleapis.com')
      : false;

    if (isGoogleHost && context.apiKey) {
      headers['x-goog-api-key'] = context.apiKey;
    }
    if (context.accessToken) {
      headers.Authorization = `Bearer ${context.accessToken}`;
    }

    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  private async fetchGeminiBinary(
    url: string,
    authContext: GeminiAuthContext,
    visited?: Set<string>,
    redirectDepth = 0,
  ): Promise<GeneratedAsset | null> {
    if (!url) {
      return null;
    }

    if (redirectDepth > 5) {
      return null;
    }

    const effectiveUrl = this.maybeAttachGeminiApiKey(url, authContext.apiKey);
    const visitSet = visited ?? new Set<string>();
    const visitKey = this.normalizeGeminiFilePath(effectiveUrl) ?? effectiveUrl;
    if (visitSet.has(visitKey)) {
      return null;
    }
    visitSet.add(visitKey);

    try {
      const headers =
        this.getGeminiDownloadHeaders(effectiveUrl, authContext) ?? undefined;
      const response = await fetch(effectiveUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return null;
        }
        let redirectedUrl = location;
        try {
          redirectedUrl = new URL(location, effectiveUrl).toString();
        } catch {
          // URL parsing failed, use location as-is
        }
        return this.fetchGeminiBinary(
          redirectedUrl,
          authContext,
          visitSet,
          redirectDepth + 1,
        );
      }

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
              const asset = this.generatedAssetService.assetFromDataUrl(candidate);
              return { ...asset, remoteUrl: effectiveUrl };
            }

            if (candidate.startsWith('gs://')) {
              const converted = this.generatedAssetService.convertGsUriToHttps(candidate);
              if (converted) {
                const nested = await this.fetchGeminiBinary(
                  converted,
                  authContext,
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
                authContext,
                visitSet,
              );
              if (nested) {
                return nested;
              }
              continue;
            }

            const direct = await this.fetchGeminiBinary(
              candidate,
              authContext,
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



  private async pollFluxJob(
    pollingUrl: string,
    apiKey: string,
  ): Promise<{ payload: JsonRecord; raw: unknown; status: string }> {
    let lastPayloadRaw: unknown = null;

    for (let attempt = 0; attempt < FLUX_MAX_ATTEMPTS; attempt += 1) {
      const response = await this.providerHttpService.fetchWithTimeout(pollingUrl, {
        method: 'GET',
        headers: {
          'x-key': apiKey,
          accept: 'application/json',
        },
      }, 20000);

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
          buildHttpErrorPayload('Flux polling failed', payloadRaw),
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
          buildHttpErrorPayload('Flux generation failed', failureDetails),
          HttpStatus.BAD_GATEWAY,
        );
      }

      await this.providerHttpService.wait(FLUX_POLL_INTERVAL_MS);
    }

    throw new HttpException(
      buildHttpErrorPayload('Flux generation timed out', {
        lastPayload: lastPayloadRaw,
      }),
      HttpStatus.REQUEST_TIMEOUT,
    );
  }

  // --- Timeouts, Retries, Circuit Breaker ---

  private circuitMap = new Map<string, { failures: number; openedUntil: number }>();

  private isCircuitOpen(provider: string): boolean {
    const now = Date.now();
    const state = this.circuitMap.get(provider);
    return !!state && state.openedUntil > now;
  }

  private recordSuccess(provider: string) {
    this.circuitMap.delete(provider);
  }

  private recordFailure(provider: string, threshold = 5, openMs = 60_000) {
    const now = Date.now();
    const state = this.circuitMap.get(provider) ?? { failures: 0, openedUntil: 0 };
    state.failures += 1;
    if (state.failures >= threshold) {
      state.openedUntil = now + openMs;
      state.failures = 0;
    }
    this.circuitMap.set(provider, state);
  }

  private async withCircuit<T>(provider: string, fn: () => Promise<T>): Promise<T> {
    if (this.isCircuitOpen(provider)) {
      throw new ServiceUnavailableException(`${provider} temporarily unavailable (circuit open)`);
    }
    try {
      const res = await fn();
      this.recordSuccess(provider);
      return res;
    } catch (err) {
      // Increment on timeouts, 429, 5xx; otherwise keep closed
      let shouldTrip = false;
      const message = err instanceof Error ? err.message : String(err);
      if (/timed out/i.test(message) || /aborted/i.test(message)) {
        shouldTrip = true;
      }
      const status = (err as { status?: number }).status;
      if (status && (status === 429 || status >= 500)) {
        shouldTrip = true;
      }
      if (shouldTrip) {
        this.recordFailure(provider);
      }
      throw err;
    }
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
    throw new HttpException(
      buildHttpErrorPayload(message, details),
      HttpStatus.BAD_REQUEST,
    );
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

  private extractAspectRatio(dto: ProviderGenerateDto): string | undefined {
    // Check config.imageConfig.aspectRatio first (safe access)
    const dtoRecord = optionalJsonRecord(dto);
    const configRecord = dtoRecord
      ? optionalJsonRecord(dtoRecord['config'])
      : undefined;
    const imageConfigRecord = configRecord
      ? optionalJsonRecord(configRecord['imageConfig'])
      : undefined;
    const configAspectRatio = asString(imageConfigRecord?.['aspectRatio']);
    if (configAspectRatio) {
      return configAspectRatio;
    }

    // Fallback to providerOptions.aspectRatio
    const providerAspectRatio = asString(
      optionalJsonRecord(dto.providerOptions)?.['aspectRatio'],
    );
    if (providerAspectRatio) {
      return providerAspectRatio;
    }

    return undefined;
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
