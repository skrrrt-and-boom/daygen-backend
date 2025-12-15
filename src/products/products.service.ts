import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto, AddProductImageDto } from './dto';

function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

@Injectable()
export class ProductsService {
    constructor(private readonly prisma: PrismaService) { }

    async findAll(userId: string) {
        const products = await this.prisma.product.findMany({
            where: { userId, deletedAt: null },
            include: { images: true },
            orderBy: { createdAt: 'desc' },
        });

        return products.map(product => this.toResponse(product));
    }

    async findOne(userId: string, id: string) {
        const product = await this.prisma.product.findFirst({
            where: { id, userId, deletedAt: null },
            include: { images: true },
        });

        if (!product) {
            throw new NotFoundException('Product not found');
        }

        return this.toResponse(product);
    }

    async create(userId: string, dto: CreateProductDto) {
        const baseSlug = generateSlug(dto.name);

        // Find unique slug
        let slug = baseSlug;
        let counter = 1;
        while (true) {
            const existing = await this.prisma.product.findUnique({
                where: { userId_slug: { userId, slug } },
            });
            if (!existing) break;
            slug = `${baseSlug}-${counter}`;
            counter++;
        }

        const product = await this.prisma.product.create({
            data: {
                userId,
                name: dto.name,
                slug,
                imageUrl: dto.imageUrl,
                source: dto.source,
                sourceId: dto.sourceId,
                published: dto.published ?? false,
                images: dto.images?.length
                    ? {
                        create: dto.images.map((img, index) => ({
                            fileUrl: img.url,
                            fileName: img.url.split('/').pop() || 'product-image',
                            userId,
                            source: img.source,
                            sourceId: img.sourceId,
                            isPrimary: img.isPrimary ?? index === 0,
                        })),
                    }
                    : {
                        create: {
                            fileUrl: dto.imageUrl,
                            fileName: dto.imageUrl.split('/').pop() || 'product-image',
                            userId,
                            source: dto.source,
                            sourceId: dto.sourceId,
                            isPrimary: true,
                        },
                    },
            },
            include: { images: true },
        });

        return this.toResponse(product);
    }

    async update(userId: string, id: string, dto: UpdateProductDto) {
        const product = await this.prisma.product.findFirst({
            where: { id, userId, deletedAt: null },
        });

        if (!product) {
            throw new NotFoundException('Product not found');
        }

        // If name changed, regenerate slug
        let slug = product.slug;
        if (dto.name && dto.name !== product.name) {
            const baseSlug = generateSlug(dto.name);
            slug = baseSlug;
            let counter = 1;
            while (true) {
                const existing = await this.prisma.product.findFirst({
                    where: { userId, slug, id: { not: id } },
                });
                if (!existing) break;
                slug = `${baseSlug}-${counter}`;
                counter++;
            }
        }

        const updated = await this.prisma.product.update({
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
        const product = await this.prisma.product.findFirst({
            where: { id, userId, deletedAt: null },
        });

        if (!product) {
            throw new NotFoundException('Product not found');
        }

        await this.prisma.product.update({
            where: { id },
            data: { deletedAt: new Date() },
        });

        return { success: true };
    }

    async addImage(userId: string, productId: string, dto: AddProductImageDto) {
        const product = await this.prisma.product.findFirst({
            where: { id: productId, userId, deletedAt: null },
        });

        if (!product) {
            throw new NotFoundException('Product not found');
        }

        // If this is marked as primary, unmark others
        if (dto.isPrimary) {
            await this.prisma.r2File.updateMany({
                where: { productId },
                data: { isPrimary: false },
            });
        }

        const image = await this.prisma.r2File.create({
            data: {
                productId,
                fileUrl: dto.url,
                fileName: dto.url.split('/').pop() || 'product-image',
                userId, // Need to make sure userId is passed.
                source: dto.source,
                sourceId: dto.sourceId,
                isPrimary: dto.isPrimary ?? false,
            },
        });

        // Update product's primary imageUrl if this is primary
        if (dto.isPrimary) {
            await this.prisma.product.update({
                where: { id: productId },
                data: { imageUrl: dto.url },
            });
        }

        return image;
    }

    async removeImage(userId: string, productId: string, imageId: string) {
        const product = await this.prisma.product.findFirst({
            where: { id: productId, userId, deletedAt: null },
            include: { images: true },
        });

        if (!product) {
            throw new NotFoundException('Product not found');
        }

        const image = product.images.find(img => img.id === imageId);
        if (!image) {
            throw new NotFoundException('Image not found');
        }

        // Don't allow deleting the last image
        if (product.images.length <= 1) {
            throw new Error('Cannot delete the last image');
        }

        await this.prisma.r2File.delete({
            where: { id: imageId },
        });

        // If deleted image was primary, set another as primary
        if (image.isPrimary) {
            const remaining = product.images.filter(img => img.id !== imageId);
            if (remaining.length > 0) {
                await this.prisma.r2File.update({
                    where: { id: remaining[0].id },
                    data: { isPrimary: true },
                });
                await this.prisma.product.update({
                    where: { id: productId },
                    data: { imageUrl: remaining[0].fileUrl },
                });
            }
        }

        return { success: true };
    }

    private toResponse(product: any) {
        const primaryImage = product.images?.find((img: any) => img.isPrimary) || product.images?.[0];

        return {
            id: product.id,
            slug: product.slug,
            name: product.name,
            imageUrl: product.imageUrl,
            source: product.source,
            sourceId: product.sourceId,
            published: product.published,
            createdAt: product.createdAt.toISOString(),
            updatedAt: product.updatedAt.toISOString(),
            primaryImageId: primaryImage?.id || null,
            images: product.images?.map((img: any) => ({
                id: img.id,
                url: img.fileUrl,
                source: img.source,
                sourceId: img.sourceId,
                createdAt: img.createdAt.toISOString(),
            })) || [],
        };
    }
}
