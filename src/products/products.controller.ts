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
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto, AddProductImageDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SanitizedUser } from '../users/types';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
    constructor(private readonly productsService: ProductsService) { }

    @Get()
    findAll(@CurrentUser() user: SanitizedUser) {
        return this.productsService.findAll(user.authUserId);
    }

    @Get(':id')
    findOne(@CurrentUser() user: SanitizedUser, @Param('id') id: string) {
        return this.productsService.findOne(user.authUserId, id);
    }

    @Post()
    create(@CurrentUser() user: SanitizedUser, @Body() dto: CreateProductDto) {
        return this.productsService.create(user.authUserId, dto);
    }

    @Patch(':id')
    update(
        @CurrentUser() user: SanitizedUser,
        @Param('id') id: string,
        @Body() dto: UpdateProductDto,
    ) {
        return this.productsService.update(user.authUserId, id, dto);
    }

    @Delete(':id')
    delete(@CurrentUser() user: SanitizedUser, @Param('id') id: string) {
        return this.productsService.delete(user.authUserId, id);
    }

    @Post(':id/images')
    addImage(
        @CurrentUser() user: SanitizedUser,
        @Param('id') id: string,
        @Body() dto: AddProductImageDto,
    ) {
        return this.productsService.addImage(user.authUserId, id, dto);
    }

    @Delete(':id/images/:imageId')
    removeImage(
        @CurrentUser() user: SanitizedUser,
        @Param('id') id: string,
        @Param('imageId') imageId: string,
    ) {
        return this.productsService.removeImage(user.authUserId, id, imageId);
    }
}
