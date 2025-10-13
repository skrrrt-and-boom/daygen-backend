import { Injectable } from '@nestjs/common';
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
      throw new Error('Missing Supabase configuration. Please set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY environment variables.');
    }

    // Client for user operations (uses anon key)
    this.supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Admin client for server-side operations (uses service role key)
    this.supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }

  getAdminClient(): SupabaseClient {
    return this.supabaseAdmin;
  }

  // Helper method to get user from JWT token
  async getUserFromToken(token: string) {
    const { data: { user }, error } = await this.supabaseAdmin.auth.getUser(token);
    if (error) throw error;
    return user;
  }

  // Helper method to create user in our custom users table
  async createUserProfile(authUser: any, additionalData: any = {}) {
    const { data, error } = await this.supabaseAdmin
      .from('User')
      .insert({
        id: authUser.id,
        email: authUser.email,
        authUserId: authUser.id,
        displayName: additionalData.displayName || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        credits: 20,
        role: 'USER'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Helper method to get user profile
  async getUserProfile(authUserId: string) {
    const { data, error } = await this.supabaseAdmin
      .from('User')
      .select('*')
      .eq('authUserId', authUserId)
      .single();

    if (error) throw error;
    return data;
  }

  // Helper method to update user profile
  async updateUserProfile(authUserId: string, updates: any) {
    const { data, error } = await this.supabaseAdmin
      .from('User')
      .update({
        ...updates,
        updatedAt: new Date().toISOString()
      })
      .eq('authUserId', authUserId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}
