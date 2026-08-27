import { createClient, type User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
  );
}

const configuredSupabaseUrl = supabaseUrl;
const configuredSupabaseKey = supabaseKey;

type ApiAuthentication =
  | { user: User; supabase: ReturnType<typeof createClient> }
  | { response: Response };

function unauthorized(message: string) {
  return Response.json({ error: message }, { status: 401 });
}

export async function authenticateApiRequest(
  request: Request
): Promise<ApiAuthentication> {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return { response: unauthorized("A bearer access token is required.") };
  }

  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken) {
    return { response: unauthorized("A bearer access token is required.") };
  }

  // Verify the token remotely rather than decoding it locally, so expired or
  // revoked Supabase sessions cannot reach downstream RLS-protected calls.
  const verifier = createClient(configuredSupabaseUrl, configuredSupabaseKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data, error } = await verifier.auth.getUser(accessToken);

  if (error || !data.user) {
    return { response: unauthorized("The bearer access token is invalid.") };
  }

  return {
    user: data.user,
    supabase: createClient(configuredSupabaseUrl, configuredSupabaseKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    }),
  };
}
