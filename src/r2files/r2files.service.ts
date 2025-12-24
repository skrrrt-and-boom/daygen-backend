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
  aspectRatio?: string;
  avatarId?: string;
  avatarImageId?: string;
  productId?: string;
  jobId?: string;
  references?: string[];  // Reference image URLs used during generation (max 16)
}

export interface R2FileResponse {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
  prompt?: string;
  model?: string;
  aspectRatio?: string;
  avatarId?: string;
  avatarImageId?: string;
  productId?: string;
  jobId?: string;
  jobType?: string;  // Job type derived from the associated Job
  isLiked?: boolean;
  likeCount?: number;
  isPublic?: boolean;
  references?: string[];  // Reference image URLs used during generation
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateR2FileDto {
  isLiked?: boolean;
  isPublic?: boolean;
  model?: string;
}

export interface PublicR2FileResponse extends R2FileResponse {
  owner?: {
    username?: string;
    authUserId: string;
    profileImage?: string;
    country?: string;
  };
}

@Injectable() // Correction: @Injectable proper usage
export class R2FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Service: R2Service,
  ) { }

  /**
   * Toggle like status for a file
   */
  async toggleLike(userId: string, fileId: string): Promise<{ isLiked: boolean; likeCount: number }> {
    const file = await this.prisma.r2File.findUnique({
      where: { id: fileId },
      // explicit select is optional if we trust the type, but good for perf
      select: { id: true, likedByAuthIds: true, likeCount: true }
    });

    if (!file) {
      throw new Error('File not found');
    }

    const hasLiked = file.likedByAuthIds.includes(userId);

    if (hasLiked) {
      // Unlike
      const updated = await this.prisma.r2File.update({
        where: { id: fileId },
        data: {
          likedByAuthIds: {
            set: file.likedByAuthIds.filter(id => id !== userId)
          },
          likeCount: {
            decrement: 1
          },
        }
      });
      return { isLiked: false, likeCount: updated.likeCount };
    } else {
      // Like
      const updated = await this.prisma.r2File.update({
        where: { id: fileId },
        data: {
          likedByAuthIds: {
            push: userId
          },
          likeCount: {
            increment: 1
          },
        }
      });
      return { isLiked: true, likeCount: updated.likeCount };
    }
  }

  /**
   * Check if a user has liked a file
   */
  async hasUserLiked(userId: string, fileId: string): Promise<boolean> {
    const file = await this.prisma.r2File.findUnique({
      where: { id: fileId },
      select: { likedByAuthIds: true }
    });
    return file ? file.likedByAuthIds.includes(userId) : false;
  }

  /**
   * List all public generations from all users for the Explore gallery
   */
  async listPublic(limit = 50, cursor?: string, viewerAuthId?: string): Promise<{
    items: PublicR2FileResponse[];
    totalCount: number;
    nextCursor: string | null;
  }> {
    const take = Math.min(Math.max(limit, 1), 100);

    const where: Prisma.R2FileWhereInput = {
      isPublic: true,
      deletedAt: null,
      avatarId: null,
      productId: null,
    };

    const fetchBatchSize = Math.min(take * 2, 50);
    const seenKeys = new Set<string>();

    // Type definition for selected fields
    type R2FileSelected = {
      id: string;
      fileName: string;
      fileUrl: string;
      fileSize: number | null;
      mimeType: string | null;
      prompt: string | null;
      model: string | null;
      aspectRatio: string | null;
      avatarId: string | null;
      avatarImageId: string | null;
      productId: string | null;
      jobId: string | null;
      isLiked: boolean | null;
      likeCount: number;
      likedByAuthIds: string[];
      isPublic: boolean | null;
      references: string[];
      createdAt: Date;
      updatedAt: Date;
      owner: {
        username: string | null;
        authUserId: string;
        profileImage: string | null;
        country: string | null;
      } | null;
    };

    const collected: (R2FileSelected & { viewerHasLiked?: boolean })[] = [];
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
        select: {
          id: true,
          fileName: true,
          fileUrl: true,
          fileSize: true,
          mimeType: true,
          prompt: true,
          model: true,
          aspectRatio: true,
          avatarId: true,
          avatarImageId: true,
          productId: true,
          jobId: true,
          isLiked: true,
          likeCount: true,
          likedByAuthIds: true,
          isPublic: true,
          references: true,
          createdAt: true,
          updatedAt: true,
          owner: {
            select: {
              username: true,
              authUserId: true,
              profileImage: true,
              country: true,
            },
          },
        },
      });

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of batch) {
        const dedupeKey = this.getDedupeKey(item);
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);

          let viewerHasLiked = false;
          if (viewerAuthId) {
            viewerHasLiked = item.likedByAuthIds.includes(viewerAuthId);
          }

          collected.push({ ...item, viewerHasLiked });
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
      items: paginatedItems.map((item) => {
        const likeCount = item.likeCount;
        let isLiked = item.viewerHasLiked ?? false;

        // Consistency check
        if (likeCount === 0 && isLiked) {
          isLiked = false;
        }

        return {
          ...this.toResponse(item),
          likeCount,
          isLiked,
          owner: item.owner
            ? {
              username: item.owner.username ?? undefined,
              authUserId: item.owner.authUserId,
              profileImage: item.owner.profileImage ?? undefined,
              country: item.owner.country ?? undefined,
            }
            : undefined,
        };
      }),
      totalCount: totalCountGroups.length,
      nextCursor,
    };
  }

  /**
   * List public generations for a specific user (for creator profile modal)
   */
  async listPublicByUser(userId: string, limit = 50, cursor?: string, viewerAuthId?: string): Promise<{
    items: PublicR2FileResponse[];
    totalCount: number;
    nextCursor: string | null;
    user?: {
      username?: string;
      authUserId: string;
      profileImage?: string;
      bio?: string;
      country?: string;
    };
  }> {
    const take = Math.min(Math.max(limit, 1), 100);

    // Get user info first
    const user = await this.prisma.user.findUnique({
      where: { authUserId: userId },
      select: {
        username: true,
        authUserId: true,
        profileImage: true,
        bio: true,
        country: true,
      },
    });

    const where: Prisma.R2FileWhereInput = {
      userId: userId,
      isPublic: true,
      deletedAt: null,
      avatarId: null,
      productId: null,
    };

    const fetchBatchSize = Math.min(take * 2, 50);
    const seenKeys = new Set<string>();

    // Type definition for selected fields
    type R2FileSelected = {
      id: string;
      fileName: string;
      fileUrl: string;
      fileSize: number | null;
      mimeType: string | null;
      prompt: string | null;
      model: string | null;
      aspectRatio: string | null;
      avatarId: string | null;
      avatarImageId: string | null;
      productId: string | null;
      jobId: string | null;
      isLiked: boolean | null;
      likeCount: number;
      likedByAuthIds: string[];
      isPublic: boolean | null;
      references: string[];
      createdAt: Date;
      updatedAt: Date;
    };

    const collected: (R2FileSelected & { viewerHasLiked?: boolean })[] = [];
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
        select: {
          id: true,
          fileName: true,
          fileUrl: true,
          fileSize: true,
          mimeType: true,
          prompt: true,
          model: true,
          aspectRatio: true,
          avatarId: true,
          avatarImageId: true,
          productId: true,
          jobId: true,
          isLiked: true,
          likeCount: true,
          likedByAuthIds: true,
          isPublic: true,
          references: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of batch) {
        const dedupeKey = this.getDedupeKey(item);
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);

          let viewerHasLiked = false;
          if (viewerAuthId) {
            viewerHasLiked = item.likedByAuthIds.includes(viewerAuthId);
          }

          collected.push({ ...item, viewerHasLiked });
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
      items: paginatedItems.map((item) => {
        const likeCount = item.likeCount;
        let isLiked = item.viewerHasLiked ?? false;

        if (likeCount === 0 && isLiked) {
          isLiked = false;
        }

        return {
          ...this.toResponse(item),
          likeCount,
          isLiked,
          owner: user
            ? {
              username: user.username ?? undefined,
              authUserId: user.authUserId,
              profileImage: user.profileImage ?? undefined,
              bio: user.bio ?? undefined,
              country: user.country ?? undefined,
            }
            : undefined,
        };
      }),
      totalCount: totalCountGroups.length,
      nextCursor,
      user: user
        ? {
          username: user.username ?? undefined,
          authUserId: user.authUserId,
          profileImage: user.profileImage ?? undefined,
          bio: user.bio ?? undefined,
          country: user.country ?? undefined,
        }
        : undefined,
    };
  }

  /**
   * Find a single public file by ID
   */
  async findPublicById(id: string, viewerAuthId?: string): Promise<PublicR2FileResponse | null> {
    const file = await this.prisma.r2File.findFirst({
      where: {
        id,
        isPublic: true,
        deletedAt: null,
      },
      include: {
        owner: {
          select: {
            username: true,
            authUserId: true,
            profileImage: true,
            country: true,
          },
        },
      },
    });

    if (!file) {
      return null;
    }

    let viewerHasLiked = false;
    if (viewerAuthId) {
      viewerHasLiked = file.likedByAuthIds.includes(viewerAuthId);
    }

    const likeCount = file.likeCount;
    let isLiked = viewerHasLiked;

    if (likeCount === 0 && isLiked) {
      isLiked = false;
    }

    return {
      ...this.toPublicResponse(file),
      likeCount,
      isLiked,
    };
  }

  private toPublicResponse(file: {
    id: string;
    fileName: string;
    fileUrl: string;
    fileSize?: number | null;
    mimeType?: string | null;
    prompt?: string | null;
    model?: string | null;
    aspectRatio?: string | null;
    avatarId?: string | null;
    avatarImageId?: string | null;
    productId?: string | null;
    jobId?: string | null;
    isLiked?: boolean | null;
    likeCount?: number | null;
    likedByAuthIds?: string[];
    isPublic?: boolean | null;
    createdAt: Date;
    updatedAt: Date;
    owner?: {
      username?: string | null;
      authUserId: string;
      profileImage?: string | null;
      country?: string | null;
    } | null;
  }): PublicR2FileResponse {
    return {
      ...this.toResponse(file),
      owner: file.owner
        ? {
          username: file.owner.username ?? undefined,
          authUserId: file.owner.authUserId,
          profileImage: file.owner.profileImage ?? undefined,
          country: file.owner.country ?? undefined,
        }
        : undefined,
    };
  }

  async list(userId: string, limit = 50, cursor?: string, type?: 'image' | 'video') {
    const take = Math.min(Math.max(limit, 1), 100);

    // Build mimeType filter based on type parameter
    const mimeTypeFilter: Prisma.R2FileWhereInput = type === 'video'
      ? { mimeType: { startsWith: 'video/' } }
      : type === 'image'
        ? {
          OR: [
            { mimeType: { startsWith: 'image/' } },
            { mimeType: null }, // Include items without mimeType in image view
          ],
        }
        : {};

    const where: Prisma.R2FileWhereInput = {
      userId: userId,
      deletedAt: null,
      avatarId: null,
      productId: null,
      ...mimeTypeFilter,
    };

    const fetchBatchSize = Math.min(take * 2, 50);
    const seenKeys = new Set<string>();
    // Type definition for selected fields
    type R2FileSelected = {
      id: string;
      fileName: string;
      fileUrl: string;
      fileSize: number | null;
      mimeType: string | null;
      prompt: string | null;
      model: string | null;
      aspectRatio: string | null;
      avatarId: string | null;
      avatarImageId: string | null;
      productId: string | null;
      jobId: string | null;
      isLiked: boolean | null;
      likeCount: number;
      likedByAuthIds: string[];
      isPublic: boolean | null;
      references: string[];
      createdAt: Date;
      updatedAt: Date;
      job: { type: string } | null;
    };
    const collected: R2FileSelected[] = [];
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
        select: {
          id: true,
          fileName: true,
          fileUrl: true,
          fileSize: true,
          mimeType: true,
          prompt: true,
          model: true,
          aspectRatio: true,
          avatarId: true,
          avatarImageId: true,
          productId: true,
          jobId: true,
          isLiked: true,
          likeCount: true,
          likedByAuthIds: true,
          isPublic: true,
          references: true,
          createdAt: true,
          updatedAt: true,
          job: {
            select: {
              type: true,
            },
          },
        },
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

  async create(userId: string, dto: CreateR2FileDto) {
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
          userId,
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
            aspectRatio: dto.aspectRatio,
            avatarId: dto.avatarId,
            avatarImageId: dto.avatarImageId,
            productId: dto.productId,
            jobId: dto.jobId,
            references: dto.references?.slice(0, 16) ?? [],
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
        userId,
        fileName: dto.fileName,
        fileUrl: normalizedFileUrl ?? dto.fileUrl,
        fileSize: dto.fileSize,
        mimeType: dto.mimeType,
        prompt: dto.prompt,
        model: dto.model,
        aspectRatio: dto.aspectRatio,
        avatarId: dto.avatarId,
        avatarImageId: dto.avatarImageId,
        productId: dto.productId,
        jobId: dto.jobId,
        references: dto.references?.slice(0, 16) ?? [],
        updatedAt: new Date(),
      },
    });

    return this.toResponse(file);
  }

  async findById(userId: string, id: string) {
    const file = await this.prisma.r2File.findFirst({
      where: { id, userId, deletedAt: null },
    });

    return file ? this.toResponse(file) : null;
  }

  async update(userId: string, id: string, dto: UpdateR2FileDto) {
    const file = await this.prisma.r2File.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!file) {
      throw new Error('File not found');
    }

    const updated = await this.prisma.r2File.update({
      where: { id },
      data: {
        ...(dto.isLiked !== undefined && { isLiked: dto.isLiked }),
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
        ...(dto.model !== undefined && { model: dto.model }),
        updatedAt: new Date(),
      },
    });

    return this.toResponse(updated);
  }

  async updateByFileUrl(userId: string, fileUrl: string, dto: UpdateR2FileDto) {
    const normalized = fileUrl?.trim();
    if (!normalized) {
      throw new Error('fileUrl is required');
    }

    const result = await this.prisma.r2File.updateMany({
      where: {
        userId,
        deletedAt: null,
        fileUrl: normalized,
      },
      data: {
        ...(dto.isLiked !== undefined && { isLiked: dto.isLiked }),
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
        ...(dto.model !== undefined && { model: dto.model }),
        updatedAt: new Date(),
      },
    });

    if (!result.count) {
      throw new Error('File not found');
    }

    return { success: true, count: result.count };
  }

  async remove(userId: string, id: string) {
    const file = await this.prisma.r2File.findFirst({
      where: { id, userId, deletedAt: null }, // Only find non-deleted files
    });

    if (!file) {
      throw new Error('File not found');
    }

    // Soft delete: mark as deleted instead of removing from database
    const now = new Date();

    await this.prisma.r2File.updateMany({
      where: {
        userId,
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

  async removeByFileUrl(userId: string, fileUrl: string) {
    // Normalize URL - strip query params for flexible matching
    const normalized = fileUrl?.trim();
    if (!normalized) {
      throw new Error('fileUrl is required');
    }
    const baseUrl = normalized.split('?')[0];

    // Try exact match first
    let file = await this.prisma.r2File.findFirst({
      where: {
        userId,
        deletedAt: null,
        fileUrl: normalized,
      },
    });

    // If no exact match, try matching by base URL (without query params)
    if (!file) {
      file = await this.prisma.r2File.findFirst({
        where: {
          userId,
          deletedAt: null,
          fileUrl: {
            startsWith: baseUrl,
          },
        },
      });
    }

    if (!file) {
      throw new Error('File not found');
    }

    // Soft delete
    const now = new Date();
    await this.prisma.r2File.updateMany({
      where: {
        userId,
        deletedAt: null,
        OR: [
          { id: file.id },
          { fileUrl: file.fileUrl },
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
    aspectRatio?: string | null;
    avatarId?: string | null;
    avatarImageId?: string | null;
    productId?: string | null;
    jobId?: string | null;
    isLiked?: boolean | null;
    likeCount?: number | null;
    isPublic?: boolean | null;
    references?: string[] | null;
    createdAt: Date;
    updatedAt: Date;
    job?: { type: string } | null;
  }): R2FileResponse {
    return {
      id: file.id,
      fileName: file.fileName,
      fileUrl: file.fileUrl,
      fileSize: file.fileSize ?? undefined,
      mimeType: file.mimeType ?? undefined,
      prompt: file.prompt ?? undefined,
      model: file.model ?? undefined,
      aspectRatio: file.aspectRatio ?? undefined,
      avatarId: file.avatarId ?? undefined,
      avatarImageId: file.avatarImageId ?? undefined,
      productId: file.productId ?? undefined,
      jobId: file.jobId ?? undefined,
      jobType: file.job?.type ?? undefined,
      isLiked: file.isLiked ?? undefined,
      likeCount: file.likeCount ?? 0,
      isPublic: file.isPublic ?? undefined,
      references: file.references && file.references.length > 0 ? file.references : undefined,
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
