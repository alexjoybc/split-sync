"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function ResetPasswordContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let resolved = false;
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && active) {
        resolved = true;
        setReady(true);
      }
    });

    const code = params.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
        if (!active) return;
        resolved = true;
        if (exchangeError) setError("This reset link has expired or was already used. Request a new one.");
        else setReady(true);
      });
    } else {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session && active) {
          resolved = true;
          setReady(true);
        }
      });
      const timeout = window.setTimeout(() => {
        if (active && !resolved) setError("This reset link has expired or was already used. Request a new one.");
      }, 5000);
      return () => {
        active = false;
        window.clearTimeout(timeout);
        listener.subscription.unsubscribe();
      };
    }

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const updatePassword = async () => {
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) return setError(updateError.message);
    router.replace("/");
  };

  if (error) {
    return (
      <div className="text-center">
        <p className="text-sm font-black uppercase tracking-wide text-race-ink">{error}</p>
        <a href="/auth/forgot-password" className="race-action--muted mt-5 inline-block">
          Request a new link
        </a>
      </div>
    );
  }

  if (!ready) {
    return <p className="text-sm font-black uppercase tracking-wide text-race-muted">Verifying reset link…</p>;
  }

  return (
    <div className="race-panel w-full max-w-lg p-5">
      <h2 className="text-lg font-black uppercase">Set a new password</h2>
      <label className="mt-5 block text-xs font-black uppercase tracking-wide">New password</label>
      <input
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="••••••••"
        className="race-input--muted mt-1"
        autoComplete="new-password"
      />
      <label className="mt-4 block text-xs font-black uppercase tracking-wide">Confirm password</label>
      <input
        type="password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && updatePassword()}
        placeholder="••••••••"
        className="race-input--muted mt-1"
        autoComplete="new-password"
      />
      <button onClick={updatePassword} disabled={!password || !confirmPassword} className="race-action--muted mt-4 w-full disabled:opacity-50">
        Update password
      </button>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="race-page grid place-items-center">
      <Suspense fallback={<p className="text-sm font-black uppercase tracking-wide text-race-muted">Loading…</p>}>
        <ResetPasswordContent />
      </Suspense>
    </main>
  );
}
