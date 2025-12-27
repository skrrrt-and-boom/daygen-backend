import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAvatarDto, UpdateAvatarDto, AddAvatarImageDto } from './dto';

function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

@Injectable()
export class AvatarsService {
    constructor(private readonly prisma: PrismaService) { }

    async findAll(userId: string) {
        const avatars = await this.prisma.avatar.findMany({
            where: { userId, deletedAt: null },
            include: { images: true },
            orderBy: { createdAt: 'desc' },
        });

        return avatars.map(avatar => this.toResponse(avatar));
    }

    async findOne(userId: string, id: string) {
        const avatar = await this.prisma.avatar.findFirst({
            where: { id, userId, deletedAt: null },
            include: { images: true },
        });

        if (!avatar) {
            throw new NotFoundException('Avatar not found');
        }

        return this.toResponse(avatar);
    }

    async create(userId: string, dto: CreateAvatarDto) {
        const baseSlug = generateSlug(dto.name);

        // Find unique slug (max 10 attempts to prevent infinite loops)
        let slug = baseSlug;
        let counter = 1;
        const maxAttempts = 10;
        while (counter <= maxAttempts) {
            const existing = await this.prisma.avatar.findUnique({
                where: { userId_slug: { userId, slug } },
            });
            if (!existing) break;
            slug = `${baseSlug}-${counter}`;
            counter++;
        }
        // If we exhausted attempts, add a random suffix
        if (counter > maxAttempts) {
            slug = `${baseSlug}-${Date.now()}`;
        }

        // If isMe is explicitly set to true, unset any existing Me avatar first
        if (dto.isMe) {
            await this.prisma.avatar.updateMany({
                where: { userId, isMe: true, deletedAt: null },
                data: { isMe: false },
            });
        }

        const avatar = await this.prisma.avatar.create({
            data: {
                userId,
                name: dto.name,
                slug,
                imageUrl: dto.imageUrl,
                source: dto.source,
                sourceId: dto.sourceId,
                published: dto.published ?? false,
                isMe: dto.isMe ?? false, // Only set isMe if explicitly requested
                images: dto.images?.length
                    ? {
                        create: dto.images.map((img, index) => ({
                            fileUrl: img.url,
                            fileName: img.url.split('/').pop() || 'avatar-image',
                            userId,
                            source: img.source,
                            sourceId: img.sourceId,
                            isPrimary: img.isPrimary ?? index === 0,
                        })),
                    }
                    : {
                        create: {
                            fileUrl: dto.imageUrl,
                            fileName: dto.imageUrl.split('/').pop() || 'avatar-image',
                            userId,
                            source: dto.source,
                            sourceId: dto.sourceId,
                            isPrimary: true,
                        },
                    },
            },
            include: { images: true },
        });

        return this.toResponse(avatar);
    }

    async update(userId: string, id: string, dto: UpdateAvatarDto) {
        const avatar = await this.prisma.avatar.findFirst({
            where: { id, userId, deletedAt: null },
        });

        if (!avatar) {
            throw new NotFoundException('Avatar not found');
        }

        // If name changed, regenerate slug (max 10 attempts to prevent infinite loops)
        let slug = avatar.slug;
        if (dto.name && dto.name !== avatar.name) {
            const baseSlug = generateSlug(dto.name);
            slug = baseSlug;
            let counter = 1;
            const maxAttempts = 10;
            while (counter <= maxAttempts) {
                const existing = await this.prisma.avatar.findFirst({
                    where: { userId, slug, id: { not: id } },
                });
                if (!existing) break;
                slug = `${baseSlug}-${counter}`;
                counter++;
            }
            // If we exhausted attempts, add a random suffix
            if (counter > maxAttempts) {
                slug = `${baseSlug}-${Date.now()}`;
            }
        }

        const updated = await this.prisma.avatar.update({
            where: { id },
            data: {
                name: dto.name,
                slug,
                imageUrl: dto.imageUrl,
                source: dto.source,
                sourceId: dto.sourceId,
                published: dto.published,
            },
            include: { images: true },
        });

        return this.toResponse(updated);
    }

    async delete(userId: string, id: string) {
        const avatar = await this.prisma.avatar.findFirst({
            where: { id, userId, deletedAt: null },
        });

        if (!avatar) {
            throw new NotFoundException('Avatar not found');
        }

        await this.prisma.avatar.update({
            where: { id },
            data: { deletedAt: new Date() },
        });

        return { success: true };
    }

