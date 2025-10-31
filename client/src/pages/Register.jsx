// client/src/pages/Register.jsx
/**
 * Register — account creation with optional avatar and about.
 */

/*
[PRO] Purpose: Create a new account and keep session so user can verify immediately.
Context: Accepts optional avatar via public upload for pre-auth users.
Edge cases: Duplicate emails, weak passwords, transient upload failures.
Notes: Keeps UI responsive with a single busy flag; no emoji in labels.
*/
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/axios";
import useAuth from "../store/authStore";
import AvatarUploader from "../components/AvatarUploader";

/** @returns {JSX.Element} Sign-up screen */
export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [about, setAbout] = useState("");
  const [avatar, setAvatar] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const loginAuth = useAuth((s) => s.login);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      const { data } = await api.post("/auth/register", {
        name,
        email,
        password,
        about,
        avatar,
      });
      loginAuth(data.token, data.user);
      nav(`/verify?email=${encodeURIComponent(email)}`);
    } catch (e2) {
      setErr(e2?.response?.data?.message || "Register failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-emerald-900 to-emerald-500 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-6">
        <div className="text-white p-4 hidden md:block">
          <div className="text-4xl font-bold">Create your account</div>
          <p className="mt-3 opacity-90">Start chatting in seconds.</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-8 space-y-4 w-full">
          <div className="text-2xl font-semibold text-emerald-900">Sign up</div>
          {err && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</div>}

          <div>
            <div className="text-sm text-gray-600 mb-1">Profile picture</div>
            <AvatarUploader value={avatar} onChange={setAvatar} guest />
          </div>

          <input
            className="w-full border p-3 rounded"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="w-full border p-3 rounded"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <div className="relative">
            <input
              className="w-full border p-3 rounded pr-16"
              placeholder="Password"
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded border"
              onClick={() => setShowPw((s) => !s)}
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>

          <textarea
            className="w-full border p-3 rounded"
            placeholder="About (optional)"
            rows={3}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
          />

          <button
            className="w-full bg-emerald-600 text-white p-3 rounded font-medium disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Creating..." : "Create Account"}
          </button>

          <p className="text-sm text-center">
            Have an account?{" "}
            <Link className="text-emerald-900 font-medium" to="/login">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
