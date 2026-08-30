/**
 * TEST SETUP ONLY — never import this file from app code.
 *
 * Uses the public anon key (not service_role) to sign up and sign in test
 * users against the local Supabase stack. The anon key does not bypass RLS.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export function createTestSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/** Generate a unique email per test run to avoid collisions without a DB reset. */
export function uniqueTestEmail(prefix = 'test'): string {
  return `${prefix}+${Date.now()}@example.com`;
}

export async function createTestOrganizer(email: string, password: string) {
  const client = createTestSupabaseClient();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw new Error(`Failed to create test user: ${error.message}`);
  return data;
}

/**
 * Sign in programmatically.
 *
 * If email confirmation is required (enable_confirmations = true in
 * supabase/config.toml) this will throw with "Email not confirmed". In that
 * case the caller should capture the confirmation email from Mailpit first.
 * For the default local demo stack (enable_confirmations = false) this works
 * immediately after signUp.
 */
export async function signInProgrammatically(email: string, password: string) {
  const client = createTestSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error(`Failed to sign in: ${error.message}`);
  return data;
}
