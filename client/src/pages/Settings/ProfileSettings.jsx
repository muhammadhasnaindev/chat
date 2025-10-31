// client/src/pages/settings/ProfileSettings.jsx
/**
 * ProfileSettings — user profile edit (name/about/avatar) and account changes (email/password).
 
 */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api/axios";
import useAuth from "../../store/authStore";
import BackButton from "../../components/BackButton";
import AvatarUploader from "../../components/AvatarUploader";

/* constants kept close to usage */
const NAV_BACK_DELAY_MS = 500;
const TOAST_SHORT_MS = 2000;
const TOAST_LONG_MS = 2500;

/* small inline icons (kept internal; no external deps) */
const EyeIcon = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...props}>
    <path d="M12 5C7 5 2.73 8.11 1 12c1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7Zm0 12a5 5 0 1 1 5-5 5 5 0 0 1-5 5Z" fill="currentColor"/>
  </svg>
);
const EyeOffIcon = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...props}>
    <path d="M2 5.27 3.28 4 20 20.72 18.73 22l-2.21-2.21A10.84 10.84 0 0 1 12 19c-5 0-9.27-3.11-11-7a12.44 12.44 0 0 1 4.11-5.13L2 5.27Zm6.54 6.54a3.5 3.5 0 0 0 4.65 4.65l-4.65-4.65ZM12 5c5 0 9.27 3.11 11 7a12.8 12.8 0 0 1-3.06 4.19l-1.42-1.42A10.2 10.2 0 0 0 21 12c-1.73-3.89-6-7-9-7a10 10 0 0 0-4 .84l1.56 1.56A8.24 8.24 0 0 1 12 5Z" fill="currentColor"/>
  </svg>
);

