// src/pages/auth/VerifyEmail.jsx
/**
 * VerifyEmail — confirm a user's email via token.
 */

import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import api from "../../api/axios";

/*
[PRO] Purpose: Validate an email verification token and inform the user of the outcome.
Context: Token comes from an emailed link; backend marks the account verified.
Edge cases: Missing tokens, expired links, and network errors are handled with neutral messaging.
Notes: Avoids leaking backend details; keeps UI crisp and single-purpose.
*/
export default function VerifyEmail() {
  const [sp] = useSearchParams();
  const [state, setState] = useState({ loading: true, ok: false, msg: "" });

  useEffect(() => {
    let alive = true;
    (async () => {
      const token = sp.get("token");
      if (!token) {
        if (alive) setState({ loading: false, ok: false, msg: "Missing token." });
        return;
      }
      try {
        await api.get(`/auth/verify-email?token=${encodeURIComponent(token)}`);
        if (alive) setState({ loading: false, ok: true, msg: "Email verified. You can continue." });
      } catch (e) {
        if (alive)
          setState({
            loading: false,
            ok: false,
            msg: e?.response?.data?.message || "Invalid or expired link.",
          });
      }
    })();
    return () => {
      alive = false;
    };
  }, [sp]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="bg-white p-6 rounded-xl shadow w-full max-w-md text-center space-y-3">
        <div className="text-2xl font-semibold">Verify Email</div>

        {state.loading ? (
          <div aria-live="polite">Verifying...</div>
        ) : (
          <>
            <div
              className={state.ok ? "text-emerald-600" : "text-red-600"}
              aria-live="polite"
            >
              {state.msg}
            </div>
            <Link to="/login" className="inline-block mt-2 text-emerald-700 underline">
              Go to Sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
