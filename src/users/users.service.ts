import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLocalUserInput, SanitizedUser } from './types';
import { Prisma, User as PrismaUser } from '@prisma/client';
import type { User as SupabaseAuthUser } from '@supabase/supabase-js';
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

  async createLocalUser(input: CreateLocalUserInput): Promise<PrismaUser> {
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

  async findByEmailWithSecret(email: string): Promise<PrismaUser | null> {
    const normalizedEmail = normalizeEmailValue(email);
    return this.prisma.user.findUnique({ where: { email: normalizedEmail } });
  }

  async findByEmail(email: string): Promise<PrismaUser | null> {
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
    }) as Promise<PrismaUser | null>;
  }

  async findById(id: string): Promise<PrismaUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByAuthUserId(
    authUserId: string,
  ): Promise<PrismaUser & { subscription?: any }> {
    const user = await this.prisma.user.findUnique({
      where: { authUserId },
      include: { subscription: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByAuthUserIdOrNull(
    authUserId: string,
  ): Promise<(PrismaUser & { subscription?: any }) | null> {
    return this.prisma.user.findUnique({
      where: { authUserId },
      include: { subscription: true },
    });
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

  updatePassword(): Promise<void> {
    // This method is deprecated - password management is now handled by Supabase Auth
    throw new Error('Password updates are now handled by Supabase Auth');
  }

  async upsertFromSupabaseUser(
    authUser: SupabaseAuthUser,
    options: {
      displayName?: string | null;
      profileImage?: string | null;
      credits?: number;
    } = {},
  ): Promise<SanitizedUser> {
    if (!authUser?.id) {
      throw new Error('Supabase user is missing an id');
    }

    const normalizedEmail = authUser.email
      ? normalizeEmailValue(authUser.email)
      : `${authUser.id}@supabase.local`;

    const metadata = (authUser.user_metadata ?? {}) as Record<string, unknown>;
    const metaDisplayName = this.extractString(
      metadata.display_name ?? metadata.full_name,
    );
    const metaAvatarUrl = this.extractString(metadata.avatar_url);

    const desiredDisplayName =
      options.displayName?.trim() ||
      metaDisplayName ||
      (authUser.email ? authUser.email.split('@')[0] : null);

    const desiredProfileImage = options.profileImage ?? metaAvatarUrl ?? null;

    const updateData: Prisma.UserUpdateInput = {
      email: normalizedEmail,
    };

    if (desiredDisplayName !== undefined) {
      updateData.displayName = desiredDisplayName;
    }

    if (desiredProfileImage !== undefined) {
      updateData.profileImage = desiredProfileImage;
    }

    // First, try to find existing user by authUserId
    let user = await this.prisma.user.findUnique({
      where: { authUserId: authUser.id },
    });

    if (user) {
      // Update existing user
      user = await this.prisma.user.update({
        where: { authUserId: authUser.id },
        data: updateData,
      });
    } else {
      // Check if user exists with same email but different authUserId
      const existingUserByEmail = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (existingUserByEmail) {
        // Update the existing user with the new authUserId
        user = await this.prisma.user.update({
          where: { email: normalizedEmail },
          data: {
            ...updateData,
            id: authUser.id,
            authUserId: authUser.id,
          },
        });
      } else {
        // Create new user
        user = await this.prisma.user.create({
          data: {
            id: authUser.id,
            authUserId: authUser.id,
            email: normalizedEmail,
            displayName: desiredDisplayName ?? null,
            profileImage: desiredProfileImage,
            credits:
              options.credits !== undefined && options.credits !== null
                ? options.credits
                : 20,
            role: 'USER',
          },
        });
      }
    }

    return this.toSanitizedUser(user);
  }

  toSanitizedUser(user: PrismaUser & { subscription?: any }): SanitizedUser {
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
      subscription: user.subscription
        ? {
            id: user.subscription.id,
            status: user.subscription.status,
            currentPeriodStart: user.subscription.currentPeriodStart,
            currentPeriodEnd: user.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
            credits: user.subscription.credits,
            createdAt: user.subscription.createdAt,
          }
        : null,
    };
  }

  private extractString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    return null;
  }
}
