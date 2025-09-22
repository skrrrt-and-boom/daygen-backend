import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGalleryEntryDto } from './dto/create-gallery-entry.dto';
import { Prisma } from '@prisma/client';
import type { GalleryEntry } from '@prisma/client';

@Injectable()
export class GalleryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerAuthId: string, limit = 50, cursor?: string) {
    const take = Math.min(Math.max(limit, 1), 100);

    const entries = await this.prisma.galleryEntry.findMany({
      where: { ownerAuthId },
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
    const result = await this.prisma.galleryEntry.deleteMany({
      where: { id, ownerAuthId },
    });

    return { removed: result.count > 0 };
  }

  private toResponse(entry: GalleryEntry) {
    return {
      id: entry.id,
      templateId: entry.templateId,
      ownerAuthId: entry.ownerAuthId,
      assetUrl: entry.assetUrl,
      metadata: entry.metadata ?? null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }
}
