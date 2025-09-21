import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLocalUserInput, SanitizedUser } from './types';
import { User } from '@prisma/client';
import { randomUUID } from 'node:crypto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createLocalUser(input: CreateLocalUserInput): Promise<User> {
    const authUserId = randomUUID();

    return this.prisma.user.create({
      data: {
        email: input.email,
        authUserId,
        passwordHash: input.passwordHash,
        displayName: input.displayName?.trim() || null,
        credits: 200, // starter credits for new accounts
      },
    });
  }

  async findByEmailWithSecret(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByAuthUserId(authUserId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { authUserId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateProfile(authUserId: string, patch: { displayName?: string | null; profileImage?: string | null }): Promise<SanitizedUser> {
    const user = await this.prisma.user.update({
      where: { authUserId },
      data: {
        displayName: patch.displayName?.trim() || null,
        profileImage: patch.profileImage ?? null,
      },
    });

    return this.toSanitizedUser(user);
  }

  toSanitizedUser(user: User): SanitizedUser {
    return {
      id: user.id,
      authUserId: user.authUserId,
      email: user.email,
      displayName: user.displayName ?? null,
      credits: user.credits,
      profileImage: user.profileImage ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
