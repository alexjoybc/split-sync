#!/usr/bin/env node
/**
 * SplitSync E2E local runner
 *
 * Orchestrates:
 *   1. Supabase start (if not already running)
 *   2. supabase db reset (clean, deterministic state)
 *   3. Playwright via `pnpm --filter web test:e2e` (or test:e2e:ui with --ui flag)
 *
 * Prerequisites: Docker running, Supabase CLI installed, pnpm installed
 *
 * Usage:
 *   pnpm test:e2e          # headless
 *   pnpm test:e2e:ui       # Playwright UI mode
 */

import { execSync, spawnSync } from 'node:child_process';

const HOSTED_REF = 'bsihlrzncucrglqltjrc';
const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

console.log('🔧 SplitSync E2E runner');
console.log('Prerequisites: Docker running, Supabase CLI installed, pnpm installed\n');

// Guard: refuse to run against the hosted Supabase project
const existingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
if (existingUrl.includes(HOSTED_REF)) {
  console.error(
    'ERROR: NEXT_PUBLIC_SUPABASE_URL points to hosted Supabase.\n' +
      'Refusing to run E2E against production. Unset the variable and try again.',
  );
  process.exit(1);
}

// Detect whether the local Supabase stack is already up
let supabaseRunning = false;
try {
  const status = execSync('supabase status', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  supabaseRunning = status.includes('API URL');
} catch {
  supabaseRunning = false;
}

if (!supabaseRunning) {
  console.log('Starting local Supabase...');
  execSync('supabase start', { stdio: 'inherit' });
} else {
  console.log('Local Supabase already running — reusing.');
}

// Always reset the DB so every run starts from a clean, seeded state
console.log('\nResetting database (applying migrations + seed)...');
execSync('supabase db reset', { stdio: 'inherit' });

// Choose headless or UI mode
const uiMode = process.argv.includes('--ui');
const playwrightScript = uiMode ? 'test:e2e:ui' : 'test:e2e';

// Build the env for the web app
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON_KEY,
};

console.log(`\nRunning Playwright (${uiMode ? 'UI mode' : 'headless'})...\n`);
const result = spawnSync('pnpm', ['--filter', 'web', playwrightScript], {
  env,
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
