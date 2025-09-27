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
}

export interface R2FileResponse {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
  prompt?: string;
  model?: string;
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

    if (cursor) {
      where.createdAt = {
        lt: new Date(cursor),
      };
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.r2File.findMany({
        where,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.r2File.count({ where }),
    ]);

    const nextCursor = items.length === take && items.length > 0
      ? items[items.length - 1].createdAt.toISOString()
      : null;

    return {
      items: items.map(item => this.toResponse(item)),
      totalCount,
      nextCursor,
    };
  }

  async create(ownerAuthId: string, dto: CreateR2FileDto) {
    const file = await this.prisma.r2File.create({
      data: {
        id: randomUUID(),
        ownerAuthId,
        fileName: dto.fileName,
        fileUrl: dto.fileUrl,
        fileSize: dto.fileSize,
        mimeType: dto.mimeType,
        prompt: dto.prompt,
        model: dto.model,
        updatedAt: new Date(),
      },
    });

    return this.toResponse(file);
  }

  async remove(ownerAuthId: string, id: string) {
    const file = await this.prisma.r2File.findFirst({
      where: { id, ownerAuthId, deletedAt: null }, // Only find non-deleted files
    });

    if (!file) {
      throw new Error('File not found');
    }

    // Soft delete: mark as deleted instead of removing from database
    await this.prisma.r2File.update({
      where: { id },
      data: { 
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return { success: true };
  }

  private toResponse(file: any): R2FileResponse {
    return {
      id: file.id,
      fileName: file.fileName,
      fileUrl: file.fileUrl,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      prompt: file.prompt,
      model: file.model,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
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
