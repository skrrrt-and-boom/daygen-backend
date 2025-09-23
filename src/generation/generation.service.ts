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
import type { SanitizedUser } from '../users/types';
import { GalleryService } from '../gallery/gallery.service';
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
  buffer: Buffer;
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

  constructor(
    private readonly configService: ConfigService,
    private readonly galleryService: GalleryService,
    private readonly usageService: UsageService,
  ) {}

  async generate(user: SanitizedUser, dto: UnifiedGenerateDto) {
    const prompt = dto.prompt?.trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required');
    }

    const model = dto.model?.trim();
    if (!model) {
      throw new BadRequestException('Model is required');
    }

    const providerResult = await this.dispatch(model, {
      ...dto,
      prompt,
      model,
    });

    await this.persistResult(
      user,
      prompt,
      providerResult,
      dto.providerOptions ?? {},
    );

    return providerResult.clientPayload;
  }

  private async dispatch(
    model: string,
    dto: UnifiedGenerateDto,
  ): Promise<ProviderResult> {
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
      default:
        throw new BadRequestException(`Unsupported model: ${model}`);
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

    this.ensureFluxHost(pollingUrl, FLUX_ALLOWED_POLL_HOSTS, 'polling URL');

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

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
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

    for (const part of partCandidates) {
      const partRecord = optionalJsonRecord(part);
      if (!partRecord) {
        continue;
      }
      const inlineRecord = optionalJsonRecord(partRecord['inlineData']);
      if (!inlineRecord) {
        continue;
      }
      const data = asString(inlineRecord['data']);
      if (!data) {
        continue;
      }
      base64 = data;
      mimeType = asString(inlineRecord['mimeType']) ?? 'image/png';
      break;
    }

    if (!base64) {
      throw new BadRequestException(
        'No image returned from Gemini 2.5 Flash Image',
      );
    }

    const resolvedMimeType = mimeType ?? 'image/png';
    const dataUrl = `data:${resolvedMimeType};base64,${base64}`;

    return {
      provider: 'gemini',
      model: targetModel,
      clientPayload: {
        success: true,
        mimeType: resolvedMimeType,
        imageBase64: base64,
        model: targetModel,
      },
      assets: [
        {
          dataUrl,
          mimeType: resolvedMimeType,
          base64,
        },
      ],
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
      throw new ServiceUnavailableException('Ideogram API key not configured');
    }

    const response = await fetch('https://api.ideogram.ai/api/v1/images', {
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
      throw new HttpException(
        { error: `Ideogram API error: ${response.status}`, details: errorText },
        response.status,
      );
    }

    const resultPayload = (await response.json()) as unknown;
    const urls = this.collectIdeogramUrls(resultPayload);
    if (urls.length === 0) {
      throw new BadRequestException('No images returned from Ideogram');
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
      throw new BadRequestException('No image returned from DashScope');
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
      'https://api.runwayml.com/v1/image_generations',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
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
      throw new BadRequestException('No image URL returned from Runway');
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
      throw new BadRequestException('No images returned from Seedream');
    }

    const dataUrls = [] as string[];
    const assets: GeneratedAsset[] = [];
    for (const url of urls) {
      const ensured = await this.ensureDataUrl(url);
      dataUrls.push(ensured);
      assets.push(this.assetFromDataUrl(ensured));
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
      throw new BadRequestException('No image returned from OpenAI');
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
      throw new ServiceUnavailableException('Reve API key not configured');
    }

    const providerOptions = dto.providerOptions ?? {};
    const requestBody: Record<string, unknown> = {
      prompt: dto.prompt,
    };

    const resolvedModel = this.resolveReveModel(
      dto.model,
      providerOptions.model,
    );
    if (resolvedModel) {
      requestBody.model = resolvedModel;
    }

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
      (providerOptions.guidance_scale ?? providerOptions.guidanceScale) as
        unknown,
    );
    if (guidanceScale !== undefined) {
      requestBody.guidance_scale = guidanceScale;
    }
    const steps = asNumber(providerOptions.steps);
    if (steps !== undefined) {
      requestBody.steps = steps;
    }
    const batchSize = asNumber(
      (providerOptions.batch_size ?? providerOptions.batchSize) as unknown,
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
      throw new HttpException(
        { error: `Reve API error: ${response.status}`, details: resultPayload },
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

    const jobId = getFirstString(payloadRecord, [
      'job_id',
      'request_id',
      'id',
    ]);

    const { dataUrls, assets } = await this.resolveReveAssets(resultPayload);

    if (dataUrls.length === 0) {
      throw new BadRequestException('No images returned from Reve');
    }

    const clientPayload = this.buildReveClientPayload(
      payloadRecord,
      dataUrls,
      jobId,
    );

    return {
      provider: 'reve',
      model: resolvedModel ?? 'reve-image-1.0',
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
      throw new BadRequestException('Job ID is required');
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
      this.logger.error(
        `Reve job status error ${response.status}: ${details}`,
      );
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

    const imageBlob = new Blob([input.image.buffer], {
      type: input.image.mimeType ?? 'application/octet-stream',
    });
    form.set('image', imageBlob, input.image.filename ?? 'image.png');

    if (input.mask) {
      const maskBlob = new Blob([input.mask.buffer], {
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
        { error: `Reve edit error: ${response.status}`, details: resultPayload },
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

    const jobId = getFirstString(payloadRecord, [
      'job_id',
      'request_id',
      'id',
    ]);

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

    await this.persistResult(
      user,
      input.prompt,
      providerResult,
      input.providerOptions,
    );

    return clientPayload;
  }

  private async handleRecraft(
    dto: UnifiedGenerateDto,
  ): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('RECRAFT_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('Recraft API key not configured');
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
      throw new BadRequestException('No images returned from Recraft');
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

  private async persistResult(
    user: SanitizedUser,
    prompt: string,
    providerResult: ProviderResult,
    providerOptions: Record<string, unknown>,
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

    const metadata: Record<string, unknown> = {
      provider: providerResult.provider,
      model: providerResult.model,
      prompt,
      options: providerOptions,
    };

    try {
      await this.galleryService.create(user.authUserId, {
        assetUrl: firstAsset.dataUrl,
        metadata,
      });
    } catch (error) {
      this.logger.error(`Failed to persist gallery entry: ${String(error)}`);
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
    const { dataUrl } = await this.downloadAsDataUrl(source);
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
      return overrideValue === 'reve-image'
        ? 'reve-image-1.0'
        : overrideValue;
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
      throw new BadRequestException('Empty image reference from Reve');
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
      const url = asString(entryRecord['url']);
      if (url) {
        images.push(url);
      }
    }

    for (const entry of asArray(resultRecord['images'])) {
      if (typeof entry === 'string') {
        images.push(entry);
      }
    }

    return images;
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

  private ensureFluxHost(
    url: string,
    allowedHosts: Set<string>,
    label: string,
  ): void {
    try {
      const parsed = new URL(url);
      if (!allowedHosts.has(parsed.hostname)) {
        throw new BadRequestException(
          `Invalid ${label} host: ${parsed.hostname}`,
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Invalid ${label}`);
    }
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
