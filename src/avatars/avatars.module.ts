import { Module } from '@nestjs/common';
import { AvatarsController } from './avatars.controller';
import { AvatarsService } from './avatars.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [AvatarsController],
    providers: [AvatarsService],
    exports: [AvatarsService],
})
export class AvatarsModule { }
