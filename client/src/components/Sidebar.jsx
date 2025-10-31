/**
 * Sidebar — chat list, global search (people + public groups), and quick actions.
 *
 * Changed Today:
 * - Replaced glyphs (hourglass, cross) with inline SVG icons (no emoji policy).
 * - Extracted magic numbers into named constants (debounce and click-lock window).
 * - Added PRO blocks for debounce, keyboard navigation, and click guard rationale.
 * - Light a11y and error-handling touch-ups; behavior otherwise unchanged.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import useChat from "../store/chatStore";
import useAuth from "../store/authStore";

/** constants — avoid magic numbers */
const DEBOUNCE_MS = 250;
const CLICK_LOCK_MS = 400;

/* --- tiny inline icons (no emoji) --- */
const GroupIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4ZM8 13a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm8 2c-3.33 0-6 1.67-6 4v1h12v-1c0-2.33-2.67-4-6-4Zm-8 0c-2.67 0-5 1.33-5 3v1h7v-1c0-1.18.5-2.23 1.35-3.09A9.7 9.7 0 0 0 8 15Z" fill="currentColor"/>
  </svg>
);
const UserFallback = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.33 0-8 2.17-8 5v1h16v-1c0-2.83-3.67-5-8-5Z" fill="currentColor"/>
  </svg>
);
const SpinnerIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="4" fill="none"/>
    <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" fill="none" />
  </svg>
);
const CloseIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7A1 1 0 0 0 5.7 7.1L10.6 12l-4.9 4.9a1 1 0 1 0 1.4 1.4L12 13.4l4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z" fill="currentColor"/>
  </svg>
);

/* avatar used in chat list rows */
function ChatAvatar({ chat, meId }) {
  const size = 40;

  if (chat.isGroup) {
    if (chat.iconUrl) {
      return (
        <img
          src={chat.iconUrl}
          alt={chat.name || "Group"}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      );
    }
    return (
      <div
        className="rounded-full bg-emerald-700/10 text-emerald-900 flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <GroupIcon size={22} />
      </div>
    );
  }

  const other =
    chat.participants?.find((p) => String(p._id || p) !== String(meId)) ||
    chat.participants?.[0];

  const name = other?.name || "User";
  const avatar = other?.avatar || "";

  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="rounded-full bg-emerald-700 text-white flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <UserFallback size={20} />
    </div>
  );
}

