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

    async findAll(ownerAuthId: string) {
        const products = await this.prisma.product.findMany({
            where: { ownerAuthId, deletedAt: null },
            include: { images: true },
            orderBy: { createdAt: 'desc' },
        });

        return products.map(product => this.toResponse(product));
    }

    async findOne(ownerAuthId: string, id: string) {
        const product = await this.prisma.product.findFirst({
            where: { id, ownerAuthId, deletedAt: null },
            include: { images: true },
        });

        if (!product) {
            throw new NotFoundException('Product not found');
        }

        return this.toResponse(product);
    }

    async create(ownerAuthId: string, dto: CreateProductDto) {
        const baseSlug = generateSlug(dto.name);

        // Find unique slug
        let slug = baseSlug;
        let counter = 1;
        while (true) {
            const existing = await this.prisma.product.findUnique({
                where: { ownerAuthId_slug: { ownerAuthId, slug } },
            });
            if (!existing) break;
            slug = `${baseSlug}-${counter}`;
            counter++;
        }

        const product = await this.prisma.product.create({
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

        return this.toResponse(product);
    }

    async update(ownerAuthId: string, id: string, dto: UpdateProductDto) {
        const product = await this.prisma.product.findFirst({
            where: { id, ownerAuthId, deletedAt: null },
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
                    where: { ownerAuthId, slug, id: { not: id } },
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

    async delete(ownerAuthId: string, id: string) {
        const product = await this.prisma.product.findFirst({
            where: { id, ownerAuthId, deletedAt: null },
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

    async addImage(ownerAuthId: string, productId: string, dto: AddProductImageDto) {
        const product = await this.prisma.product.findFirst({
            where: { id: productId, ownerAuthId, deletedAt: null },
        });

        if (!product) {
            throw new NotFoundException('Product not found');
        }

        // If this is marked as primary, unmark others
        if (dto.isPrimary) {
            await this.prisma.productImage.updateMany({
                where: { productId },
                data: { isPrimary: false },
            });
        }

        const image = await this.prisma.productImage.create({
            data: {
                productId,
                url: dto.url,
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

    async removeImage(ownerAuthId: string, productId: string, imageId: string) {
        const product = await this.prisma.product.findFirst({
            where: { id: productId, ownerAuthId, deletedAt: null },
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

        await this.prisma.productImage.delete({
            where: { id: imageId },
        });

        // If deleted image was primary, set another as primary
        if (image.isPrimary) {
            const remaining = product.images.filter(img => img.id !== imageId);
            if (remaining.length > 0) {
                await this.prisma.productImage.update({
                    where: { id: remaining[0].id },
                    data: { isPrimary: true },
                });
                await this.prisma.product.update({
                    where: { id: productId },
                    data: { imageUrl: remaining[0].url },
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
                url: img.url,
                source: img.source,
                sourceId: img.sourceId,
                createdAt: img.createdAt.toISOString(),
            })) || [],
        };
    }
}
