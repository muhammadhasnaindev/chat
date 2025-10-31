/**
 * MessageInput — chat composer for text, attachments, emoji insertion, and voice notes.
 */

/*
[PRO] Purpose: Provide a responsive, low-latency composer with text, file, emoji, and voice support.
Context: Users expect single-key submit, optimistic UI, typing presence, and reply context; UI icons must avoid emoji.
Edge cases: Respect blocked/admin locks, cap file size (25MB), handle socket availability, and typing debounce lifecycle.
Notes: No new deps; inline SVGs avoid extra requests; server and store contracts remain stable for safe rollback.
*/

import React, { useEffect, useRef, useState } from "react";
import { getSocket } from "../sockets/socket";
import api from "../api/axios";
import VoiceRecorder from "./VoiceRecorder";
import useChat from "../store/chatStore";
import EmojiPopover from "./EmojiPopover";

/* ---------- Constants (no magic numbers) ---------- */
const MAX_FILE_MB = 25;

/* ---------- Small inline icons (no emoji) ---------- */
const ClipIcon = ({ size = 16, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path d="M7 7.5v7a5 5 0 0 0 10 0V7a3.5 3.5 0 0 0-7 0v7a2 2 0 0 0 4 0V8h2v6a4 4 0 1 1-8 0V7.5a5.5 5.5 0 1 1 11 0V14h-2V7.5a3.5 3.5 0 1 0-7 0Z" fill="currentColor"/>
  </svg>
);

const SmileIcon = ({ size = 16, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm-3.5 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM7.9 14.8a4.8 4.8 0 0 0 8.2 0l1.7 1a6.8 6.8 0 0 1-11.6 0l1.7-1Z" fill="currentColor"/>
  </svg>
);

const MicIcon = ({ size = 16, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Zm-5 8h2a3 3 0 1 0 6 0h2a5 5 0 0 1-10 0Zm5 7a7 7 0 0 0 7-7h2a9 9 0 0 1-8 8.95V22h-2v-2.05A9 9 0 0 1 3 11h2a7 7 0 0 0 7 7Z" fill="currentColor"/>
  </svg>
);

const CloseIcon = ({ size = 14, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path d="M6.7 5.3 5.3 6.7 10.6 12l-5.3 5.3 1.4 1.4L12 13.4l5.3 5.3 1.4-1.4L13.4 12l5.3-5.3-1.4-1.4L12 10.6 6.7 5.3Z" fill="currentColor"/>
  </svg>
);

/*
[PRO] Purpose: Size conversion helpers keep alerts readable and avoid repeated math.
Context: File size checks appear in multiple places; centralizing reduces drift.
Edge cases: Inputs are File sizes; no external callers.
Notes: Rounds to 0.1 MB to match concise UI copy.
*/
function bytesToMB(b) {
  return Math.round((b / (1024 * 1024)) * 10) / 10;
}

/*
[PRO] Purpose: Normalize MIME to coarse categories used by UI and payloads.
Context: The server and UI treat non-text uploads differently; quick classification needed.
Edge cases: Unknown types map to "file"; PDF is an explicit common case.
Notes: Relies on browser-provided `file.type`.
*/
function fileKind(file) {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  if (t === "application/pdf") return "file";
  return "file";
}

/*
[PRO] Purpose: Upload abstraction for local and presigned flows without changing callers.
Context: Environments switch between form upload and S3-style PUT; callers only need a URL.
Edge cases: Preserves content type; strips query from returned URL; builds absolute URL for local.
Notes: Keeps server contracts intact; no retries here (surface errors to caller).
*/
async function uploadFile(file) {
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
      `/upload/presign?fileName=${encodeURIComponent(
        file.name
      )}&fileType=${encodeURIComponent(file.type || "application/octet-stream")}`
    );
    await fetch(data.url, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    return data.url.split("?")[0];
  }
}

/**
 * MessageInput
 * @param {object} props
 * @param {string} props.chatId
 * @param {boolean} [props.blockedByMe]
 * @param {boolean} [props.blockedMe]
 * @param {boolean} [props.adminsOnlyLocked]
 * @param {object|null} [props.replyTo]
 * @param {Function} [props.onCancelReply]
 */
export default function MessageInput({
  chatId,
  blockedByMe = false,
  blockedMe = false,
  adminsOnlyLocked = false,
  replyTo = null,
  onCancelReply = () => {},
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [queue, setQueue] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false); // opened from button only

  const typingTimeout = useRef(null);
  const areaRef = useRef(null);
  const fileRef = useRef(null);
  const emojiBtnRef = useRef(null);

  const socket = getSocket();
  const { pushMessage } =
    useChat.getState ? useChat.getState() : { pushMessage: () => {} };

  const locked = !!(adminsOnlyLocked || blockedByMe || blockedMe);
  const lockText =
    blockedByMe
      ? "You have blocked this user."
      : blockedMe
      ? "This user has blocked you."
      : adminsOnlyLocked
      ? "Only admins can send messages in this group."
      : "";

  const meId = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}")?.id || "";
    } catch {
      return "";
    }
  })();

  /*
  [PRO] Purpose: Emit typing presence with a debounce to reduce network chatter.
  Context: Mirrors common chat UX and avoids spamming the server.
  Edge cases: On unmount, ensure a final "not typing" signal and clear timers.
  Notes: Guarded by chatId presence; socket optional chaining avoids crashes.
  */
  const emitTyping = (isTyping) => {
    try {
      if (!chatId) return;
      socket?.emit("typing", { chatId, typing: !!isTyping });
    } catch {}
  };

  useEffect(() => {
    const closer = () => setEmojiOpen(false);
    window.addEventListener("app:closeAllModals", closer);
    return () => {
      emitTyping(false);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      window.removeEventListener("app:closeAllModals", closer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hushAll = () => {
    try {
      setEmojiOpen(false);
      window.dispatchEvent(new CustomEvent("app:closeAllModals"));
    } catch {}
  };

  const onChange = (e) => {
    setText(e.target.value);
    if (!chatId) return;
    emitTyping(true);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => emitTyping(false), 1200);
  };

  const makeClientId = () =>
    "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

  /*
  [PRO] Purpose: Insert an optimistic message for instant visual feedback.
  Context: Keeps the timeline flowing while the server acknowledges delivery.
  Edge cases: Store signature guarded with try/catch; uses clientId for later reconciliation.
  Notes: Copy payload shape used by the server to minimize diff on ack.
  */
  const addOptimistic = (temp) => {
    try {
      pushMessage(chatId, temp);
    } catch {}
  };

  const clearComposer = () => {
    setText("");
    setEmojiOpen(false);
    onCancelReply();
    emitTyping(false);
    requestAnimationFrame(() => {
      try {
        window.dispatchEvent(new CustomEvent("app:scrollToBottom"));
      } catch {}
    });
  };

  const sendText = async () => {
    const value = (text || "").trim();
    if (!value || !chatId || !socket || locked) return;

    const clientId = makeClientId();
    addOptimistic({
      clientId,
      chat: chatId,
      sender: meId,
      type: "text",
      text: value,
      createdAt: new Date().toISOString(),
      status: "sending",
      replyTo: replyTo
        ? {
            _id: replyTo._id,
            text: replyTo.text,
            type: replyTo.type,
            mediaName: replyTo.mediaName,
            senderName: replyTo.senderName,
          }
        : undefined,
    });

    setSending(true);
    try {
      socket.emit("message:send", {
        chatId,
        text: value,
        clientId,
        type: "text",
        replyToId: replyTo?._id,
      });
      clearComposer();
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  };

  /*
  [PRO] Purpose: Validate and enqueue files without blocking the UI.
  Context: Enforces a single-file size cap to protect bandwidth and server limits.
  Edge cases: Resets input value after selection; closes emoji popover to avoid overlap.
  Notes: Queue is processed sequentially in sendFiles().
  */
  const onPickFiles = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const tooBig = files.find((f) => bytesToMB(f.size) > MAX_FILE_MB);
    if (tooBig) {
      alert(
        `File too large: ${tooBig.name} (${bytesToMB(
          tooBig.size
        )} MB). Limit is ${MAX_FILE_MB} MB.`
      );
      e.target.value = "";
      return;
    }

    setQueue((q) => [...q, ...files]);
    e.target.value = "";
    setEmojiOpen(false);
  };

  const sendFiles = async () => {
    if (!queue.length || !chatId || !socket || locked) return;

setUploading(true);
const errors = [];

try {
  for (const file of queue) {
    const kind = fileKind(file);
    let url = null;

    try {
      url = await uploadFile(file);
    } catch {
      errors.push(file.name);
      continue; // skip this file, but continue loop
    }

    const clientId = makeClientId();

    addOptimistic({
      clientId,
      chat: chatId,
      sender: meId,
      type: kind === "file" ? "file" : kind,
      mediaUrl: url,
      mediaName: file.name,
      mediaSize: file.size,
      createdAt: new Date().toISOString(),
      status: "sending",
      replyTo: replyTo
        ? {
            _id: replyTo._id,
            text: replyTo.text,
            type: replyTo.type,
            mediaName: replyTo.mediaName,
            senderName: replyTo.senderName,
          }
        : undefined,
    });

    socket.emit("message:send", {
      chatId,
      clientId,
      type: kind === "file" ? "file" : kind,
      mediaUrl: url,
      mediaName: file.name,
      mediaSize: file.size,
      replyToId: replyTo?._id,
    });
  }
} finally {
  // ALWAYS restore UI state no matter what happened
  setUploading(false);
  setQueue([]);
  clearComposer();

  requestAnimationFrame(() =>
    window.dispatchEvent(new CustomEvent("app:scrollToBottom"))
  );

  if (errors.length) {
    console.warn("Upload errors:", errors);
  }
}
  };

  const onSendVoice = async ({ blob, mime, durationMs }) => {
    if (!chatId || !socket || locked) return;

    let ext = "webm";
    if (mime.includes("ogg")) ext = "ogg";
    else if (mime.includes("mp4")) ext = "m4a";
    else if (mime.includes("mpeg")) ext = "mp3";

    const fileName = `voice-${Date.now()}.${ext}`;
    const file = new File([blob], fileName, { type: mime });

    try {
      setUploading(true);
      const url = await uploadFile(file);
      const clientId = makeClientId();

      addOptimistic({
        clientId,
        chat: chatId,
        sender: meId,
        type: "audio",
        mediaUrl: url,
        mediaName: fileName,
        mediaSize: file.size,
        mediaDuration: Math.round((durationMs || 0) / 1000),
        createdAt: new Date().toISOString(),
        status: "sending",
        replyTo: replyTo
          ? {
              _id: replyTo._id,
              text: replyTo.text,
              type: replyTo.type,
              mediaName: replyTo.mediaName,
              senderName: replyTo.senderName,
            }
          : undefined,
      });

      socket.emit("message:send", {
        chatId,
        clientId,
        type: "audio",
        mediaUrl: url,
        mediaName: fileName,
        mediaSize: file.size,
        mediaDuration: Math.round((durationMs || 0) / 1000),
        replyToId: replyTo?._id,
      });
      setShowRecorder(false);
      clearComposer();
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="w-full">
      {locked && (
        <div className="px-3 py-2 text-sm text-amber-800 bg-amber-50 border-t border-amber-200">
          {lockText}
        </div>
      )}

      {replyTo && (
        <div className="px-3 py-1 border-t bg-emerald-50 text-sm flex items-center gap-2">
          <div className="pl-2 border-l-4 border-emerald-600 text-gray-700 line-clamp-2">
            {replyTo?.text ||
              (replyTo?.mediaName ? `Attachment: ${replyTo.mediaName}` : "Reply")}
          </div>
          <button
            className="ml-auto text-xs px-2 py-1 rounded hover:bg-emerald-100"
            onClick={() => {
              onCancelReply();
              setEmojiOpen(false);
            }}
            title="Cancel reply"
            aria-label="Cancel reply"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {queue.length > 0 && (
        <div className="px-3 py-2 border-t bg-white flex items-center gap-2 overflow-x-auto">
          {queue.map((f, i) => {
            const kind = fileKind(f);
            const isImg = kind === "image";
            return (
              <div key={i} className="flex items-center gap-2 border rounded p-1">
                {isImg ? (
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    className="w-12 h-12 object-cover rounded"
                  />
                ) : (
                  <div className="w-12 h-12 rounded bg-gray-100 text-xs flex items-center justify-center">
                    {kind.toUpperCase()}
                  </div>
                )}
                <div className="text-xs max-w-[180px] truncate">
                  {f.name}
                  <div className="text-[10px] text-gray-500">
                    {bytesToMB(f.size)} MB
                  </div>
                </div>
                <button
                  className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                  onClick={() =>
                    setQueue((q) => q.filter((_, idx) => idx !== i))
                  }
                  title="Remove"
                  aria-label="Remove file"
                >
                  <CloseIcon />
                </button>
              </div>
            );
          })}
          <button
            className="text-sm ml-auto px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-50"
            onClick={sendFiles}
            disabled={uploading || locked}
          >
            {uploading ? "Sending…" : "Send files"}
          </button>
        </div>
      )}

      {showRecorder && !locked && (
        <VoiceRecorder onCancel={() => setShowRecorder(false)} onSend={onSendVoice} />
      )}

      {/* Composer row */}
      <div className="flex items-end gap-2 p-2 bg-white" onClick={hushAll}>
        {/* Attach */}
        <button
          className="px-3 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
          onClick={(e) => {
            e.stopPropagation();
            hushAll();
            fileRef.current?.click();
          }}
          disabled={locked || uploading}
          title="Attach files"
          aria-label="Attach files"
        >
          <ClipIcon />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf"
          multiple
          className="hidden"
          onChange={onPickFiles}
        />

        {/* Textarea (does not auto-open emoji) */}
        <textarea
          ref={areaRef}
          className="flex-1 border rounded-lg p-2 resize-none max-h-40 focus:outline-none focus:ring-1 focus:ring-emerald-600"
          placeholder={locked ? "Messaging disabled" : "Type a message"}
          rows={1}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          disabled={locked || sending || !chatId || uploading}
          style={{ overflow: "hidden" }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 160) + "px";
          }}
        />

        {/* Emoji button (opens popover) */}
        <button
          ref={emojiBtnRef}
          className="px-3 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
          onClick={(e) => {
            e.stopPropagation();
            setEmojiOpen((v) => !v);
          }}
          disabled={locked || uploading}
          title="Emoji"
          aria-label="Open emoji picker"
        >
          <SmileIcon />
        </button>

        {/* Emoji popover anchored to the emoji button */}
        <EmojiPopover
          anchorRef={emojiBtnRef}
          open={emojiOpen && !locked}
          onPick={(emoji) => setText((t) => t + emoji)}
          onClose={() => setEmojiOpen(false)}
        />

        {/* Mic */}
        <button
          className="px-3 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
          onClick={(e) => {
            e.stopPropagation();
            hushAll();
            setShowRecorder(true);
          }}
          disabled={locked || uploading}
          title="Record voice"
          aria-label="Record voice"
        >
          <MicIcon />
        </button>

        {/* Send */}
        <button
          className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
          onClick={sendText}
          disabled={locked || sending || !chatId || !text.trim() || uploading}
        >
          Send
        </button>
      </div>
    </div>
  );
}
