/**
 * MessageList — renders chat messages, media, reply headers, and per-message actions.
 
 */

/*
[PRO] Purpose: Keep message rendering predictable and accessible with small, surgical improvements.
Context: Existing UI was correct but used unicode ticks; switching to SVG avoids platform glyph differences.
Edge cases: Long-press on touch vs right-click on desktop, deleted messages, missing originals for replies.
Notes: No new deps; all icons are inline SVG; layout and timing constants unchanged.
*/

import React, { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { getSocket } from "../sockets/socket";

/* ---------- Inline SVG icons (no emoji/unicode) ---------- */
const TickIcon = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path d="M20.3 5.7 9.5 16.5l-5.8-5.8-1.4 1.4 7.2 7.2L21.7 7.1 20.3 5.7z" fill="currentColor"/>
  </svg>
);
const DoubleTickIcon = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path d="M9.6 17.2 3.2 10.8l1.4-1.4 5 5 9-9 1.4 1.4-10.4 10.4z" fill="currentColor"/>
    <path d="M12.8 17.2 6.4 10.8l1.4-1.4 5 5 7.2-7.2 1.4 1.4-8.6 8.6z" fill="currentColor" opacity="0.8"/>
  </svg>
);

/*
[PRO] Purpose: Delivery/read status ticks with consistent visuals.
Context: Unicode ticks can render inconsistently across OS/browsers; SVG ensures clarity and theming.
Edge cases: Unknown status falls back to single tick; color shifts for read.
Notes: Keep footprint minimal; text size class preserved for alignment.
*/
function Ticks({ status }) {
  const isDelivered = status === "delivered" || status === "read";
  const isRead = status === "read";
  const colorClass = isRead ? "text-emerald-700" : "text-gray-500";
  return (
    <span className={`ml-1 inline-flex items-center ${colorClass}`}>
      {isDelivered ? <DoubleTickIcon /> : <TickIcon />}
    </span>
  );
}

/*
[PRO] Purpose: Build a compact preview line for replied-to messages.
Context: Reply header needs stable, short text even for media.
Edge cases: Non-object reply values and long texts are safely truncated.
Notes: Keeps wording neutral and compact.
*/
function previewText(m) {
  if (!m || typeof m === "string") return "Replied message";
  if (m.text) return m.text.length > 80 ? m.text.slice(0, 80) + "…" : m.text;
  if (m.type === "image") return "Photo";
  if (m.type === "video") return "Video";
  if (m.type === "audio") return "Audio";
  if (m.mediaName) return m.mediaName;
  return "Attachment";
}

/*
[PRO] Purpose: Small, unobtrusive media chip in reply header to indicate kind.
Context: Helps users recognize context without opening the original.
Edge cases: Unknown types fall back to “Document”.
Notes: Neutral styling to blend with light surfaces.
*/
function ReplyMediaChip({ m }) {
  if (!m || typeof m === "string") return null;
  const kind =
    m.type === "image" ? "Photo" :
    m.type === "video" ? "Video" :
    m.type === "audio" ? "Audio" :
    (m.mediaName ? "Document" : null);
  if (!kind) return null;

  return (
    <span
      className="inline-flex items-center px-2 py-[2px] rounded-full text-[11px] leading-none border"
      style={{ backgroundColor: "rgba(255,255,255,0.75)", borderColor: "rgba(0,0,0,0.12)" }}
    >
      {kind}
    </span>
  );
}

/**
 * MessageList
 * @param {Object} props
 * @param {Array<Object>} props.msgs
 * @param {string|number} props.me
 * @param {boolean} props.typing
 * @param {Function} props.onReply
 * @param {Function} props.onAskForward
 * @param {boolean} props.canPin
 * @param {string} [props.dmName]
 */
