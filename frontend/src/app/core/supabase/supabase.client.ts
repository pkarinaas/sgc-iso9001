import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

/** Shared Supabase client instance (singleton). */
export const supabase: SupabaseClient = createClient(
  environment.supabase.url,
  environment.supabase.anonKey,
);
