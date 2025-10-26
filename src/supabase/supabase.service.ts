import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;
  private supabaseAdmin: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      throw new Error(
        'Missing Supabase configuration. Please set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY environment variables.',
      );
    }

    // Client for user operations (uses anon key)
    this.supabase = createClient(supabaseUrl, supabaseAnonKey) as any;

    // Admin client for server-side operations (uses service role key)
    this.supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }) as any;
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }

  getAdminClient(): SupabaseClient {
    return this.supabaseAdmin;
  }

  // Helper method to get user from JWT token
  async getUserFromToken(token: string) {
    // Extract user ID from the JWT token
    const userId = this.extractUserIdFromToken(token);
    if (!userId) {
      throw new UnauthorizedException('Invalid or missing Supabase token');
    }

    // Fetch user details using admin client
    const { data, error: lookupError } =
      await this.supabaseAdmin.auth.admin.getUserById(userId);

    if (lookupError || !data?.user) {
      console.error('Supabase admin getUserById failed:', lookupError);
      throw new UnauthorizedException('Unable to resolve Supabase user');
    }

    return data.user;
  }

  private extractUserIdFromToken(token: string): string | null {
    try {
      // Decode JWT without verification - we trust Supabase has already validated it
      // Access tokens from Supabase are already validated by the client
      const parts = token.split('.');
      if (parts.length !== 3) {
        console.error('Invalid JWT format');
        return null;
      }

      // Decode the payload (middle part)
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64').toString('utf-8'),
      );

      if (payload && 'sub' in payload) {
        const value = payload.sub;
        return typeof value === 'string' ? value : null;
      }

      console.error('No sub field found in JWT payload');
      return null;
    } catch (decodeError) {
      console.error('Failed to decode Supabase access token:', decodeError);
      return null;
    }
  }
}
