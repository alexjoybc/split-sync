"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendReset = async () => {
    setError(null);
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (authError) return setError(authError.message);
    setSent(true);
  };

  return (
    <main className="race-page">
      <div className="race-topline" />
      <header className="race-masthead">
        <div className="mx-auto max-w-lg">
          <p className="race-kicker">Organizer access</p>
          <h1 className="race-title">Reset password</h1>
        </div>
      </header>
      <div className="mx-auto max-w-lg px-4 py-10 sm:px-6">
        {sent ? (
          <div className="race-panel p-5">
            <h2 className="text-lg font-black uppercase">Check your inbox</h2>
            <p className="mt-2 text-sm text-race-muted">
              We sent a password reset link to <b className="text-race-ink">{email}</b>.
            </p>
          </div>
        ) : (
          <div className="race-panel p-5">
            <p className="text-sm text-race-muted">Enter your email and we will send a link to set a new password.</p>
            <label className="mt-5 block text-xs font-black uppercase tracking-wide">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && sendReset()}
              placeholder="you@example.com"
              className="race-input mt-1"
              autoComplete="email"
            />
            {error && <p className="mt-3 text-sm font-bold text-race-red">{error}</p>}
            <button onClick={sendReset} disabled={!email} className="race-action mt-4 w-full disabled:opacity-50">
              Send reset link
            </button>
            <a href="/login" className="mt-4 inline-block text-xs font-bold text-race-muted hover:text-race-red">
              Back to sign in
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
