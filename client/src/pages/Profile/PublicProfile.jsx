// client/src/pages/PublicProfile.jsx
/**
 * PublicProfile — DM counterpart profile view with chat-scoped actions.

 */

import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../../api/axios";
import useChat from "../../store/chatStore";
import useAuth from "../../store/authStore";

/*
[PRO] Purpose: Human-friendly "last seen" with minimal locale use.
Context: Profiles surface "last active" often; this avoids heavy libs and keeps UX stable.
Edge cases: Invalid/missing ISO; cross-day formatting (yesterday); year rollover; falls back safely.
Notes: Keep time math lightweight; avoid throwing for malformed values.
*/
const ONE_MIN = 60 * 1000;
const ONE_HOUR = 60 * ONE_MIN;
const ONE_DAY = 24 * ONE_HOUR;
function formatLastSeen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (Number.isNaN(d.getTime())) return "";
  const diff = now - d;

  if (diff < ONE_MIN) return "just now";
  if (diff < ONE_HOUR) return `${Math.floor(diff / ONE_MIN)}m ago`;
  if (diff < ONE_DAY) return `${Math.floor(diff / ONE_HOUR)}h ago`;

  const startOfToday = new Date(now.toDateString());
  const startOfThatDay = new Date(d.toDateString());
  const isYesterday = startOfToday - startOfThatDay === ONE_DAY;

  const two = (n) => String(n).padStart(2, "0");
  const hhmm = `${two(d.getHours())}:${two(d.getMinutes())}`;

  if (isYesterday) return `yesterday ${hhmm}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.toLocaleString(undefined, { month: "short" })} ${d.getDate()} ${hhmm}`;
  }
  return `${d.toLocaleDateString()} ${hhmm}`;
}

