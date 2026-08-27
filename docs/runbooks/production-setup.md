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
http://localhost:3000/auth/callback
org.splitsync.tracker://**
```

Magic link emails use Resend SMTP. Do not use Supabase's default sender for real events because it is heavily rate-limited.

## Resend And DNS

Sender: `noreply@splitsync.org`.

- Verify the Resend TXT and CNAME records in Cloudflare.
- Resend CNAME records must be DNS-only, not proxied.
- Add DMARC: `_dmarc` TXT `v=DMARC1; p=none`.
- Configure Supabase Authentication SMTP with host `smtp.resend.com`, port `465`, username `resend`, and a Resend sending API key as the password.
- Never put the Resend API key in web/mobile source, Vercel public variables, or GitHub repository variables.

## Migrations

GitHub workflow: `Apply Supabase migrations`.

Required repository secrets:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_ID
SUPABASE_DB_PASSWORD
```

The workflow runs on `main` when a migration changes. Use Actions -> Apply Supabase migrations -> Run workflow to manually reconcile production.
