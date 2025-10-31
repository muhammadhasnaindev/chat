// client/src/pages/VerifyEmailCode.jsx
/**
 * VerifyEmailCode — confirm email ownership via 6-digit OTP.

 */

/*
[PRO] Purpose: Confirm a user's email with a code and mark session as verified.
Context: Supports both logged-in (update local store) and pre-login verification.
Edge cases: Empty email, expired code, repeated resends; show concise messages.
Notes: Redirect after success to home for a clear post-verify path.
*/
import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api/axios";
import useAuth from "../store/authStore";

/** @returns {JSX.Element} Email verification screen */
export default function VerifyEmailCode() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const emailFromQuery = params.get("email");
  const [email, setEmail] = useState(emailFromQuery || user?.email || "");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email) setMsg("Enter your email to verify.");
  }, [email]);

  const verify = async (e) => {
    e?.preventDefault?.();
    setMsg("");
    if (!email || !code) return setMsg("Email and code are required");
    try {
      setLoading(true);
      await api.post("/auth/verify-code", { email, code });
      if (user?.email === email) setUser({ ...user, emailVerified: true });
      setMsg("Verified! Redirecting...");
      setTimeout(() => nav("/"), 500);
    } catch (e2) {
      setMsg(e2?.response?.data?.message || "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setMsg("");
    if (!email) return setMsg("Enter your email first");
    try {
      setLoading(true);
      await api.post("/auth/send-verify", { email });
      setMsg("Code sent. Check your inbox/spam.");
    } catch (e2) {
      setMsg(e2?.response?.data?.message || "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-emerald-900 to-emerald-500 flex items-center justify-center p-6">
      <form onSubmit={verify} className="bg-white rounded-xl shadow-xl p-8 w-full max-w-md space-y-4">
        <div className="text-2xl font-semibold text-emerald-900">Verify Email</div>
        {msg && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{msg}</div>}
        <input
          className="w-full border p-3 rounded"
          placeholder="Email"
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
          type="email"
          required
        />
        <input
          className="w-full border p-3 rounded tracking-widest text-center"
          placeholder="6-digit code"
          value={code}
          onChange={(e)=>setCode(e.target.value.replace(/\D/g, '').slice(0,6))}
          inputMode="numeric"
          pattern="\d*"
          required
        />
        <button className="w-full bg-emerald-600 text-white p-3 rounded font-medium" disabled={loading}>
          {loading ? "Verifying..." : "Verify"}
        </button>
        <button type="button" onClick={resend} className="w-full border p-3 rounded font-medium" disabled={loading}>
          {loading ? "Sending..." : "Resend code"}
        </button>
        <div className="text-center text-sm">
          <Link className="text-emerald-900" to="/login">Go to Sign in</Link>
        </div>
      </form>
    </div>
  );
}
