/**
 * VoiceRecorder — inline/sheet voice recording UI with send/cancel flow.

 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/*
[PRO] Purpose: Provide a simple, reliable audio capture flow that works inline on desktop and as a bottom sheet on mobile.
Context: MediaRecorder + getUserMedia with a lock during stop to avoid double-finalization races.
Edge cases: HTTPS requirement, permission denial, no device, quick tap/stop, and URL cleanup are handled.
Notes: Keep UI responsive; no new dependencies; avoid emoji; user-facing errors stay short and clear.
*/

const RecDot = ({ size = 8 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 12 12"
    aria-hidden="true"
    className="inline-block"
  >
    <circle cx="6" cy="6" r="5" fill="#DC2626" />
  </svg>
);

export default function VoiceRecorder({ onCancel, onSend, inline: forceInline = false }) {
  const [supported, setSupported] = useState(false);
  const [err, setErr] = useState("");
  const [recording, setRecording] = useState(false);
  const [stopping, setStopping] = useState(false); // wait for onstop
  const [busy, setBusy] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [mime, setMime] = useState("audio/webm");
  const [blobUrl, setBlobUrl] = useState("");
  const [chunks, setChunks] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width:767px)").matches
  );

  const streamRef = useRef(null);
  const recRef = useRef(null);
  const timerRef = useRef(null);
  const startedAt = useRef(0);

  const useSheet = !forceInline && isMobile;

  useEffect(() => {
    const mql = window.matchMedia("(max-width:767px)");
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    setSupported(!!(navigator.mediaDevices && window.MediaRecorder));
    return cleanupAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
  [PRO] Purpose: Ensure we stop timers/streams and revoke URLs on unmount.
  Context: Prevents memory leaks and dangling microphone access.
  Edge cases: Defensive try/catch if MediaRecorder/stream already ended.
  Notes: Idempotent; safe to call multiple times.
  */
  const cleanupAll = () => {
    stopTimer();
    try { recRef.current?.stop(); } catch {}
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    recRef.current = null;
    streamRef.current = null;
  };

  const startTimer = () => {
    startedAt.current = Date.now();
    stopTimer();
    timerRef.current = setInterval(() => setDurationMs(Date.now() - startedAt.current), 200);
  };
  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };

  const formatTime = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  };

  const chooseMime = () => {
    const types = [
      "audio/webm;codecs=opus","audio/webm",
      "audio/ogg;codecs=opus","audio/ogg",
      "audio/mp4","audio/mpeg"
    ];
    return types.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "audio/webm";
  };

  /*
  [PRO] Purpose: Single-button toggle with stop lock to avoid duplicate onstop events.
  Context: Some browsers fire onstop async; we disable while stopping to prevent races.
  Edge cases: Busy/uploading flags block toggles; HTTPS and device errors are surfaced cleanly.
  Notes: UI reflects recording immediately after start for responsiveness.
  */
  const toggleRecord = async () => {
    if (busy || uploading || stopping) return;
    setBusy(true);

    if (recording) {
      setStopping(true);
      try { recRef.current?.stop(); } catch {}
      // onstop will finalize
      return;
    }

    // start
    setErr("");
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      setErr("Microphone requires HTTPS or localhost.");
      setBusy(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const m = chooseMime();
      setMime(m);
      const rec = new MediaRecorder(stream, { mimeType: m });
      recRef.current = rec;

      const local = [];
      rec.ondataavailable = (e) => e.data && local.push(e.data);
      rec.onerror = (e) => {
        console.error(e);
        setErr(e?.message || "Recorder error");
        setStopping(false);
        setBusy(false);
      };
      rec.onstop = () => {
        stopTimer();
        const b = new Blob(local, { type: m });
        const url = URL.createObjectURL(b);
        setChunks(local);
        setBlobUrl(url);
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        setRecording(false);
        setStopping(false);   // unlock only here
        setBusy(false);
      };

      // reflect immediately
      setRecording(true);
      startTimer();
      rec.start();
      setBusy(false);
    } catch (e) {
      setErr(
        e?.name === "NotAllowedError"
          ? "Microphone permission denied."
          : e?.name === "NotFoundError"
          ? "No microphone found."
          : "Cannot start microphone."
      );
      setBusy(false);
    }
  };

  const resetAll = () => {
    stopTimer();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl("");
    setChunks([]);
    setDurationMs(0);
    setRecording(false);
    setStopping(false);
    setErr("");
    try { recRef.current?.stop(); } catch {}
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    recRef.current = null;
    streamRef.current = null;
  };

  const discard = () => { if (!uploading && !stopping) { resetAll(); onCancel?.(); } };

  /*
  [PRO] Purpose: Build blob and hand it off to parent with duration and mime.
  Context: Upload responsibility remains outside; this component only captures and emits.
  Edge cases: Disabled while uploading; ignores if no chunks.
  Notes: Resets state after send to prepare for the next capture.
  */
  const send = async () => {
    if (!chunks.length || uploading) return;
    setUploading(true);
    try {
      const b = new Blob(chunks, { type: mime });
      await onSend?.({ blob: b, mime, durationMs });
      resetAll();
      onCancel?.();
    } finally { setUploading(false); }
  };

  // UI pieces
  const Controls = () => (
    <>
      <button
        className={`px-3 md:px-4 py-2 rounded text-white ${recording ? "bg-red-600" : "bg-emerald-600"} disabled:opacity-50`}
        onClick={toggleRecord}
        disabled={busy || uploading || stopping}
        title={stopping ? "Stopping…" : recording ? "Stop" : "Start"}
        aria-label={stopping ? "Stopping" : recording ? "Stop recording" : "Start recording"}
      >
        {stopping ? "Stopping…" : recording ? "Stop" : "Start"}
      </button>

      {recording && (
        <button
          className="px-3 md:px-4 py-2 border rounded"
          onClick={discard}
          disabled={stopping}
          title={stopping ? "Finishing…" : "Cancel"}
          aria-label="Cancel recording"
        >
          Cancel
        </button>
      )}

      {!recording && blobUrl && (
        <>
          <button
            className="px-3 md:px-4 py-2 rounded bg-emerald-600 text-white"
            onClick={send}
            disabled={uploading}
            aria-label="Send recording"
          >
            {uploading ? "Uploading…" : "Send"}
          </button>
          <button className="px-3 md:px-4 py-2 border rounded" onClick={discard} disabled={uploading} aria-label="Discard recording">
            Discard
          </button>
        </>
      )}

      {!recording && !blobUrl && (
        <button className="px-3 md:px-4 py-2 border rounded" onClick={discard} disabled={stopping} aria-label="Cancel">
          Cancel
        </button>
      )}
    </>
  );

  const InlineBar = () => (
    <div className="p-2 border-t bg-white">
      {err && <div className="mb-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border px-3 py-1">
          <div className={`w-2 h-2 rounded-full ${recording ? "bg-red-500 animate-pulse" : "bg-gray-400"}`} aria-hidden="true" />
          <div className="font-mono text-sm">{formatTime(durationMs)}</div>
        </div>
        {!recording && blobUrl && <audio src={blobUrl} controls className="w-56 md:w-72" />}
        <div className="ml-auto flex items-center gap-2">
          <Controls />
        </div>
      </div>
    </div>
  );

  /*
  [PRO] Purpose: Mobile-first bottom sheet recorder UI with simple preview.
  Context: Easier thumb reach and clearer focus on small screens.
  Edge cases: Tap outside to dismiss; safe-area padding; stop-lock respected.
  Notes: Portal to body ensures overlay independence from chat scroll container.
  */
  const Sheet = () => (
    <div className="fixed inset-0 z-[1400]" onClick={(e)=>e.target===e.currentTarget && discard()}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="absolute inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-2xl p-3 pt-2"
        style={{ paddingBottom: `calc(12px + env(safe-area-inset-bottom,0px))` }}
        onClick={(e)=>e.stopPropagation()}
      >
        <div className="mx-auto my-1 w-10 h-1.5 rounded-full bg-gray-300" />
        {err && <div className="mb-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {recording ? (
              <div className="text-rose-600 flex items-center gap-2">
                <RecDot /> <span>Recording</span>
              </div>
            ) : blobUrl ? (
              <div className="text-gray-700">Preview</div>
            ) : (
              <div className="text-gray-700">Ready</div>
            )}
            <div className="ml-auto font-mono text-sm">{formatTime(durationMs)}</div>
          </div>
          {!recording && blobUrl && <audio src={blobUrl} controls className="w-full" />}
          <div className="flex items-center gap-2"><Controls /></div>
        </div>
      </div>
    </div>
  );

  if (!supported) return <div className="p-3 text-sm text-gray-500">Browser not supported.</div>;
  return useSheet ? createPortal(<Sheet />, document.body) : <InlineBar />;
}
