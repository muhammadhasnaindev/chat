// src/pages/auth/ResetPassword.jsx
/**
 * ResetPassword — set a new password using a token.

 */

import React, { useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import api from "../../api/axios";

/*
[PRO] Purpose: Accept a new password and finalize the reset for the given token.
Context: Token is passed via query string; server validates and updates credentials.
Edge cases: Missing/expired tokens and network failures are surfaced clearly.
Notes: Keeps UX neutral; does not reveal token validity beyond generic messages.
*/
export default function ResetPassword() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const token = sp.get("token") || "";
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      await api.post("/auth/reset", { token, password });
      setOk(true);
      setTimeout(() => nav("/login"), 1000);
    } catch (e) {
      setErr(e?.response?.data?.message || "Could not update password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <form
        onSubmit={submit}
        className="bg-white rounded-xl shadow-xl p-8 w-full max-w-md space-y-4"
        noValidate
      >
        <div className="text-2xl font-semibold text-emerald-900">Set new password</div>

        {err ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-2 rounded" aria-live="assertive">
            {err}
          </div>
        ) : null}

        {ok ? (
          <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 p-2 rounded" aria-live="polite">
            Updated! Redirecting...
          </div>
        ) : null}

        <input
          className="w-full border p-3 rounded"
          placeholder="New password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
        />

        <button
          type="submit"
          className="w-full bg-emerald-600 text-white p-3 rounded font-medium disabled:opacity-60"
          disabled={!token || !password || busy}
          aria-busy={busy ? "true" : "false"}
        >
          {busy ? "Updating..." : "Update"}
        </button>

        <p className="text-sm text-center">
          <Link className="text-emerald-900 underline" to="/login">
            Back to Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
