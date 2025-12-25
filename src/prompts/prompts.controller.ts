import {
    Body,
    Controller,
    Delete,
    Get,
    NotFoundException,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { PromptType } from '@prisma/client';
import { PromptsService } from './prompts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';
import { CreatePromptDto } from './dto/create-prompt.dto';
import { UpdatePromptDto } from './dto/update-prompt.dto';

@Controller('prompts')
@UseGuards(JwtAuthGuard)
export class PromptsController {
    constructor(private readonly promptsService: PromptsService) { }

    /**
     * List prompts by type
     * GET /prompts?type=SAVED or GET /prompts?type=RECENT
     */
    @Get()
    async listPrompts(
        @CurrentUser() user: SanitizedUser,
        @Query('type') type: PromptType = PromptType.SAVED,
        @Query('limit') limitStr?: string,
    ) {
        const limit = limitStr ? Math.min(parseInt(limitStr, 10), 100) : 50;
        return this.promptsService.listPrompts(user.authUserId, type, limit);
    }

    /**
     * Create or upsert a prompt
     * POST /prompts
     */
    @Post()
    async createPrompt(
        @CurrentUser() user: SanitizedUser,
        @Body() dto: CreatePromptDto,
    ) {
        return this.promptsService.upsertPrompt(user.authUserId, dto.text, dto.type);
    }

    /**
     * Update a prompt's text
     * PATCH /prompts/:id
     */
    @Patch(':id')
    async updatePrompt(
        @CurrentUser() user: SanitizedUser,
        @Param('id') id: string,
        @Body() dto: UpdatePromptDto,
    ) {
        const result = await this.promptsService.updatePrompt(user.authUserId, id, dto.text);
        if (!result) {
            throw new NotFoundException('Prompt not found');
        }
        return result;
    }

    /**
     * Delete a prompt by ID
     * DELETE /prompts/:id
     */
    @Delete(':id')
    async deletePrompt(
        @CurrentUser() user: SanitizedUser,
        @Param('id') id: string,
    ) {
        const result = await this.promptsService.deletePrompt(user.authUserId, id);
        if (!result) {
            throw new NotFoundException('Prompt not found');
        }
        return result;
    }

    /**
     * Delete a prompt by text (for easier frontend integration)
     * DELETE /prompts/by-text?text=...&type=SAVED
     */
    @Delete('by-text')
    async deletePromptByText(
        @CurrentUser() user: SanitizedUser,
        @Query('text') text: string,
        @Query('type') type: PromptType = PromptType.SAVED,
    ) {
        if (!text) {
            throw new NotFoundException('Text is required');
        }
        const result = await this.promptsService.deletePromptByText(user.authUserId, text, type);
        if (!result) {
            throw new NotFoundException('Prompt not found');
        }
        return result;
    }

    /**
     * Check if a specific prompt is saved
     * GET /prompts/is-saved?text=...
     */
    @Get('is-saved')
    async isPromptSaved(
        @CurrentUser() user: SanitizedUser,
        @Query('text') text: string,
    ) {
        if (!text) {
            return { isSaved: false };
        }
        const isSaved = await this.promptsService.isPromptSaved(user.authUserId, text);
        return { isSaved };
    }
}
