import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLocalUserInput, SanitizedUser } from './types';
import { User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { R2Service } from '../upload/r2.service';

const normalizeEmailValue = (email: string): string =>
  email.trim().toLowerCase();

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Service: R2Service,
  ) {}

  async createLocalUser(input: CreateLocalUserInput): Promise<User> {
    const authUserId = randomUUID();
    const normalizedEmail = normalizeEmailValue(input.email);

    return this.prisma.user.create({
      data: {
        id: authUserId, // Use authUserId as the primary key
        email: normalizedEmail,
        authUserId,
        displayName: input.displayName?.trim() || null,
        credits: 20, // 20 free credits for new accounts
        role: 'USER',
      },
    });
  }

  async findByEmailWithSecret(email: string): Promise<User | null> {
    const normalizedEmail = normalizeEmailValue(email);
    return this.prisma.user.findUnique({ where: { email: normalizedEmail } });
  }

  async findByEmail(email: string): Promise<User | null> {
    const normalizedEmail = normalizeEmailValue(email);
    return this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        authUserId: true,
        email: true,
        displayName: true,
        credits: true,
        profileImage: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        // Exclude passwordHash for security
      },
    }) as Promise<User | null>;
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

  async uploadProfilePicture(
    authUserId: string,
    base64Data: string,
    mimeType?: string,
  ): Promise<SanitizedUser> {
    // Get current user to check for existing profile image
    const currentUser = await this.findByAuthUserId(authUserId);

    // Delete old profile picture from R2 if exists
    if (currentUser.profileImage) {
      try {
        await this.r2Service.deleteFile(currentUser.profileImage);
      } catch (error) {
        console.error('Failed to delete old profile picture:', error);
        // Continue even if deletion fails
      }
    }

    // Upload new profile picture to R2
    const profileImageUrl = await this.r2Service.uploadBase64Image(
      base64Data,
      mimeType || 'image/png',
      'profile-pictures',
    );

    // Update user record with new profile image URL
    const updatedUser = await this.prisma.user.update({
      where: { authUserId },
      data: { profileImage: profileImageUrl },
    });

    return this.toSanitizedUser(updatedUser);
  }

  async removeProfilePicture(authUserId: string): Promise<SanitizedUser> {
    const currentUser = await this.findByAuthUserId(authUserId);

    // Delete profile picture from R2 if exists
    if (currentUser.profileImage) {
      try {
        await this.r2Service.deleteFile(currentUser.profileImage);
      } catch (error) {
        console.error('Failed to delete profile picture from R2:', error);
        // Continue even if deletion fails
      }
    }

    // Update user record to remove profile image
    const updatedUser = await this.prisma.user.update({
      where: { authUserId },
      data: { profileImage: null },
    });

    return this.toSanitizedUser(updatedUser);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    // This method is deprecated - password management is now handled by Supabase Auth
    throw new Error('Password updates are now handled by Supabase Auth');
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
