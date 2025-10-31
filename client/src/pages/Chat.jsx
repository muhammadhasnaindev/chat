// client/src/pages/Chat.jsx
/**
 * Chat — main 2-pane messaging surface (list + conversation) with sockets, calls, and toasts.

 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useChat from "../store/chatStore";
import useAuth from "../store/authStore";
import api from "../api/axios";
import { connectSocket, getSocket } from "../sockets/socket";

import Sidebar from "../components/Sidebar";
import ChatHeader from "../components/ChatHeader";
import MessageList from "../components/MessageList";
import MessageInput from "../components/MessageInput";
import EmptyState from "../components/EmptyState";
import GroupInfoModal from "../components/GroupInfoModal";
import CreateGroupModal from "../components/CreateGroupModal";
import CallPanel from "../components/CallPanel";
import ForwardSheet from "../components/ForwardSheet";

import AppNav from "../components/AppNav";
import GroupsDirectory from "../components/GroupsDirectory";
import CallsList from "../components/CallsList";
import ProfileDrawer from "../components/ProfileDrawer";

/* small constants to avoid magic numbers */
const BREAKPOINT_PX = 1023;
const COMPOSER_FALLBACK_H = 72;

/** Toast is wrapped so it never blocks the page */
/*
[PRO] Purpose: Non-blocking, low-friction notifications that don’t steal focus.
Context: Shown for new messages when not viewing the target chat.
Edge cases: Pointer events; ensure dismiss always available on small screens.
Notes: Keep content short. No emoji in copy to match brand tone.
*/
function Toast({ show, title, body, onClick, onClose }) {
  if (!show) return null;
  return (
    <div
      className="fixed left-3 z-[1200] max-w-sm pointer-events-none"
      style={{ bottom: "calc(var(--app-nav-h, 0px) + 12px)" }}
    >
      <div
        className="bg-white rounded-lg shadow-lg border p-3 cursor-pointer pointer-events-auto"
        onClick={onClick}
      >
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-gray-600 line-clamp-2">{body}</div>
      </div>
      <button
        className="mt-1 text-xs text-gray-500 underline pointer-events-auto"
        onClick={onClose}
      >
        dismiss
      </button>
    </div>
  );
}

