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

    await this.persistResult(user, prompt, providerResult, dto);

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

    const createResult = await createResponse.json().catch(async () => {
      const text = await createResponse.text().catch(() => '<unavailable>');
      return { raw: text };
    });

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
        `Flux create job failed ${createResponse.status}: ${JSON.stringify(createResult)}`,
      );
      throw new HttpException(
        {
          error: `BFL error ${createResponse.status}`,
          details: createResult,
        },
        createResponse.status,
      );
    }

    const jobId =
      createResult?.id ??
      createResult?.job_id ??
      createResult?.task_id ??
      createResult?.jobId;
    const pollingUrl =
      createResult?.polling_url ??
      createResult?.pollingUrl ??
      createResult?.polling_url_v2;

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
        create: createResult,
        final: pollResult.payload,
      },
      usageMetadata: {
        jobId: jobId ?? null,
        pollingUrl,
        status: pollResult.status,
      },
    };
  }

  private async handleGemini(dto: UnifiedGenerateDto): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('Gemini API key not configured');
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

    const result = await response.json();
    const candidateParts = result?.candidates?.[0]?.content?.parts ?? [];
    const imgPart = candidateParts.find(
      (p: { inlineData?: { data?: string } }) => p.inlineData?.data,
    );

    if (!imgPart?.inlineData?.data) {
      throw new BadRequestException(
        'No image returned from Gemini 2.5 Flash Image',
      );
    }

    const mimeType = imgPart.inlineData.mimeType || 'image/png';
    const base64 = imgPart.inlineData.data;
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      provider: 'gemini',
      model: targetModel,
      clientPayload: {
        success: true,
        mimeType,
        imageBase64: base64,
        model: targetModel,
      },
      assets: [
        {
          dataUrl,
          mimeType,
          base64,
        },
      ],
      rawResponse: result,
    };
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

    const result = await response.json();
    const urls = await this.collectIdeogramUrls(result);
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
      rawResponse: result,
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

    const result = await response.json();

    if (!response.ok) {
      this.logger.error(
        `DashScope error ${response.status}: ${JSON.stringify(result)}`,
      );
      throw new HttpException(
        { error: result?.message ?? 'DashScope error', code: result?.code },
        response.status,
      );
    }

    const imageUrl = this.extractDashscopeImageUrl(result);
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
        usage: result?.usage ?? null,
      },
      assets: [asset],
      rawResponse: result,
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

    const result = await response.json();

    if (!response.ok) {
      const details = await this.stringifyUnknown(result);
      this.logger.error(`Runway API error ${response.status}: ${details}`);
      throw new HttpException(
        { error: `Runway API error: ${response.status}`, details: result },
        response.status,
      );
    }

    const remoteUrl = this.extractRunwayImageUrl(result);
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
        job: result,
      },
      assets: [asset],
      rawResponse: result,
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

    const result = await response.json();
    if (!response.ok) {
      this.logger.error(
        `Seedream API error ${response.status}: ${JSON.stringify(result)}`,
      );
      throw new HttpException(
        { error: `Seedream API error: ${response.status}`, details: result },
        response.status,
      );
    }

    const urls = this.extractSeedreamImages(result);
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
      rawResponse: result,
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

    const result = await response.json();
    if (!response.ok) {
      this.logger.error(
        `OpenAI API error ${response.status}: ${JSON.stringify(result)}`,
      );
      throw new HttpException(
        { error: `OpenAI API error: ${response.status}`, details: result },
        response.status,
      );
    }

    const url = this.extractOpenAiImage(result);
    if (!url) {
      throw new BadRequestException('No image returned from OpenAI');
    }

    const dataUrl = await this.ensureDataUrl(url);
    const asset = this.assetFromDataUrl(dataUrl);

    return {
      provider: 'openai',
      model: 'dall-e-3',
      clientPayload: {
        dataUrl,
        contentType: asset.mimeType,
        revisedPrompt: result?.data?.[0]?.revised_prompt ?? null,
      },
      assets: [asset],
      rawResponse: result,
    };
  }

  private async handleReve(dto: UnifiedGenerateDto): Promise<ProviderResult> {
    const apiKey = this.configService.get<string>('REVE_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('Reve API key not configured');
    }

    const response = await fetch('https://api.reve.com/v1/images/generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: dto.prompt,
        model: 'reve-v1',
        width: dto.providerOptions.width ?? 1024,
        height: dto.providerOptions.height ?? 1024,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      this.logger.error(
        `Reve API error ${response.status}: ${JSON.stringify(result)}`,
      );
      throw new HttpException(
        { error: `Reve API error: ${response.status}`, details: result },
        response.status,
      );
    }

    const urls = this.extractReveImages(result);
    if (urls.length === 0) {
      throw new BadRequestException('No images returned from Reve');
    }

    const dataUrls = [] as string[];
    const assets: GeneratedAsset[] = [];
    for (const url of urls) {
      const ensured = await this.ensureDataUrl(url);
      dataUrls.push(ensured);
      assets.push(this.assetFromDataUrl(ensured));
    }

    return {
      provider: 'reve',
      model: 'reve-v1',
      clientPayload: { dataUrls },
      assets,
      rawResponse: result,
    };
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

    const result = await response.json();
    if (!response.ok) {
      this.logger.error(
        `Recraft API error ${response.status}: ${JSON.stringify(result)}`,
      );
      throw new HttpException(
        { error: `Recraft API error: ${response.status}`, details: result },
        response.status,
      );
    }

    const urls = this.extractRecraftImages(result);
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
      rawResponse: result,
    };
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

    const metadata: Record<string, unknown> = {
      provider: providerResult.provider,
      model: providerResult.model,
      prompt,
      options: dto.providerOptions,
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

  private extractDashscopeImageUrl(result: any): string | null {
    const choices = result?.output?.choices;
    if (!Array.isArray(choices)) {
      return null;
    }
    for (const choice of choices) {
      const content = choice?.message?.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (typeof item?.image === 'string') {
            return item.image;
          }
        }
      }
    }
    return null;
  }

  private extractRunwayImageUrl(result: any): string | null {
    if (typeof result?.data?.[0]?.image_url === 'string') {
      return result.data[0].image_url;
    }
    if (typeof result?.data?.[0]?.url === 'string') {
      return result.data[0].url;
    }
    if (typeof result?.output?.[0]?.image === 'string') {
      return result.output[0].image;
    }
    return null;
  }

  private extractSeedreamImages(result: any): string[] {
    const images: string[] = [];
    if (Array.isArray(result?.data)) {
      for (const entry of result.data) {
        if (typeof entry?.b64_json === 'string') {
          images.push(`data:image/png;base64,${entry.b64_json}`);
        }
        if (typeof entry?.url === 'string') {
          images.push(entry.url);
        }
      }
    }
    if (Array.isArray(result?.images)) {
      for (const url of result.images) {
        if (typeof url === 'string') {
          images.push(url);
        }
      }
    }
    return images;
  }

  private extractOpenAiImage(result: any): string | null {
    const data = result?.data;
    if (!Array.isArray(data)) {
      return null;
    }
    const first = data[0];
    if (typeof first?.b64_json === 'string') {
      return `data:image/png;base64,${first.b64_json}`;
    }
    if (typeof first?.url === 'string') {
      return first.url;
    }
    return null;
  }

  private extractReveImages(result: any): string[] {
    const images: string[] = [];
    if (Array.isArray(result?.images)) {
      for (const entry of result.images) {
        if (typeof entry === 'string') {
          images.push(entry);
        } else if (entry?.url) {
          images.push(entry.url);
        }
      }
    }
    return images;
  }

  private extractRecraftImages(result: any): string[] {
    const images: string[] = [];
    if (Array.isArray(result?.data)) {
      for (const entry of result.data) {
        if (typeof entry === 'string') {
          images.push(entry);
        } else if (typeof entry?.url === 'string') {
          images.push(entry.url);
        }
      }
    }
    if (Array.isArray(result?.images)) {
      for (const url of result.images) {
        if (typeof url === 'string') {
          images.push(url);
        }
      }
    }
    return images;
  }

  private async pollFluxJob(
    pollingUrl: string,
    apiKey: string,
  ): Promise<{ payload: any; status: string }> {
    let lastPayload: any = null;

    for (let attempt = 0; attempt < FLUX_MAX_ATTEMPTS; attempt += 1) {
      const response = await fetch(pollingUrl, {
        method: 'GET',
        headers: {
          'x-key': apiKey,
          accept: 'application/json',
        },
      });

      const text = await response.text().catch(() => '');
      let payload: any;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }

      if (!response.ok) {
        throw new HttpException(
          { error: 'Flux polling failed', details: payload },
          response.status,
        );
      }

      lastPayload = payload;

      const statusValue =
        payload?.status ??
        payload?.task_status ??
        payload?.state ??
        payload?.result?.status;
      const status = this.normalizeFluxStatus(statusValue);

      if (status === 'READY') {
        return { payload, status };
      }

      if (status === 'FAILED' || status === 'ERROR') {
        throw new HttpException(
          {
            error: 'Flux generation failed',
            details: payload?.error ?? payload?.details ?? payload,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      await this.wait(FLUX_POLL_INTERVAL_MS);
    }

    throw new HttpException(
      {
        error: 'Flux generation timed out',
        details: { lastPayload },
      },
      HttpStatus.REQUEST_TIMEOUT,
    );
  }

  private normalizeFluxStatus(
    status: unknown,
  ): 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'ERROR' {
    if (!status) {
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

  private extractFluxSampleUrl(result: any): string | null {
    if (!result) {
      return null;
    }
    if (typeof result?.result?.sample === 'string') {
      return result.result.sample;
    }
    if (typeof result?.result?.sample_url === 'string') {
      return result.result.sample_url;
    }
    if (typeof result?.sample === 'string') {
      return result.sample;
    }
    if (typeof result?.image === 'string') {
      return result.image;
    }
    if (Array.isArray(result?.result?.samples)) {
      for (const entry of result.result.samples) {
        if (typeof entry === 'string') {
          return entry;
        }
        if (typeof entry?.url === 'string') {
          return entry.url;
        }
      }
    }
    if (Array.isArray(result?.images)) {
      for (const entry of result.images) {
        if (typeof entry === 'string') {
          return entry;
        }
        if (typeof entry?.url === 'string') {
          return entry.url;
        }
      }
    }
    if (Array.isArray(result?.output)) {
      for (const entry of result.output) {
        if (typeof entry?.image === 'string') {
          return entry.image;
        }
        if (typeof entry?.url === 'string') {
          return entry.url;
        }
      }
    }
    if (Array.isArray(result?.outputs)) {
      for (const entry of result.outputs) {
        if (typeof entry?.image === 'string') {
          return entry.image;
        }
        if (typeof entry?.url === 'string') {
          return entry.url;
        }
      }
    }
    if (typeof result?.result?.sample?.url === 'string') {
      return result.result.sample.url;
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

  private async collectIdeogramUrls(result: any): Promise<string[]> {
    const urls: string[] = [];
    if (Array.isArray(result?.data)) {
      for (const item of result.data) {
        if (typeof item?.image_url === 'string') {
          urls.push(item.image_url);
        }
        if (typeof item?.url === 'string') {
          urls.push(item.url);
        }
      }
    }
    if (Array.isArray(result?.images)) {
      for (const entry of result.images) {
        if (typeof entry === 'string') {
          urls.push(entry);
        } else if (typeof entry?.url === 'string') {
          urls.push(entry.url);
        }
      }
    }
    if (Array.isArray(result?.result?.images)) {
      for (const entry of result.result.images) {
        if (typeof entry?.url === 'string') {
          urls.push(entry.url);
        }
      }
    }
    return urls;
  }

  private async stringifyUnknown(value: unknown): Promise<string> {
    try {
      return typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }
}
