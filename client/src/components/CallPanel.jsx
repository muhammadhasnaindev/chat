// src/components/CallPanel.jsx

/**
 * CallPanel: WebRTC call UI + signaling (Socket.IO).
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getSocket } from "../sockets/socket";
import useAuth from "../store/authStore";
import api from "../api/axios";

/*
[PRO] Purpose: Provide a resilient call surface (start/accept, signal, media, cleanup).
Context: Group calls may add members incrementally; signaling events can repeat.
Edge cases: Duplicate peers, non-HTTPS origins, missing mic/cam permissions; we guard all three.
Notes: Keep behavior minimal; one host ends the call, others leave cleanly. No new deps.
*/

/** ICE servers (public STUN). Keep minimal, configurable later. */
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const HTTPS_ERR = "Calls need HTTPS (or localhost). Open the app over https.";

function isSecureForMedia() {
  return (
    typeof window !== "undefined" &&
    (window.isSecureContext ||
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost")
  );
}

/**
 * @param {{
 *  mode: 'outgoing' | 'incoming',
 *  chat: any,
 *  kind?: 'audio'|'video',
 *  callId?: string,
 *  onClose?: ()=>void
 * }} props
 */
export default function CallPanel({ mode, chat, kind = "audio", callId: initialCallId, onClose }) {
  const socket = getSocket();
  const { user } = useAuth();

  const [callId, setCallId] = useState(initialCallId || "");
  const currentCallIdRef = useRef(callId);
  useEffect(() => {
    currentCallIdRef.current = callId;
  }, [callId]);

  const [participants, setParticipants] = useState([]); // userIds
  const [host, setHost] = useState(null);
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(kind === "video");
  const [joining, setJoining] = useState(true);

  const startedAtRef = useRef(null);
  const endedRef = useRef(false);

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  const peersRef = useRef(new Map()); // userId -> { pc, stream, mediaRef }
  const myId = user?.id;
  const isGroup = !!chat?.isGroup;

  const constraints = useMemo(
    () => ({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: kind === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    }),
    [kind]
  );

  const chatId = chat?._id || chat?.id || null; // accept both shapes

  function mapParticipantIds() {
    const raw = Array.isArray(chat?.participants) ? chat.participants : [];
    const mapped = raw.map((p) => (typeof p === "object" ? p._id : p)).filter(Boolean);
    if (isGroup) return mapped;
    const other = mapped.find((id) => String(id) !== String(myId));
    return other ? [other] : mapped;
  }

  function hasPeer(uid) {
    return peersRef.current.has(String(uid));
  }

  // Setup devices and start/accept the call
  useEffect(() => {
    (async () => {
      try {
        if (!isSecureForMedia()) {
          setError(HTTPS_ERR);
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          try {
            await localVideoRef.current.play();
          } catch {}
        }
        stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
        stream.getVideoTracks().forEach((t) => (t.enabled = camOn));

        startedAtRef.current = new Date().toISOString();

        if (!chatId) {
          setError("Missing chat id — cannot start call.");
          return;
        }

        if (mode === "outgoing") {
          try {
            await api.post("/calls/start", {
              chatId,
              kind,
              participants: mapParticipantIds(),
            });
          } catch (e) {
            // soft-fail: signaling will still run
            console.debug("[CallPanel] /calls/start failed:", e?.message);
          }
          socket.emit("call:start", { chatId, kind });
        } else if (mode === "incoming" && initialCallId) {
          socket.emit("call:accept", { callId: initialCallId });
        }
      } catch (e) {
        console.debug("[CallPanel] getUserMedia error:", e?.message);
        setError("Mic/Camera permission needed. Please allow.");
      }
    })();

    return () => {
      // close all peers
      for (const [, p] of peersRef.current) {
        try {
          p.pc.close();
        } catch {}
      }
      peersRef.current.clear();
      // stop local tracks
      try {
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
      // notify leave if we had a call
      if (currentCallIdRef.current && !endedRef.current) {
        socket.emit("call:leave", { callId: currentCallIdRef.current });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Socket events
  useEffect(() => {
    if (!socket) return;

    const onCreated = (p) => {
      setCallId(p.callId);
      setParticipants(p.members || []);
      setHost(p.host);
      setJoining(false);
    };

    const onParticipants = async (p) => {
      setCallId(p.callId);
      setParticipants(p.members || []);
      setHost(p.host);
      setJoining(false);

      for (const uid of p.members || []) {
        if (String(uid) === String(myId)) continue;
        if (hasPeer(uid)) continue; // NEW: skip duplicate creation
        await createPeerAndOffer(uid, p.callId);
      }
    };

    const onJoined = async ({ callId: id, userId: uid }) => {
      setParticipants((prev) => Array.from(new Set([...prev, uid])));
      if (String(uid) !== String(myId) && !hasPeer(uid)) {
        await createPeerAndOffer(uid, id);
      }
    };

    const onLeft = ({ userId: uid }) => {
      setParticipants((prev) => prev.filter((x) => String(x) !== String(uid)));
      const p = peersRef.current.get(String(uid));
      if (p) {
        try {
          p.pc.close();
        } catch {}
        peersRef.current.delete(String(uid));
      }
    };

    const onEnded = async () => {
      if (!endedRef.current) {
        endedRef.current = true;
        try {
          if (chatId) {
            await api.post("/calls/end", {
              chatId,
              startedAt: startedAtRef.current,
              status: "completed",
            });
          }
        } catch {}
      }
      onClose?.();
    };

    const onSignal = async ({ callId: id, fromUserId, data }) => {
      if (!localStreamRef.current) return;
      let peer = peersRef.current.get(String(fromUserId));
      if (!peer) peer = await createPeer(String(fromUserId));
      const pc = peer.pc;

      if (data?.sdp) {
        const desc = new RTCSessionDescription(data.sdp);
        await pc.setRemoteDescription(desc);
        if (desc.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("call:signal", {
            callId: id,
            toUserId: fromUserId,
            data: { sdp: pc.localDescription },
          });
        }
      } else if (data?.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch {}
      }
    };

    socket.on("call:created", onCreated);
    socket.on("call:participants", onParticipants);
    socket.on("call:joined", onJoined);
    socket.on("call:left", onLeft);
    socket.on("call:ended", onEnded);
    socket.on("call:signal", onSignal);
    socket.on("call:error", (e) => setError(e?.message || "Call error"));

    return () => {
      socket.off("call:created", onCreated);
      socket.off("call:participants", onParticipants);
      socket.off("call:joined", onJoined);
      socket.off("call:left", onLeft);
      socket.off("call:ended", onEnded);
      socket.off("call:signal", onSignal);
      socket.off("call:error");
    };
  }, [socket, myId, chatId]);

  async function createPeerAndOffer(targetUserId, useCallId) {
    const peer = await createPeer(String(targetUserId));
    const pc = peer.pc;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("call:signal", {
      callId: useCallId || currentCallIdRef.current,
      toUserId: targetUserId,
      data: { sdp: pc.localDescription },
    });
  }

  async function createPeer(targetUserId) {
    if (!localStreamRef.current) throw new Error("No local stream");

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("call:signal", {
          callId: currentCallIdRef.current,
          toUserId: targetUserId,
          data: { candidate: e.candidate },
        });
      }
    };

    const mediaRef = React.createRef();
    peersRef.current.set(String(targetUserId), { pc, stream: null, mediaRef });

    pc.ontrack = async (e) => {
      const entry = peersRef.current.get(String(targetUserId));
      if (!entry) return;
      const remoteStream = (e.streams && e.streams[0]) || entry.stream || new MediaStream();
      entry.stream = remoteStream;
      if (entry.mediaRef?.current) {
        entry.mediaRef.current.srcObject = remoteStream;
        try {
          await entry.mediaRef.current.play();
        } catch {}
      }
    };

    return peersRef.current.get(String(targetUserId));
  }

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  }

  function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
  }

  async function hangup() {
    if (!endedRef.current) {
      endedRef.current = true;
      try {
        if (chatId) {
          await api.post("/calls/end", {
            chatId,
            startedAt: startedAtRef.current,
            status: "completed",
          });
        }
      } catch {}
    }

    if (host && String(host) === String(myId)) {
      socket.emit("call:end", { callId: currentCallIdRef.current });
    } else {
      socket.emit("call:leave", { callId: currentCallIdRef.current });
    }
    onClose?.();
  }

  const otherIds = participants.filter((u) => String(u) !== String(myId));
  const cols = otherIds.length === 0 ? 1 : otherIds.length === 1 ? 2 : otherIds.length <= 3 ? 2 : 3;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur">
      <div className="absolute inset-0 p-3 md:p-6 flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 text-white">
          <div className="text-lg font-semibold">
            {kind === "video" ? "Video call" : "Audio call"} {isGroup ? "• Group" : ""}
          </div>
          <div className="ml-auto text-sm opacity-80">
            {joining ? "Connecting…" : `${participants.length} in call`}
          </div>
        </div>

        {/* Grid */}
        <div
          className="mt-3 grid gap-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {/* Local */}
          <div className="relative rounded-xl overflow-hidden bg-black">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-56 md:h-72 object-cover"
              style={{ transform: kind === "video" ? "scaleX(-1)" : undefined }}
            />
            <div className="absolute bottom-2 left-2 text-xs text-white/90">You</div>
          </div>

          {/* Remotes */}
          {otherIds.map((uid) => {
            const entry = peersRef.current.get(String(uid));
            const ref = entry?.mediaRef || React.createRef();
            if (entry && !entry.mediaRef) entry.mediaRef = ref;
            return (
              <div key={uid} className="relative rounded-xl overflow-hidden bg-black">
                {kind === "video" ? (
                  <video
                    ref={ref}
                    autoPlay
                    playsInline
                    muted={false}
                    className="w-full h-56 md:h-72 object-cover"
                  />
                ) : (
                  <audio ref={ref} autoPlay controls={false} className="hidden" />
                )}
                <div className="absolute bottom-2 left-2 text-xs text-white/90">
                  {String(uid).slice(-6)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Controls */}
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={toggleMic}
            className={`px-4 py-2 rounded-full ${
              micOn ? "bg-white text-black" : "bg-red-600 text-white"
            }`}
            title={micOn ? "Mute" : "Unmute"}
            type="button"
          >
            {micOn ? "Mute" : "Unmute"}
          </button>
          {kind === "video" && (
            <button
              onClick={toggleCam}
              className={`px-4 py-2 rounded-full ${
                camOn ? "bg-white text-black" : "bg-yellow-600 text-white"
              }`}
              title={camOn ? "Turn camera off" : "Turn camera on"}
              type="button"
            >
              {camOn ? "Camera off" : "Camera on"}
            </button>
          )}
          <button
            onClick={hangup}
            className="px-4 py-2 rounded-full bg-red-700 text-white"
            title="End call"
            type="button"
          >
            End
          </button>
        </div>

        {error && <div className="mt-3 text-center text-sm text-red-300">{error}</div>}
      </div>
    </div>
  );
}
