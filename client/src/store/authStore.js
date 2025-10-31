// src/store/authStore.js
/**
 * Auth store — token + user session with localStorage persistence.
 */

/*
[PRO] Purpose: Hold authenticated session state and persist it across reloads.
Context: Central store avoids prop drilling and keeps API calls simple.
Edge cases: Corrupt storage or unavailable Storage—wrap reads/writes; null-safe updates.
Notes: Storage is best-effort; app should still run without persistence.
*/
import { create } from "zustand";

function safeParse(json, fallback = null) {
  try { return JSON.parse(json); } catch { return fallback; }
}

const initialToken = (() => {
  try { return localStorage.getItem("token"); } catch { return null; }
})();
const initialUser = (() => {
  try { return safeParse(localStorage.getItem("user"), null); } catch { return null; }
})();

const useAuth = create((set) => ({
  token: initialToken,
  user: initialUser,

  /** Save token+user and persist. */
  login: (token, user) => {
    try { localStorage.setItem("token", token); } catch {}
    try { localStorage.setItem("user", JSON.stringify(user)); } catch {}
    set({ token, user });
  },

  /** Clear session and persisted values. */
  logout: () => {
    try { localStorage.removeItem("token"); } catch {}
    try { localStorage.removeItem("user"); } catch {}
    set({ token: null, user: null });
  },

  /** Update user profile and persist. */
  setUser: (user) => {
    try { localStorage.setItem("user", JSON.stringify(user)); } catch {}
    set({ user });
  },
}));

export default useAuth;
