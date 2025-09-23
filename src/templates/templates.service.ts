import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService) {}

  create(ownerAuthId: string, createTemplateDto: CreateTemplateDto) {
    return this.prisma.template.create({
      data: {
        ...createTemplateDto,
        ownerAuthId,
      },
    });
  }

  findAll(ownerAuthId: string) {
    return this.prisma.template.findMany({
      where: { ownerAuthId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(ownerAuthId: string, id: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, ownerAuthId },
    });
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    return template;
  }

  async update(
    ownerAuthId: string,
    id: string,
    updateTemplateDto: UpdateTemplateDto,
  ) {
    await this.ensureOwnership(ownerAuthId, id);
    return this.prisma.template.update({
      where: { id },
      data: updateTemplateDto,
    });
  }

  async remove(ownerAuthId: string, id: string) {
    await this.ensureOwnership(ownerAuthId, id);
    return this.prisma.template.delete({ where: { id } });
  }

  private async ensureOwnership(ownerAuthId: string, id: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, ownerAuthId },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    return template;
  }
}
