# Production Setup

## Vercel

Project: `split-sync-web`.

Set these environment variables for Production, Preview, and Development:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Set `splitsync.org` and `www.splitsync.org` to DNS-only CNAME records pointing to the Vercel target shown in the Vercel domain settings. Redirect `www` to the apex domain.

## Supabase

Project ref: `bsihlrzncucrglqltjrc`.

Auth URL configuration:

```text
Site URL: https://splitsync.org
Redirect URLs:
https://splitsync.org/auth/callback
https://splitsync.org/auth/reset-password
http://localhost:3000/auth/callback
http://localhost:3000/auth/reset-password
org.splitsync.tracker://**
```

Google OAuth is the organizer sign-in method. Set it up once:

1. In Google Cloud Console, create (or reuse) a project, then under "APIs & Services -> Credentials" create an **OAuth client ID** of type **Web application**.
2. Add this authorized redirect URI (the Supabase-hosted callback, not the app's `/auth/callback`):
   ```text
   https://bsihlrzncucrglqltjrc.supabase.co/auth/v1/callback
   ```
3. In the Supabase dashboard, go to Authentication -> Sign In / Providers -> Google, enable it, and paste the client ID and client secret from step 1.
4. Configure the OAuth consent screen with the SplitSync name/logo and add `splitsync.org` as an authorized domain.
5. The web login (`/login`) and mobile tracker both call `supabase.auth.signInWithOAuth({ provider: "google" })`; the redirect URLs above already cover the final app-side hop back to `/auth/callback`.

Email/password is a second organizer sign-in option, offered alongside Google. Sign-up confirmation and "forgot password" emails go through the Resend SMTP config below. Magic link (OTP) is no longer used.

## Resend And DNS

Sender: `noreply@splitsync.org`.

- Verify the Resend TXT and CNAME records in Cloudflare.
- Resend CNAME records must be DNS-only, not proxied.
- Add DMARC: `_dmarc` TXT `v=DMARC1; p=none`.
- Configure Supabase Authentication SMTP with host `smtp.resend.com`, port `465`, username `resend`, and a Resend sending API key as the password.
- Never put the Resend API key in web/mobile source, Vercel public variables, or GitHub repository variables.
- In the Supabase dashboard, under Authentication -> Sign In / Providers -> Email, keep "Confirm email" enabled for production so `owner_id` always maps to a verified address.

## Migrations

GitHub workflow: `Apply Supabase migrations`.

Required repository secrets:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_ID
SUPABASE_DB_PASSWORD
```

The workflow runs on `main` when a migration changes. Use Actions -> Apply Supabase migrations -> Run workflow to manually reconcile production.

## Continuous Integration

GitHub workflow: `CI` (`.github/workflows/ci.yml`), runs on every pull request into `main`.

- `web` job: `pnpm --filter web lint`, `pnpm --filter web typecheck`, `pnpm --filter web build`.
- `mobile` job: `pnpm --filter mobile lint`, `pnpm --filter mobile typecheck`.

The web build step needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` because `src/lib/supabase.ts` throws at module load if they are unset. CI sets placeholder values (no real Supabase project is contacted during a build) so no repository secrets are required for this workflow.

This is a pre-merge gate only; it does not deploy anything. Production builds still go through Vercel's own build/preview pipeline, and database migrations still ship only through the `Apply Supabase migrations` workflow above.
