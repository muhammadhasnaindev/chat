// src/components/GroupInfoModal.jsx

/**
 * GroupInfoModal — view/edit group details, settings, and members.
 */

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/axios";
import useAuth from "../store/authStore";
import GroupsIcon from "@mui/icons-material/Groups";

/*
[PRO] Purpose: Single place to adjust group metadata and membership.
Context: Honors admin-only settings; optimistic updates with rollback on failure.
Edge cases: Missing group, upload errors, search with current members; all handled with safe fallbacks.
Notes: No structural rewrites; icons only.
*/

function Field({ label, children }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-medium text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

export default function GroupInfoModal({ open, chatId, onClose, onUpdated }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [group, setGroup] = useState(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [iconFile, setIconFile] = useState(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !chatId) return;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const { data } = await api.get(`/chats/${chatId}`);
        setGroup(data || {});
        setName(data?.name || "");
        setDesc(data?.description || "");
      } catch {
        setError("Failed to load group info.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, chatId]);

  if (!open) return null;

  const isAdmin =
    group && (group.admins || []).some((a) => String(a._id || a) === String(user?.id));

  const settings = group?.settings || {
    onlyAdminsCanMessage: false,
    onlyAdminsCanEditInfo: true,
  };

  const uploadIcon = async (file) => {
    if (!file) return null;
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
  };

  const saveMeta = async () => {
    if (!isAdmin && settings.onlyAdminsCanEditInfo) return;
    try {
      setSaving(true);
      setError("");
      let iconUrl;
      if (iconFile) iconUrl = await uploadIcon(iconFile);
      const body = { name, description: desc };
      if (iconUrl) body.iconUrl = iconUrl;

      const { data } = await api.patch(`/chats/${chatId}`, body);
      setGroup(data || {});
      onUpdated?.(data || {});
      onClose?.();
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const toggleSetting = async (key) => {
    if (!isAdmin) return;
    try {
      setSaving(true);
      setError("");
      const next = {
        ...settings,
        ...(key === "msg"
          ? { onlyAdminsCanMessage: !settings.onlyAdminsCanMessage }
          : { onlyAdminsCanEditInfo: !settings.onlyAdminsCanEditInfo }),
      };
      // optimistic
      setGroup((g) => ({ ...(g || {}), settings: next }));
      const { data } = await api.patch(`/chats/${chatId}/settings`, next);
      setGroup(data || {});
      onUpdated?.(data || {});
    } catch (e) {
      try {
        const { data } = await api.get(`/chats/${chatId}`);
        setGroup(data || {});
      } catch {}
      setError(e?.response?.data?.message || "Failed to update settings.");
    } finally {
      setSaving(false);
    }
  };

  const doSearch = async (q) => {
    setSearch(q);
    if (!q) return setResults([]);
    try {
      const { data } = await api.get(`/users/search?q=${encodeURIComponent(q)}`);
      const ids = new Set((group?.participants || []).map((p) => String(p._id || p)));
      setResults((Array.isArray(data) ? data : []).filter((u) => !ids.has(String(u._id))));
    } catch {
      setResults([]);
    }
  };

  const addMember = async (userId) => {
    const { data } = await api.post(`/chats/${chatId}/add`, { userId });
    setGroup(data || {});
    setSearch("");
    setResults([]);
    onUpdated?.(data || {});
  };
  const removeMember = async (userId) => {
    const { data } = await api.post(`/chats/${chatId}/remove`, { userId });
    setGroup(data || {});
    onUpdated?.(data || {});
  };
  const promote = async (userId) => {
    const { data } = await api.post(`/chats/${chatId}/promote`, { userId });
    setGroup(data || {});
    onUpdated?.(data || {});
  };
  const demote = async (userId) => {
    const { data } = await api.post(`/chats/${chatId}/demote`, { userId });
    setGroup(data || {});
    onUpdated?.(data || {});
  };
  const leave = async () => {
    await api.post(`/chats/${chatId}/leave`);
    onUpdated?.({ left: true, chatId });
    onClose?.();
  };
  const del = async () => {
    if (!confirm("Delete this group for all members?")) return;
    await api.delete(`/chats/${chatId}`);
    onUpdated?.({ deleted: true, chatId });
    onClose?.();
  };

  const adminIds = new Set((group?.admins || []).map((a) => String(a._id || a)));

  // SHEET shell
  const shell = (children) => (
    <div className="fixed inset-0 z-[1100]">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center">
        <div
          className="bg-white w-full md:w-[680px] max-w-[100vw] md:rounded-2xl rounded-t-2xl shadow-xl
                     md:max-h-[90vh] max-h-[88dvh] overflow-y-auto ios-bounce"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Group info"
        >
          {children}
        </div>
      </div>
    </div>
  );

  if (loading) return createPortal(shell(<div className="p-6">Loading…</div>), document.body);

  return createPortal(
    shell(
      <>
        <div className="p-4 border-b sticky top-0 bg-white z-10 flex items-center justify-between">
          <div className="font-semibold">Group info</div>
          <button onClick={onClose} className="text-sm underline" type="button">
            Close
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 mb-1 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            {error}
          </div>
        )}

        <div className="p-4 grid grid-cols-1 gap-4">
          {/* icon + meta */}
          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-full bg-gray-200 overflow-hidden flex items-center justify-center shrink-0">
              {group?.iconUrl ? (
                <img src={group.iconUrl} alt="icon" className="w-full h-full object-cover" />
              ) : iconFile ? (
                <img src={URL.createObjectURL(iconFile)} alt="icon" className="w-full h-full object-cover" />
              ) : (
                <GroupsIcon sx={{ fontSize: 32, color: "#065F46" }} aria-hidden />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <Field label="Group name">
                <input
                  className="border rounded w-full p-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={(!isAdmin && settings.onlyAdminsCanEditInfo) || saving}
                />
              </Field>
              <Field label="Description">
                <textarea
                  className="border rounded w-full p-2 resize-none h-16"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  disabled={(!isAdmin && settings.onlyAdminsCanEditInfo) || saving}
                />
              </Field>
              {(!settings.onlyAdminsCanEditInfo || isAdmin) && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setIconFile(e.target.files?.[0] || null)}
                    disabled={saving}
                  />
                  <button
                    onClick={saveMeta}
                    className="px-3 py-2 bg-emerald-700 text-white rounded disabled:opacity-60"
                    disabled={saving}
                    type="button"
                  >
                    {saving ? "Saving…" : "Save & Close"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* settings */}
          {isAdmin && (
            <div className="border rounded p-3">
              <div className="font-medium mb-2">Group settings</div>
              <label className="flex items-center gap-2 mb-1">
                <input
                  type="checkbox"
                  checked={!!settings.onlyAdminsCanMessage}
                  onChange={() => toggleSetting("msg")}
                  disabled={saving}
                />
                <span>Only admins can send messages</span>
              </label>
              <label className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  checked={!!settings.onlyAdminsCanEditInfo}
                  onChange={() => toggleSetting("info")}
                  disabled={saving}
                />
                <span>Only admins can edit group info</span>
              </label>

              {/* Public toggle */}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!settings.isPublic}
                  onChange={async () => {
                    if (!isAdmin) return;
                    try {
                      setSaving(true);
                      setError("");
                      const { data } = await api.patch(`/chats/${chatId}/public`, {
                        isPublic: !settings.isPublic,
                      });
                      setGroup(data || {});
                      onUpdated?.(data || {});
                    } catch (e) {
                      setError(e?.response?.data?.message || "Failed to update public setting.");
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                />
                <span>Public (searchable & anyone can join)</span>
              </label>
            </div>
          )}

          {/* members */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="font-medium">Participants · {group?.participants?.length || 0}</div>
              {isAdmin && (
                <input
                  className="border rounded p-2 w-full sm:w-64"
                  placeholder="Add by search…"
                  value={search}
                  onChange={(e) => doSearch(e.target.value)}
                  disabled={saving}
                />
              )}
            </div>

            {isAdmin && results.length > 0 && (
              <div className="border rounded mb-2 max-h-40 overflow-auto">
                {results.map((u) => (
                  <div key={u._id} className="flex items-center justify-between p-2 hover:bg-gray-50">
                    <div className="truncate">
                      {u.name} <span className="text-xs text-gray-500">{u.email}</span>
                    </div>
                    <button
                      className="text-sm px-3 py-1 border rounded disabled:opacity-60"
                      onClick={() => addMember(u._id)}
                      disabled={saving}
                      type="button"
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="border rounded max-h-56 overflow-auto divide-y">
              {(group?.participants || []).map((p) => {
                const pid = p._id || p;
                const isSelf = String(pid) === String(user?.id);
                const isPAdmin = adminIds.has(String(pid));
                return (
                  <div key={pid} className="flex items-center justify-between p-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {p.name}{" "}
                        {isPAdmin && (
                          <span className="text-[10px] ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            admin
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{p.email}</div>
                    </div>
                    {isAdmin && !isSelf && (
                      <div className="flex items-center gap-2">
                        {isPAdmin ? (
                          <button
                            className="text-sm px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
                            onClick={() => demote(pid)}
                            disabled={saving}
                            type="button"
                          >
                            Remove admin
                          </button>
                        ) : (
                          <button
                            className="text-sm px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
                            onClick={() => promote(pid)}
                            disabled={saving}
                            type="button"
                          >
                            Make admin
                          </button>
                        )}
                        <button
                          className="text-sm px-3 py-1 border rounded hover:bg-red-50 disabled:opacity-50"
                          onClick={() => removeMember(pid)}
                          disabled={saving}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* danger */}
          <div className="border-t pt-3 flex items-center justify-between">
            <button className="px-3 py-2 border rounded" onClick={leave} disabled={saving} type="button">
              Leave group
            </button>
            {isAdmin && (
              <button
                className="px-3 py-2 border rounded text-red-700 hover:bg-red-50"
                onClick={del}
                disabled={saving}
                type="button"
              >
                Delete group
              </button>
            )}
          </div>
        </div>
      </>
    ),
    document.body
  );
}
