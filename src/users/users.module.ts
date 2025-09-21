import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../prisma/prisma.module'; // 👈 import PrismaModule

@Module({
  imports: [PrismaModule],   // 👈 add it here
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}