export default function MessageList({
  msgs = [],
  me,
  typing,
  onReply,
  onAskForward,
  canPin,
  dmName = "",
}) {
  const [menuFor, setMenuFor] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const sheetRef = useRef(null);
  const socket = getSocket();

  /*
  [PRO] Purpose: Prefer mobile-optimized menu placement when viewport is small.
  Context: Action sheet needs to stay on-screen; using a media query once is cheap.
  Edge cases: SSR guards with typeof window check inside useMemo initializer.
  Notes: Value stays stable for the render; layout effects adjust as needed.
  */
  const isSmall = useMemo(
    () => (typeof window !== "undefined" ? window.matchMedia("(max-width: 640px)").matches : false),
    []
  );

  /*
  [PRO] Purpose: O(1) lookup of original messages for reply resolution.
  Context: Reply headers should hydrate data when the original is present.
  Edge cases: Messages lacking a stable id are skipped.
  Notes: Refreshes when msgs changes; keeps Map local to avoid store coupling.
  */
  const byId = useMemo(() => {
    const map = new Map();
    (msgs || []).forEach((m) => {
      const id = m?._id || m?.clientId;
      if (id) map.set(String(id), m);
    });
    return map;
  }, [msgs]);

  /*
  [PRO] Purpose: Stop background scroll while context menu is open.
  Context: Mobile sheets can cause page drift; locking body avoids this.
  Edge cases: Restore previous overflow on cleanup.
  Notes: Applies only while a menu target exists.
  */
  useEffect(() => {
    if (!menuFor) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [menuFor]);

  const mine = (m) => String(m.sender) === String(me);
  const hiddenForMe = (m) =>
    Array.isArray(m.deletedFor) && m.deletedFor.map(String).includes(String(me));
  const openMenu = (m) => setMenuFor(m);

  /*
  [PRO] Purpose: Keep viewport anchored to latest messages in natural places.
  Context: On mount, on new messages, and when typing indicator clears.
  Edge cases: Container may not exist (early mount); guard safely.
  Notes: Smooth scroll for incremental moves; instant on initial mount.
  */
  const scrollToBottom = (smooth = false) => {
    const sc = document.querySelector('[data-chat-scroll="1"]');
    if (!sc) return;
    const top = Math.max(0, sc.scrollHeight - sc.clientHeight);
    sc.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  };
  useEffect(() => {
    scrollToBottom(false);
  }, []);
  useEffect(() => {
    scrollToBottom(true);
  }, [msgs.length]);
  useEffect(() => {
    if (!typing) scrollToBottom(true);
  }, [typing]);

  /*
  [PRO] Purpose: Ensure the mobile action sheet isn't clipped below viewport.
  Context: On small screens, adjust scroll to reveal the full sheet.
  Edge cases: If no scroll container, fall back to window scrolling.
  Notes: Runs after paint to measure actual position.
  */
  useEffect(() => {
    if (!menuFor || !isSmall) return;
    const id = setTimeout(() => {
      const pop = sheetRef.current;
      if (!pop) return;
      const rect = pop.getBoundingClientRect();
      const pad = 12;
      const overflow = rect.bottom - (window.innerHeight - pad);
      if (overflow > 0) {
        const sc = document.querySelector('[data-chat-scroll="1"]');
        if (sc) sc.scrollBy({ top: overflow + 8, behavior: "smooth" });
        else window.scrollBy({ top: overflow + 8, behavior: "smooth" });
      }
    }, 0);
    return () => clearTimeout(id);
  }, [menuFor, isSmall]);

  /*
  [PRO] Purpose: Cross-device gesture handling for opening message menu.
  Context: Long-press on touch and right-click on desktop map to the same UI.
  Edge cases: Avoid spurious triggers during edits; clean timers on cancel/leave.
  Notes: Timing tuned for responsiveness (LONG_MS/TAP_MS).
  */
  const LONG_MS = 350,
    TAP_MS = 180;
  const press = useRef({ id: null, t0: 0, timer: null });
  const clearPress = () => {
    if (press.current.timer) clearTimeout(press.current.timer);
    press.current = { id: null, t0: 0, timer: null };
  };
  const onPointerDown = (m, id, isEditing) => (e) => {
    if (isEditing) return;
    if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      openMenu(m);
      return;
    }
    if (e.pointerType === "touch") {
      e.preventDefault();
      e.currentTarget.style.webkitTouchCallout = "none";
      e.currentTarget.style.userSelect = "none";
      press.current.t0 = Date.now();
      press.current.id = id;
      press.current.timer = setTimeout(() => {
        openMenu(m);
        clearPress();
      }, LONG_MS);
    }
  };
  const onPointerUp = (m, id, isEditing) => (e) => {
    if (isEditing) return;
    if (e.pointerType === "touch") {
      e.currentTarget.style.webkitTouchCallout = "";
      e.currentTarget.style.userSelect = "";
      const dt = Date.now() - (press.current.t0 || 0);
      const same = press.current.id === id;
      const hadTimer = !!press.current.timer;
      clearPress();
      if (same && hadTimer && dt < TAP_MS) openMenu(m);
    }
  };
  const onPointerCancel = (e) => {
    if (e.currentTarget) {
      e.currentTarget.style.webkitTouchCallout = "";
      e.currentTarget.style.userSelect = "";
    }
    clearPress();
  };
  const stopCtx = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  /*
  [PRO] Purpose: Smoothly locate and highlight the original replied-to message.
  Context: Reply headers should be actionable for context recovery.
  Edge cases: Missing element id (not rendered in viewport or pruned).
  Notes: Temporary ring styles auto-clear after 1s.
  */
  const jumpToMessage = (msgId) => {
    if (!msgId) return;
    const el = document.querySelector(`[data-mid="${msgId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-emerald-400");
      setTimeout(() => el.classList.remove("ring-2", "ring-emerald-400"), 1000);
    }
  };

  /*
  [PRO] Purpose: Render the content of a message given its type.
  Context: Consolidates logic for edit mode, media, and plain text.
  Edge cases: Deleted-for-all placeholder, non-http media paths.
  Notes: Keeps event suppression so media clicks don’t bubble to open menus.
  */
  const Body = ({ m }) => {
    const id = m._id || m.clientId;
    const inEdit = editingId === id;

    if (m.deletedForAllAt) return <i className="text-gray-500">This message was deleted</i>;
    const src = m.mediaUrl?.startsWith("http")
      ? m.mediaUrl
      : m.mediaUrl
      ? window.location.origin + m.mediaUrl
      : null;

    if (inEdit) {
      return (
        <div className="flex flex-col gap-2">
          <textarea
            className="w-full border rounded-lg p-2 text-[15px] leading-snug resize-none focus:outline-none focus:ring-1 focus:ring-emerald-600"
            rows={1}
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                saveEdit(m);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 160) + "px";
            }}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button className="px-3 py-1 rounded border hover:bg-gray-50" onClick={cancelEdit}>
              Cancel
            </button>
            <button
              className="px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-50"
              onClick={() => saveEdit(m)}
              disabled={!editingText.trim()}
            >
              Save
            </button>
          </div>
        </div>
      );
    }

    const mediaClass = "rounded select-none";
    const maxBlock = "max-w-[min(480px,80vw)] md:max-w-[min(520px,68vw)]";

    if (m.type === "image" && src)
      return (
        <a href={src} target="_blank" rel="noreferrer" onContextMenu={stopCtx}>
          <img
            src={src}
            alt=""
            className={`${mediaClass} w-full h-auto object-cover ${maxBlock}`}
            draggable={false}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        </a>
      );

    if (m.type === "video" && src)
      return (
        <div onContextMenu={stopCtx} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <video src={src} controls className={`${mediaClass} w-full h-auto object-contain ${maxBlock}`} playsInline />
        </div>
      );

    if (m.type === "audio" && src)
      return (
        <div onContextMenu={stopCtx} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <audio src={src} controls className="w-56 max-w-full" />
        </div>
      );

    if (m.type !== "text" && src)
      return (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="underline break-all"
          onContextMenu={stopCtx}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {m.mediaName || "file"}
        </a>
      );

    return (
      <span className="whitespace-pre-wrap break-words" onContextMenu={stopCtx}>
        {m.text || m.mediaName || "file"}
      </span>
    );
  };

  /*
  [PRO] Purpose: Merge lightweight reply stubs with any available original message.
  Context: Servers may send only ids; hydrating improves headers without extra calls.
  Edge cases: Missing originals keep provided fields; string ids return minimal objects.
  Notes: Memoized closure over byId.
  */
  const resolveReply = useMemo(() => {
    return (replied) => {
      if (!replied) return null;
      if (typeof replied === "string") {
        const orig = byId.get(String(replied));
        return orig
          ? {
              _id: orig._id,
              type: orig.type,
              text: orig.text,
              mediaName: orig.mediaName,
              sender: orig.sender,
            }
          : { _id: replied };
      }
      const id = replied._id || replied.id;
      if (!id) return replied;
      const orig = byId.get(String(id));
      if (!orig) return replied;
      return {
        ...replied,
        _id: orig._id,
        type: orig.type ?? replied.type,
        text: orig.text ?? replied.text,
        mediaName: orig.mediaName ?? replied.mediaName,
        sender: orig.sender ?? replied.sender,
      };
    };
  }, [byId]);

  /*
  [PRO] Purpose: WhatsApp-like reply header with friendly name resolution.
  Context: Never show raw ids; prefer “You” or provided dmName for 1:1.
  Edge cases: Partials from server; media vs text previews handled distinctly.
  Notes: Click-through jumps to the original in the list.
  */
  const ReplyHeader = ({ repliedRaw, isMine }) => {
    const replied = resolveReply(repliedRaw);
    if (!replied) return null;

    const senderId = replied.sender?.id || replied.sender?._id || replied.sender || null;

    const resolvedName =
      replied.senderName ||
      replied.sender?.name ||
      (senderId ? (String(senderId) === String(me) ? "You" : dmName || "") : isMine ? "You" : dmName || "");

    const bar = isMine ? "#7E22CE" : "#25D366";
    const nameClr = isMine ? "#7E22CE" : "#128C7E";
    const boxBg = isMine ? "#E7F6D5" : "#F0F0F0";
    const border = "rgba(0,0,0,0.12)";

    const hasMedia = typeof replied !== "string" && (replied.type !== "text" || replied.mediaName);

    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          jumpToMessage(replied._id);
        }}
        title="Go to replied message"
        className="w-full text-left mb-1 rounded-[12px] relative overflow-hidden"
        style={{ backgroundColor: boxBg, border: `1px solid ${border}` }}
      >
        <div className="absolute inset-y-0 left-0" style={{ width: 4, backgroundColor: bar }} />
        <div className="pl-3 pr-2 py-2 ml-1">
          {resolvedName ? (
            <div className="text-[13px] font-semibold" style={{ color: nameClr }}>
              {resolvedName}
            </div>
          ) : null}

          {hasMedia ? (
            <div className="mt-[2px] flex items-center gap-2 text-[12px] text-gray-800">
              <ReplyMediaChip m={replied} />
              <span className="truncate">{replied.mediaName || previewText(replied)}</span>
            </div>
          ) : (
            <div className="mt-[2px] text-[12px] text-gray-800 line-clamp-2">{previewText(replied)}</div>
          )}
        </div>
      </button>
    );
  };

  const toggleReaction = (m, emoji) => socket?.emit("message:react", { messageId: m._id, emoji });

  /*
  [PRO] Purpose: Inline text editing for own messages.
  Context: Keeps the edit flow local and fast; server receives the final text only.
  Edge cases: Ignore non-text or already-deleted messages; trim empty saves.
  Notes: Menu closes when entering edit mode to reduce accidental taps.
  */
  const beginEdit = (m) => {
    if (!mine(m) || m.type !== "text" || m.deletedForAllAt) return;
    setEditingId(m._id || m.clientId);
    setEditingText(m.text || "");
    setMenuFor(null);
  };
  const saveEdit = (m) => {
    const val = (editingText || "").trim();
    if (!val) return;
    socket?.emit("message:edit", { messageId: m._id, text: val });
    setEditingId(null);
    setEditingText("");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  /*
  [PRO] Purpose: Mutations for star/pin/copy/delete with minimal UI churn.
  Context: Actions share the same close-menu behavior for consistency.
  Edge cases: Pin requires canPin; delete-everyone only for own messages.
  Notes: Clipboard write guarded to avoid throw on unsupported platforms.
  */
  const doDelete = (m, all) => {
    socket?.emit("message:delete", { messageId: m._id, forEveryone: !!all });
    setMenuFor(null);
  };
  const doCopy = async (m) => {
    try {
      await navigator.clipboard.writeText(m.text || m.mediaName || "");
    } catch {}
    setMenuFor(null);
  };
  const doStar = (m, star) => {
    socket?.emit("message:star", { messageId: m._id, star });
    setMenuFor(null);
  };
  const doPin = (m, pin) => {
    if (!canPin) return;
    socket?.emit("message:pin", { messageId: m._id, pin });
    setMenuFor(null);
  };

  const handleReply = (m) => {
    onReply?.(m);
    try {
      window.dispatchEvent(new CustomEvent("app:focusComposer"));
    } catch {}
  };

  return (
    <div className="space-y-2 overflow-x-hidden">
      {msgs.map((m) => {
        const id = m._id || m.clientId;
        if (hiddenForMe(m)) return null;
        const isMine = mine(m);
        const isOpen = menuFor && (menuFor._id || menuFor.clientId) === (m._id || m.clientId);
        const isEditing = editingId === id;

        return (
          <div key={id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
            <div
              role="button"
              tabIndex={0}
              data-mid={id}
              className={`relative overflow-visible max-w-[90%] sm:max-w-[82%] md:max-w-[70%] rounded-2xl px-3 py-2 shadow text-[15px] leading-snug ${
                isMine ? "bg-[#DCF8C6]" : "bg-white"
              }`}
              style={{
                borderTopRightRadius: isMine ? 4 : 16,
                borderTopLeftRadius: isMine ? 16 : 4,
                touchAction: "manipulation",
              }}
              onPointerDown={onPointerDown(m, id, isEditing)}
              onPointerUp={onPointerUp(m, id, isEditing)}
              onPointerCancel={onPointerCancel}
              onPointerLeave={onPointerCancel}
              onContextMenu={(e) => {
                if (isEditing) return;
                e.preventDefault();
                e.stopPropagation();
                openMenu(m);
              }}
            >
              {/* Reply header */}
              <ReplyHeader repliedRaw={m.replyTo} isMine={isMine} />

              <div className="max-w-full break-words">
                <Body m={m} />
              </div>

              <div className="mt-1 text-[10px] text-gray-600 flex items-center justify-end gap-1 select-none">
                {m.editedAt && editingId !== (m._id || m.clientId) && (
                  <span className="italic text-gray-500 mr-1">edited</span>
                )}
                {dayjs(m.createdAt).format("HH:mm")} {isMine && <Ticks status={m.status} />}
              </div>

              {/* Action menu */}
              {isOpen && !isEditing && (
                <>
                  <div className="fixed inset-0 z-[2100] bg-transparent" onPointerDown={() => setMenuFor(null)} />

                  {isSmall ? (
                    <div
                      ref={sheetRef}
                      className={`absolute ${isMine ? "right-0" : "left-0"} top-[-8px] z-[2101] rounded-xl border bg-white shadow-xl overflow-hidden inline-block`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: "max-content", maxWidth: "86vw", fontSize: "1.02rem", lineHeight: 1.15 }}
                    >
                      <button className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => { handleReply(m); setMenuFor(null); }}>
                        Reply
                      </button>
                      <button className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => { onAskForward?.(m); setMenuFor(null); }}>
                        Forward
                      </button>
                      {isMine && m.type === "text" && !m.deletedForAllAt && (
                        <button className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => beginEdit(m)}>
                          Edit
                        </button>
                      )}
                      <button className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => doCopy(m)}>
                        Copy
                      </button>
                      <button
                        className="w-full px-3 py-2 text-left hover:bg-gray-50"
                        onClick={() => doStar(m, !((m.starredBy || []).map(String).includes(String(me))))}
                      >
                        {(m.starredBy || []).map(String).includes(String(me)) ? "Unstar" : "Star"}
                      </button>
                      {canPin && (
                        <button className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => doPin(m, !m.pinnedAt)}>
                          {m.pinnedAt ? "Unpin" : "Pin"}
                        </button>
                      )}
                      <div className="border-t my-1" />
                      <button className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => doDelete(m, false)}>
                        Delete for me
                      </button>
                      {isMine && !m.deletedForAllAt && (
                        <button
                          className="w-full px-3 py-2 text-left text-red-700 hover:bg-red-50"
                          onClick={() => doDelete(m, true)}
                        >
                          Delete for everyone
                        </button>
                      )}
                    </div>
                  ) : (
                    <div
                      ref={sheetRef}
                      className={`absolute ${isMine ? "right-0" : "left-0"} top-[-8px] z-[2101] w-52 rounded-xl border bg-white shadow-xl overflow-hidden`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => { handleReply(m); setMenuFor(null); }}>
                        Reply
                      </button>
                      <button className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => { onAskForward?.(m); setMenuFor(null); }}>
                        Forward
                      </button>
                      {isMine && m.type === "text" && !m.deletedForAllAt && (
                        <button className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => beginEdit(m)}>
                          Edit
                        </button>
                      )}
                      <button className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => doCopy(m)}>
                        Copy
                      </button>
                      <button
                        className="w-full px-3 py-2 text-left hover:bg-gray-50"
                        onClick={() => doStar(m, !((m.starredBy || []).map(String).includes(String(me))))}
                      >
                        {(m.starredBy || []).map(String).includes(String(me)) ? "Unstar" : "Star"}
                      </button>
                      {canPin && (
                        <button className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => doPin(m, !m.pinnedAt)}>
                          {m.pinnedAt ? "Unpin" : "Pin"}
                        </button>
                      )}
                      <div className="border-t my-1" />
                      <button className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => doDelete(m, false)}>
                        Delete for me
                      </button>
                      {isMine && !m.deletedForAllAt && (
                        <button
                          className="w-full px-3 py-2 text-left text-red-700 hover:bg-red-50"
                          onClick={() => doDelete(m, true)}
                        >
                          Delete for everyone
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
      {typing && (
        <div className="inline-flex gap-1 p-2 text-gray-600" aria-live="polite" aria-label="User is typing">
          <span className="animate-bounce">•</span>
          <span className="animate-bounce [animation-delay:150ms]">•</span>
          <span className="animate-bounce [animation-delay:300ms]">•</span>
        </div>
      )}
    </div>
  );
}
