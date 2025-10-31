// client/src/pages/Forgot.jsx
/**
 * Forgot — request password reset code.

 */

/*
[PRO] Purpose: Let a user request a password reset and move to code entry.
Context: Keeps flow simple—collect email, call API, route to /reset with email prefilled.
Edge cases: Network errors and unknown emails return generic, user-safe messages.
Notes: Avoids disclosing account existence; navigation gated behind successful request.
*/
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/axios";

/** @returns {JSX.Element} Forgot password request view */
export default function Forgot() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setMsg("");
    try {
      setLoading(true);
      await api.post("/auth/forgot", { email });
      nav(`/reset?email=${encodeURIComponent(email)}`);
    } catch (e2) {
      setMsg(e2?.response?.data?.message || "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-emerald-900 to-emerald-500 flex items-center justify-center p-6">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-8 w-full max-w-md space-y-4">
        <div className="text-2xl font-semibold text-emerald-900">Forgot password</div>
        {msg && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{msg}</div>}
        <input
          className="w-full border p-3 rounded"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
          required
        />
        <button className="w-full bg-emerald-600 text-white p-3 rounded font-medium" disabled={loading}>
          {loading ? "Sending..." : "Send reset code"}
        </button>
        <div className="text-center text-sm">
          <Link className="text-emerald-900" to="/login">Back to Sign in</Link>
        </div>
      </form>
    </div>
  );
}
