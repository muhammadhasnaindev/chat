// src/utils/chatIds.js
/**
 * Robust helpers for participant id handling in chats.
 */

/*
[PRO] Purpose: Normalize different id shapes into a comparable string.
Context: Backend responses may return participants as strings or objects; downstream code expects a stable id.
Edge cases: Null/undefined participants and objects without _id/id are handled safely.
Notes: Return type is string|null; do not throw on malformed input to keep UI resilient.
*/
export function normalizeId(x) {
  if (!x) return null;
  return typeof x === "string" ? x : x._id || x.id || null;
}

/*
[PRO] Purpose: Resolve the "other" user in a 1:1 chat from the participants list.
Context: Direct chats can arrive with populated users or bare ids; this abstracts the lookup.
Edge cases: If only one participant is available or meId is missing, return the first available id.
Notes: Non-throwing behavior is intentional to avoid breaking list rendering.
*/
export function otherParticipant(chat, meId) {
  if (!chat?.participants) return null;
  const me = String(meId ?? "");
  const ids = chat.participants.map(normalizeId).filter(Boolean);
  return ids.find((id) => String(id) !== me) || ids[0] || null;
}
