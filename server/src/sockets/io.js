// server/src/sockets/io.js
/*
[PRO] Purpose: Real-time transport for messaging, presence, typing, and lightweight call orchestration.
Context: HTTP handles persistence; sockets fan out hydrated payloads and maintain ephemeral presence/call state.
Edge cases: Multi-device users (many sockets per user), DM block checks, admin-only group posting, racey disconnects.
Notes: Keep memory registries small (Maps/Sets), hydrate replyTo.sender for UI, and isolate room names with prefixes.
*/
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import User from '../models/User.js';

// ==============================================
// Online presence: userId -> Set(socketId)
// ==============================================
/*
[PRO] Purpose: Track all live sockets per user to multicast targeted events (typing, call signals).
Context: Users may connect from multiple tabs/devices; we avoid overwriting a single socket reference.
Edge cases: Rapid reconnects can leave stale ids → we prune on 'disconnect'.
Notes: Map(userId -> Set(socketId)) gives O(1) add/remove and cheap broadcast per user.
*/
const onlineUsers = new Map();

// --- helpers to emit group-related updates ---
function broadcastGroup(io, chatId, event, payload) {
  io.to(`chat:${chatId}`).emit(event, payload);
}

async function emitGroupToParticipants(io, chat) {
  for (const u of chat.participants) {
    const set = onlineUsers.get(String(u._id || u));
    if (set) {
      for (const sid of set) {
        io.to(sid).emit('group:refresh', { chatId: String(chat._id || chat) });
      }
    }
  }
}

