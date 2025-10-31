/**
 * ProfileDrawer — right-side drawer with DM counterpart info and block/unblock.
 
 */

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useChat from "../store/chatStore";
import api from "../api/axios";

/** constants (no magic numbers) */
const MS_PER_MIN = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const SWIPE_CLOSE_PX = 64;
const TRANSITION_MS = 150;

const CloseIcon = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...p}>
    <path d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7A1 1 0 0 0 5.7 7.1L10.6 12l-4.9 4.9a1 1 0 1 0 1.4 1.4L12 13.4l4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z" fill="currentColor"/>
  </svg>
);

/*
[PRO] Purpose: Convert ISO timestamps to compact, human-friendly status
Context: Keeps presence line readable across locales without heavy libs
Edge cases: Invalid dates or missing input return empty/default strings
Notes: Uses safe toLocaleString fallbacks; avoids throwing in older browsers
*/
function formatLastSeen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < MS_PER_MIN) return "just now";
  if (diff < MS_PER_HOUR) return `${Math.floor(diff / MS_PER_MIN)}m ago`;
  if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)}h ago`;
  try {
    return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return d.toLocaleString();
  }
}

/**
 * @typedef {Object} DrawerProps
 * @property {boolean} open
 * @property {string} userId
 * @property {string} chatId
 * @property {() => void} onClose
 * @property {(p:{blockedByMe:boolean}) => void} onBlockedChange
 * @property {() => void} [onOpenFullProfile]
 */

/**
 * @param {DrawerProps} props
 */
export default function ProfileDrawer({
  open,
  userId,
  chatId,
  onClose,
  onBlockedChange,
  onOpenFullProfile,
}) {
  const navigate = useNavigate();
  const { presence, availability, setAvailability } = useChat();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState({ name: "", avatar: "", about: "", lastSeen: null });
  const [mutating, setMutating] = useState(false);

  const blockedByMe = !!availability?.[chatId]?.blockedByMe;
  const blockedMe = !!availability?.[chatId]?.blockedMe;

  /*
  [PRO] Purpose: Prevent background scroll while the drawer overlays the page
  Context: Mobile Safari can scroll the body behind fixed overlays
  Edge cases: Preserve previous overflow value to avoid layout side effects
  Notes: Only toggles when open changes; cleans on unmount
  */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /*
  [PRO] Purpose: Fetch public profile when the drawer opens
  Context: Keeps data fresh without permanent subscriptions
  Edge cases: Component may unmount during fetch; guard with 'alive' flag
  Notes: Minimal user-facing fallback to avoid noisy alerts
  */
  useEffect(() => {
    if (!open || !userId) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { data } = await api.get(`/users/${userId}/public`);
        if (!alive) return;
        setProfile({
          name: data?.name || "",
          avatar: data?.avatar || "",
          about: data?.about || "",
          lastSeen: data?.lastSeen || null,
        });
      } catch {
        if (alive) setProfile({ name: "User", avatar: "", about: "", lastSeen: null });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, userId]);

  const online = !!presence?.[userId];
  const lastActive = profile.lastSeen ? formatLastSeen(profile.lastSeen) : "unknown";

  /*
  [PRO] Purpose: Block/unblock counterpart in the current DM
  Context: Reflects change in local availability store for instant UI feedback
  Edge cases: Network latency; disable buttons during mutation
  Notes: No user-visible errors here; keep flow quiet and reversible
  */
  const doBlock = async () => {
    try {
      setMutating(true);
      await api.post(`/users/block/${userId}`);
      setAvailability(chatId, { ...(availability?.[chatId] || {}), blockedByMe: true });
      onBlockedChange?.({ blockedByMe: true });
    } finally {
      setMutating(false);
    }
  };
  const doUnblock = async () => {
    try {
      setMutating(true);
      await api.post(`/users/unblock/${userId}`);
      setAvailability(chatId, { ...(availability?.[chatId] || {}), blockedByMe: false });
      onBlockedChange?.({ blockedByMe: false });
    } finally {
      setMutating(false);
    }
  };

  /*
  [PRO] Purpose: Navigate to a full profile view while collapsing the drawer
  Context: Keeps navigation paths consistent whether handler is passed or not
  Edge cases: Ensure both ids exist for route-based navigation
  Notes: Closes drawer immediately to avoid double overlays
  */
  const openFullProfile = () => {
    if (onOpenFullProfile) {
      onOpenFullProfile();
      onClose?.();
      return;
    }
    if (chatId && userId) {
      navigate(`/profile/${chatId}/${userId}`);
      onClose?.();
    }
  };

  /*
  [PRO] Purpose: Natural swipe-to-close on touch devices
  Context: Users expect drawers to follow finger and dismiss past a threshold
  Edge cases: Ensure transform resets when threshold not met; guard null refs
  Notes: Keep animations short to avoid input lag (TRANSITION_MS)
  */
  const panelRef = useRef(null);
  const startX = useRef(null);
  const currentX = useRef(null);
  const dragging = useRef(false);

  const onTouchStart = (e) => {
    const touch = e.touches[0];
    startX.current = touch.clientX;
    currentX.current = touch.clientX;
    dragging.current = true;
  };
  const onTouchMove = (e) => {
    if (!dragging.current) return;
    const touch = e.touches[0];
    currentX.current = touch.clientX;
    const closeDX = Math.max(0, currentX.current - startX.current);
    if (panelRef.current) {
      panelRef.current.style.transform = closeDX > 0 ? `translateX(${closeDX}px)` : "translateX(0)";
    }
  };
  const onTouchEnd = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const closeDX = Math.max(0, currentX.current - startX.current);
    if (closeDX > SWIPE_CLOSE_PX) {
      if (panelRef.current) {
        panelRef.current.style.transition = `transform ${TRANSITION_MS}ms ease-out`;
        panelRef.current.style.transform = "translateX(100%)";
        setTimeout(() => {
          if (panelRef.current) panelRef.current.style.transition = "";
          onClose?.();
        }, TRANSITION_MS - 10);
      } else {
        onClose?.();
      }
    } else if (panelRef.current) {
      panelRef.current.style.transition = `transform ${TRANSITION_MS}ms ease-out`;
      panelRef.current.style.transform = "translateX(0)";
      setTimeout(() => {
        if (panelRef.current) panelRef.current.style.transition = "";
      }, TRANSITION_MS - 10);
    }
    startX.current = null;
    currentX.current = null;
  };

  return (
    <div
      className={`fixed inset-0 z-[1200] ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={open ? "false" : "true"}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`absolute right-0 top-0 h-full bg-white border-l shadow-xl transform transition-transform
          ${open ? "translate-x-0" : "translate-x-full"}
          w-full sm:w-[92%] md:w-[420px] max-w-full
        `}
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <div className="px-4 pb-3 flex items-center justify-between border-b">
            <div className="text-[clamp(16px,3.4vw,18px)] font-semibold">Profile</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-100 text-sm"
                onClick={openFullProfile}
                title="Open full profile"
              >
                Full profile
              </button>
              <button
                type="button"
                className="w-9 h-9 inline-flex items-center justify-center rounded-full hover:bg-gray-100"
                onClick={() => onClose?.()}
                aria-label="Close"
                title="Close"
              >
                <CloseIcon />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="h-full overflow-y-auto px-4">
          {loading ? (
            <div className="py-6 text-sm text-gray-500">Loading…</div>
          ) : (
            <>
              {/* Header block */}
              <div className="pt-4 flex items-center gap-3">
                {profile.avatar ? (
                  <img
                    src={profile.avatar}
                    alt={profile.name}
                    className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xl flex-shrink-0">
                    {(profile.name || "U").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="font-medium truncate text-[clamp(15px,4vw,18px)]">
                    {profile.name || "User"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {online ? "Online" : `Last active ${lastActive}`}
                  </div>
                </div>
              </div>

              {/* About */}
              {profile.about ? (
                <div className="mt-4">
                  <div className="text-xs text-gray-500 mb-1">About</div>
                  <div className="text-sm break-words">{profile.about}</div>
                </div>
              ) : null}

              {/* Actions */}
              <div className="mt-6 flex flex-col sm:flex-row gap-2">
                {blockedMe ? (
                  <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 self-start">
                    They blocked you
                  </span>
                ) : null}

                {blockedByMe ? (
                  <button
                    type="button"
                    disabled={mutating}
                    onClick={doUnblock}
                    className="inline-flex justify-center px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-60 w-full sm:w-auto"
                  >
                    {mutating ? "Unblocking…" : "Unblock"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={mutating}
                    onClick={doBlock}
                    className="inline-flex justify-center px-4 py-2 rounded-lg bg-red-600 text-white text-sm disabled:opacity-60 w-full sm:w-auto"
                  >
                    {mutating ? "Blocking…" : "Block"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={openFullProfile}
                  className="inline-flex justify-center px-4 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 w-full sm:w-auto"
                >
                  View full profile
                </button>
              </div>

              <div className="mt-2 mb-6 text-xs text-gray-500">
                {blockedByMe
                  ? "You won't receive messages from this user until you unblock."
                  : "Block stops messages in this DM."}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
