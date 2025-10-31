// client/src/components/AvatarUploader.jsx

/**
 * Simple avatar uploader (local endpoint). Returns an absolute URL via onChange.
 *

 */

import React, { useRef, useState } from "react";
import api from "../api/axios";

const MAX_MB = 10;
const ERR_SIZE = `Max ${MAX_MB} MB exceeded.`;
const ERR_TYPE = "Please select an image file.";
const ERR_UPLOAD = "Failed to upload avatar. Please try again.";

/*
[PRO] Purpose: Provide a small, dependency-free avatar uploader that works for guests and authed users.
Context: Registration uses a public endpoint; settings page uses an auth-only endpoint.
Edge cases: Non-image file types and large files are rejected client-side; server errors surface as a friendly alert.
Notes: If S3 is added later, branch inside upload path without changing consumer props.
*/

/**
 * AvatarUploader
 * @param {{value?: string, onChange?: (url:string)=>void, guest?: boolean}} props
 */
export default function AvatarUploader({ value, onChange, guest = false }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const preview = value || "";

  const pick = () => inputRef.current?.click();

  // Build absolute URL for /uploads paths using the API base (without /api suffix)
  const buildAbsolute = (relativePath) => {
    const base = import.meta.env.VITE_API_URL || window.location.origin;
    const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
    const cleanPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
    return `${cleanBase}${cleanPath}`;
  };

  const uploadLocal = async (file, isGuest) => {
    const form = new FormData();
    form.append("file", file);

    // Use public endpoint for guests (no token yet), otherwise auth-only endpoint
    const endpoint = isGuest ? "/upload/public" : "/upload/local";

    const { data } = await api.post(endpoint, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    // backend returns { url: "/uploads/filename.ext", ... }
    return buildAbsolute(data.url);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting same file later
    if (!file) return;

    if (!file.type || !file.type.startsWith("image/")) {
      alert(ERR_TYPE);
      return;
    }

    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > MAX_MB) {
      alert(`${ERR_SIZE} Selected: ${sizeMb.toFixed(1)} MB.`);
      return;
    }

    setBusy(true);
    try {
      // If you add S3 later, you can branch here; for now local is fine
      const url = await uploadLocal(file, guest);
      if (typeof onChange === "function") onChange(url);
    } catch (err) {
      console.error("[AvatarUploader] upload failed:", err);
      alert(ERR_UPLOAD);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        {preview ? (
          <img
            src={preview}
            alt="avatar"
            className="w-16 h-16 rounded-full object-cover border"
            loading="lazy"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-gray-200 border grid place-items-center text-gray-500">
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.33 0-8 2.17-8 5v1h16v-1c0-2.83-3.67-5-8-5Z"
                fill="currentColor"
              />
            </svg>
          </div>
        )}
      </div>

      <div className="flex flex-col">
        <button
          type="button"
          onClick={pick}
          className="px-3 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-60"
          disabled={busy}
          aria-label="Upload avatar"
        >
          {busy ? "Uploading…" : preview ? "Change photo" : "Upload photo"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onFile}
          className="hidden"
        />
        <div className="text-[11px] text-gray-500 mt-1">PNG/JPG, up to {MAX_MB} MB</div>
      </div>
    </div>
  );
}
