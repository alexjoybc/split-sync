import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Solo-stopwatch mode does not use Supabase at all, so it must keep working
 * with no `.env` file. Only the shared-session ("Time Together") feature
 * needs real credentials. Rather than throwing at import time (which would
 * crash the whole app before the user even picks solo vs. shared), fall back
 * to a harmless placeholder client and expose `isSupabaseConfigured` so
 * call sites can gate shared-session UI/behavior instead.
 */
export const isSupabaseConfigured = Boolean(url && key);

export const supabase = createClient(
  url ?? "https://placeholder.invalid",
  key ?? "public-anon-placeholder-key",
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  }
);
