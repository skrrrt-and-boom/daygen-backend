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

    async findAll(ownerAuthId: string) {
        const avatars = await this.prisma.avatar.findMany({
            where: { ownerAuthId, deletedAt: null },
            include: { images: true },
            orderBy: { createdAt: 'desc' },
        });

        return avatars.map(avatar => this.toResponse(avatar));
    }

    async findOne(ownerAuthId: string, id: string) {
        const avatar = await this.prisma.avatar.findFirst({
            where: { id, ownerAuthId, deletedAt: null },
            include: { images: true },
        });

        if (!avatar) {
            throw new NotFoundException('Avatar not found');
        }

        return this.toResponse(avatar);
    }

    async create(ownerAuthId: string, dto: CreateAvatarDto) {
        const baseSlug = generateSlug(dto.name);

        // Find unique slug
        let slug = baseSlug;
        let counter = 1;
        while (true) {
            const existing = await this.prisma.avatar.findUnique({
                where: { ownerAuthId_slug: { ownerAuthId, slug } },
            });
            if (!existing) break;
            slug = `${baseSlug}-${counter}`;
            counter++;
        }

        const avatar = await this.prisma.avatar.create({
            data: {
                ownerAuthId,
                name: dto.name,
                slug,
                imageUrl: dto.imageUrl,
                source: dto.source,
                sourceId: dto.sourceId,
                published: dto.published ?? false,
                images: dto.images?.length
                    ? {
                        create: dto.images.map((img, index) => ({
                            url: img.url,
                            source: img.source,
                            sourceId: img.sourceId,
                            isPrimary: img.isPrimary ?? index === 0,
                        })),
                    }
                    : {
                        create: {
                            url: dto.imageUrl,
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

    async update(ownerAuthId: string, id: string, dto: UpdateAvatarDto) {
        const avatar = await this.prisma.avatar.findFirst({
            where: { id, ownerAuthId, deletedAt: null },
        });

        if (!avatar) {
            throw new NotFoundException('Avatar not found');
        }

        // If name changed, regenerate slug
        let slug = avatar.slug;
        if (dto.name && dto.name !== avatar.name) {
            const baseSlug = generateSlug(dto.name);
            slug = baseSlug;
            let counter = 1;
            while (true) {
                const existing = await this.prisma.avatar.findFirst({
                    where: { ownerAuthId, slug, id: { not: id } },
                });
                if (!existing) break;
                slug = `${baseSlug}-${counter}`;
                counter++;
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

    async delete(ownerAuthId: string, id: string) {
        const avatar = await this.prisma.avatar.findFirst({
            where: { id, ownerAuthId, deletedAt: null },
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

    async addImage(ownerAuthId: string, avatarId: string, dto: AddAvatarImageDto) {
        const avatar = await this.prisma.avatar.findFirst({
            where: { id: avatarId, ownerAuthId, deletedAt: null },
        });

        if (!avatar) {
            throw new NotFoundException('Avatar not found');
        }

        // If this is marked as primary, unmark others
        if (dto.isPrimary) {
            await this.prisma.avatarImage.updateMany({
                where: { avatarId },
                data: { isPrimary: false },
            });
        }

        const image = await this.prisma.avatarImage.create({
            data: {
                avatarId,
                url: dto.url,
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

    async removeImage(ownerAuthId: string, avatarId: string, imageId: string) {
        const avatar = await this.prisma.avatar.findFirst({
            where: { id: avatarId, ownerAuthId, deletedAt: null },
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

        await this.prisma.avatarImage.delete({
            where: { id: imageId },
        });

        // If deleted image was primary, set another as primary
        if (image.isPrimary) {
            const remaining = avatar.images.filter(img => img.id !== imageId);
            if (remaining.length > 0) {
                await this.prisma.avatarImage.update({
                    where: { id: remaining[0].id },
                    data: { isPrimary: true },
                });
                await this.prisma.avatar.update({
                    where: { id: avatarId },
                    data: { imageUrl: remaining[0].url },
                });
            }
        }

        return { success: true };
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
            createdAt: avatar.createdAt.toISOString(),
            updatedAt: avatar.updatedAt.toISOString(),
            primaryImageId: primaryImage?.id || null,
            images: avatar.images?.map((img: any) => ({
                id: img.id,
                url: img.url,
                source: img.source,
                sourceId: img.sourceId,
                createdAt: img.createdAt.toISOString(),
            })) || [],
        };
    }
}
