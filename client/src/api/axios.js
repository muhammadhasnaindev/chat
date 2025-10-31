// client/src/api/axios.js

/**
 * Axios instance with auth header and a small GET /chats dedupe/throttle layer.

 */

import axios from "axios";
import useAuth from "../store/authStore";

// --- Constants ---
const API_ROOT = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");
const BASE_URL = `${API_ROOT}/api`;
const CHATS_PATH = "/api/chats";
const THROTTLE_MS = 1500;

// --- State ---
const inFlight = new Map(); // key -> { ts }
const lastSeen = new Map(); // key -> number

/**
 * Build a stable key: METHOD + normalized URL + sorted query params.
 * Reason: avoid collapsing different queries to the same path.
 */
function makeKey(config = {}) {
  const method = String(config.method || "get").toUpperCase();

  const base = (config.baseURL || "").replace(/\/+$/, "");
  const url = String(config.url || "");
  const full = url.startsWith("http") ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`;

  const [pathOnly, query = ""] = full.split("?");
  if (!query) return `${method} ${pathOnly}`;

  const params = new URLSearchParams(query);
  const pairs = [];
  Array.from(params.keys())
    .sort()
    .forEach((k) => {
      const vals = params.getAll(k).sort();
      vals.forEach((v) => pairs.push(`${k}=${v}`));
    });

  return `${method} ${pathOnly}?${pairs.join("&")}`;
}

/**
 * True only for GET /api/chats (absolute or relative).
 */
function isChatsRequest(config = {}) {
  const method = String(config.method || "get").toLowerCase();
  if (method !== "get") return false;

  const base = (config.baseURL || "").replace(/\/+$/, "");
  const url = String(config.url || "");
  const full = url.startsWith("http") ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`;

  try {
    const u = new URL(full, "http://placeholder.local");
    return u.pathname.endsWith(CHATS_PATH);
  } catch {
    return full.endsWith(CHATS_PATH);
  }
}

/*
[PRO] Purpose: Provide a single axios instance with auth and predictable caching behavior.
Context: Multiple UI surfaces can trigger /chats concurrently; we throttle and dedupe to reduce load.
Edge cases: Distinct query strings must not merge; makeKey sorts params for stability.
Notes: We drop new duplicates within a short window, allowing the first request to complete.
*/
const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  // Auth header (if token present)
  const token = useAuth.getState().token;
  config.headers = config.headers || {};
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Hint browsers to avoid caching loops; server may still reply 304
  config.headers["Cache-Control"] = "no-cache";

  // Apply dedupe/throttle only for GET /chats
  if (isChatsRequest(config)) {
    const key = makeKey(config);
    const now = Date.now();
    const seenAt = lastSeen.get(key) || 0;

    // Throttle: if recently allowed, abort this repeat quickly
    if (now - seenAt < THROTTLE_MS) {
      const ctl = new AbortController();
      config.signal = ctl.signal;
      setTimeout(() => ctl.abort(), 0);
      return config;
    }

    // Dedupe: if an identical request is in flight, abort this one
    if (inFlight.has(key)) {
      const ctl = new AbortController();
      config.signal = ctl.signal;
      setTimeout(() => ctl.abort(), 0);
      return config;
    }

    // Mark as in-flight
    inFlight.set(key, { ts: now });
  }

  return config;
});

/*
[PRO] Purpose: Clear in-flight and record lastSeen for /chats after any outcome.
Context: Prevent stuck in-flight entries on errors and space out bursts.
Edge cases: Non-/chats endpoints are ignored; aborted requests without in-flight are harmless.
Notes: Keeps the throttle window anchored on completion time.
*/
function finishChats(config = {}) {
  if (!isChatsRequest(config)) return;
  const key = makeKey(config);
  inFlight.delete(key);
  lastSeen.set(key, Date.now());
}

api.interceptors.response.use(
  (res) => {
    finishChats(res.config || {});
    return res;
  },
  (err) => {
    if (err?.config) finishChats(err.config);
    return Promise.reject(err);
  }
);

export default api;
