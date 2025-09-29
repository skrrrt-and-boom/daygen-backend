import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLocalUserInput, SanitizedUser } from './types';
import { User } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const normalizeEmailValue = (email: string): string =>
  email.trim().toLowerCase();

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createLocalUser(input: CreateLocalUserInput): Promise<User> {
    const authUserId = randomUUID();
    const normalizedEmail = normalizeEmailValue(input.email);

    return this.prisma.user.create({
      data: {
        email: normalizedEmail,
        authUserId,
        passwordHash: input.passwordHash,
        displayName: input.displayName?.trim() || null,
        credits: 3, // 3 free credits for new accounts
        role: 'USER',
      },
    });
  }

  async findByEmailWithSecret(email: string): Promise<User | null> {
    const normalizedEmail = normalizeEmailValue(email);
    return this.prisma.user.findUnique({ where: { email: normalizedEmail } });
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

  async listBalances(limit = 100) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const users = await this.prisma.user.findMany({
      orderBy: [{ credits: 'asc' }, { createdAt: 'asc' }],
      take: safeLimit,
    });

    return users.map((user) => this.toSanitizedUser(user));
  }

  async updateProfile(
    authUserId: string,
    patch: { displayName?: string | null; profileImage?: string | null },
  ): Promise<SanitizedUser> {
    const user = await this.prisma.user.update({
      where: { authUserId },
      data: {
        displayName: patch.displayName?.trim() || null,
        profileImage: patch.profileImage ?? null,
      },
    });

    return this.toSanitizedUser(user);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  toSanitizedUser(user: User): SanitizedUser {
    return {
      id: user.id,
      authUserId: user.authUserId,
      email: normalizeEmailValue(user.email),
      displayName: user.displayName ?? null,
      credits: user.credits,
      profileImage: user.profileImage ?? null,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
