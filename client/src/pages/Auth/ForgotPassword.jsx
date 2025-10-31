// src/pages/auth/ForgotPassword.jsx
/**
 * ForgotPassword — request a password reset link.
 */

import React, { useState } from "react";
import api from "../../api/axios";
import { Link } from "react-router-dom";

/*
[PRO] Purpose: Minimal flow to request a reset email with user-safe feedback.
Context: API returns 200 for both existing/non-existing emails; UI shows a neutral success message.
Edge cases: Network or server errors are surfaced in a compact banner; prevents duplicate submits.
Notes: No new dependencies; behavior matches backend expectations.
*/
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      await api.post("/auth/forgot", { email: email.trim() });
      setDone(true);
    } catch (e) {
      setErr(e?.response?.data?.message || "Request failed. Please try again.");
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
        <div className="text-2xl font-semibold text-emerald-900">Forgot password</div>

        {done ? (
          <div className="text-sm text-gray-700" aria-live="polite">
            If the email exists, a reset link was sent.
          </div>
        ) : (
          <>
            {err ? (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-2 rounded" aria-live="assertive">
                {err}
              </div>
            ) : null}

            <input
              className="w-full border p-3 rounded"
              placeholder="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <button
              type="submit"
              className="w-full bg-emerald-600 text-white p-3 rounded font-medium disabled:opacity-60"
              disabled={!email.trim() || busy}
              aria-busy={busy ? "true" : "false"}
            >
              {busy ? "Sending..." : "Send reset link"}
            </button>
          </>
        )}

        <p className="text-sm text-center">
          <Link className="text-emerald-900 underline" to="/login">
            Back to Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
