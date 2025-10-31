// src/components/GroupsDirectory.jsx

/**
 * GroupsDirectory — browse/join public groups.

 */

import React, { useEffect, useState } from "react";
import api from "../api/axios";
import useChat from "../store/chatStore";
import GroupsIcon from "@mui/icons-material/Groups";

/*
[PRO] Purpose: Let users discover and join public groups.
Context: Joins if not already in chats; otherwise opens existing chat.
Edge cases: Empty directory, join errors; we surface a simple message.
Notes: No new frameworks; MUI icon for consistency.
*/

export default function GroupsDirectory({ onOpen }) {
  const { chats, setChats, setActiveChat } = useChat();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState(null);
  const [q, setQ] = useState("");
  const [filtered, setFiltered] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const { data } = await api.get("/chats/public?limit=100");
        const arr = Array.isArray(data) ? data : [];
        setList(arr);
        setFiltered(arr);
      } catch {
        setList([]);
        setFiltered([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const v = q.trim().toLowerCase();
    if (!v) return setFiltered(list);
    setFiltered(
      list.filter(
        (g) => (g.name || "").toLowerCase().includes(v) || (g.description || "").toLowerCase().includes(v)
      )
    );
  }, [q, list]);

  const openOrJoin = async (groupId) => {
    const existing = (chats || []).find((c) => String(c._id) === String(groupId));
    if (existing) {
      setActiveChat(existing);
      onOpen?.();
      return;
    }
    try {
      setJoiningId(groupId);
      const { data } = await api.post(`/chats/${groupId}/join`);
      const merged = [data, ...(chats || [])];
      setChats(merged);
      setActiveChat(data);
      onOpen?.();
    } catch (e) {
      alert(e?.response?.data?.message || "Failed to join this group.");
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b bg-gray-50">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search public groups"
          className="w-full border rounded p-2"
          aria-label="Search public groups"
        />
      </div>

      <div className="flex-1 overflow-y-auto ios-bounce">
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Loading groups…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No public groups found.</div>
        ) : (
          <div className="divide-y">
            {filtered.map((g) => (
              <div key={g._id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
                    {g.iconUrl ? (
                      <img src={g.iconUrl} alt={g.name} className="w-full h-full object-cover" />
                    ) : (
                      <GroupsIcon fontSize="small" sx={{ color: "#065F46" }} aria-hidden />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{g.name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {g.membersCount} members {g.description ? "· " + g.description : ""}
                    </div>
                  </div>
                  <button
                    className="text-sm px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
                    onClick={() => openOrJoin(g._id)}
                    disabled={joiningId === g._id}
                    aria-label={`Open or join ${g.name}`}
                    type="button"
                  >
                    {joiningId === g._id ? "Joining…" : "Open / Join"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
