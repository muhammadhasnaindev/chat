// utils/chatProjection.js
/*
[PRO] Purpose: Build consistent list items for chats and compute per-user unread counts.
Context: The chats list needs lightweight projections with a text preview and counts without over-fetching.
Edge cases: Missing last message, empty per-user markers, and non-text messages (map to labels).
Notes: Keep previews text-only (no emoji); prefer server-side counting to avoid client N+1 queries.
*/
import Message from '../models/Message.js';

function previewFor(msg) {
  if (!msg) return '';
  if (msg.type === 'text') return msg.text || '';
  if (msg.type === 'image') return 'Photo';
  if (msg.type === 'video') return 'Video';
  if (msg.type === 'audio') return 'Audio';
  return msg.mediaName ? `File: ${msg.mediaName}` : 'File';
}

/*
[PRO] Purpose: Count messages newer than the user's lastReadAt that weren't sent by the user.
Context: Unread badges on chat list; avoids multiple aggregate pipelines on the client.
Edge cases: Missing lastReadAt defaults to epoch; index on Message.chat speeds the query.
Notes: For very large rooms, consider bucketing or storing per-user counters on the chat doc.
*/
export async function computeUnreadCount(chatDoc, userId) {
  const me = String(userId);
  const lastReadAt =
    (chatDoc.perUser || []).find((p) => String(p.user) === me)?.lastReadAt || new Date(0);

  const count = await Message.countDocuments({
    chat: chatDoc._id,
    createdAt: { $gt: lastReadAt },
    sender: { $ne: userId },
  });

  return count;
}

/*
[PRO] Purpose: Normalize the chat payload returned to the client for list views.
Context: Keeps UI mapping simple and stable across endpoints.
Edge cases: No lastMessage; missing settings; legacy chats without lastMessageAt.
Notes: Keep this shape in sync with client/store expectations.
*/
export function buildListItem(chatDoc, unreadCount) {
  const lm = chatDoc.lastMessage;
  return {
    _id: chatDoc._id,
    isGroup: chatDoc.isGroup,
    name: chatDoc.name,
    description: chatDoc.description,
    iconUrl: chatDoc.iconUrl,
    participants: chatDoc.participants,
    admins: chatDoc.admins,
    settings: chatDoc.settings,
    updatedAt: chatDoc.updatedAt,
    lastMessage: lm
      ? {
          _id: lm._id,
          type: lm.type,
          text: lm.text,
          mediaName: lm.mediaName,
          sender: lm.sender,
          createdAt: lm.createdAt,
          preview: previewFor(lm),
        }
      : null,
    lastMessageAt: chatDoc.lastMessageAt || chatDoc.updatedAt,
    unreadCount,
  };
}
