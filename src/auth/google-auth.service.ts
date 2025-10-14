import { Injectable, BadRequestException } from '@nestjs/common';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class GoogleAuthService {
  private oauth2Client: OAuth2Client;

  constructor(private readonly supabaseService: SupabaseService) {
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
  async createOrUpdateUser(googleUserInfo: TokenPayload) {
    try {
      if (!googleUserInfo.email || !googleUserInfo.sub) {
        throw new BadRequestException('Invalid Google user information');
      }

      // Try to find existing user in our database first
      let existingProfile;
      try {
        // Check if user exists in our custom User table by email
        const { data: users, error: findError } = await this.supabaseService
          .getAdminClient()
          .from('User')
          .select('*')
          .eq('email', googleUserInfo.email)
          .limit(1);

        if (findError) {
          console.error('Error finding user by email:', findError);
        } else if (users && users.length > 0) {
          existingProfile = users[0];
        }
      } catch (error) {
        console.error('Error checking existing user:', error);
      }

      let authUser;
      if (existingProfile) {
        // User exists in our database, use their auth ID
        authUser = {
          id: existingProfile.id,
          email: existingProfile.email,
          user_metadata: {
            full_name: googleUserInfo.name,
            avatar_url: googleUserInfo.picture,
            provider: 'google',
            google_id: googleUserInfo.sub,
          },
        };
      } else {
        // Create new user using Supabase admin
        const { data: newUser, error: createError } = await this.supabaseService
          .getAdminClient()
          .auth.admin.createUser({
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

      // Ensure user profile exists in our custom User table
      try {
        const profile = await this.supabaseService.getUserProfile(authUser.id);
        return { authUser, profile };
      } catch (profileError) {
        // Create user profile if it doesn't exist
        const profile = await this.supabaseService.createUserProfile(authUser, {
          displayName: googleUserInfo.name || 'Google User',
        });
        return { authUser, profile };
      }
    } catch (error) {
      console.error('Error creating/updating user:', error);
      throw new BadRequestException('Failed to create user account');
    }
  }

  /**
   * Complete Google authentication flow with ID token verification
   */
  async authenticateWithIdToken(idToken: string) {
    // Verify the ID token
    const googleUserInfo = await this.verifyIdToken(idToken);
    
    // Create or update user in our system
    const { authUser, profile } = await this.createOrUpdateUser(googleUserInfo);

    // Generate a session token for the user
    const { data: sessionData, error: sessionError } = await this.supabaseService
      .getAdminClient()
      .auth.admin.generateLink({
        type: 'magiclink',
        email: authUser.email!,
        options: {
          redirectTo: `${process.env.FRONTEND_URL}/auth/callback`,
        },
      });

    if (sessionError) {
      console.error('Error generating session:', sessionError);
      throw sessionError;
    }

    // Extract tokens from the generated link
    const link = sessionData.properties?.action_link;
    const url = new URL(link);
    const accessToken = url.searchParams.get('access_token');
    const refreshToken = url.searchParams.get('refresh_token');

    return {
      user: authUser,
      profile,
      accessToken: accessToken || '',
      refreshToken: refreshToken || '',
    };
  }
}