    async addImage(userId: string, avatarId: string, dto: AddAvatarImageDto) {
        const avatar = await this.prisma.avatar.findFirst({
            where: { id: avatarId, userId, deletedAt: null },
        });

        if (!avatar) {
            throw new NotFoundException('Avatar not found');
        }

        // If this is marked as primary, unmark others
        if (dto.isPrimary) {
            await this.prisma.r2File.updateMany({
                where: { avatarId },
                data: { isPrimary: false },
            });
        }

        const image = await this.prisma.r2File.create({
            data: {
                avatarId,
                fileUrl: dto.url,
                fileName: dto.url.split('/').pop() || 'avatar-image',
                userId, // We need userId here. It was passed to method.
                source: dto.source,
                sourceId: dto.sourceId,
                isPrimary: dto.isPrimary ?? false,
            },
        });

        // Update avatar's primary imageUrl if this is primary
        if (dto.isPrimary) {
            await this.prisma.avatar.update({
                where: { id: avatarId },
                data: { imageUrl: dto.url },
            });
        }

        return image;
    }

    async removeImage(userId: string, avatarId: string, imageId: string) {
        const avatar = await this.prisma.avatar.findFirst({
            where: { id: avatarId, userId, deletedAt: null },
            include: { images: true },
        });

        if (!avatar) {
            throw new NotFoundException('Avatar not found');
        }

        const image = avatar.images.find(img => img.id === imageId);
        if (!image) {
            throw new NotFoundException('Image not found');
        }

        // Don't allow deleting the last image
        if (avatar.images.length <= 1) {
            throw new Error('Cannot delete the last image');
        }

        await this.prisma.r2File.delete({
            where: { id: imageId },
        });

        // If deleted image was primary, set another as primary
        if (image.isPrimary) {
            const remaining = avatar.images.filter(img => img.id !== imageId);
            if (remaining.length > 0) {
                await this.prisma.r2File.update({
                    where: { id: remaining[0].id },
                    data: { isPrimary: true },
                });
                await this.prisma.avatar.update({
                    where: { id: avatarId },
                    data: { imageUrl: remaining[0].fileUrl },
                });
            }
        }

        return { success: true };
    }

    /**
     * Set an avatar as the "Me" avatar (user's own avatar)
     * Ensures only one avatar per user can be isMe: true
     */
    async setMeAvatar(userId: string, avatarId: string) {
        // First, unset any existing "Me" avatar for this user
        await this.prisma.avatar.updateMany({
            where: { userId, isMe: true, deletedAt: null },
            data: { isMe: false },
        });

        // Set the specified avatar as "Me"
        const avatar = await this.prisma.avatar.update({
            where: { id: avatarId },
            data: { isMe: true },
            include: { images: true },
        });

        return this.toResponse(avatar);
    }

    /**
     * Set a specific image as the primary image for an avatar
     */
    async setPrimaryImage(userId: string, avatarId: string, imageId: string) {
        const avatar = await this.prisma.avatar.findFirst({
            where: { id: avatarId, userId, deletedAt: null },
            include: { images: true },
        });

        if (!avatar) {
            throw new NotFoundException('Avatar not found');
        }

        const image = avatar.images.find(img => img.id === imageId);
        if (!image) {
            throw new NotFoundException('Image not found');
        }

        // Unmark all images as primary
        await this.prisma.r2File.updateMany({
            where: { avatarId },
            data: { isPrimary: false },
        });

        // Mark the selected image as primary
        await this.prisma.r2File.update({
            where: { id: imageId },
            data: { isPrimary: true },
        });

        // Update avatar's primary imageUrl
        const updatedAvatar = await this.prisma.avatar.update({
            where: { id: avatarId },
            data: { imageUrl: image.fileUrl },
            include: { images: true },
        });

        return this.toResponse(updatedAvatar);
    }

    private toResponse(avatar: any) {
        const primaryImage = avatar.images?.find((img: any) => img.isPrimary) || avatar.images?.[0];

        return {
            id: avatar.id,
            slug: avatar.slug,
            name: avatar.name,
            imageUrl: avatar.imageUrl,
            source: avatar.source,
            sourceId: avatar.sourceId,
            published: avatar.published,
            isMe: avatar.isMe ?? false,
            createdAt: avatar.createdAt.toISOString(),
            updatedAt: avatar.updatedAt.toISOString(),
            primaryImageId: primaryImage?.id || null,
            images: avatar.images?.map((img: any) => ({
                id: img.id,
                url: img.fileUrl,
                source: img.source,
                sourceId: img.sourceId,
                createdAt: img.createdAt.toISOString(),
            })) || [],
        };
    }
}
