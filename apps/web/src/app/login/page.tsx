"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const signInWithGoogle = async () => {
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (authError) setError(authError.message);
  };

  const submitPassword = async () => {
    setError(null);
    setNotice(null);
    if (mode === "signin") {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) setError(authError.message);
      else window.location.assign("/");
      return;
    }
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (authError) return setError(authError.message);
    if (data.session) window.location.assign("/");
    else setNotice("Check your inbox to confirm your address, then sign in.");
  };

  return <main className="race-page"><div className="race-topline" /><header className="race-masthead"><div className="mx-auto max-w-lg"><p className="race-kicker">Organizer access</p><h1 className="race-title">Sign in</h1></div></header><div className="mx-auto max-w-lg px-4 py-10 sm:px-6"><div className="race-panel p-5"><p className="text-sm text-race-muted">Sign in with your Google account to manage your events.</p><button onClick={signInWithGoogle} className="race-action mt-4 w-full">Continue with Google</button><div className="mt-6 flex items-center gap-3"><div className="h-px flex-1 bg-race-ink/20" /><span className="text-xs font-black uppercase tracking-wide text-race-muted">Or</span><div className="h-px flex-1 bg-race-ink/20" /></div><div className="mt-6 flex gap-2 text-xs font-black uppercase tracking-wide"><button onClick={() => { setMode("signin"); setError(null); setNotice(null); }} className={mode === "signin" ? "text-race-red" : "text-race-muted"}>Sign in</button><span className="text-race-muted">/</span><button onClick={() => { setMode("signup"); setError(null); setNotice(null); }} className={mode === "signup" ? "text-race-red" : "text-race-muted"}>Create account</button></div><label className="mt-5 block text-xs font-black uppercase tracking-wide">Email</label><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="race-input mt-1" autoComplete="email" /><label className="mt-4 block text-xs font-black uppercase tracking-wide">Password</label><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitPassword()} placeholder="••••••••" className="race-input mt-1" autoComplete={mode === "signin" ? "current-password" : "new-password"} />{mode === "signin" && <a href="/auth/forgot-password" className="mt-2 inline-block text-xs font-bold text-race-muted hover:text-race-red">Forgot password?</a>}{error && <p className="mt-3 text-sm font-bold text-race-red">{error}</p>}{notice && <p className="mt-3 text-sm font-bold text-race-ink">{notice}</p>}<button onClick={submitPassword} disabled={!email || !password} className="race-action mt-4 w-full disabled:opacity-50">{mode === "signin" ? "Sign in" : "Create account"}</button></div></div></main>;
}
