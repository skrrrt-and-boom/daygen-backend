import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PromptType } from '@prisma/client';

@Injectable()
export class PromptsService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * List prompts by type for a user
     */
    async listPrompts(userId: string, type: PromptType, limit = 50) {
        return this.prisma.userPrompt.findMany({
            where: { userId, type },
            orderBy: { savedAt: 'desc' },
            take: limit,
            select: {
                id: true,
                text: true,
                type: true,
                savedAt: true,
            },
        });
    }

    /**
     * Create or upsert a prompt (moves existing to top by updating savedAt)
     */
    async upsertPrompt(userId: string, text: string, type: PromptType) {
        const trimmedText = text.trim();

        // For RECENT prompts, enforce a limit of 20 entries
        if (type === PromptType.RECENT) {
            const existingCount = await this.prisma.userPrompt.count({
                where: { userId, type },
            });

            // If at or over limit, delete oldest entries
            if (existingCount >= 20) {
                const oldestPrompts = await this.prisma.userPrompt.findMany({
                    where: { userId, type },
                    orderBy: { savedAt: 'asc' },
                    take: existingCount - 19, // Keep 19 to make room for new one
                    select: { id: true },
                });

                if (oldestPrompts.length > 0) {
                    await this.prisma.userPrompt.deleteMany({
                        where: { id: { in: oldestPrompts.map(p => p.id) } },
                    });
                }
            }
        }

        // Upsert the prompt (create or update savedAt to move to top)
        return this.prisma.userPrompt.upsert({
            where: {
                userId_type_text: { userId, type, text: trimmedText },
            },
            update: {
                savedAt: new Date(),
            },
            create: {
                userId,
                text: trimmedText,
                type,
            },
            select: {
                id: true,
                text: true,
                type: true,
                savedAt: true,
            },
        });
    }

    /**
     * Update prompt text
     */
    async updatePrompt(userId: string, id: string, text: string) {
        const trimmedText = text.trim();

        // First verify the prompt belongs to the user
        const existing = await this.prisma.userPrompt.findFirst({
            where: { id, userId },
        });

        if (!existing) {
            return null;
        }

        return this.prisma.userPrompt.update({
            where: { id },
            data: { text: trimmedText },
            select: {
                id: true,
                text: true,
                type: true,
                savedAt: true,
            },
        });
    }

    /**
     * Delete a prompt
     */
    async deletePrompt(userId: string, id: string) {
        // First verify the prompt belongs to the user
        const existing = await this.prisma.userPrompt.findFirst({
            where: { id, userId },
        });

        if (!existing) {
            return null;
        }

        await this.prisma.userPrompt.delete({
            where: { id },
        });

        return { success: true };
    }

    /**
     * Delete a prompt by text (for frontend compatibility)
     */
    async deletePromptByText(userId: string, text: string, type: PromptType) {
        const trimmedText = text.trim();

        const existing = await this.prisma.userPrompt.findFirst({
            where: { userId, type, text: trimmedText },
        });

        if (!existing) {
            return null;
        }

        await this.prisma.userPrompt.delete({
            where: { id: existing.id },
        });

        return { success: true };
    }

    /**
     * Check if a prompt is saved
     */
    async isPromptSaved(userId: string, text: string): Promise<boolean> {
        const trimmedText = text.trim().toLowerCase();

        const existing = await this.prisma.userPrompt.findFirst({
            where: {
                userId,
                type: PromptType.SAVED,
            },
        });

        if (!existing) {
            return false;
        }

        // Case-insensitive check
        const prompts = await this.prisma.userPrompt.findMany({
            where: { userId, type: PromptType.SAVED },
            select: { text: true },
        });

        return prompts.some(p => p.text.toLowerCase() === trimmedText);
    }
}