/*
[PRO] Purpose: Main profile settings surface for editing identity and account credentials.
Context: Single-page flow reduces cognitive load; relies on existing API endpoints for updates.
Edge cases: Network errors, partial loads, or unmounted state during async ops are guarded.
Notes: No extra libraries; tight copy and minimal UI chrome for predictable behavior.
*/
export default function ProfileSettings() {
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const [form, setForm] = useState({ name: "", about: "", avatar: "" });
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [showPw, setShowPw] = useState({ current: false, next: false });
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);

  /*
  [PRO] Purpose: Load current user profile to seed the form.
  Context: Avoids blank flicker and keeps inputs controlled.
  Edge cases: Component unmount during request; malformed server data.
  Notes: Uses "alive" guard to prevent post-unmount state writes.
  */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/users/me");
        if (!alive) return;
        setForm({
          name: data?.name || "",
          about: data?.about || "",
          avatar: data?.avatar || "",
        });
        setEmail(data?.email || "");
      } catch (e) {
        setMsg(e?.response?.data?.message || "Failed to load profile");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /*
  [PRO] Purpose: Back navigation that behaves the same for deep links and direct visits.
  Context: SPA routes sometimes lack history; this fallback avoids dead-ends.
  Edge cases: Modal contexts; triggers a global close event first if any listeners exist.
  Notes: Keep side effects minimal and predictable.
  */
  const goBack = () => {
    try {
      window.dispatchEvent(new CustomEvent("app:closeAllModals"));
    } catch {}
    if (window.history && window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  /*
  [PRO] Purpose: Persist profile changes and reflect them across the app.
  Context: Store setter keeps views in sync without page reloads.
  Edge cases: Server validation errors; partial user shape differences.
  Notes: Short delay before nav back gives users a clear success acknowledgement.
  */
  const saveProfile = async () => {
    setMsg("");
    setMutating(true);
    try {
      const { data } = await api.patch("/users/me", form);
      setUser?.(data?.user || data);
      setMsg("Profile updated");
      setTimeout(goBack, NAV_BACK_DELAY_MS);
    } catch (e) {
      setMsg(e?.response?.data?.message || "Failed to update profile");
    } finally {
      setMutating(false);
    }
  };

  /*
  [PRO] Purpose: Start email change flow; server sends verification to the new address.
  Context: Lightweight client step; no local confirmation codes stored here.
  Edge cases: Empty email; backend may reject duplicates or invalid formats.
  Notes: Toast auto-clears; no navigation to keep users in context.
  */
  const startChangeEmail = async () => {
    setMsg("");
    setMutating(true);
    try {
      await api.post("/auth/change-email", { newEmail: email });
      setMsg("Verification sent to new email");
    } catch (e) {
      setMsg(e?.response?.data?.message || "Failed to send verification");
    } finally {
      setMutating(false);
      setTimeout(() => setMsg(""), TOAST_LONG_MS);
    }
  };

  /*
  [PRO] Purpose: Change password with current + new secret.
  Context: Keeps flow local; server enforces strength/policy.
  Edge cases: Wrong current password; weak new password; empty fields.
  Notes: Clears inputs on success; quick toast and return to editing.
  */
  const changePassword = async () => {
    setMsg("");
    setMutating(true);
    try {
      await api.post("/auth/change-password", pw);
      setMsg("Password changed");
      setPw({ currentPassword: "", newPassword: "" });
    } catch (e) {
      setMsg(e?.response?.data?.message || "Failed to change password");
    } finally {
      setMutating(false);
      setTimeout(() => setMsg(""), TOAST_SHORT_MS);
    }
  };

  return (
    <div className="h-[100dvh] bg-white flex flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b">
        <div className="px-3 py-2 flex items-center gap-2">
          <BackButton tone="green" className="mr-1" label="Back" to="/" onBack={() => {}} />
          <div className="min-w-0">
            <div className="font-semibold leading-tight truncate">Profile</div>
            <div className="text-[11px] text-gray-500 truncate">{email}</div>
          </div>
          <div className="flex-1" />
          <button
            onClick={saveProfile}
            disabled={mutating}
            className="hidden md:inline-flex px-3 py-2 rounded bg-emerald-600 text-white text-sm disabled:opacity-60"
          >
            {mutating ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {msg && (
        <div className="px-4 pt-3" aria-live="polite">
          <div className="mb-3 text-sm bg-emerald-50 text-emerald-700 p-2 rounded">{msg}</div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 md:py-6">
        {loading ? (
          <div className="text-sm text-gray-500">Loading...</div>
        ) : (
          <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-6">
            {/* Left */}
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-600 mb-1">Avatar</div>
                <AvatarUploader
                  value={form.avatar}
                  onChange={(url) => setForm((f) => ({ ...f, avatar: url }))}
                />
              </div>

              <label className="block">
                <div className="text-sm text-gray-600">Name</div>
                <input
                  className="mt-1 w-full border p-3 rounded"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </label>

              <label className="block">
                <div className="text-sm text-gray-600">About</div>
                <textarea
                  className="mt-1 w-full border p-3 rounded"
                  rows={4}
                  value={form.about}
                  onChange={(e) => setForm({ ...form, about: e.target.value })}
                  placeholder="Write something about yourself"
                />
              </label>

              <div className="md:hidden">
                <button
                  onClick={saveProfile}
                  disabled={mutating}
                  className="w-full px-4 py-2 bg-emerald-600 text-white rounded disabled:opacity-60"
                >
                  {mutating ? "Saving..." : "Save"}
                </button>
              </div>
            </div>

            {/* Right */}
            <div className="space-y-6">
              <div>
                <div className="font-medium">Change Email</div>
                <input
                  className="w-full border p-3 rounded mt-2"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  type="email"
                  autoComplete="email"
                />
                <button
                  onClick={startChangeEmail}
                  disabled={mutating || !email}
                  className="mt-2 px-4 py-2 border rounded disabled:opacity-60"
                >
                  {mutating ? "Sending..." : "Send verification"}
                </button>
              </div>

              <div>
                <div className="font-medium">Change Password</div>

                {/* Current password */}
                <div className="relative mt-2">
                  <input
                    className="w-full border p-3 rounded pr-12"
                    type={showPw.current ? "text" : "password"}
                    placeholder="Current password"
                    value={pw.currentPassword}
                    onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-sm px-2 py-1 rounded hover:bg-gray-50"
                    onClick={() => setShowPw((s) => ({ ...s, current: !s.current }))}
                    aria-label={showPw.current ? "Hide password" : "Show password"}
                    title={showPw.current ? "Hide" : "Show"}
                  >
                    {showPw.current ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>

                {/* New password */}
                <div className="relative mt-2">
                  <input
                    className="w-full border p-3 rounded pr-12"
                    type={showPw.next ? "text" : "password"}
                    placeholder="New password"
                    value={pw.newPassword}
                    onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-sm px-2 py-1 rounded hover:bg-gray-50"
                    onClick={() => setShowPw((s) => ({ ...s, next: !s.next }))}
                    aria-label={showPw.next ? "Hide password" : "Show password"}
                    title={showPw.next ? "Hide" : "Show"}
                  >
                    {showPw.next ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>

                <button
                  onClick={changePassword}
                  disabled={mutating || !pw.currentPassword || !pw.newPassword}
                  className="mt-2 px-4 py-2 border rounded disabled:opacity-60"
                >
                  {mutating ? "Updating..." : "Update password"}
                </button>
              </div>

              <button onClick={goBack} className="px-4 py-2 border rounded w-full md:w-auto">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
