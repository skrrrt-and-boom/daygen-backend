import {
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  ImageProviderAdapter,
  NormalizedImageResult,
  ProviderAdapterResult,
} from '../types';
import type { ProviderGenerateDto } from '../dto/base-generate.dto';
import type { SanitizedUser } from '../../users/types';
import { GeneratedAssetService } from '../generated-asset.service';
import { ProviderHttpService } from '../provider-http.service';
import {
  asArray,
  asNumber,
  asString,
  buildHttpErrorPayload,
  optionalJsonRecord,
} from '../utils/provider-helpers';

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

export class RunwayImageAdapter implements ImageProviderAdapter {
  readonly providerName = 'runway';
  private readonly logger = new Logger(RunwayImageAdapter.name);

  constructor(
    private readonly getApiKey: () => string | undefined,
    private readonly assets: GeneratedAssetService,
    private readonly http: ProviderHttpService,
  ) { }

  canHandleModel(model: string): boolean {
    return model === 'runway-gen4' || model === 'runway-gen4-turbo';
  }

  async generate(
    _user: SanitizedUser,
    dto: ProviderGenerateDto,
  ): Promise<ProviderAdapterResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException('Runway API key not configured');
    }

    const runwayModel = this.resolveRunwayModel(dto.model);
    const ratio = this.resolveRunwayRatio(dto.providerOptions?.ratio);
    const seed = asNumber(dto.providerOptions?.seed);
    const referenceImages = this.buildRunwayReferenceImages(dto);

    if (runwayModel === 'gen4_image_turbo' && referenceImages.length === 0) {
      this.badRequest(
        'Runway Gen-4 Turbo requires at least one reference image.',
      );
    }

    const contentModeration = this.resolveRunwayModeration(
      dto.providerOptions,
    );

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

    const createResponse = await this.http.fetchWithTimeout(
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
      20_000,
    );

    const createPayload = await this.http.safeJson(createResponse);

    if (!createResponse.ok) {
      const message =
        this.http.extractProviderMessage(createPayload) ||
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
      this.badRequest('Runway did not return a task identifier');
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
      this.badRequest('Runway did not return an output image URL');
    }

    const dataUrl = await this.assets.ensureDataUrl(remoteUrlCandidate);
    const asset = this.assets.assetFromDataUrl(dataUrl);
    const normalized: NormalizedImageResult = {
      url: asset.dataUrl!,
      mimeType: asset.mimeType,
      provider: this.providerName,
      model: runwayModel,
      metadata: {
        remoteUrl: remoteUrlCandidate,
      },
    };

    return {
      results: [normalized],
      clientPayload: {
        dataUrl,
        contentType: asset.mimeType,
        taskId,
        status: asString(taskRecord?.['status']) ?? null,
        output: outputs,
      },
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
        this.logger.warn('Runway ratio not supported, falling back to default.', {
          requested: cleaned,
        });
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

  private sanitizeRunwayTag(
    value: unknown,
    index: number,
  ): string | undefined {
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
    if (trimmed.startsWith('gs://')) {
      return this.assets.convertGsUriToHttps(trimmed) ?? trimmed;
    }
    if (trimmed.includes('://')) {
      return trimmed;
    }
    return trimmed;
  }

  private async pollRunwayTask(apiKey: string, taskId: string) {
    for (let attempt = 0; attempt < RUNWAY_MAX_ATTEMPTS; attempt += 1) {
      const response = await this.http.fetchWithTimeout(
        `https://api.dev.runwayml.com/v1/tasks/${taskId}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'X-Runway-Version': RUNWAY_API_VERSION,
            Accept: 'application/json',
          },
        },
        15_000,
      );

      const payload = await this.http.safeJson(response);

      if (!response.ok) {
        const providerMessage =
          this.http.extractProviderMessage(payload) ||
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
          this.http.extractProviderMessage(payload) ??
          `Runway task ${status.toLowerCase()}`;
        throw new HttpException(
          buildHttpErrorPayload(failureMessage, payload),
          HttpStatus.BAD_GATEWAY,
        );
      }

      await this.http.sleep(RUNWAY_POLL_INTERVAL_MS);
    }

    this.logger.error('Runway task timed out', { taskId });
    throw new HttpException(
      buildHttpErrorPayload('Runway generation timed out', { taskId }),
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }

  private badRequest(message: string, details?: unknown): never {
    throw new HttpException(
      buildHttpErrorPayload(message, details),
      HttpStatus.BAD_REQUEST,
    );
  }
}

