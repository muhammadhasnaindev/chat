// src/components/CreateGroupModal.jsx

/**
 * CreateGroupModal — create a new group with members/admins and optional icon upload.

 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/axios";
import useChat from "../store/chatStore";
import useAuth from "../store/authStore";
import GroupsIcon from "@mui/icons-material/Groups";

/*
[PRO] Purpose: Provide a focused flow to create groups with minimal surprises.
Context: Contacts come from /users/contacts or /users/search; self is always included as admin.
Edge cases: Icon upload failures, duplicate members/admins, missing chat hydration; all guarded with fallbacks.
Notes: No new libraries; behavior is unchanged aside from safe validations and clearer structure.
*/

const HEADER_H = 56;         // px — fixed header height
const FOOTER_H = 64;         // px — fixed footer height
const ICON_MAX_MB = 5;       // soft limit for group icon
const SEARCH_DEBOUNCE = 250; // ms for search queries

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idOf = (u) => String(u?._id ?? u?.id ?? "");

// Normalize minimal chat shape when hydration is not possible
function makeSafeChatShape(raw, { name = "", iconUrl = "" } = {}) {
  const base = raw || {};
  return {
    _id: base._id || "",
    isGroup: true,
    name: base.name || name || "Group",
    iconUrl: base.iconUrl || iconUrl || "",
    participants: Array.isArray(base.participants) ? base.participants : [],
    admins: Array.isArray(base.admins) ? base.admins : [],
    settings: base.settings || {
      onlyAdminsCanMessage: false,
      onlyAdminsCanEditInfo: true,
      isPublic: false,
    },
    createdAt: base.createdAt || new Date().toISOString(),
    updatedAt: base.updatedAt || new Date().toISOString(),
  };
}

function MemberRow({ user, checked, isAdmin, onToggleMember, onToggleAdmin }) {
  const initial = (user?.name || "U").slice(0, 1).toUpperCase();
  return (
    <div
      className={`w-full flex items-center gap-3 p-2 rounded border ${
        checked ? "bg-emerald-50 border-emerald-200" : "hover:bg-gray-50"
      }`}
    >
      <button
        type="button"
        onClick={() => onToggleMember(user)}
        className="flex items-center gap-3 min-w-0 flex-1 text-left"
        title={checked ? "Remove from group" : "Add to group"}
      >
        {user?.avatar ? (
          <img src={user.avatar} alt={user.name} className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-emerald-600 text-white grid place-items-center">
            {initial}
          </div>
        )}
        <div className="min-w-0">
          <div className="font-medium truncate">{user?.name || "User"}</div>
          <div className="text-xs text-gray-500 truncate">{user?.email || ""}</div>
        </div>
      </button>

      <label className="flex items-center gap-1 text-xs mr-2 whitespace-nowrap">
        <input type="checkbox" readOnly checked={checked} className="w-4 h-4 accent-emerald-600" />
        <span>{checked ? "Selected" : "Select"}</span>
      </label>

      <label
        className={`flex items-center gap-1 text-xs whitespace-nowrap ${checked ? "" : "opacity-50"}`}
        title={checked ? "Toggle admin" : "Select member first"}
      >
        <input
          type="checkbox"
          disabled={!checked}
          checked={!!isAdmin}
          onChange={() => onToggleAdmin(user)}
          className="w-4 h-4 accent-emerald-600"
        />
        <span>Admin</span>
      </label>
    </div>
  );
}

function Chip({ user, isAdmin, onRemove, onToggleAdmin }) {
  const initial = (user?.name || "U").slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200">
      {user?.avatar ? (
        <img src={user.avatar} alt={user.name} className="w-5 h-5 rounded-full object-cover" />
      ) : (
        <div className="w-5 h-5 rounded-full bg-emerald-600 text-white grid place-items-center text-[10px]">
          {initial}
        </div>
      )}
      <span className="text-xs md:text-sm max-w-[9rem] md:max-w-none truncate">{user?.name || "User"}</span>
      {isAdmin && <span className="text-[10px] px-1 rounded bg-emerald-600 text-white">Admin</span>}
      <button
        type="button"
        onClick={() => onToggleAdmin(user)}
        className="text-[11px] px-1 rounded hover:bg-emerald-100"
        title={isAdmin ? "Remove admin" : "Make admin"}
      >
        {isAdmin ? "-admin" : "+admin"}
      </button>
      <button
        type="button"
        onClick={() => onRemove(user)}
        className="w-5 h-5 rounded-full hover:bg-emerald-100 grid place-items-center text-xs"
        title="Remove"
      >
        x
      </button>
    </div>
  );
}