/*
[PRO] Purpose: Chat page orchestration — lists, active thread, sockets, calls, toasts.
Context: Centralizes data flow across panes; coordinates store and socket events.
Edge cases: Remounts in StrictMode, narrow viewports, joining/leaving rooms.
Notes: No extra libs; keep effects idempotent and guarded.
*/
export default function Chat() {
  const navigate = useNavigate();

  const { token, user } = useAuth();
  const {
    setChats, chats, activeChat, setActiveChat, setMessages,
    pushMessage, replaceTemp, setTyping, typing, messages,
    setPresence, availability, setAvailability, chatMeta, setChatMeta,
    setChatUnreadCount, bumpChatToTop, setChatLastMessage
  } = useChat();

  const [activeTab, setActiveTab] = useState("chats");
  const [isMobile, setIsMobile] = useState(() =>
    (typeof window !== "undefined"
      ? window.matchMedia(`(max-width: ${BREAKPOINT_PX}px)`).matches
      : false)
  );
  const [showList, setShowList] = useState(true);

  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [incoming, setIncoming] = useState(null);
  const [showCall, setShowCall] = useState(false);
  const [callProps, setCallProps] = useState(null);
  const [toast, setToast] = useState({ show: false, title: "", body: "", chatId: null });

  const [replyTo, setReplyTo] = useState(null);
  const [forwardSrc, setForwardSrc] = useState(null);

  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const composerWrapRef = useRef(null);

  // Global one-time guard survives remounts in dev/StrictMode
  const fetchedOnceRef = useRef(false);

  const forceCloseModals = useMemo(
    () => () => {
      try {
        document.body.style.overflow = "";
        window.dispatchEvent(new CustomEvent("app:closeAllModals"));
      } catch {}
    },
    []
  );

  const focusComposer = useMemo(() => {
    return () => {
      try {
        const root = composerWrapRef.current;
        if (!root) return;
        const el = root.querySelector('textarea, input[type="text"], [contenteditable="true"]');
        if (el && typeof el.focus === "function") {
          el.focus({ preventScroll: true });
          if ("value" in el && typeof el.setSelectionRange === "function") {
            const len = el.value?.length ?? 0;
            el.setSelectionRange(len, len);
          }
        }
      } catch {}
    };
  }, []);

  /*
  [PRO] Purpose: Maintain a --composer-h CSS var to avoid content jump when keyboard opens.
  Context: Composer height changes with reply state and screen size.
  Edge cases: iOS viewport resizes and rotation; ensure cleanup.
  Notes: Fallback height used when measurements are unavailable.
  */
  useEffect(() => {
    const el = composerWrapRef.current;
    if (!el) return;

    const setVar = () => {
      const h = el.getBoundingClientRect().height || COMPOSER_FALLBACK_H;
      document.documentElement.style.setProperty("--composer-h", `${h}px`);
    };
    setVar();

    const ro = new ResizeObserver(setVar);
    ro.observe(el);
    window.addEventListener("resize", setVar);
    window.addEventListener("orientationchange", setVar);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", setVar);
      window.removeEventListener("orientationchange", setVar);
    };
  }, []);

  /*
  [PRO] Purpose: Keep a reactive boolean for responsive layout.
  Context: Controls whether left pane (list) is shown alongside thread.
  Edge cases: Older browsers with addListener/removeListener.
  Notes: Handler runs immediately to seed initial state consistently.
  */
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${BREAKPOINT_PX}px)`);
    const handler = (e) => {
      setIsMobile(e.matches);
      setShowList(true);
    };
    handler(mql);
    if (mql.addEventListener) mql.addEventListener("change", handler);
    else mql.addListener?.(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handler);
      else mql.removeListener?.(handler);
    };
  }, []);

  useEffect(() => {
    if (isMobile) setShowList(!activeChat);
  }, [isMobile, activeChat]);

  /*
  [PRO] Purpose: Initial chats fetch exactly once per session.
  Context: Prevents duplicate loads under StrictMode remounts.
  Edge cases: Token changes; activeChat reference invalidation.
  Notes: Flag stored on window to survive component remounts.
  */
  useEffect(() => {
    if (!token) return;
    if (fetchedOnceRef.current || window.__CHATS_FETCHED_ONCE__) return;
    fetchedOnceRef.current = true;
    window.__CHATS_FETCHED_ONCE__ = true;

    (async () => {
      try {
        const { data } = await api.get("/chats");
        const list = Array.isArray(data) ? data : [];
        setChats(list);
        if (activeChat && !list.find((c) => c._id === activeChat._id)) setActiveChat(null);
      } catch {
        // swallow; axios layer should already throttle/log
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /*
  [PRO] Purpose: Socket lifecycle; subscribe to room-agnostic events.
  Context: Connect once per token; update stores on incoming events.
  Edge cases: Reconnect loops; ensure handlers removed on unmount.
  Notes: Avoid depending on chats length to prevent churn.
  */
  useEffect(() => {
    if (!token) return;
    const socket = connectSocket(token);

    socket.on("message:new", (msg) => {
      const me = JSON.parse(localStorage.getItem("user") || "{}")?.id;

      if (msg?.clientId && msg?.chat) replaceTemp(msg.chat, msg.clientId, msg);
      else if (msg?.chat) pushMessage(msg.chat, msg);

      if (activeChat && String(activeChat._id) === String(msg.chat)) {
        requestAnimationFrame(() =>
          endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
        );
      }

      if (msg?._id && String(msg.sender) !== String(me)) {
        socket.emit("message:delivered", { messageId: msg._id });
        if (activeChat && String(activeChat._id) === String(msg.chat)) {
          socket.emit("message:read", { messageId: msg._id });
        }
      }

      if (msg?.chat) {
        const isActive = activeChat && String(activeChat._id) === String(msg.chat);
        const mine = String(msg.sender) === String(me);

        // No emojis: concise, readable preview text
        const preview =
          msg.type === "text" ? (msg.text || "") :
          msg.type === "image" ? "Photo" :
          msg.type === "video" ? "Video" :
          msg.type === "audio" ? "Audio" :
          msg.mediaName ? `Attachment: ${msg.mediaName}` : "File";

        setChatLastMessage(msg.chat, {
          _id: msg._id,
          type: msg.type,
          text: msg.text,
          mediaName: msg.mediaName,
          sender: msg.sender,
          createdAt: msg.createdAt || new Date().toISOString(),
          preview,
        });

        bumpChatToTop(msg.chat, msg.createdAt || new Date().toISOString());

        if (!isActive && !mine) {
          setChatUnreadCount(msg.chat, (prev) => (prev || 0) + 1);
          const chatObj =
            (chats || []).find((c) => String(c._id) === String(msg.chat)) || {};
          const title = chatObj.isGroup ? (chatObj.name || "Group") : "New message";
          setToast({ show: true, title, body: preview, chatId: msg.chat });
        }
      }
    });

    socket.on("message:update", (msg) => msg && replaceTemp(msg.chat, msg._id, msg));
    socket.on("typing", ({ chatId, typing }) => chatId && setTyping(chatId, typing));
    socket.on("presence:update", ({ userId, online }) => userId && setPresence(userId, online));
    socket.on("call:ring", setIncoming);

    return () => {
      socket.off("message:new");
      socket.off("message:update");
      socket.off("typing");
      socket.off("presence:update");
      socket.off("call:ring");
      socket.disconnect();
      forceCloseModals();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeChat?._id]);

  /*
  [PRO] Purpose: Load messages + per-chat metadata on chat switch.
  Context: Joins socket room, fetches messages and status/meta, zeroes unread.
  Edge cases: Legacy servers where clear endpoints differ; message read receipts.
  Notes: Scroll to bottom after mount; leave room on cleanup.
  */
  useEffect(() => {
    if (!activeChat?._id) return;
    forceCloseModals();
    setShowGroupInfo(false);

    const socket = getSocket();
    socket?.emit("chat:join", activeChat._id);

    (async () => {
      try {
        const [msgsRes, statusOrMetaRes] = await Promise.all([
          api.get(`/chats/${activeChat._id}/messages`),
          activeChat.isGroup
            ? api.get(`/chats/${activeChat._id}`)
            : api.get(`/chats/${activeChat._id}/status`),
        ]);

        setMessages(activeChat._id, Array.isArray(msgsRes.data) ? msgsRes.data : []);

        if (activeChat.isGroup) setChatMeta(activeChat._id, statusOrMetaRes.data || {});
        else
          setAvailability(activeChat._id, statusOrMetaRes.data || {
            blockedByMe: false,
            blockedMe: false,
          });

        const me = JSON.parse(localStorage.getItem("user") || "{}")?.id;
        (msgsRes.data || []).forEach((m) => {
          if (m?._id && String(m.sender) !== String(me))
            socket?.emit("message:read", { messageId: m._id });
        });

        setChatUnreadCount(activeChat._id, 0);

        requestAnimationFrame(() =>
          endRef.current?.scrollIntoView({ behavior: "auto", block: "end" })
        );
      } catch {
        setMessages(activeChat._id, []);
        if (activeChat.isGroup) setChatMeta(activeChat._id, {});
        else setAvailability(activeChat._id, { blockedByMe: false, blockedMe: false });
      }
    })();

    return () => {
      socket?.emit("chat:leave", activeChat._id);
      forceCloseModals();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?._id]);

  /*
  [PRO] Purpose: Allow other components to request a bottom scroll (e.g., after send).
  Context: Simple event channel avoids prop drilling into scroll container.
  Edge cases: None significant; listener removed on unmount.
  Notes: Smooth behavior for consistency with message arrivals.
  */
  useEffect(() => {
    const s = () =>
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    window.addEventListener("app:scrollToBottom", s);
    return () => window.removeEventListener("app:scrollToBottom", s);
  }, []);

  useEffect(() => {
    if (replyTo)
      requestAnimationFrame(() =>
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
      );
  }, [replyTo]);

  const currentMsgs = activeChat?._id ? (messages?.[activeChat._id] || []) : [];
  const dmStatus = activeChat?._id
    ? availability?.[activeChat._id] || { blockedByMe: false, blockedMe: false }
    : { blockedByMe: false, blockedMe: false };

  const meta = activeChat?.isGroup ? (chatMeta?.[activeChat._id] || {}) : null;
  const admins = Array.isArray(meta?.admins) ? meta.admins.map((a) => a?._id || a) : [];
  const amAdmin = admins.some((a) => String(a) === String(user?.id));
  const onlyAdmins = !!meta?.settings?.onlyAdminsCanMessage;

  const navIsVisible = !(isMobile && activeChat);
  const navOffset = navIsVisible ? "var(--app-nav-h, 0px)" : "0px";

  const meId = user?.id;
  const otherIdForActive = useMemo(() => {
    if (!activeChat || activeChat.isGroup) return null;
    const parts = Array.isArray(activeChat.participants) ? activeChat.participants : [];
    const norm = (p) => String(p?._id || p);
    const other = parts.find((p) => norm(p) !== String(meId)) || parts[0];
    return other ? norm(other) : null;
  }, [activeChat, meId]);

  const canPin = useMemo(() => {
    if (!activeChat) return false;
    if (!activeChat.isGroup) return true;
    const adminsIds = (chatMeta?.[activeChat._id]?.admins || []).map((a) => a?._id || a);
    return adminsIds.some((a) => String(a) === String(user?.id));
  }, [activeChat, chatMeta, user?.id]);

  const openProfileDrawer = () => {
    if (!activeChat || activeChat.isGroup || !otherIdForActive) return;
    setProfileUserId(otherIdForActive);
    setProfileOpen(true);
  };
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState(null);
  const openFullProfile = () => {
    if (!activeChat || activeChat.isGroup || !otherIdForActive) return;
    navigate(`/profile/${activeChat._id}/${otherIdForActive}`);
  };

  const LeftPane = () => {
    if (activeTab === "groups") return <GroupsDirectory onOpen={() => setShowList(false)} />;
    if (activeTab === "calls")
      return (
        <div className="h-full overflow-y-auto ios-bounce">
          <CallsList />
        </div>
      );
    return (
      <Sidebar
        onSelectChat={() => setShowList(false)}
        onNewGroup={() => setShowCreateGroup(true)}
      />
    );
  };

  return (
    <div
      className="h-[100dvh] md:h-screen bg-gray-50 md:grid md:grid-cols-12 safe-areas overflow-x-hidden"
      style={{ paddingBottom: navOffset }}
    >
      {/* LEFT */}
      <div
        className={`h-full ${showList ? "block" : "hidden"} md:block md:col-span-4 border-r bg-white min-h-0 overflow-y-auto ios-bounce`}
        style={{ paddingBottom: navOffset }}
      >
        <LeftPane />
      </div>

      {/* RIGHT */}
      <div
        className={`h-full ${showList ? "hidden" : "flex"} md:flex md:col-span-8 flex-col min-h-0 overflow-x-hidden`}
      >
        {activeChat ? (
          !!activeChat && typeof activeChat.isGroup === "boolean" && typeof activeChat._id === "string" ? (
            <>
              <div className="shrink-0 sticky top-0 z-10 bg-white/90 backdrop-blur border-b">
                <ChatHeader
                  chat={activeChat}
                  onBack={() => {
                    if (isMobile) setActiveChat(null);
                    setShowList(true);
                  }}
                  onOpenGroupInfo={() => setShowGroupInfo(true)}
                  onStartAudio={() => startCall("audio")}
                  onStartVideo={() => startCall("video")}
                  onViewProfile={openProfileDrawer}
                  onOpenFullProfile={openFullProfile}
                />
              </div>

              {/* SCROLL CONTAINER */}
              <div
                ref={scrollRef}
                data-chat-scroll="1"
                className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4 lg:p-6 space-y-2 ios-bounce overscroll-contain"
                style={{ scrollPaddingBottom: "var(--composer-h, 72px)" }}
              >
                <MessageList
                  msgs={currentMsgs}
                  me={user?.id}
                  typing={typing?.[activeChat._id]}
                  onReply={(m) => {
                    setReplyTo({ _id: m._id, text: m.text || m.mediaName || "", type: m.type });
                    requestAnimationFrame(focusComposer);
                  }}
                  onAskForward={(m) => setForwardSrc(m)}
                  canPin={canPin}
                  dmName={
                    !activeChat.isGroup
                      ? (
                          activeChat.name ||
                          (activeChat.participants || [])
                            .map((p) => p?.name || p?.fullName || "")
                            .find((n) => n && n !== user?.name) ||
                          ""
                        )
                      : ""
                  }
                />
                <div ref={endRef} style={{ height: 0 }} />
              </div>

              {/* COMPOSER */}
              <div
                ref={composerWrapRef}
                className="shrink-0 border-t bg-white sticky z-10"
                style={{ position: "sticky", bottom: navOffset }}
              >
                <MessageInput
                  chatId={activeChat._id}
                  blockedByMe={!!availability?.[activeChat._id]?.blockedByMe}
                  blockedMe={!!availability?.[activeChat._id]?.blockedMe}
                  adminsOnlyLocked={
                    !!(
                      activeChat?.isGroup &&
                      chatMeta?.[activeChat._id]?.settings?.onlyAdminsCanMessage &&
                      !((chatMeta?.[activeChat._id]?.admins || []).some(
                        (a) => String(a?._id || a) === String(user?.id)
                      ))
                    )
                  }
                  replyTo={replyTo}
                  onCancelReply={() => {
                    setReplyTo(null);
                    requestAnimationFrame(focusComposer);
                  }}
                />
              </div>

              {activeChat?.isGroup && showGroupInfo && (
                <GroupInfoModal
                  open={showGroupInfo}
                  chatId={activeChat._id}
                  onClose={() => setShowGroupInfo(false)}
                  onUpdated={(data) => {
                    if (data?.deleted || data?.left) {
                      (async () => {
                        const { data: list } = await api.get("/chats");
                        setChats(Array.isArray(list) ? list : []);
                        setActiveChat(null);
                        setShowList(true);
                      })();
                      return;
                    }
                    setChatMeta(activeChat._id, data || {});
                  }}
                />
              )}

              <ProfileDrawer
                open={!!profileOpen}
                userId={profileUserId}
                chatId={activeChat?._id}
                onClose={() => setProfileOpen(false)}
                onOpenFullProfile={openFullProfile}
                onBlockedChange={({ blockedByMe }) => {
                  if (!activeChat?._id) return;
                  setAvailability(activeChat._id, {
                    ...(availability?.[activeChat._id] || {}),
                    blockedByMe: !!blockedByMe,
                  });
                }}
              />

              <Toast
                show={toast.show}
                title={toast.title}
                body={toast.body}
                onClick={() => {
                  const tgt = (chats || []).find((c) => String(c._id) === String(toast.chatId));
                  if (tgt) setActiveChat(tgt);
                  setToast({ show: false, title: "", body: "", chatId: null });
                }}
                onClose={() => setToast({ show: false, title: "", body: "", chatId: null })}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
              Loading chat...
            </div>
          )
        ) : (
          <>
            <EmptyState />
            <Toast
              show={toast.show}
              title={toast.title}
              body={toast.body}
              onClick={() => {
                const tgt = (chats || []).find((c) => String(c._id) === String(toast.chatId));
                if (tgt) setActiveChat(tgt);
                setToast({ show: false, title: "", body: "", chatId: null });
              }}
              onClose={() => setToast({ show: false, title: "", body: "", chatId: null })}
            />
          </>
        )}
      </div>

      {/* Incoming call */}
      {incoming && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-xl shadow-xl p-4 w-[92%] max-w-sm">
            <div className="font-semibold mb-1">
              {incoming.kind === "video" ? "Video call" : "Audio call"}
              {incoming.isGroup ? " in group" : ""}
            </div>
            <div className="text-sm text-gray-600">
              from {String(incoming.from).slice(-6)}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                className="px-3 py-1 border rounded"
                onClick={() => {
                  getSocket()?.emit("call:reject", { callId: incoming.callId });
                  setIncoming(null);
                }}
              >
                Reject
              </button>
              <button
                className="px-3 py-1 rounded bg-emerald-600 text-white"
                onClick={() => {
                  const chatObj =
                    (chats || []).find((c) => String(c._id) === String(incoming.chatId)) ||
                    activeChat ||
                    { _id: incoming.chatId, isGroup: incoming.isGroup };
                  setCallProps({
                    mode: "incoming",
                    chat: chatObj,
                    kind: incoming.kind,
                    callId: incoming.callId,
                  });
                  setShowCall(true);
                  setIncoming(null);
                }}
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {showCall && callProps && (
        <CallPanel
          mode={callProps.mode}
          chat={callProps.chat}
          kind={callProps.kind}
          callId={callProps.callId}
          onClose={() => {
            setShowCall(false);
            setCallProps(null);
          }}
        />
      )}

      {showCreateGroup && <CreateGroupModal onClose={() => setShowCreateGroup(false)} />}

      {/* Forward sheet */}
      {forwardSrc && (
        <ForwardSheet
          open={!!forwardSrc}
          sourceMessage={forwardSrc}
          onClose={() => setForwardSrc(null)}
        />
      )}

      {!(
        isMobile && activeChat
      ) && <AppNav value={activeTab} onChange={setActiveTab} />}
    </div>
  );
}

/*
[PRO] Purpose: Initiate an outgoing call (audio/video) from ChatHeader.
Context: Kept as a local helper to minimize prop churn elsewhere.
Edge cases: Missing active chat; socket unavailable; stale chat object.
Notes: Lean on CallPanel for the actual media session lifecycle.
*/
function startCall(kind) {
  // This is a simple adapter for ChatHeader onStartAudio/onStartVideo.
  // Actual call setup happens via socket events and CallPanel.
  getSocket()?.emit("call:start", { kind });
}
