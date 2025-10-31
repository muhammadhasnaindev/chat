// server/src/routes/chat.routes.js
/*
[PRO] Purpose: All chat and group HTTP endpoints (lists, messages, metadata, membership, settings, public directory).
Context: Sockets push real-time changes; REST remains the source of truth for initial loads and non-realtime actions.
Edge cases: Route order matters (create group before parameterized routes); access control enforced in controllers.
Notes: Keep message list sorted chronologically; align payload shapes with client store expectations.
*/
import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import {
  // Lists
  listMyChats,
  listPublicGroups,

  // DMs
  getOrCreateDirectChat,

  // Messages
  getMessages,
  sendMessage,

  // Chat status / fetch
  getChatStatus,
  getChat,

  // Groups
  createGroup,
  updateGroup,
  updateGroupSettings,
  addMember,
  removeMember,
  promoteAdmin,
  demoteAdmin,
  leaveGroup,
  deleteGroup,

  // Public groups
  joinPublicGroup,
  setGroupPublic,

  // Media & links & maintenance
  listChatMedia,
  listChatLinks,
  clearChat,
} from '../controllers/chat.controller.js';

const r = Router();

// Chats list
r.get('/', auth, listMyChats);

// Public groups directory
r.get('/public', auth, listPublicGroups);

// Create group (must be before :chatId routes)
r.post('/group', auth, createGroup);

// Direct chat utility
r.get('/direct/:userId', auth, getOrCreateDirectChat);

// Messages
r.get('/:chatId/messages', auth, getMessages);
r.post('/:chatId/messages', auth, sendMessage);

// Chat status and fetch
r.get('/:chatId/status', auth, getChatStatus);
r.get('/:chatId', auth, getChat);

// Group management
r.patch('/:chatId', auth, updateGroup);
r.patch('/:chatId/settings', auth, updateGroupSettings);
r.post('/:chatId/add', auth, addMember);
r.post('/:chatId/remove', auth, removeMember);
r.post('/:chatId/promote', auth, promoteAdmin);
r.post('/:chatId/demote', auth, demoteAdmin);
r.post('/:chatId/leave', auth, leaveGroup);
r.delete('/:chatId', auth, deleteGroup);

// Public group actions
r.post('/:chatId/join', auth, joinPublicGroup);
r.patch('/:chatId/public', auth, setGroupPublic);

// Media, links, maintenance
r.get('/:chatId/media', auth, listChatMedia);
r.get('/:chatId/links', auth, listChatLinks);
r.delete('/:chatId/clear', auth, clearChat);

export default r;
