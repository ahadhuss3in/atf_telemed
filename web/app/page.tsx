"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ServerBanner } from "@/components/primitives";
import { useSignaling } from "@/hooks/use-signaling";

export default function LoginPage() {
  const router = useRouter();
  const {
    accounts,
    demoPassword,
    authError,
    login,
    user,
    status,
    ready,
    url,
    unconfiguredServer,
  } = useSignaling();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    router.replace(user.role === "doctor" ? "/doctor" : "/patient");
  }, [user, router]);

  // Re-enable the form whenever an attempt resolves, one way or the other.
  useEffect(() => setSubmitting(false), [authError, user]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    login(username.trim(), password);
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>
          atf <span style={{ color: "var(--accent)" }}>telehealth</span>
        </h1>
        <p className="sub">Peer-to-peer video consultations between patients and doctors.</p>

        <ServerBanner unconfigured={unconfiguredServer} url={url} />

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <div className="login-error" data-testid="error">
            {authError ?? ""}
          </div>

          <button
            className="primary"
            type="submit"
            disabled={submitting || status !== "open"}
            style={{ width: "100%", padding: 11 }}
            data-testid="submit"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {ready && status !== "open" && !authError && (
          <p className="demo-note" data-testid="status">
            Connecting to <code>{url || "…"}</code>…
          </p>
        )}

        <div className="demo">
          <h2>Demo accounts</h2>
          <div className="demo-chips" data-testid="account-list">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                className={`chip ${account.role}`}
                onClick={() => {
                  setUsername(account.username);
                  setPassword(demoPassword);
                }}
                data-testid="account-chip"
              >
                {account.specialty ? `${account.name} · ${account.specialty}` : account.name}
              </button>
            ))}
          </div>
          {demoPassword && (
            <p className="demo-note">
              Click an account to fill the form. Password:{" "}
              <code data-testid="demo-password">{demoPassword}</code>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}