import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGalleryEntryDto } from './dto/create-gallery-entry.dto';
import { Prisma } from '@prisma/client';
import type { GalleryEntry } from '@prisma/client';
import { GalleryEntryStatus } from '@prisma/client';
import { R2Service } from '../upload/r2.service';

@Injectable()
export class GalleryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Service: R2Service,
  ) {}

  async list(ownerAuthId: string, limit = 50, cursor?: string) {
    const take = Math.min(Math.max(limit, 1), 100);

    const entries = await this.prisma.galleryEntry.findMany({
      where: {
        ownerAuthId,
        status: GalleryEntryStatus.ACTIVE,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
    });

    const hasMore = entries.length > take;
    const items = hasMore ? entries.slice(0, take) : entries;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    return {
      items: items.map((entry) => this.toResponse(entry)),
      nextCursor,
    };
  }

  async create(ownerAuthId: string, dto: CreateGalleryEntryDto) {
    const entry = await this.prisma.galleryEntry.create({
      data: {
        ownerAuthId,
        templateId: dto.templateId ?? null,
        assetUrl: dto.assetUrl,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
    });

    return this.toResponse(entry);
  }

  async remove(ownerAuthId: string, id: string) {
    const entry = await this.prisma.galleryEntry.findFirst({
      where: { id, ownerAuthId },
    });

    if (!entry) {
      return { removed: false };
    }

    if (entry.status === GalleryEntryStatus.REMOVED) {
      return { removed: true, entry: this.toResponse(entry) };
    }

    // Try to delete the file from R2 if it's an R2 URL
    if (entry.assetUrl && this.isR2Url(entry.assetUrl)) {
      try {
        await this.r2Service.deleteFile(entry.assetUrl);
      } catch (error) {
        console.warn('Failed to delete file from R2:', error);
        // Continue with database update even if R2 deletion fails
      }
    }

    const updated = await this.prisma.galleryEntry.update({
      where: { id },
      data: { status: GalleryEntryStatus.REMOVED },
    });

    return { removed: true, entry: this.toResponse(updated) };
  }

  private toResponse(entry: GalleryEntry) {
    return {
      id: entry.id,
      templateId: entry.templateId,
      ownerAuthId: entry.ownerAuthId,
      assetUrl: entry.assetUrl,
      metadata: entry.metadata ?? null,
      status: entry.status,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  private isR2Url(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('r2.dev') || urlObj.hostname.includes('cloudflarestorage.com');
    } catch {
      return false;
    }
  }
}