function Highlight({ text = "", q = "" }) {
  if (!q) return <>{text}</>;
  const parts = text.split(
    new RegExp(`(${q.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})`, "ig")
  );
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="bg-emerald-100 rounded px-0.5">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

/*
[PRO] Purpose: Present chats, search, and quick actions without extra routes
Context: Keeps the main UX snappy; search hits the API with debounce
Edge cases: Empty results, missing avatars, rapid taps/clicks
Notes: No new deps; store orchestrates active chat and user presence
*/
/**
 * @param {{ onSelectChat?: () => void, onNewGroup?: () => void }} props
 */
export default function Sidebar({ onSelectChat, onNewGroup }) {
  const { chats, setChats, activeChat, setActiveChat } = useChat();
  const { user, logout } = useAuth();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [userResults, setUserResults] = useState([]);
  const [groupResults, setGroupResults] = useState([]);
  const [joiningId, setJoiningId] = useState(null);

  // keyboard nav
  const [focusIdx, setFocusIdx] = useState(0);
  const listRef = useRef(null);
  const navigate = useNavigate();

  /*
  [PRO] Purpose: Guard against rapid double taps/clicks across devices
  Context: Prevents duplicate API calls and duplicate route pushes
  Edge cases: Very fast re-clicks within lock window are ignored
  Notes: Keep window short to avoid feeling laggy
  */
  const clickLockRef = useRef({ ts: 0 });
  const singleClick = (fn) => (...args) => {
    const now = Date.now();
    if (now - clickLockRef.current.ts < CLICK_LOCK_MS) return;
    clickLockRef.current.ts = now;
    fn?.(...args);
  };

  // options for keyboard selection
  const options = useMemo(() => {
    const items = [];
    if (groupResults.length) {
      items.push({ kind: "header", label: "Groups" });
      groupResults.forEach((g) => items.push({ kind: "group", ...g }));
    }
    if (userResults.length) {
      items.push({ kind: "header", label: "People" });
      userResults.forEach((u) => items.push({ kind: "user", ...u }));
    }
    return items;
  }, [groupResults, userResults]);

  /*
  [PRO] Purpose: Initial chat list hydration from backend
  Context: Avoids redundant fetches when store already populated
  Edge cases: API returns non-array; fallback to empty list
  Notes: Leaves store as source of truth after first load
  */
  useEffect(() => {
    (async () => {
      if (Array.isArray(chats) && chats.length) return;
      const { data } = await api.get("/chats");
      setChats(Array.isArray(data) ? data : []);
    })();
    // eslint-disable-next-line
  }, []);

  /*
  [PRO] Purpose: Debounced search for users and public groups
  Context: Reduces request volume while typing; instant clear on empty query
  Edge cases: Rapid input changes; ensures latest term wins
  Notes: 250ms debounce tuned for perceived responsiveness
  */
  const typingTimer = useRef(null);
  const handleSearchChange = (e) => {
    const v = e.target.value;
    setQ(v);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(async () => {
      if (!v.trim()) {
        setUserResults([]);
        setGroupResults([]);
        setLoading(false);
        setFocusIdx(0);
        return;
      }
      try {
        setLoading(true);
        const { data } = await api.get("/search?q=" + encodeURIComponent(v.trim()));
        setUserResults(Array.isArray(data?.users) ? data.users : []);
        setGroupResults(Array.isArray(data?.groups) ? data.groups : []);
        setFocusIdx(0);
      } catch {
        setUserResults([]);
        setGroupResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
  };

  // start DM
  const startChat = async (userId) => {
    const { data } = await api.get("/chats/direct/" + userId);
    const merged = [data, ...(chats || []).filter((c) => c._id !== data._id)];
    setChats(merged);
    setActiveChat(data);
    setUserResults([]);
    setGroupResults([]);
    setQ("");
    onSelectChat?.();
  };

  /*
  [PRO] Purpose: Open existing or join new public group in-place
  Context: Mirrors directory behavior; merges into store for continuity
  Edge cases: Concurrent joins; disables join button for the target id
  Notes: Resets search UI on success; user-safe alert on failure
  */
  const openOrJoinGroup = async (groupId) => {
    const existing = (chats || []).find((c) => String(c._id) === String(groupId));
    if (existing) {
      setActiveChat(existing);
      onSelectChat?.();
      setUserResults([]);
      setGroupResults([]);
      setQ("");
      return;
    }
    try {
      setJoiningId(groupId);
      const { data } = await api.post(`/chats/${groupId}/join`);
      const merged = [data, ...(chats || [])];
      setChats(merged);
      setActiveChat(data);
      setUserResults([]);
      setGroupResults([]);
      setQ("");
      onSelectChat?.();
    } catch (e) {
      alert(e?.response?.data?.message || "Failed to join this group.");
    } finally {
      setJoiningId(null);
    }
  };

  /*
  [PRO] Purpose: Keyboard navigation for search results list
  Context: Keeps search operable without mouse; skips section headers
  Edge cases: Scrolls focused row into view; guards empty options
  Notes: Enter key activates current result (user/group)
  */
  // use the shared listRef declared earlier
  const onKeyDown = (e) => {
    if (!options.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      let next = focusIdx + 1;
      while (next < options.length && options[next].kind === "header") next++;
      const idx = Math.min(next, options.length - 1);
      setFocusIdx(idx);
      listRef.current
        ?.querySelector(`[data-i="${idx}"]`)
        ?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      let prev = focusIdx - 1;
      while (prev > 0 && options[prev].kind === "header") prev--;
      const idx = Math.max(prev, 0);
      setFocusIdx(idx);
      listRef.current
        ?.querySelector(`[data-i="${idx}"]`)
        ?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = options[focusIdx];
      if (!item || item.kind === "header") return;
      if (item.kind === "user") singleClick(startChat)(item._id);
      else if (item.kind === "group") singleClick(openOrJoinGroup)(item._id);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="p-3 bg-emerald-900 text-white">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => navigate("/settings/profile")}
            className="flex items-center gap-2 min-w-0 group text-left"
            title="Edit profile"
          >
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={user?.name || "Me"}
                className="rounded-full object-cover border border-white/20"
                style={{ width: 32, height: 32 }}
              />
            ) : (
              <div className="rounded-full bg-white/20 w-8 h-8 flex items-center justify-center shrink-0" aria-hidden="true">
                <UserFallback size={18} />
              </div>
            )}
            <div className="min-w-0">
              <div className="font-semibold leading-tight truncate group-hover:underline">
                {user?.name || "User"}
              </div>
              <div className="text:[11px] text-[11px] opacity-80 leading-tight truncate">
                {user?.email}
              </div>
            </div>
          </button>

          <div className="flex items-center gap-2">
            <button
              className="text-[12px] px-2 py-1 rounded bg-white/10 hover:bg-white/20"
              onClick={onNewGroup}
              title="Create group"
            >
              + New Group
            </button>
            <button
              onClick={() => navigate("/settings/profile")}
              className="text-[12px] px-2 py-1 rounded bg-white/10 hover:bg-white/20"
              title="Profile settings"
              aria-label="Profile settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19.14 12.94a7.6 7.6 0 0 0 0-1.88l2-1.55-2-3.46-2.34.94a7.85 7.85 0 0 0-1.63-.94l-.35-2.49h-4l-.35 2.49a7.85 7.85 0 0 0-1.63.94L4.86 6.05l-2 3.46 2 1.55a7.6 7.6 0 0 0 0 1.88l-2 1.55 2 3.46 2.34-.94c.51.39 1.06.71 1.63.94l.35 2.49h4l.35-2.49c.57-.23 1.12-.55 1.63-.94l2.34.94 2-3.46-2-1.55ZM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5Z" fill="currentColor"/>
              </svg>
            </button>
            <button onClick={logout} className="text-sm underline">
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="p-2 border-b bg-gray-50">
        <div className="relative">
          <input
            value={q}
            onChange={handleSearchChange}
            onKeyDown={onKeyDown}
            placeholder="Search people or public groups"
            className="w-full border rounded p-2 pr-8"
            aria-label="Search"
          />
          {loading ? (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
              <SpinnerIcon />
            </div>
          ) : q ? (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              onClick={() => {
                setQ("");
                setUserResults([]);
                setGroupResults([]);
                setFocusIdx(0);
              }}
              aria-label="Clear search"
              title="Clear search"
            >
              <CloseIcon />
            </button>
          ) : null}

          {(userResults.length > 0 || groupResults.length > 0) && (
            <div
              ref={listRef}
              className="mt-2 bg-white rounded-xl shadow-2xl border divide-y max-h-96 overflow-auto ios-bounce"
            >
              {/* Groups */}
              {groupResults.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50 rounded-t-xl">
                    Groups
                  </div>
                  {groupResults.map((g) => {
                    const i = options.findIndex((o) => o.kind === "group" && o._id === g._id);
                    const focused = i === focusIdx;
                    return (
                      <div
                        key={g._id}
                        data-i={i}
                        className={`px-3 py-2 hover:bg-gray-50 ${focused ? "bg-emerald-50" : ""}`}
                        onMouseEnter={() => setFocusIdx(i)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center" aria-hidden="true">
                            {g.iconUrl ? (
                              <img src={g.iconUrl} alt={g.name} className="w-full h-full object-cover" />
                            ) : (
                              <GroupIcon size={18} />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">
                              <Highlight text={g.name} q={q} />
                              <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 align-middle">
                                Public
                              </span>
                            </div>
                            <div className="text-[11px] text-gray-500 truncate">
                              {g.membersCount} members {g.description ? "· " : ""}
                              <span className="truncate">
                                <Highlight text={g.description} q={q} />
                              </span>
                            </div>
                          </div>
                          <button
                            className={`text-sm px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50 ${focused ? "border-emerald-600" : ""}`}
                            onClick={singleClick(() => openOrJoinGroup(g._id))}
                            onDoubleClick={(e) => e.preventDefault()}
                            disabled={joiningId === g._id}
                          >
                            {joiningId === g._id ? "Joining…" : "Open / Join"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* People */}
              {userResults.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50">
                    People
                  </div>
                  {userResults.map((u) => {
                    const i = options.findIndex((o) => o.kind === "user" && o._id === u._id);
                    const focused = i === focusIdx;
                    return (
                      <div
                        key={u._id}
                        data-i={i}
                        className={`px-3 py-2 hover:bg-gray-50 cursor-pointer ${focused ? "bg-emerald-50" : ""}`}
                        onMouseEnter={() => setFocusIdx(i)}
                        onClick={singleClick(() => startChat(u._id))}
                        onDoubleClick={(e) => e.preventDefault()}
                      >
                        <div className="flex items-center justify-between">
                          <div className="truncate">
                            <span className="font-medium"><Highlight text={u.name} q={q} /></span>
                            <span className="text-xs text-gray-500 ml-2"><Highlight text={u.email} q={q} /></span>
                          </div>
                          <span className="text-[11px] text-gray-400">↵ to open</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {q && !loading && userResults.length === 0 && groupResults.length === 0 && (
            <div className="mt-2 bg-white rounded-lg border p-4 text-sm text-gray-500">
              No results for <span className="font-medium">“{q}”</span>. Try a different name or keyword.
            </div>
          )}
        </div>
      </div>

      {/* Chats list */}
      <div className="flex-1 overflow-y-auto ios-bounce">
        {!chats || chats.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">
            No chats yet — search above or click <span className="font-medium">New Group</span>.
          </div>
        ) : (
          <div className="divide-y">
            {chats.map((c) => {
              const isActive = c._id === activeChat?._id;
              const title = c.isGroup
                ? c.name || "Group"
                : (() => {
                    const other =
                      c.participants?.find((p) => String(p._id || p) !== String(user?.id)) ||
                      c.participants?.[0];
                    return other?.name || "Chat";
                  })();
              const preview = c.lastMessage?.preview || "";
              const timeStr = new Date(c.lastMessageAt || c.updatedAt || c.createdAt)
                .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              const unread = c.unreadCount || 0;

              return (
                <div
                  key={c._id}
                  className={`p-3 cursor-pointer hover:bg-gray-50 ${isActive ? "bg-gray-100" : ""}`}
                  onClick={singleClick(() => {
                    setActiveChat(c);
                    onSelectChat?.();
                  })}
                  onDoubleClick={(e) => e.preventDefault()}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ChatAvatar chat={c} meId={user?.id} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium truncate">{title}</div>
                        <div className="text-[11px] text-gray-500 flex-shrink-0">{timeStr}</div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-gray-500 truncate max-w-[65%]">{preview}</div>
                        {unread > 0 && (
                          <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full text-[11px] bg-emerald-600 text-white">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
