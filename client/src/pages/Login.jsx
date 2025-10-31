// client/src/pages/Login.jsx
/**
 * Login — email + password sign-in with verified email gate.
 
 */

/*
[PRO] Purpose: Authenticate and hydrate session, then route respecting verification status.
Context: Keeps user store authoritative for token + profile; redirects to verify if needed.
Edge cases: Wrong creds, unverified email, backend message passthrough.
Notes: Password input uses a toggleable visibility control for UX.
*/
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/axios";
import useAuth from "../store/authStore";
import PasswordInput from "../components/PasswordInput";

/** @returns {JSX.Element} Sign-in screen */
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const loginAuth = useAuth((s) => s.login);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      loginAuth(data.token, data.user);
      if (!data.user.emailVerified) nav("/verify-email?email=" + encodeURIComponent(email));
      else nav("/");
    } catch (e2) {
      setErr(e2?.response?.data?.message || "Login failed");
    }
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-emerald-900 to-emerald-500 flex items-center justify-center p-6">
      <div className="w/full max-w-4xl grid md:grid-cols-2 gap-6">
        <div className="text-white p-4 hidden md:block">
          <div className="text-4xl font-bold">Welcome back</div>
          <p className="mt-3 opacity-90">Enter your email code if not verified.</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-8 space-y-4 w-full">
          <div className="text-2xl font-semibold text-emerald-900">Sign in</div>
          {err && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</div>}
          <input
            className="w-full border p-3 rounded"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <PasswordInput value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Password" />

          <button className="w-full bg-emerald-600 text-white p-3 rounded font-medium">Continue</button>

          <p className="text-sm text-center mt-2">
            <Link className="text-emerald-900 font-medium" to="/forgot">Forgot password?</Link>
          </p>
          <p className="text-sm text-center mt-3">
            No account?{" "}
            <Link className="text-emerald-900 font-medium" to="/register">
              Create one
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
