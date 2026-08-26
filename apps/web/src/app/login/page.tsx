"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (authError) return setError(authError.message);
    setSent(true);
  };

  return <main className="race-page"><div className="race-topline" /><header className="race-masthead"><div className="mx-auto max-w-lg"><p className="race-kicker">Organizer access</p><h1 className="race-title">Sign in</h1></div></header><div className="mx-auto max-w-lg px-4 py-10 sm:px-6">{sent ? <div className="race-panel p-5"><h2 className="text-lg font-black uppercase">Check your inbox</h2><p className="mt-2 text-sm text-race-muted">We sent a secure sign-in link to <b className="text-race-ink">{email}</b>.</p></div> : <div className="race-panel p-5"><p className="text-sm text-race-muted">Enter your email and we will send a password-free magic link.</p><label className="mt-5 block text-xs font-black uppercase tracking-wide">Email</label><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => event.key === "Enter" && signIn()} placeholder="you@example.com" className="race-input mt-1" autoComplete="email" />{error && <p className="mt-3 text-sm font-bold text-race-red">{error}</p>}<button onClick={signIn} disabled={!email} className="race-action mt-4 w-full disabled:opacity-50">Send magic link</button></div>}</div></main>;
}
