// src/store/chatStore.js
/**
 * Chat store — chats list, active chat, messages, presence, and meta.

 */

/*
[PRO] Purpose: Centralize chat-session state to keep UI fast and consistent.
Context: Socket events arrive out of order; store reconciles optimistic vs. server updates.
Edge cases: Duplicate messages, missing realMsg, unknown chatId—defensive checks prevent crashes.
Notes: Always return new arrays/objects to trigger renders; avoid mutating existing state.
*/
import { create } from "zustand";

const useChat = create((set, get) => ({
  chats: [],
  activeChat: null,
  messages: {},          // { [chatId]: Message[] }
  typing: {},            // { [chatId]: boolean }
  presence: {},          // { [userId]: boolean }
  availability: {},      // { [chatId]: { blockedByMe, blockedMe } }
  chatMeta: {},          // { [chatId]: { admins:[], settings:{} } }

  // High-level setters
  setChats: (chats) => set({ chats }),
  setActiveChat: (chat) => set({ activeChat: chat }),

  setMessages: (chatId, msgs) =>
    set((s) => ({ messages: { ...s.messages, [chatId]: Array.isArray(msgs) ? msgs : [] } })),

  pushMessage: (chatId, msg) =>
    set((s) => {
      const list = s.messages[chatId] || [];
      if (msg?._id && list.some((m) => String(m._id) === String(msg._id))) {
        return { messages: s.messages }; // already present
      }
      return { messages: { ...s.messages, [chatId]: [...list, msg] } };
    }),

  /*
  [PRO] Purpose: Swap an optimistic message with its server version; also works if only _id is known.
  Context: Server may echo with _id while client has clientId; support both lookup paths.
  Edge cases: Missing realMsg, unknown clientId/_id—append safely without duplication.
  Notes: Keeps order stable by replacing in place; appends only when necessary.
  */
  replaceTemp: (chatId, clientIdOrRealId, realMsg) =>
    set((s) => {
      const list = s.messages[chatId] || [];
      if (!realMsg) return { messages: s.messages };

      let idx = list.findIndex((m) => m.clientId && m.clientId === clientIdOrRealId);
      if (idx < 0) {
        idx = list.findIndex((m) => m._id && String(m._id) === String(clientIdOrRealId));
      }

      if (idx >= 0) {
        const next = [...list];
        next[idx = idx] = realMsg; // replace in place
        return { messages: { ...s.messages, [chatId]: next } };
      }

      if (realMsg._id && list.some((m) => String(m._id) === String(realMsg._id))) {
        return { messages: s.messages };
      }
      return { messages: { ...s.messages, [chatId]: [...list, realMsg] } };
    }),

  setTyping: (chatId, val) =>
    set((s) => ({ typing: { ...s.typing, [chatId]: !!val } })),

  setPresence: (userId, online) =>
    set((s) => ({ presence: { ...s.presence, [userId]: !!online } })),

  setAvailability: (chatId, value) =>
    set((s) => ({ availability: { ...s.availability, [chatId]: value || { blockedByMe: false, blockedMe: false } } })),

  setChatMeta: (chatId, meta) =>
    set((s) => ({ chatMeta: { ...s.chatMeta, [chatId]: meta || {} } })),

  /*
  [PRO] Purpose: Track unread per chat without recomputing entire lists.
  Context: Socket events can increment; opening a chat resets to zero.
  Edge cases: Unknown chatId—no state change; negative values clamped to zero.
  Notes: Accepts number or updater fn for flexibility.
  */
  setChatUnreadCount: (chatId, valueOrUpdater) =>
    set((s) => {
      const list = [...(s.chats || [])];
      const idx = list.findIndex((c) => String(c._id) === String(chatId));
      if (idx < 0) return {};
      const curr = list[idx].unreadCount || 0;
      const next = typeof valueOrUpdater === "function" ? valueOrUpdater(curr) : valueOrUpdater;
      list[idx] = { ...list[idx], unreadCount: Math.max(0, next | 0) };
      return { chats: list };
    }),

  /*
  [PRO] Purpose: Move a chat to the top when new activity arrives.
  Context: Matches common chat UX by ordering on latest message time.
  Edge cases: Unknown chatId—no-op; missing date uses now.
  Notes: Does not mutate the original array; preserves other entries.
  */
  bumpChatToTop: (chatId, lastMessageAt) =>
    set((s) => {
      const list = [...(s.chats || [])];
      const idx = list.findIndex((c) => String(c._id) === String(chatId));
      if (idx < 0) return {};
      const updated = { ...list[idx], lastMessageAt: lastMessageAt || new Date().toISOString() };
      list.splice(idx, 1);
      list.unshift(updated);
      return { chats: list };
    }),

  /*
  [PRO] Purpose: Store a lightweight preview and timestamp for sidebar rows.
  Context: Sidebar should not walk the full messages array for each render.
  Edge cases: Unknown chatId—no-op; missing createdAt keeps previous timestamp.
  Notes: Keep preview minimal; upstream decides the preview string.
  */
  setChatLastMessage: (chatId, lastMessageObj) =>
    set((s) => {
      const list = [...(s.chats || [])];
      const idx = list.findIndex((c) => String(c._id) === String(chatId));
      if (idx < 0) return {};
      const curr = list[idx];
      list[idx] = {
        ...curr,
        lastMessage: lastMessageObj,
        lastMessageAt: lastMessageObj?.createdAt || curr?.lastMessageAt || new Date().toISOString(),
      };
      return { chats: list };
    }),
}));

export default useChat;
