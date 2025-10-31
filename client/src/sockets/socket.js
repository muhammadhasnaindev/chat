// src/sockets/socket.js
/**
 * Lightweight Socket.IO client wrapper.
 */

/*
[PRO] Purpose: Centralize socket connection lifecycle and keep a single client instance.
Context: Multiple components need a shared socket; a singleton avoids duplicate connections.
Edge cases: Missing URL, token changes, and reconnect behavior—guard URL, expose disconnect.
Notes: Keep options minimal for reliability; callers own event subscriptions.
*/
import { io } from "socket.io-client";

let socket = null;

/** Connect (or re-connect) using the provided token. */
export function connectSocket(token) {
  const url = import.meta.env.VITE_SOCKET_URL;
  if (!url) {
    console.warn("[socket] Missing VITE_SOCKET_URL");
    return null;
  }
  // If an old client exists, close it before creating a new one.
  try { socket?.disconnect(); } catch {}
  socket = io(url, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 8,
    reconnectionDelay: 500,
    transports: ["websocket"], // prefer WS; falls back internally if needed
  });
  return socket;
}

/** Get the active socket instance (may be null before connect). */
export function getSocket() {
  return socket;
}

/** Allow callers to explicitly close socket (e.g., on logout). */
export function disconnectSocket() {
  try { socket?.disconnect(); } finally { socket = null; }
}
