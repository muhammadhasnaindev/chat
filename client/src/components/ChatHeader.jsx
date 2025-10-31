// src/components/ChatHeader.jsx

/**
 * ChatHeader: title, presence, and call actions with local CallPanel fallback.
 */

import React, { useEffect, useRef, useState, useMemo } from "react";
import CallOutlinedIcon from "@mui/icons-material/CallOutlined";
import VideocamOutlinedIcon from "@mui/icons-material/VideocamOutlined";
import useAuth from "../store/authStore";
import useChat from "../store/chatStore";
import api from "../api/axios";
import CallPanel from "./CallPanel"; // ensure this path is correct

/*
[PRO] Purpose: Provide stable chat header with presence and quick call actions.
Context: DM vs Group shows different subtitle; click actions open CallPanel and also run external hooks.
Edge cases: Unknown lastSeen; user without avatar; mobile back closes modals first.
Notes: Keep behavior intact; avoid new deps.
*/

function formatLastSeen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const min = 60 * 1000,
    hr = 60 * min,
    day = 24 * hr;
  if (diffMs < min) return "just now";
  if (diffMs < hr) return `${Math.floor(diffMs / min)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hr)}h ago`;
  const isYesterday =
    new Date(now.toDateString()) - new Date(d.toDateString()) === day;
  const two = (n) => String(n).padStart(2, "0");
  const hhmm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  if (isYesterday) return `yesterday ${hhmm}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.toLocaleString(undefined, { month: "short" })} ${d.getDate()} ${hhmm}`;
  }
  return `${d.toLocaleDateString()} ${hhmm}`;
}

/**
 * @param {{
 *  chat: any,
 *  onBack?: ()=>void,
 *  onOpenGroupInfo?: ()=>void,
 *  onStartAudio?: ()=>void,
 *  onStartVideo?: ()=>void,
 *  onViewProfile?: ()=>void,
 *  onOpenFullProfile?: ()=>void
 * }} props
 */
