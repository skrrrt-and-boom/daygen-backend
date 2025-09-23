import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';

@UseGuards(JwtAuthGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  create(
    @CurrentUser() user: SanitizedUser,
    @Body() createTemplateDto: CreateTemplateDto,
  ) {
    return this.templatesService.create(user.authUserId, createTemplateDto);
  }

  @Get()
  findAll(@CurrentUser() user: SanitizedUser) {
    return this.templatesService.findAll(user.authUserId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: SanitizedUser, @Param('id') id: string) {
    return this.templatesService.findOne(user.authUserId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: SanitizedUser,
    @Param('id') id: string,
    @Body() updateTemplateDto: UpdateTemplateDto,
  ) {
    return this.templatesService.update(user.authUserId, id, updateTemplateDto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: SanitizedUser, @Param('id') id: string) {
    return this.templatesService.remove(user.authUserId, id);
  }
}