// ==============================================
// ====== CALLS: In-memory call registry =========
// ==============================================
/*
[PRO] Purpose: Ephemeral call coordination (ring/accept/leave) without persisting media state.
Context: Persisted call logs are handled by controllers; here we only coordinate live participation.
Edge cases: Host leaves → call ends; last member leaves → end; reject vs miss; race on accept after end.
Notes: Keys are deterministic for single node; cluster deployments should move to a shared store.
*/
const activeCalls = new Map(); // callId -> { id, chatId, kind, host, members:Set<userId>, createdAt }
function makeId() {
  return 'call_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

// helper: emit to all sockets of a user
function emitToUser(io, userId, event, payload) {
  const set = onlineUsers.get(String(userId));
  if (set) for (const sid of set) io.to(sid).emit(event, payload);
}

// helper: get participant ids for chat
async function getChatParticipants(chatId) {
  const chat = await Chat.findById(chatId).select('participants isGroup name').lean();
  if (!chat) throw new Error('Chat not found');
  return { chat, participants: (chat.participants || []).map(String) };
}

// ===================== Hydration helpers =====================
/*
[PRO] Purpose: Shape messages for clients with inline reply sender info to avoid N+1 on the frontend.
Context: UI needs replied sender name even for historical messages; we hydrate once near the DB.
Edge cases: replyTo may be missing or partially populated; guard optional paths.
Notes: Keep the selection minimal to avoid heavy docs.
*/
async function hydrateMessageForClient(msgDoc) {
  const populated = await msgDoc.populate({
    path: 'replyTo',
    select: '_id type text mediaName sender',
    populate: { path: 'sender', select: '_id name avatar' },
  });
  const out = populated.toObject();
  if (out?.replyTo?.sender && typeof out.replyTo.sender === 'object') {
    out.replyTo.senderName = out.replyTo.sender.name || undefined;
  }
  return out;
}

async function hydrateManyMessagesForClient(query) {
  const msgs = await query
    .populate({
      path: 'replyTo',
      select: '_id type text mediaName sender',
      populate: { path: 'sender', select: '_id name avatar' },
    })
    .lean({ getters: true });

  return (msgs || []).map((m) => {
    if (m?.replyTo?.sender && typeof m.replyTo.sender === 'object') {
      m.replyTo.senderName = m.replyTo.sender.name || undefined;
    }
    return m;
  });
}

async function emitMessageUpdate(io, msgDoc) {
  const chatId = String(msgDoc.chat);
  const target = new Set();

  // watchers in the chat room
  const room = io.sockets.adapter.rooms.get(`chat:${chatId}`);
  if (room) for (const rsid of room) target.add(rsid);

  // all online participants (other tabs/devices)
  const chat = await Chat.findById(chatId).select('participants').lean();
  if (chat) {
    for (const u of (chat.participants || [])) {
      const set = onlineUsers.get(String(u));
      if (set) for (const rsid of set) target.add(rsid);
    }
  }

  const out = await hydrateMessageForClient(msgDoc);
  for (const rsid of target) io.to(rsid).emit('message:update', out);
}

// will hold the live io instance for controllers to reuse
let ioInstance = null;
export const getIO = () => ioInstance;

// ============================================================
// Init
// ============================================================
/*
[PRO] Purpose: Bind Socket.IO with JWT auth and wire all chat/call events.
Context: CORS origin supports comma-separated origins via upstream config; credentials allow cookies if used.
Edge cases: Invalid tokens; refreshing tokens during transport is not handled here (reconnect required).
Notes: Keep per-connection listeners lean; heavy work delegated to helpers.
*/
export function initSocket(httpServer, corsOrigin = env.CORS_ORIGIN) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
  });
  ioInstance = io;

  // Auth gate
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No token'));
      const payload = jwt.verify(token, env.JWT_SECRET);
      socket.userId = String(payload.id);
      next();
    } catch {
      next(new Error('Auth failed'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    const sid = socket.id;
    console.log('socket connected', { userId, sid });

    // presence: track this socket
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(sid);

    await User.findByIdAndUpdate(userId, { lastSeen: new Date() });
    io.emit('presence:update', { userId, online: true });

    // ---- Chat room membership ----
    socket.on('chat:join', (chatId) => socket.join(`chat:${chatId}`));
    socket.on('chat:leave', (chatId) => socket.leave(`chat:${chatId}`));

    // ---- Typing indicators ----
    socket.on('typing', ({ chatId, typing }) => {
      socket.to(`chat:${chatId}`).emit('typing', { chatId, userId, typing: !!typing });
    });
    socket.on('typing:start', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('typing', { chatId, userId, typing: true });
    });
    socket.on('typing:stop', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('typing', { chatId, userId, typing: false });
    });

    // =======================================================
    // HISTORY (backfill) — always hydrated
    // =======================================================
    socket.on('messages:fetch', async ({ chatId, before, limit = 50 }) => {
      try {
        if (!chatId) throw new Error('chatId required');

        const base = Message.find(
          before
            ? { chat: chatId, createdAt: { $lt: new Date(before) } }
            : { chat: chatId }
        )
          .sort({ createdAt: -1 })
          .limit(Math.max(1, Math.min(200, limit)));

        const items = await hydrateManyMessagesForClient(base);
        items.reverse(); // chronological for UI
        io.to(sid).emit('messages:fetch:result', { chatId, items });
      } catch (e) {
        io.to(sid).emit('error', { where: 'messages:fetch', message: e?.message || 'Failed to fetch messages' });
      }
    });

    // =======================================================
    // SEND MESSAGE — guards + hydrate replyTo before emit
    // =======================================================
    socket.on('message:send', async ({
      chatId,
      text,
      type = 'text',
      mediaUrl,
      mediaName,
      mediaSize,
      mediaDuration,
      clientId,
      replyToId,
    }) => {
      try {
        const chat = await Chat.findById(chatId)
          .populate('participants', '_id blocked') // keep lean; admins live on chat doc
          .lean();
        if (!chat) throw new Error('Chat not found');

        // groups: admins only when enabled
        if (chat.isGroup && chat.settings?.onlyAdminsCanMessage) {
          const isAdmin = (chat.admins || []).some((a) => String(a) === String(userId));
          if (!isAdmin) throw new Error('Only group admins can send messages');
        }

        // DMs: respect blocks both ways
        if (!chat.isGroup) {
          const others = (chat.participants || []).filter((u) => String(u._id || u) !== String(userId));
          const meDoc = (chat.participants || []).find((u) => String(u._id || u) === String(userId));
          const myBlocks = new Set((meDoc?.blocked || []).map(String));
          for (const p of others) if (myBlocks.has(String(p._id || p))) throw new Error('You blocked this contact');
          for (const p of others) {
            const theirBlocks = new Set((p.blocked || []).map(String));
            if (theirBlocks.has(String(userId))) throw new Error('Recipient blocked you');
          }
        }

        const msg = await Message.create({
          chat: chatId,
          sender: userId,
          text,
          type,
          mediaUrl,
          mediaName,
          mediaSize,
          mediaDuration,
          status: 'sent',
          replyTo: replyToId || undefined,
        });
        await Chat.findByIdAndUpdate(chatId, { lastMessageAt: new Date() });

        const out = await hydrateMessageForClient(msg);
        if (clientId) out.clientId = clientId;

        // target sockets = viewers + all participants + sender
        const target = new Set();
        const room = io.sockets.adapter.rooms.get(`chat:${chatId}`);
        if (room) for (const rsid of room) target.add(rsid);
        for (const u of chat.participants) {
          const uid = String(u._id || u);
          const set = onlineUsers.get(uid);
          if (set) for (const tsid of set) target.add(tsid);
        }
        target.add(sid);

        for (const rsid of target) io.to(rsid).emit('message:new', out);
      } catch (err) {
        io.to(sid).emit('error', { where: 'message:send', message: err?.message || 'Failed to send' });
      }
    });

    // ---- delivery ack ----
    socket.on('message:delivered', async ({ messageId }) => {
      const msg = await Message.findById(messageId);
      if (!msg) return;
      if (!msg.deliveredTo.map(String).includes(userId)) msg.deliveredTo.push(userId);
      if (msg.status !== 'read') msg.status = 'delivered';
      await msg.save();

      const out = await hydrateMessageForClient(msg);
      io.to(`chat:${msg.chat}`).emit('message:update', out);
    });

    // ---- read ack ----
    socket.on('message:read', async ({ messageId }) => {
      const msg = await Message.findById(messageId);
      if (!msg) return;
      if (!msg.readBy.map(String).includes(userId)) msg.readBy.push(userId);
      msg.status = 'read';
      await msg.save();

      const out = await hydrateMessageForClient(msg);
      io.to(`chat:${msg.chat}`).emit('message:update', out);
    });

    // =======================================================
    // Updates (react/edit/delete/star/pin/forward)
    // =======================================================
    async function broadcastMsgUpdate(msgDoc) {
      await emitMessageUpdate(io, msgDoc);
    }

    socket.on('message:react', async ({ messageId, emoji }) => {
      try {
        if (!emoji) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;
        const i = (msg.reactions || []).findIndex(r => String(r.by) === String(userId) && r.emoji === emoji);
        if (i >= 0) msg.reactions.splice(i, 1);
        else msg.reactions.push({ emoji, by: userId });
        await msg.save();
        await broadcastMsgUpdate(msg);
      } catch (e) {
        io.to(sid).emit('error', { where: 'message:react', message: e?.message || 'Failed to react' });
      }
    });

    socket.on('message:edit', async ({ messageId, text }) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;
        if (String(msg.sender) !== String(userId)) throw new Error('Only sender can edit');
        if (msg.type !== 'text') throw new Error('Only text can be edited');
        if (msg.deletedForAllAt) throw new Error('Message was deleted');
        msg.text = (text || '').slice(0, 5000);
        msg.editedAt = new Date();
        await msg.save();
        await broadcastMsgUpdate(msg);
      } catch (e) {
        io.to(sid).emit('error', { where: 'message:edit', message: e?.message || 'Failed to edit' });
      }
    });

    socket.on('message:delete', async ({ messageId, forEveryone }) => {
      try {
        const msg = await Message.findById(messageId).lean(false);
        if (!msg) return;

        if (forEveryone) {
          const chat = await Chat.findById(msg.chat).select('isGroup admins').lean();
          const isAdmin = chat?.isGroup && (chat.admins || []).some(a => String(a) === String(userId));
          const can = String(msg.sender) === String(userId) || isAdmin;
          if (!can) throw new Error('Not allowed');

          if (!msg.deletedForAllAt) {
            msg.deletedForAllAt = new Date();
            msg.text = '';
            msg.mediaUrl = '';
            msg.mediaName = '';
            msg.mediaSize = undefined;
          }
          await msg.save();
          await broadcastMsgUpdate(msg);
        } else {
          if (!msg.deletedFor.map(String).includes(String(userId))) {
            msg.deletedFor.push(userId);
            await msg.save();
          }
          const out = await hydrateMessageForClient(msg);
          io.to(sid).emit('message:update', out);
        }
      } catch (e) {
        io.to(sid).emit('error', { where: 'message:delete', message: e?.message || 'Delete failed' });
      }
    });

    socket.on('message:star', async ({ messageId, star }) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;
        const set = new Set((msg.starredBy || []).map(String));
        star ? set.add(String(userId)) : set.delete(String(userId));
        msg.starredBy = Array.from(set);
        await msg.save();
        await broadcastMsgUpdate(msg);
      } catch (e) {
        io.to(sid).emit('error', { where: 'message:star', message: e?.message || 'Failed to star' });
      }
    });

    socket.on('message:pin', async ({ messageId, pin }) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;
        const chat = await Chat.findById(msg.chat).select('isGroup admins').lean();
        const isAdmin = chat?.isGroup ? (chat.admins || []).some(a => String(a) === String(userId)) : true;
        if (!isAdmin) throw new Error('Admins only');
        msg.pinnedAt = pin ? new Date() : null;
        msg.pinnedBy = pin ? userId : null;
        await msg.save();
        await broadcastMsgUpdate(msg);
      } catch (e) {
        io.to(sid).emit('error', { where: 'message:pin', message: e?.message || 'Failed to pin' });
      }
    });

    socket.on('message:forward', async ({ messageId, toChatId }) => {
      try {
        const src = await Message.findById(messageId);
        if (!src) throw new Error('Source message not found');

        const targetChat = await Chat.findById(toChatId).select('participants').lean();
        if (!targetChat) throw new Error('Target chat not found');
        if (!(targetChat.participants || []).map(String).includes(String(userId))) {
          throw new Error('Not a participant of target chat');
        }

        const copy = await Message.create({
          chat: toChatId,
          sender: userId,
          type: src.type,
          text: src.type === 'text' ? src.text : undefined,
          mediaUrl: src.mediaUrl,
          mediaName: src.mediaName,
          mediaSize: src.mediaSize,
          mediaDuration: src.mediaDuration,
          status: 'sent',
          forwardOf: src._id,
        });

        const outSelf = await hydrateMessageForClient(copy);
        io.to(sid).emit('message:new', outSelf);

        const targetSockets = new Set();
        const room = io.sockets.adapter.rooms.get(`chat:${toChatId}`);
        if (room) for (const rsid of room) targetSockets.add(rsid);
        for (const u of (targetChat.participants || [])) {
          const set = onlineUsers.get(String(u));
          if (set) for (const rsid of set) targetSockets.add(rsid);
        }
        const outOthers = await hydrateMessageForClient(copy);
        for (const rsid of targetSockets) io.to(rsid).emit('message:new', outOthers);
      } catch (e) {
        io.to(sid).emit('error', { where: 'message:forward', message: e?.message || 'Forward failed' });
      }
    });

    // =================== CALL HANDLERS ======================
    socket.on('call:start', async ({ chatId, kind = 'audio' }) => {
      try {
        const { chat, participants } = await getChatParticipants(chatId);
        if (!participants.includes(String(userId))) throw new Error('Not a participant');

        const id = makeId();
        const call = { id, chatId, kind, host: userId, members: new Set([userId]), createdAt: Date.now() };
        activeCalls.set(id, call);
        socket.join(`call:${id}`);

        io.to(sid).emit('call:created', {
          callId: id, chatId, kind, host: userId, members: Array.from(call.members),
        });

        for (const p of participants) {
          if (String(p) === String(userId)) continue;
          emitToUser(io, p, 'call:ring', { callId: id, chatId, kind, from: userId, isGroup: !!chat.isGroup });
        }
      } catch (e) {
        io.to(sid).emit('call:error', { message: e?.message || 'Failed to start call' });
      }
    });

    socket.on('call:accept', async ({ callId }) => {
      try {
        const call = activeCalls.get(callId);
        if (!call) throw new Error('Call not found');
        call.members.add(userId);
        socket.join(`call:${callId}`);

        io.to(sid).emit('call:participants', {
          callId, members: Array.from(call.members), host: call.host, kind: call.kind,
        });
        socket.to(`call:${callId}`).emit('call:joined', { callId, userId });
      } catch (e) {
        io.to(sid).emit('call:error', { message: e?.message || 'Failed to join call' });
      }
    });

    socket.on('call:reject', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      emitToUser(io, call.host, 'call:rejected', { callId, userId });
    });

    socket.on('call:leave', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      call.members.delete(userId);
      socket.leave(`call:${callId}`);
      io.to(`call:${callId}`).emit('call:left', { callId, userId });

      // fix: delete by callId (not undefined local id)
      if (call.host === userId || call.members.size === 0) {
        io.to(`call:${callId}`).emit('call:ended', { callId, reason: 'host_left' });
        activeCalls.delete(callId);
      }
    });

    socket.on('call:end', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      if (String(call.host) !== String(userId)) return;
      io.to(`call:${callId}`).emit('call:ended', { callId, reason: 'ended_by_host' });
      activeCalls.delete(callId);
    });

    socket.on('call:signal', ({ callId, toUserId, data }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      emitToUser(io, toUserId, 'call:signal', { callId, fromUserId: userId, data });
    });

    // =======================================================
    // Disconnect cleanup
    // =======================================================
    socket.on('disconnect', async () => {
      const set = onlineUsers.get(userId);
      if (set) {
        set.delete(sid);
        if (set.size === 0) onlineUsers.delete(userId);
      }
      await User.findByIdAndUpdate(userId, { lastSeen: new Date() });
      io.emit('presence:update', { userId, online: onlineUsers.has(userId) });
      console.log('socket disconnected', { userId, sid });

      for (const [id, call] of activeCalls.entries()) {
        if (call.members.has(userId)) {
          call.members.delete(userId);
          io.to(`call:${id}`).emit('call:left', { callId: id, userId });
          if (call.host === userId || call.members.size === 0) {
            io.to(`call:${id}`).emit('call:ended', { callId: id, reason: 'host_left' });
            activeCalls.delete(id);
          }
        }
      }
    });
  });

  // expose group helpers on io (optional)
  io.broadcastGroup = (chatId, event, payload) => broadcastGroup(io, chatId, event, payload);
  io.emitGroupToParticipants = (chat) => emitGroupToParticipants(io, chat);

  return io;
}

export { broadcastGroup, emitGroupToParticipants };