/*
[PRO] Purpose: Profile screen for a DM peer with basic moderation and cleanup actions.
Context: Lives outside the chat view; needs to load public user info and chat-scoped artifacts.
Edge cases: Missing chatId (e.g., opened from directory) removes chat-only actions; slow network is handled.
Notes: No new deps; relies on store for presence/availability to avoid redundant sockets here.
*/
export default function PublicProfile() {
  const navigate = useNavigate();
  const { chatId, userId } = useParams(); // route: /profile/:chatId/:userId
  const { presence, availability, setAvailability } = useChat();
  const { user } = useAuth();

  const [profile, setProfile] = useState(null);
  const [media, setMedia] = useState([]);
  const [links, setLinks] = useState([]);
  const [tab, setTab] = useState("about");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);

  const blockedByMe = !!(availability?.[chatId]?.blockedByMe);
  const online = !!presence?.[userId];
  const lastActive = useMemo(
    () => (profile?.lastSeen ? formatLastSeen(profile.lastSeen) : "unknown"),
    [profile?.lastSeen]
  );

  /*
  [PRO] Purpose: Fetch public profile and chat-scoped media/links in one pass.
  Context: Users expect content to be present when navigating from a chat; parallel requests reduce wait time.
  Edge cases: Missing chatId (no media/links); soft-fail leaves UI usable; effect cleans up on unmount.
  Notes: Avoids double state commits by checking "alive"; keeps shape stable.
  */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [p, m, l] = await Promise.all([
          api.get(`/users/${userId}/public`),
          chatId ? api.get(`/chats/${chatId}/media`) : Promise.resolve({ data: [] }),
          chatId ? api.get(`/chats/${chatId}/links`) : Promise.resolve({ data: [] }),
        ]);
        if (!alive) return;
        setProfile(p.data || null);
        setMedia(Array.isArray(m.data) ? m.data : []);
        setLinks(Array.isArray(l.data) ? l.data : []);
      } catch {
        // soft fail — keep partials if any
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [chatId, userId]);

  /*
  [PRO] Purpose: Consistent back navigation whether or not history exists.
  Context: Deep links may not have a prior entry; fallback route avoids dead ends.
  Edge cases: history length 0/1 on some browsers; ensures home fallback.
  Notes: Keep behavior predictable on mobile standalone windows.
  */
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  /*
  [PRO] Purpose: Moderation toggles (block/unblock) with instant local reflection.
  Context: Availability state drives composer lock elsewhere; keeping it in sync avoids page reloads.
  Edge cases: Parallel clicks are locked by "mutating"; short-lived toast confirms outcome.
  Notes: Status messages auto-clear; errors fall back to default alert channel upstream if needed.
  */
  const doBlock = async () => {
    try {
      setMutating(true);
      await api.post(`/users/block/${userId}`);
      setAvailability(chatId, { ...(availability?.[chatId] || {}), blockedByMe: true });
      setMsg("Blocked");
    } finally {
      setMutating(false);
      const id = setTimeout(() => setMsg(""), 1800);
      // no need to store id; short-lived and harmless on unmount
    }
  };
  const doUnblock = async () => {
    try {
      setMutating(true);
      await api.post(`/users/unblock/${userId}`);
      setAvailability(chatId, { ...(availability?.[chatId] || {}), blockedByMe: false });
      setMsg("Unblocked");
    } finally {
      setMutating(false);
      const id = setTimeout(() => setMsg(""), 1800);
    }
  };

  /*
  [PRO] Purpose: Client-initiated "clear chat" that only affects the current user’s view.
  Context: New API prefers POST; older servers used DELETE — support both for compatibility.
  Edge cases: User cancels; request fails silently without breaking screen; lists are emptied optimistically.
  Notes: No global refresh; media/links cleared immediately to reflect intent.
  */
  const clearChat = async () => {
    if (!chatId) return;
    // basic confirmation — avoids accidental purge
    // (Keep native dialog for zero-dependency, consistent UX)
    // eslint-disable-next-line no-restricted-globals
    if (!confirm("Clear chat for you? This hides older messages for you only.")) return;
    try {
      setMutating(true);
      try {
        await api.post(`/chats/${chatId}/clear`);
      } catch {
        await api.delete(`/chats/${chatId}/clear`);
      }
      setMedia([]);
      setLinks([]);
      setMsg("Chat cleared");
    } finally {
      setMutating(false);
      const id = setTimeout(() => setMsg(""), 1800);
    }
  };

  // small inline chevron-left icon (replaces unicode arrow)
  const BackIcon = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.5 5 9 11.5 15.5 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  return (
    <div className="h-[100dvh] bg-white flex flex-col">
      {/* Sticky header with Back */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b">
        <div className="px-3 py-2 flex items-center gap-2">
          <button
            className="px-2 py-1 rounded hover:bg-gray-100 inline-flex items-center gap-1"
            onClick={goBack}
            aria-label="Back"
            title="Back"
          >
            <BackIcon />
            <span className="sr-only">Back</span>
          </button>
          <div className="min-w-0">
            <div className="font-semibold leading-tight truncate">
              {profile?.name || "Profile"}
            </div>
            <div className="text-[11px] text-gray-500 truncate">
              {online ? "Online" : `Last active ${lastActive}`}
            </div>
          </div>
          <div className="flex-1" />
          {/* Quick actions on wide screens */}
          <div className="hidden md:flex items-center gap-2">
            {blockedByMe ? (
              <button
                disabled={mutating}
                onClick={doUnblock}
                className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm disabled:opacity-60"
              >
                {mutating ? "…" : "Unblock"}
              </button>
            ) : (
              <button
                disabled={mutating}
                onClick={doBlock}
                className="px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-60"
              >
                {mutating ? "…" : "Block"}
              </button>
            )}
            {chatId && (
              <button
                disabled={mutating}
                onClick={clearChat}
                className="px-3 py-1.5 rounded border text-sm disabled:opacity-60"
              >
                {mutating ? "…" : "Clear chat"}
              </button>
            )}
          </div>
        </div>
      </div>

      {msg && (
        <div className="px-3 pt-3" aria-live="polite">
          <div className="text-sm bg-emerald-50 text-emerald-700 p-2 rounded">{msg}</div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 md:py-6">
        {loading ? (
          <div className="text-sm text-gray-500">Loading profile...</div>
        ) : (
          <>
            {/* Top card with actions for mobile */}
            <div className="bg-white border rounded-2xl shadow-sm p-4">
              <div className="flex items-center gap-4">
                {profile?.avatar ? (
                  <img
                    src={profile.avatar}
                    alt={profile?.name || "User"}
                    className="w-16 h-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-emerald-600 text-white flex items-center justify-center text-2xl">
                    {(profile?.name || "U").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-lg font-semibold truncate">{profile?.name || "User"}</div>
                  <div className="text-xs text-gray-500">
                    {online ? "Online" : `Last active ${lastActive}`}
                  </div>
                </div>
                <div className="flex-1" />
                <div className="flex md:hidden items-center gap-2">
                  {blockedByMe ? (
                    <button
                      disabled={mutating}
                      onClick={doUnblock}
                      className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm disabled:opacity-60"
                    >
                      {mutating ? "…" : "Unblock"}
                    </button>
                  ) : (
                    <button
                      disabled={mutating}
                      onClick={doBlock}
                      className="px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-60"
                    >
                      {mutating ? "…" : "Block"}
                    </button>
                  )}
                  {chatId && (
                    <button
                      disabled={mutating}
                      onClick={clearChat}
                      className="px-3 py-1.5 rounded border text-sm disabled:opacity-60"
                    >
                      {mutating ? "…" : "Clear"}
                    </button>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="mt-5 border-b flex gap-4">
                <button
                  onClick={() => setTab("about")}
                  className={`px-2 pb-2 -mb-px ${tab === "about" ? "border-b-2 border-emerald-600 font-medium" : "text-gray-600"}`}
                >
                  About
                </button>
                <button
                  onClick={() => setTab("media")}
                  className={`px-2 pb-2 -mb-px ${tab === "media" ? "border-b-2 border-emerald-600 font-medium" : "text-gray-600"}`}
                >
                  Media
                </button>
                <button
                  onClick={() => setTab("links")}
                  className={`px-2 pb-2 -mb-px ${tab === "links" ? "border-b-2 border-emerald-600 font-medium" : "text-gray-600"}`}
                >
                  Links
                </button>
              </div>

              {/* About */}
              {tab === "about" && (
                <div className="mt-4 text-sm">
                  <div className="text-gray-500 mb-1">About</div>
                  <div>{profile?.about || "—"}</div>
                </div>
              )}

              {/* Media */}
              {tab === "media" && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                  {media.map((m) => (
                    <a
                      key={m._id}
                      href={m.mediaUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block border rounded overflow-hidden"
                    >
                      <div className="text-xs px-2 py-1 bg-gray-50">{(m.type || "").toUpperCase()}</div>
                      <div className="p-2 truncate">{m.mediaName || m.mediaUrl}</div>
                    </a>
                  ))}
                  {!media.length && (
                    <div className="text-sm text-gray-600">No media yet.</div>
                  )}
                </div>
              )}

              {/* Links */}
              {tab === "links" && (
                <div className="mt-4 space-y-2">
                  {links.map((l) => (
                    <div key={l._id} className="p-2 border rounded">
                      <div className="text-sm break-words">{l.text}</div>
                      <div className="text-[11px] text-gray-500">
                        {l.createdAt ? new Date(l.createdAt).toLocaleString() : ""}
                      </div>
                    </div>
                  ))}
                  {!links.length && (
                    <div className="text-sm text-gray-600">No links yet.</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Bottom safe area on mobile */}
      <div className="h-3 md:h-0" />
    </div>
  );
}
