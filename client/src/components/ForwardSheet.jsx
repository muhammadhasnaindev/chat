// src/components/ForwardSheet.jsx

/**
 * ForwardSheet — bottom sheet to forward a message into an existing chat.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useChat from "../store/chatStore";
import { getSocket } from "../sockets/socket";
import GroupsIcon from "@mui/icons-material/Groups";

/*
[PRO] Purpose: Let users forward a message to an existing chat quickly.
Context: Closes on ESC/visibility/scroll/resize and after forwarding; opens target chat WhatsApp-style.
Edge cases: Missing chat names/avatars; missing source message; no chats matching search.
Notes: Minimal UI; no new libraries beyond MUI icons for consistency.
*/

const MAX_SHEET_H = "70vh";
const MAX_LIST_H = "50vh";

function chatDisplayName(c) {
  if (!c) return "Chat";
  if (c.isGroup) return c.name || "Group";
  const p = c.participants?.[0];
  return (p && (p.name || p.username)) || "User";
}

export default function ForwardSheet({ open, sourceMessage, onClose }) {
  const { chats = [], setActiveChat } = useChat();
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const socket = getSocket();

  useEffect(() => {
    if (!open) return;
    const close = () => onClose?.();
    const onKey = (e) => e.key === "Escape" && close();
    const onVis = () => document.visibilityState === "hidden" && close();
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close, true);
    window.addEventListener("scroll", close, true);
    document.addEventListener("visibilitychange", onVis, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close, true);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("visibilitychange", onVis, true);
    };
  }, [open, onClose]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return chats;
    return chats.filter((c) => chatDisplayName(c).toLowerCase().includes(t));
  }, [q, chats]);

  if (!open) return null;

  const forwardTo = (chatId) => {
    const msgId = sourceMessage?._id;
    if (!msgId || !chatId) return;
    try {
      socket?.emit("message:forward", { messageId: msgId, toChatId: chatId });
    } catch (e) {
      console.debug("[ForwardSheet] emit failed:", e?.message);
    }
    // open that chat immediately (WhatsApp-like)
    const target = chats.find((c) => String(c._id) === String(chatId));
    if (target) setActiveChat(target);
    onClose?.();
  };

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 z-[2000]" onClick={onClose} />
      <div
        ref={ref}
        className="fixed left-0 right-0 bottom-0 z-[2001] bg-white rounded-t-2xl shadow-2xl border-t p-2 md:max-w-lg md:left-1/2 md:-translate-x-1/2"
        style={{ maxHeight: MAX_SHEET_H }}
        role="dialog"
        aria-modal="true"
        aria-label="Forward message"
      >
        <div className="h-1 w-10 rounded-full bg-gray-300 mx-auto my-1" />
        <div className="px-2 py-1 font-semibold">Forward message</div>
        <div className="px-2 pb-2">
          <input
            className="w-full border rounded-lg p-2 text-sm"
            placeholder="Search chats…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search chats"
          />
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: MAX_LIST_H }}>
          {list.length === 0 ? (
            <div className="text-sm text-gray-500 px-3 py-6 text-center">No chats found</div>
          ) : (
            list.map((c) => (
              <button
                key={c._id}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 active:scale-[.99] text-left"
                onClick={() => forwardTo(c._id)}
                title={`Forward to ${chatDisplayName(c)}`}
                type="button"
              >
                {c.isGroup ? (
                  c.iconUrl ? (
                    <img src={c.iconUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-emerald-600 text-white grid place-items-center">
                      <GroupsIcon fontSize="small" />
                    </div>
                  )
                ) : (
                  <div className="w-10 h-10 rounded-full bg-emerald-600 text-white grid place-items-center">
                    {(c.participants?.[0]?.name || "U").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="font-medium truncate">{chatDisplayName(c)}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {c.lastMessage?.preview || ""}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="p-2" />
      </div>
    </>,
    document.body
  );
}
