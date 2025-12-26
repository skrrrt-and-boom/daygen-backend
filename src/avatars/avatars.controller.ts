import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    UseGuards,
} from '@nestjs/common';
import { AvatarsService } from './avatars.service';
import { CreateAvatarDto, UpdateAvatarDto, AddAvatarImageDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';

@Controller('avatars')
@UseGuards(JwtAuthGuard)
export class AvatarsController {
    constructor(private readonly avatarsService: AvatarsService) { }

    @Get()
    findAll(@CurrentUser() user: SanitizedUser) {
        return this.avatarsService.findAll(user.authUserId);
    }

    @Get(':id')
    findOne(@CurrentUser() user: SanitizedUser, @Param('id') id: string) {
        return this.avatarsService.findOne(user.authUserId, id);
    }

    @Post()
    create(@CurrentUser() user: SanitizedUser, @Body() dto: CreateAvatarDto) {
        return this.avatarsService.create(user.authUserId, dto);
    }

    @Patch(':id')
    update(
        @CurrentUser() user: SanitizedUser,
        @Param('id') id: string,
        @Body() dto: UpdateAvatarDto,
    ) {
        return this.avatarsService.update(user.authUserId, id, dto);
    }

    @Delete(':id')
    delete(@CurrentUser() user: SanitizedUser, @Param('id') id: string) {
        return this.avatarsService.delete(user.authUserId, id);
    }

    @Post(':id/images')
    addImage(
        @CurrentUser() user: SanitizedUser,
        @Param('id') id: string,
        @Body() dto: AddAvatarImageDto,
    ) {
        return this.avatarsService.addImage(user.authUserId, id, dto);
    }

    @Delete(':id/images/:imageId')
    removeImage(
        @CurrentUser() user: SanitizedUser,
        @Param('id') id: string,
        @Param('imageId') imageId: string,
    ) {
        return this.avatarsService.removeImage(user.authUserId, id, imageId);
    }

    @Post(':id/set-me')
    setMeAvatar(
        @CurrentUser() user: SanitizedUser,
        @Param('id') id: string,
    ) {
        return this.avatarsService.setMeAvatar(user.authUserId, id);
    }

    @Post(':id/images/:imageId/set-primary')
    setPrimaryImage(
        @CurrentUser() user: SanitizedUser,
        @Param('id') id: string,
        @Param('imageId') imageId: string,
    ) {
        return this.avatarsService.setPrimaryImage(user.authUserId, id, imageId);
    }
}
