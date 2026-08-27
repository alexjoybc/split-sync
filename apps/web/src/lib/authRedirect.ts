// Where to send the organizer after they finish signing in.
//
// This is deliberately NOT passed as a `?next=` query string on the
// Supabase `redirectTo`/`emailRedirectTo` URL. Supabase Auth validates
// that URL against the project's Redirect URL allow-list, and an
// unlisted query string fails that check — Supabase then silently
// falls back to the Site URL (the marketing home page) with no
// session, which looks exactly like "sign in did nothing". Storing the
// destination client-side and reading it back in the callback page
// keeps `redirectTo` a bare, always-allow-listed URL.
const STORAGE_KEY = "splitsync.auth.next";

export function setPendingAuthRedirect(next: string) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, next);
  } catch {
    // sessionStorage can throw in locked-down/private browsing contexts;
    // the callback page falls back to a sane default when this is unset.
  }
}

export function consumePendingAuthRedirect(fallback: string): string {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    if (value) window.sessionStorage.removeItem(STORAGE_KEY);
    return value || fallback;
  } catch {
    return fallback;
  }
}
