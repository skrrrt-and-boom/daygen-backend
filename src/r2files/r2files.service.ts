import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../upload/r2.service';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface CreateR2FileDto {
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
  prompt?: string;
  model?: string;
  avatarId?: string;
  avatarImageId?: string;
  productId?: string;
  jobId?: string;
}

export interface R2FileResponse {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
  prompt?: string;
  model?: string;
  avatarId?: string;
  avatarImageId?: string;
  productId?: string;
  jobId?: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class R2FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Service: R2Service,
  ) {}

  async list(ownerAuthId: string, limit = 50, cursor?: string) {
    const take = Math.min(Math.max(limit, 1), 100);

    const where: Prisma.R2FileWhereInput = {
      ownerAuthId,
      deletedAt: null, // Only show non-deleted files
    };

    const fetchBatchSize = Math.min(take * 2, 200);
    const seenKeys = new Set<string>();
    type R2FileRecord = Awaited<
      ReturnType<typeof this.prisma.r2File.findMany>
    >[number];
    const collected: R2FileRecord[] = [];
    let pagingCursor = cursor ? new Date(cursor) : undefined;
    let hasMore = true;

    while (collected.length < take && hasMore) {
      const batch = await this.prisma.r2File.findMany({
        where: {
          ...where,
          ...(pagingCursor
            ? {
                createdAt: {
                  lt: pagingCursor,
                },
              }
            : {}),
        },
        take: fetchBatchSize,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
      });

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of batch) {
        const dedupeKey = this.getDedupeKey(item);
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          collected.push(item);
        }
      }

      hasMore = batch.length === fetchBatchSize;
      pagingCursor = batch[batch.length - 1]?.createdAt;
    }

    const paginatedItems = collected.slice(0, take);
    const nextCursor =
      (hasMore || collected.length > take) && paginatedItems.length > 0
        ? paginatedItems[paginatedItems.length - 1].createdAt.toISOString()
        : null;

    const totalCountGroups = await this.prisma.r2File.groupBy({
      where,
      by: ['fileUrl'],
      _count: {
        _all: true,
      },
    });

    return {
      items: paginatedItems.map((item) => this.toResponse(item)),
      totalCount: totalCountGroups.length,
      nextCursor,
    };
  }

  async create(ownerAuthId: string, dto: CreateR2FileDto) {
    // Validate that fileUrl is not a base64 data URL
    if (dto.fileUrl && this.r2Service.isBase64Url(dto.fileUrl)) {
      throw new Error(
        'Base64 data URLs are not allowed. Please upload to R2 first and provide the public URL.',
      );
    }

    // Validate that fileUrl is a proper R2 URL if provided
    if (dto.fileUrl && !this.r2Service.validateR2Url(dto.fileUrl)) {
      throw new Error('Invalid file URL. Only R2 public URLs are allowed.');
    }

    const normalizedFileUrl = dto.fileUrl?.trim();

    if (normalizedFileUrl) {
      const existing = await this.prisma.r2File.findFirst({
        where: {
          ownerAuthId,
          fileUrl: normalizedFileUrl,
        },
      });

      if (existing) {
        const updated = await this.prisma.r2File.update({
          where: { id: existing.id },
          data: {
            fileName: dto.fileName,
            fileUrl: normalizedFileUrl,
            fileSize: dto.fileSize,
            mimeType: dto.mimeType,
            prompt: dto.prompt,
            model: dto.model,
            avatarId: dto.avatarId,
            avatarImageId: dto.avatarImageId,
            productId: dto.productId,
            jobId: dto.jobId,
            deletedAt: null,
            updatedAt: new Date(),
          },
        });

        return this.toResponse(updated);
      }
    }

    const file = await this.prisma.r2File.create({
      data: {
        id: randomUUID(),
        ownerAuthId,
        fileName: dto.fileName,
        fileUrl: normalizedFileUrl ?? dto.fileUrl,
        fileSize: dto.fileSize,
        mimeType: dto.mimeType,
        prompt: dto.prompt,
        model: dto.model,
        avatarId: dto.avatarId,
        avatarImageId: dto.avatarImageId,
        productId: dto.productId,
        jobId: dto.jobId,
        updatedAt: new Date(),
      },
    });

    return this.toResponse(file);
  }

  async findById(ownerAuthId: string, id: string) {
    const file = await this.prisma.r2File.findFirst({
      where: { id, ownerAuthId, deletedAt: null },
    });

    return file ? this.toResponse(file) : null;
  }

  async remove(ownerAuthId: string, id: string) {
    const file = await this.prisma.r2File.findFirst({
      where: { id, ownerAuthId, deletedAt: null }, // Only find non-deleted files
    });

    if (!file) {
      throw new Error('File not found');
    }

    // Soft delete: mark as deleted instead of removing from database
    const now = new Date();

    await this.prisma.r2File.updateMany({
      where: {
        ownerAuthId,
        deletedAt: null,
        OR: [
          { id },
          {
            fileUrl: file.fileUrl,
          },
        ],
      },
      data: {
        deletedAt: now,
        updatedAt: now,
      },
    });

    return { success: true };
  }

  private toResponse(file: {
    id: string;
    fileName: string;
    fileUrl: string;
    fileSize?: number | null;
    mimeType?: string | null;
    prompt?: string | null;
    model?: string | null;
    avatarId?: string | null;
    avatarImageId?: string | null;
    productId?: string | null;
    jobId?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): R2FileResponse {
    return {
      id: file.id,
      fileName: file.fileName,
      fileUrl: file.fileUrl,
      fileSize: file.fileSize ?? undefined,
      mimeType: file.mimeType ?? undefined,
      prompt: file.prompt ?? undefined,
      model: file.model ?? undefined,
      avatarId: file.avatarId ?? undefined,
      avatarImageId: file.avatarImageId ?? undefined,
      productId: file.productId ?? undefined,
      jobId: file.jobId ?? undefined,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    };
  }

  private isR2Url(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return (
        urlObj.hostname.includes('r2.dev') ||
        urlObj.hostname.includes('cloudflarestorage.com')
      );
    } catch {
      return false;
    }
  }

  private getDedupeKey(file: { fileUrl: string | null; id: string }) {
    const normalizedUrl = file.fileUrl?.trim();
    if (normalizedUrl) {
      return `url:${normalizedUrl}`;
    }
    return `id:${file.id}`;
  }
}
