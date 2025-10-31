// src/components/CallsList.jsx

/**
 * CallsList: simple history list with duration + when.
 
 */

import React, { useEffect, useState } from "react";
import api from "../api/axios";
import dayjs from "dayjs";

/*
[PRO] Purpose: Present recent calls with minimal chrome.
Context: Server returns array of calls with startedAt/durationSec.
Edge cases: Missing fields; we render "--:--" duration and "Unknown" date.
Notes: Keep fetch on mount only; pagination can be added later without breaking API.
*/

function Duration({ s = 0 }) {
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <>
      {mm}:{ss}
    </>
  );
}

export default function CallsList() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const { data } = await api.get("/calls");
        setCalls(Array.isArray(data) ? data : []);
      } catch (e) {
        console.debug("[CallsList] fetch failed:", e?.message);
        setCalls([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading calls…</div>;
  if (!calls.length) return <div className="p-4 text-sm text-gray-500">No calls yet.</div>;

  return (
    <div className="divide-y">
      {calls.map((c) => {
        const title = c.chat?.name || (c.chat?.isGroup ? "Group" : "Chat");
        const when = c?.startedAt && dayjs(c.startedAt).isValid()
          ? dayjs(c.startedAt).format("MMM D, HH:mm")
          : "Unknown";
        return (
          <div key={c._id} className="p-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {title}{" "}
                  <span className="text-[10px] ml-1 px-2 py-0.5 rounded-full bg-gray-100">
                    {c.kind}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  {c.direction} · {c.status} · {when}
                </div>
              </div>
              <div className="text-xs text-gray-600">
                {c.durationSec ? <Duration s={c.durationSec} /> : "--:--"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
