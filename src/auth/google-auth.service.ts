import { Injectable, BadRequestException } from '@nestjs/common';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { SupabaseService } from '../supabase/supabase.service';
import { UsersService } from '../users/users.service';
import type { SanitizedUser } from '../users/types';

interface GoogleAuthResult {
  user: any; // Supabase User type
  profile: SanitizedUser;
  accessToken: string;
  refreshToken: string;
}

interface CreateUserResult {
  authUser: any; // Supabase User type
  profile: SanitizedUser;
}

@Injectable()
export class GoogleAuthService {
  private oauth2Client: OAuth2Client;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly usersService: UsersService,
  ) {
    this.oauth2Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }

  /**
   * Verify Google ID token and get user info
   * This is the secure way to handle Google Sign-In as per Google's documentation
   */
  async verifyIdToken(idToken: string): Promise<TokenPayload> {
    try {
      const ticket = await this.oauth2Client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        throw new BadRequestException('Invalid Google ID token');
      }

      return payload;
    } catch (error) {
      console.error('Google ID token verification error:', error);
      throw new BadRequestException('Invalid Google ID token');
    }
  }

  /**
   * Create or update user in Supabase after Google authentication
   */
  async createOrUpdateUser(
    googleUserInfo: TokenPayload,
  ): Promise<CreateUserResult> {
    try {
      if (!googleUserInfo.email || !googleUserInfo.sub) {
        throw new BadRequestException('Invalid Google user information');
      }

      const adminClient = this.supabaseService.getAdminClient();

      // Try to find existing user in our database first
      const existingProfile = await this.usersService.findByEmailWithSecret(
        googleUserInfo.email,
      );

      let authUser: any;

      if (existingProfile) {
        try {
          const { data, error } = await adminClient.auth.admin.getUserById(
            existingProfile.authUserId,
          );
          if (error) {
            console.error('Error loading existing Supabase user:', error);
          } else {
            authUser = data.user;
          }
        } catch (lookupError) {
          console.error('Failed to look up Supabase auth user:', lookupError);
        }
      }

      if (!authUser) {
        const { data: newUser, error: createError } =
          await adminClient.auth.admin.createUser({
            email: googleUserInfo.email,
            email_confirm: true,
            user_metadata: {
              full_name: googleUserInfo.name,
              avatar_url: googleUserInfo.picture,
              provider: 'google',
              google_id: googleUserInfo.sub,
            },
          });

        if (createError) {
          console.error('Error creating user:', createError);
          throw createError;
        }
        authUser = newUser.user;
      }

      const profile = await this.usersService.upsertFromSupabaseUser(authUser as any, {
        displayName: googleUserInfo.name || 'Google User',
        profileImage: googleUserInfo.picture ?? undefined,
      });

      return { authUser: authUser, profile: profile };
    } catch (error) {
      console.error('Error creating/updating user:', error);
      throw new BadRequestException('Failed to create user account');
    }
  }

  /**
   * Complete Google authentication flow with ID token verification
   */
  async authenticateWithIdToken(idToken: string): Promise<GoogleAuthResult> {
    // Verify the ID token
    const googleUserInfo = await this.verifyIdToken(idToken);

    // Create or update user in our system
    const { authUser, profile } = await this.createOrUpdateUser(googleUserInfo);

    // Generate a session token for the user
    const { data: sessionData, error: sessionError } =
      await this.supabaseService.getAdminClient().auth.admin.generateLink({
        type: 'magiclink',
        email: (authUser as any).email!,
        options: {
          redirectTo: `${process.env.FRONTEND_URL}/auth/callback`,
        },
      });

    if (sessionError) {
      console.error('Error generating session:', sessionError);
      throw sessionError;
    }

    // Extract tokens from the generated link
    const link = (sessionData as { properties?: { action_link?: string } })
      .properties?.action_link;
    if (!link) {
      throw new BadRequestException('Failed to generate authentication link');
    }
    const url = new URL(link);
    const accessToken = url.searchParams.get('access_token');
    const refreshToken = url.searchParams.get('refresh_token');

    return {
      user: authUser as any,
      profile: profile,
      accessToken: accessToken || '',
      refreshToken: refreshToken || '',
    };
  }
}
