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
  ) { }

  async createLocalUser(input: CreateLocalUserInput): Promise<PrismaUser> {
    const authUserId = randomUUID();
    const normalizedEmail = normalizeEmailValue(input.email);

    return this.prisma.user.create({
      data: {
        id: randomUUID(),
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
        authUserId: true,
        email: true,
        displayName: true,
        credits: true,
        profileImage: true,
        bio: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        // Exclude passwordHash for security
      },
    }) as Promise<PrismaUser | null>;
  }

  async findById(authUserId: string): Promise<PrismaUser> {
    const user = await this.prisma.user.findUnique({ where: { authUserId } });
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
    patch: { displayName?: string | null; profileImage?: string | null; bio?: string | null; username?: string | null },
  ): Promise<SanitizedUser> {
    // Build update data object with only the fields that were explicitly provided
    const updateData: Prisma.UserUpdateInput = {};

    // Only update displayName if it was explicitly provided in the patch
    if (patch.displayName !== undefined) {
      updateData.displayName = patch.displayName?.trim() || null;
    }

    // Only update bio if it was explicitly provided in the patch
    if (patch.bio !== undefined) {
      updateData.bio = patch.bio ?? null;
    }

    // Only update profileImage if it was explicitly provided in the patch
    // This prevents accidental deletion of profile pictures when updating name/bio
    if (patch.profileImage !== undefined) {
      updateData.profileImage = patch.profileImage ?? null;
    }

    // Only update username if it was explicitly provided in the patch
    if (patch.username !== undefined) {
      updateData.username = patch.username?.toLowerCase().trim() || null;
    }

    const user = await this.prisma.user.update({
      where: { authUserId },
      data: updateData,
    });

    return this.toSanitizedUser(user);
  }

  async uploadProfilePicture(
    authUserId: string,
    base64Data: string,
    mimeType?: string,
  ): Promise<SanitizedUser> {
    console.log(
      `[ProfilePicture] Starting upload for user ${authUserId}, data length: ${base64Data.length}, mimeType: ${mimeType || 'default (image/png)'}`,
    );

    // Get current user to check for existing profile image
    const currentUser = await this.findByAuthUserId(authUserId);

    // Delete old profile picture from R2 if exists
    if (currentUser.profileImage) {
      // Skip deletion for base64 URLs (shouldn't be in R2)
      if (this.r2Service.isBase64Url(currentUser.profileImage)) {
        console.log(
          'Skipping deletion of base64 profile image URL (not stored in R2)',
        );
      } else if (this.r2Service.validateR2Url(currentUser.profileImage)) {
        // Only attempt deletion for valid R2 URLs
        try {
          const deleted = await this.r2Service.deleteFile(
            currentUser.profileImage,
          );
          if (deleted) {
            console.log(
              'Successfully deleted old profile picture from R2:',
              currentUser.profileImage,
            );
          } else {
            console.warn(
              'Failed to delete old profile picture from R2 (returned false):',
              currentUser.profileImage,
            );
          }
        } catch (error) {
          console.error('Error deleting old profile picture from R2:', error);
          // Continue even if deletion fails - don't block the upload
        }
      } else {
        console.log(
          'Skipping deletion of non-R2 profile image URL:',
          currentUser.profileImage,
        );
      }
    }

    // Upload new profile picture to R2
    const profileImageUrl = await this.r2Service.uploadBase64Image(
      base64Data,
      mimeType || 'image/png',
      'profile-pictures',
    );

    console.log(`[ProfilePicture] Uploaded to R2: ${profileImageUrl}`);

    // Update user record with new profile image URL
    const updatedUser = await this.prisma.user.update({
      where: { authUserId },
      data: { profileImage: profileImageUrl },
    });

    console.log(
      `[ProfilePicture] Database updated for user ${authUserId}, profileImage: ${updatedUser.profileImage}`,
    );

    return this.toSanitizedUser(updatedUser);
  }

  async removeProfilePicture(authUserId: string): Promise<SanitizedUser> {
    const currentUser = await this.findByAuthUserId(authUserId);

    // Delete profile picture from R2 if exists
    if (currentUser.profileImage) {
      // Skip deletion for base64 URLs (shouldn't be in R2)
      if (this.r2Service.isBase64Url(currentUser.profileImage)) {
        console.log(
          'Skipping deletion of base64 profile image URL (not stored in R2)',
        );
      } else if (this.r2Service.validateR2Url(currentUser.profileImage)) {
        // Only attempt deletion for valid R2 URLs
        try {
          const deleted = await this.r2Service.deleteFile(
            currentUser.profileImage,
          );
          if (deleted) {
            console.log(
              'Successfully deleted profile picture from R2:',
              currentUser.profileImage,
            );
          } else {
            console.warn(
              'Failed to delete profile picture from R2 (returned false):',
              currentUser.profileImage,
            );
          }
        } catch (error) {
          console.error('Error deleting profile picture from R2:', error);
          // Continue even if deletion fails - don't block the removal
        }
      } else {
        console.log(
          'Skipping deletion of non-R2 profile image URL:',
          currentUser.profileImage,
        );
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

    // First, try to find existing user by authUserId
    const existingUser = await this.prisma.user.findUnique({
      where: { authUserId: authUser.id },
    });

    // Build update payload with safe rules
    // - Always update email and optionally display name
    // - Only update profileImage from metadata when creating a new user
    // - For existing users, only change profileImage if an explicit override was provided
    const updateData: Prisma.UserUpdateInput = {
      email: normalizedEmail,
    };

    if (desiredDisplayName !== undefined) {
      updateData.displayName = desiredDisplayName;
    }

    if (!existingUser) {
      // New user: allow setting profile image from desiredProfileImage (metadata or override)
      updateData.profileImage = desiredProfileImage;
    } else if (options.profileImage !== undefined) {
      // Existing user: only update if explicitly provided by caller (e.g., profile upload)
      updateData.profileImage = options.profileImage;
    }

    if (existingUser) {
      // Update existing user
      await this.prisma.user.update({
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
        await this.prisma.user.update({
          where: { email: normalizedEmail },
          data: {
            ...updateData,
            authUserId: authUser.id,
          },
        });
      } else {
        // Create new user
        await this.prisma.user.create({
          data: {
            id: randomUUID(),
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

    // Always fetch the latest user data from database to ensure we have current credits
    const latestUser = await this.prisma.user.findUnique({
      where: { authUserId: authUser.id },
    });

    if (!latestUser) {
      throw new Error('Failed to fetch user after upsert');
    }

    return this.toSanitizedUser(latestUser);
  }

  toSanitizedUser(user: PrismaUser & { subscription?: any }): SanitizedUser {
    return {
      id: user.authUserId,
      authUserId: user.authUserId,
      email: normalizeEmailValue(user.email),
      username: (user as any).username ?? null,
      displayName: user.displayName ?? null,
      credits: user.credits,
      profileImage: user.profileImage ?? null,
      bio: (user as any).bio ?? null,
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
          createdAt: user.subscription.createdAt,
        }
        : null,
    };
  }

  /**
   * Find a user by their username (for public profile URLs)
   */
  async findByUsername(username: string): Promise<SanitizedUser | null> {
    const normalizedUsername = username.toLowerCase().trim();
    const user = await this.prisma.user.findFirst({
      where: { username: normalizedUsername },
      include: { subscription: true },
    });

    if (!user) {
      return null;
    }

    return this.toSanitizedUser(user);
  }

  private extractString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    return null;
  }
}
