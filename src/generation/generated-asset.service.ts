import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { ProviderGenerateDto } from './dto/base-generate.dto';
import type { SanitizedUser } from '../users/types';
import { R2FilesService } from '../r2files/r2files.service';
import { R2Service } from '../upload/r2.service';
import { ProviderHttpService } from './provider-http.service';
import { COMMON_ALLOWED_SUFFIXES } from './allowed-hosts';
import { safeDownload, toDataUrl } from './safe-fetch';
import {
  asString,
  buildHttpErrorPayload,
  isJsonRecord,
  isProbablyBase64,
  optionalJsonRecord,
} from './utils/provider-helpers';

export interface GeneratedAsset {
  dataUrl?: string;
  mimeType: string;
  base64?: string;
  remoteUrl?: string;
  r2FileId?: string;
  r2FileUrl?: string;
}

export interface PersistableProviderResult {
  assets: GeneratedAsset[];
  model: string;
  clientPayload: unknown;
}

@Injectable()
export class GeneratedAssetService {
  private readonly logger = new Logger(GeneratedAssetService.name);

  constructor(
    private readonly r2FilesService: R2FilesService,
    private readonly r2Service: R2Service,
    private readonly providerHttpService: ProviderHttpService,
  ) { }

  assetFromDataUrl(dataUrl: string): GeneratedAsset {
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

  async ensureDataUrl(
    source: string,
    headers?: Record<string, string>,
  ): Promise<string> {
    if (source.startsWith('data:')) {
      return source;
    }

    const normalized = source.startsWith('gs://')
      ? this.convertGsUriToHttps(source) ?? source
      : source;

    try {
      const url = new URL(normalized);
      const allowedHosts = new Set<string>([url.hostname]);
      const result = await safeDownload(normalized, {
        allowedHosts,
        allowedHostSuffixes: COMMON_ALLOWED_SUFFIXES,
        headers: headers ?? {},
        acceptContentTypes: /^image\//i,
      });
      return toDataUrl(result.arrayBuffer, result.mimeType);
    } catch {
      const { dataUrl } = await this.downloadAsDataUrl(normalized, headers);
      return dataUrl!;
    }
  }

  async persistResult(
    user: SanitizedUser,
    prompt: string,
    providerResult: PersistableProviderResult,
    dto: ProviderGenerateDto,
  ): Promise<void> {
    const assets = providerResult.assets;
    if (!assets || assets.length === 0) {
      return;
    }

    for (const asset of assets) {
      await this.persistAsset(user, asset, {
        prompt,
        model: providerResult.model,
        avatarId: dto.avatarId,
        avatarImageId: dto.avatarImageId,
        productId: dto.productId,
      });
    }

    // Update client payload with R2 info from the first asset (backward compatibility)
    // or all assets if the payload structure supports it
    if (assets.length > 0) {
      // For now, we just update based on the first asset as per previous logic,
      // but we might want to handle multiple assets better in the future.
      // The previous logic only handled the first asset effectively for the 'dataUrl' field in payload.
      // We will try to update for all assets if possible.

      // If there's only one asset, use the legacy single-file update
      if (assets.length === 1 && assets[0].r2FileId) {
        this.updateClientPayloadWithR2Info(
          providerResult.clientPayload,
          { id: assets[0].r2FileId, fileUrl: assets[0].r2FileUrl! }
        );
      } else {
        // If multiple, we might need a more complex update strategy, 
        // but for now let's at least ensure the first one is reflected if the client expects a single image.
        if (assets[0].r2FileId) {
          this.updateClientPayloadWithR2Info(
            providerResult.clientPayload,
            { id: assets[0].r2FileId, fileUrl: assets[0].r2FileUrl! }
          );
        }
      }
    }
  }

  async persistAsset(
    user: SanitizedUser,
    asset: GeneratedAsset,
    metadata: {
      prompt: string;
      model: string;
      avatarId?: string;
      avatarImageId?: string;
      productId?: string;
      jobId?: string;
    },
  ): Promise<void> {
    if (!this.r2Service.isConfigured()) {
      this.logger.error(
        'R2 is not configured but a generated asset attempted persistence',
      );
      throw new Error(
        'R2 storage is not configured. Please configure Cloudflare R2 credentials.',
      );
    }

    try {
      // Ensure we have base64 data
      if (!asset.base64) {
        if (asset.dataUrl) {
          const match = asset.dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
          if (match) {
            asset.mimeType = match[1];
            asset.base64 = match[2];
          }
        }
      }

      if (!asset.base64 && asset.remoteUrl) {
        // Download if we only have a remote URL
        const downloaded = await this.downloadAsDataUrl(asset.remoteUrl);
        asset.base64 = downloaded.base64;
        asset.mimeType = downloaded.mimeType;
        asset.dataUrl = downloaded.dataUrl;
      }

      if (!asset.base64) {
        throw new InternalServerErrorException('No image data available to persist');
      }

      // Calculate hash for deduplication/naming
      const hash = this.calculateHash(asset.base64);
      const ext = asset.mimeType.split('/')[1] || 'png';
      const filename = `${hash}.${ext}`;




      const publicUrl = await this.r2Service.uploadBase64Image(
        asset.base64,
        asset.mimeType,
        'generated-images',
        filename,
      );

      const r2File = await this.r2FilesService.create(user.authUserId, {
        fileName: `image-${Date.now()}.${ext}`, // We might want to keep unique filenames for user downloads?
        fileUrl: publicUrl,
        fileSize: Math.round((asset.base64.length * 3) / 4),
        mimeType: asset.mimeType,
        prompt: metadata.prompt,
        model: metadata.model,
        avatarId: metadata.avatarId,
        avatarImageId: metadata.avatarImageId,
        productId: metadata.productId,
        jobId: metadata.jobId,
      });

      asset.dataUrl = publicUrl;
      asset.remoteUrl = publicUrl;
      asset.r2FileId = r2File.id;
      asset.r2FileUrl = r2File.fileUrl;

    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to persist generated asset', {
        error: errorMessage,
        userId: user?.authUserId,
        model: metadata.model,
      });

      if (
        errorMessage.includes('signature') ||
        errorMessage.includes('Signature')
      ) {
        throw new Error(
          `R2 upload failed due to signature mismatch: ${errorMessage}. ` +
          `Check CLOUDFLARE_R2_SECRET_ACCESS_KEY for whitespace or encoding issues.`,
        );
      }

      throw new Error(
        `R2 upload failed: ${errorMessage}. Ensure R2 credentials are configured.`,
      );
    }
  }

  private calculateHash(base64: string): string {
    return crypto.createHash('sha256').update(base64).digest('hex');
  }

  updateClientPayloadWithR2Info(
    clientPayload: unknown,
    r2File: { id: string; fileUrl: string },
  ): void {
    if (!clientPayload || typeof clientPayload !== 'object') {
      return;
    }

    const payload = clientPayload as Record<string, unknown>;
    const r2Url = r2File.fileUrl;

    if (payload.dataUrl) {
      payload.dataUrl = r2Url;
    }
    if (payload.image) {
      payload.image = r2Url;
    }
    if (payload.image_url) {
      payload.image_url = r2Url;
    }

    if (Array.isArray(payload.dataUrls)) {
      payload.dataUrls = [r2Url];
    }
    if (Array.isArray(payload.images)) {
      payload.images = [r2Url];
    }

    payload.r2FileId = r2File.id;
    payload.r2FileUrl = r2Url;
  }

  convertGsUriToHttps(uri: string): string | undefined {
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

  private async downloadAsDataUrl(
    url: string,
    headers?: Record<string, string>,
  ): Promise<GeneratedAsset> {
    const response = await this.providerHttpService.fetchWithTimeout(
      url,
      { headers },
      10_000,
    );

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
            return this.assetFromDataUrl(candidate);
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

  collectImageCandidates(source: unknown): string[] {
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
}

