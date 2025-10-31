// client/src/pages/ResetWithCode.jsx
/**
 * ResetWithCode — complete password reset using email + 6-digit code.
 
 */

/*
[PRO] Purpose: Finalize password reset after user receives a one-time code.
Context: Keeps validation local (required fields, match check) before calling API.
Edge cases: Code length, mismatched passwords, expired code; show safe errors.
Notes: Minimal state; redirect on success to sign-in for clarity.
*/
import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api/axios";

/** @returns {JSX.Element} Reset with code screen */
export default function ResetWithCode() {
  const nav = useNavigate();
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const [email, setEmail] = useState(params.get("email") || "");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState({ p1: "", p2: "" });
  const [show, setShow] = useState({ a:false, b:false });
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setMsg("");
    if (!email || !code || !pw.p1) return setMsg("All fields required");
    if (pw.p1 !== pw.p2) return setMsg("Passwords do not match");
    try {
      setLoading(true);
      await api.post("/auth/reset/confirm", { email, code, password: pw.p1 });
      setMsg("Password updated. Redirecting...");
      setTimeout(() => nav("/login"), 500);
    } catch (e2) {
      setMsg(e2?.response?.data?.message || "Invalid code or error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-emerald-900 to-emerald-500 flex items-center justify-center p-6">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-8 w-full max-w-md space-y-4">
        <div className="text-2xl font-semibold text-emerald-900">Reset password</div>
        {msg && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{msg}</div>}
        <input
          className="w-full border p-3 rounded"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
          required
        />
        <input
          className="w-full border p-3 rounded tracking-widest text-center"
          placeholder="6-digit code"
          value={code}
          onChange={(e)=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))}
          inputMode="numeric"
          pattern="\d*"
          required
        />

        <div className="relative">
          <input
            className="w-full border p-3 rounded pr-16"
            placeholder="New password"
            type={show.a ? "text" : "password"}
            value={pw.p1}
            onChange={(e)=>setPw({ ...pw, p1: e.target.value })}
            required
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded border"
            onClick={()=>setShow(s=>({...s,a:!s.a}))}
          >
            {show.a ? "Hide" : "Show"}
          </button>
        </div>
        <div className="relative">
          <input
            className="w-full border p-3 rounded pr-16"
            placeholder="Confirm password"
            type={show.b ? "text" : "password"}
            value={pw.p2}
            onChange={(e)=>setPw({ ...pw, p2: e.target.value })}
            required
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded border"
            onClick={()=>setShow(s=>({...s,b:!s.b}))}
          >
            {show.b ? "Hide" : "Show"}
          </button>
        </div>

        <button className="w-full bg-emerald-600 text-white p-3 rounded font-medium" disabled={loading}>
          {loading ? "Updating..." : "Update password"}
        </button>

        <div className="text-center text-sm">
          <Link className="text-emerald-900" to="/login">Back to Sign in</Link>
        </div>
      </form>
    </div>
  );
}