/**
 * CreateGroupModal
 * @param {{ onClose?: ()=>void }} props
 */
export default function CreateGroupModal({ onClose }) {
  const { user: me } = useAuth();
  const meId = idOf(me);

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [iconFile, setIconFile] = useState(null);

  const [isPublic, setIsPublic] = useState(false);
  const [onlyAdminsCanMessage, setOnlyAdminsCanMessage] = useState(false);
  const [onlyAdminsCanEditInfo, setOnlyAdminsCanEditInfo] = useState(true);

  const [query, setQuery] = useState("");
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const debounceRef = useRef();

  const [members, setMembers] = useState([]);
  const [adminIds, setAdminIds] = useState(() => new Set(meId ? [meId] : []));

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const { setChats, setActiveChat } = useChat();

  // Lock background + ESC close
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && safeClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const safeClose = () => {
    if (!creating) onClose?.();
  };

  // Fetch contacts / search (debounced)
  useEffect(() => {
    const run = async () => {
      setLoadingList(true);
      try {
        let data = [];
        if (query.trim().length === 0) {
          const res = await api.get("/users/contacts");
          data = Array.isArray(res.data) ? res.data : [];
        } else {
          const res = await api.get(`/users/search?q=${encodeURIComponent(query.trim())}`);
          data = Array.isArray(res.data) ? res.data : [];
        }
        // normalize ids, remove self, dedupe
        const seen = new Set();
        const normalized = [];
        for (const u of data) {
          const k = idOf(u);
          if (!k || k === meId) continue;
          if (!seen.has(k)) {
            seen.add(k);
            normalized.push({ ...u, _id: k });
          }
        }
        setList(normalized);
      } catch (e) {
        console.debug("[CreateGroupModal] contacts/search failed:", e?.message);
        setList([]);
      } finally {
        setLoadingList(false);
      }
    };
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(run, query.trim().length ? SEARCH_DEBOUNCE : 0);
    return () => clearTimeout(debounceRef.current);
  }, [query, meId]);

  const toggleMember = (u) => {
    const uid = idOf(u);
    setMembers((prev) => {
      const exists = prev.some((x) => idOf(x) === uid);
      if (exists) {
        setAdminIds((s) => {
          const n = new Set(s);
          n.delete(uid);
          return n;
        });
        return prev.filter((x) => idOf(x) !== uid);
      }
      return [...prev, { ...u, _id: uid }];
    });
  };

  const toggleAdmin = (u) => {
    const uid = idOf(u);
    if (uid === meId) return; // creator is always admin; cannot toggle off
    setAdminIds((s) => {
      const n = new Set(s);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });
  };

  const removeMember = (u) => toggleMember(u);

  const canCreate = useMemo(
    () => name.trim().length > 0 && members.length > 0 && !creating,
    [name, members.length, creating]
  );

  async function uploadIcon(file) {
    if (!file) return "";
    // light validation (keeps behavior but avoids accidental large/invalid files)
    if (!file.type?.startsWith?.("image/")) {
      setError("Please choose an image file for the group icon.");
      return "";
    }
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > ICON_MAX_MB) {
      setError(`Icon too large (max ${ICON_MAX_MB} MB).`);
      return "";
    }

    const useLocal = import.meta.env.VITE_USE_LOCAL_UPLOAD === "true";
    if (useLocal) {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post("/upload/local", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const base = import.meta.env.VITE_API_URL || "";
      const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
      const cleanPath = data.url.startsWith("/") ? data.url : "/" + data.url;
      return cleanBase + cleanPath;
    } else {
      const { data } = await api.get(
        `/upload/presign?fileName=${encodeURIComponent(file.name)}&fileType=${encodeURIComponent(
          file.type || "image/png"
        )}`
      );
      await fetch(data.url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      return data.url.split("?")[0];
    }
  }

  async function fetchFreshChatWithRetry(id) {
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try {
        const { data } = await api.get(`/chats/${id}`);
        if (data && data._id) return data;
      } catch (e) {
        lastErr = e;
        await sleep(300);
      }
    }
    throw lastErr || new Error("Failed to hydrate chat");
  }

  async function createGroup() {
    if (!canCreate) return;
    setError("");
    setCreating(true);
    try {
      let iconUrl = "";
      if (iconFile) iconUrl = await uploadIcon(iconFile);

      const memberIds = Array.from(new Set([meId, ...members.map((m) => idOf(m))].filter(Boolean)));
      const adminIdsArray = Array.from(new Set([meId, ...Array.from(adminIds)])).filter((id) =>
        memberIds.includes(id)
      );

      const payload = {
        name: name.trim(),
        members: memberIds,
        admins: adminIdsArray,
        description: desc,
        iconUrl,
        settings: { isPublic, onlyAdminsCanMessage, onlyAdminsCanEditInfo },
      };

      const { data: created } = await api.post("/chats/group", payload);

      let hydrated;
      try {
        hydrated = await fetchFreshChatWithRetry(created._id);
      } catch {
        hydrated = makeSafeChatShape(created, { name, iconUrl });
        hydrated.settings = payload.settings;
      }

      let chats = [];
      try {
        const listRes = await api.get("/chats");
        chats = Array.isArray(listRes.data) ? listRes.data : [];
      } catch {
        chats = [];
      }

      const inList = chats.find((c) => c._id === hydrated._id);
      const finalList = inList ? chats : [hydrated, ...chats];

      // Prefer injected setters; fallback to store getters (in case this file is reused)
      const state = typeof useChat.getState === "function" ? useChat.getState() : null;
      const setChatsFn = setChats || state?.setChats;
      const setActiveChatFn = setActiveChat || state?.setActiveChat;

      setChatsFn?.(finalList);
      setActiveChatFn?.(inList || hydrated);

      safeClose();
    } catch (e) {
      console.error("Create group failed:", e);
      setError(e?.response?.data?.message || "Failed to create group.");
    } finally {
      setCreating(false);
    }
  }

  const isSelected = (u) => members.some((x) => idOf(x) === idOf(u));

  return createPortal(
    <div className="fixed inset-0 z-[2000]" role="dialog" aria-modal="true">
      {/* overlay */}
      <div className="absolute inset-0 bg-black/50" onClick={safeClose} />

      {/* panel (full-screen mobile, centered desktop) */}
      <div className="absolute inset-0 flex items-center justify-center p-0 md:p-3">
        <div className="relative bg-white w-full md:max-w-[880px] h-[100dvh] md:h-[85vh] md:rounded-2xl shadow-xl">
          {/* HEADER (absolute — ALWAYS visible) */}
          <div
            className="absolute left-0 right-0 border-b bg-white flex items-center gap-2 px-3"
            style={{ top: `env(safe-area-inset-top, 0px)`, height: HEADER_H }}
          >
            <button
              type="button"
              onClick={safeClose}
              className="w-10 h-10 rounded-full bg-white border shadow grid place-items-center active:scale-95"
              aria-label="Back"
              title="Back"
            >
              <span className="text-lg">←</span>
            </button>
            <div className="min-w-0">
              <div className="font-semibold leading-tight">Create group</div>
              <div className="text-[11px] text-gray-500">
                {1 + members.length} member{1 + members.length !== 1 ? "s" : ""} selected
              </div>
            </div>
            <div className="flex-1" />
            <button
              type="button"
              onClick={safeClose}
              className="w-10 h-10 rounded-full bg-white border shadow grid place-items-center active:scale-95"
              aria-label="Close"
              title="Close"
            >
              x
            </button>
          </div>

          {/* FOOTER (absolute — ALWAYS visible) */}
          <div
            className="absolute left-0 right-0 border-t bg-white flex items-center gap-2 px-3"
            style={{ bottom: `env(safe-area-inset-bottom, 0px)`, height: FOOTER_H }}
          >
            <button type="button" onClick={safeClose} className="px-3 py-2 rounded border" disabled={creating}>
              Cancel
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={createGroup}
              disabled={!canCreate}
              className={`px-4 py-2 rounded text-white ${
                canCreate ? "bg-emerald-700 hover:bg-emerald-800" : "bg-emerald-700/50"
              }`}
              title={!canCreate ? "Enter name and select at least 1 member" : "Create Group"}
            >
              {creating ? "Creating…" : "Create Group"}
            </button>
          </div>

          {/* CONTENT (the only scrollable area) */}
          <div
            className="absolute left-0 right-0 overflow-y-auto scroll-area ios-bounce"
            style={{
              top: `calc(env(safe-area-inset-top, 0px) + ${HEADER_H}px)`,
              bottom: `calc(env(safe-area-inset-bottom, 0px) + ${FOOTER_H}px)`,
            }}
          >
            {/* FORM BLOCK */}
            <div className="px-3 pt-3 pb-2 border-b">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-16 h-16 rounded-full bg-gray-200 overflow-hidden grid place-items-center">
                  {iconFile ? (
                    <img src={URL.createObjectURL(iconFile)} alt="icon" className="w-full h-full object-cover" />
                  ) : (
                    <GroupsIcon sx={{ fontSize: 28, color: "#065F46" }} aria-hidden />
                  )}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setIconFile(e.target.files?.[0] || null)}
                  disabled={creating}
                  className="text-sm"
                />
                <div className="grow" />
              </div>

              <div className="grid md:grid-cols-2 gap-3 mt-3">
                <input
                  className="border rounded w-full p-2"
                  placeholder="Group name (required)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={creating}
                />
                <label className="inline-flex items-center gap-2 px-1">
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    disabled={creating}
                  />
                  <span className="text-sm">Public (searchable)</span>
                </label>
              </div>

              <textarea
                className="border rounded w-full p-2 mt-3 resize-none h-16"
                placeholder="Description (optional)"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                disabled={creating}
              />
            </div>

            {/* ADVANCED SETTINGS */}
            <div className="px-3 py-2 border-b">
              <div className="grid md:grid-cols-3 gap-3">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={onlyAdminsCanMessage}
                    onChange={(e) => setOnlyAdminsCanMessage(e.target.checked)}
                    disabled={creating}
                  />
                  <span className="text-sm">Only admins can message</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={onlyAdminsCanEditInfo}
                    onChange={(e) => setOnlyAdminsCanEditInfo(e.target.checked)}
                    disabled={creating}
                  />
                  <span className="text-sm">Only admins can edit info</span>
                </label>
              </div>
            </div>

            {/* SELECTED CHIPS */}
            <div className="px-3 py-2 border-b">
              <div className="flex gap-2 overflow-x-auto md:flex-wrap">
                {me && meId && (
                  <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-gray-100 border border-gray-200">
                    {me?.avatar ? (
                      <img src={me.avatar} alt={me.name} className="w-5 h-5 rounded-full object-cover" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-gray-500 text-white grid place-items-center text-[10px]">
                        {(me?.name || "U").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <span className="text-xs md:text-sm max-w-[9rem] md:max-w-none truncate">
                      {me?.name || "You"}
                    </span>
                    <span className="text-[10px] px-1 rounded bg-emerald-600 text-white">Admin</span>
                    <span className="text-[10px] px-1 rounded bg-gray-200 text-gray-700">You</span>
                  </div>
                )}
                {members.map((u) => {
                  const uid = idOf(u);
                  return (
                    <Chip
                      key={uid}
                      user={u}
                      isAdmin={adminIds.has(uid)}
                      onRemove={removeMember}
                      onToggleAdmin={toggleAdmin}
                    />
                  );
                })}
              </div>
            </div>

            {/* SEARCH + LIST */}
            <div className="px-3 py-3">
              <input
                className="border rounded w-full p-2 mb-3"
                placeholder="Search users…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={creating}
              />

              {error && (
                <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
                  {error}
                </div>
              )}

              {loadingList ? (
                <div className="text-sm text-gray-500">Loading users…</div>
              ) : list.length === 0 ? (
                <div className="text-sm text-gray-500">
                  {query.trim() ? "No users match your search." : "No contacts yet."}
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-2 pb-6">
                  {list.map((u) => {
                    const uid = idOf(u);
                    const selected = isSelected(u);
                    return (
                      <MemberRow
                        key={uid}
                        user={u}
                        checked={selected}
                        isAdmin={selected && adminIds.has(uid)}
                        onToggleMember={toggleMember}
                        onToggleAdmin={toggleAdmin}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