export default function ChatHeader({
  chat,
  onBack,
  onOpenGroupInfo,
  onStartAudio,
  onStartVideo,
  onViewProfile,
  onOpenFullProfile,
}) {
  const { user } = useAuth();
  const { presence } = useChat();

  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  // Local CallPanel state (fallback)
  const [callOpen, setCallOpen] = useState(false);
  const [callKind, setCallKind] = useState("audio"); // 'audio' | 'video'

  const meId = user?.id;
  const participants = Array.isArray(chat?.participants) ? chat.participants : [];
  const normalizeId = (p) => String(p?._id || p);
  const other =
    !chat?.isGroup
      ? participants.find((p) => normalizeId(p) !== String(meId)) || participants[0]
      : null;
  const otherId = !chat?.isGroup && other ? normalizeId(other) : null;

  const title = useMemo(() => {
    if (chat?.isGroup) return chat?.name || "Group";
    if (other && typeof other === "object" && other?.name) return other.name;
    return "Chat";
  }, [chat?.isGroup, chat?.name, other]);

  const avatarUrl = useMemo(() => {
    if (chat?.isGroup) return chat?.iconUrl || "";
    if (other && typeof other === "object") return other?.avatar || "";
    return "";
  }, [chat?.isGroup, chat?.iconUrl, other]);

  const fallbackInitial = useMemo(() => {
    const n = chat?.isGroup ? chat?.name || "G" : other?.name || "U";
    return n.slice(0, 1).toUpperCase();
  }, [chat?.isGroup, chat?.name, other]);

  const [otherPublic, setOtherPublic] = useState({ lastSeen: null });
  useEffect(() => {
    let alive = true;
    setOtherPublic({ lastSeen: null });
    (async () => {
      try {
        if (!otherId || chat?.isGroup) return;
        const { data } = await api.get(`/users/${otherId}/public`);
        if (!alive) return;
        setOtherPublic({ lastSeen: data?.lastSeen || null });
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [otherId, chat?.isGroup]);

  const subtitle = useMemo(() => {
    if (!chat) return "";
    if (chat.isGroup) {
      const ids = participants.map(normalizeId);
      const onlineCount = ids.reduce((acc, uid) => acc + (presence?.[uid] ? 1 : 0), 0);
      return `${onlineCount} online · ${ids.length} members`;
    } else {
      if (!otherId) return "Direct message";
      const online = !!presence?.[otherId];
      if (online) return "Online";
      return otherPublic.lastSeen
        ? `Last active ${formatLastSeen(otherPublic.lastSeen)}`
        : "Last active unknown";
    }
  }, [chat, participants, presence, otherId, otherPublic.lastSeen]);

  const closeMenu = () => setOpen(false);
  useEffect(() => {
    const onDocDown = (e) => {
      const t = e.target;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      closeMenu();
    };
    const onEsc = (e) => e.key === "Escape" && closeMenu();
    const onCloseAll = () => closeMenu();
    const onScroll = () => closeMenu();
    const onResize = () => closeMenu();
    const onVis = () => document.visibilityState === "hidden" && closeMenu();

    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("focusin", onDocDown, true);
    document.addEventListener("keydown", onEsc, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize, true);
    document.addEventListener("visibilitychange", onVis, true);
    window.addEventListener("app:closeAllModals", onCloseAll, true);
    return () => {
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("focusin", onDocDown, true);
      document.removeEventListener("keydown", onEsc, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize, true);
      document.removeEventListener("visibilitychange", onVis, true);
      window.removeEventListener("app:closeAllModals", onCloseAll, true);
    };
  }, []);

  // Always open panel; run external handlers if provided
  function startAudio() {
    setCallKind("audio");
    setCallOpen(true);
    if (typeof onStartAudio === "function") onStartAudio();
  }
  function startVideo() {
    setCallKind("video");
    setCallOpen(true);
    if (typeof onStartVideo === "function") onStartVideo();
  }

  return (
    <>
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        {/* Left */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            className="md:hidden px-2 py-1 rounded hover:bg-gray-50"
            onClick={() => {
              try {
                window.dispatchEvent(new CustomEvent("app:closeAllModals"));
              } catch {}
              onBack?.();
            }}
            aria-label="Back"
            title="Back"
            type="button"
          >
            ←
          </button>

          {/* Avatar */}
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={title}
              className="w-8 h-8 rounded-full object-cover border"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center text-sm">
              {fallbackInitial}
            </div>
          )}

          {/* Title + subtitle */}
          <div className="min-w-0">
            <div
              className="font-semibold leading-tight truncate text-[clamp(14px,4vw,17px)]"
              style={{
                maxWidth: "70vw",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </div>
            <div className="text-[11px] text-gray-500 truncate">{subtitle}</div>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1 relative">
          <button
            className="px-2 py-1 rounded hover:bg-gray-50"
            onClick={startAudio}
            title="Audio call"
            aria-label="Audio call"
            type="button"
          >
            <CallOutlinedIcon fontSize="small" />
          </button>
          <button
            className="px-2 py-1 rounded hover:bg-gray-50"
            onClick={startVideo}
            title="Video call"
            aria-label="Video call"
            type="button"
          >
            <VideocamOutlinedIcon fontSize="small" />
          </button>

          {/* 3-dots */}
          <button
            ref={btnRef}
            className="px-2 py-1 rounded hover:bg-gray-50"
            onClick={() => setOpen((s) => !s)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="More"
            title="More"
            type="button"
          >
            ⋮
          </button>

          {/* Menu */}
          {open && (
            <div
              ref={menuRef}
              role="menu"
              className="absolute right-0 top-[110%] w-48 bg-white border rounded-lg shadow-lg py-1 z-50"
            >
              {chat?.isGroup && (
                <button
                  role="menuitem"
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                  onClick={() => {
                    onOpenGroupInfo?.();
                    setOpen(false);
                  }}
                  type="button"
                >
                  Group info
                </button>
              )}

              {!chat?.isGroup && (
                <>
                  <button
                    role="menuitem"
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                    onClick={() => {
                      try {
                        window.dispatchEvent(new CustomEvent("app:closeAllModals"));
                      } catch {}
                      setOpen(false);
                      onViewProfile?.();
                    }}
                    type="button"
                  >
                    View profile
                  </button>
                  <button
                    role="menuitem"
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                    onClick={() => {
                      try {
                        window.dispatchEvent(new CustomEvent("app:closeAllModals"));
                      } catch {}
                      setOpen(false);
                      onOpenFullProfile?.();
                    }}
                    type="button"
                  >
                    Open full profile
                  </button>
                </>
              )}

              <div className="my-1 border-t" />
              <button
                role="menuitem"
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                onClick={() => setOpen(false)}
                type="button"
              >
                Block / Mute
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Local call panel fallback */}
      {callOpen && (
        <CallPanel mode="outgoing" chat={chat} kind={callKind} onClose={() => setCallOpen(false)} />
      )}
    </>
  );
}
