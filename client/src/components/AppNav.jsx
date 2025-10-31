// client/src/components/AppNav.jsx

/**
 * Bottom app navigation with safe-area support and WhatsApp-like active color.
 */

import React, { useEffect } from "react";
import { BottomNavigation, BottomNavigationAction, Paper } from "@mui/material";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import GroupsIcon from "@mui/icons-material/Groups";
import CallOutlinedIcon from "@mui/icons-material/CallOutlined";

const WP_GREEN = "#128C7E";
const NAV_BASE_PX = 56;

/*
[PRO] Purpose: Provide a stable bottom nav sized for devices with/without safe-area insets.
Context: Multiple screens use a fixed bottom bar; we expose its computed height via CSS var.
Edge cases: Older browsers may not support env(safe-area-inset-bottom); default remains 0px.
Notes: We only set the var once on mount; changes to inset at runtime are rare and acceptable.
*/

/**
 * AppNav
 * @param {{value: string, onChange?: (val:string)=>void}} props
 */
export default function AppNav({ value, onChange }) {
  useEffect(() => {
    const val = `calc(${NAV_BASE_PX}px + env(safe-area-inset-bottom, 0px))`;
    document.documentElement.style.setProperty("--app-nav-h", val);
  }, []);

  const safeOnChange = (_, v) => {
    if (typeof onChange === "function") onChange(v);
  };

  return (
    <Paper
      elevation={10}
      className="fixed bottom-0 inset-x-0 z-[1200]"
      sx={{
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <BottomNavigation
        value={value}
        onChange={safeOnChange}
        showLabels
        sx={{
          height: NAV_BASE_PX,
          "& .Mui-selected": { color: WP_GREEN },
          "& .MuiBottomNavigationAction-root.Mui-selected": { color: WP_GREEN },
          "& .MuiBottomNavigationAction-label.Mui-selected": { fontWeight: 600 },
          "& .MuiSvgIcon-root": { color: "inherit" },
        }}
      >
        <BottomNavigationAction
          label="Chats"
          value="chats"
          icon={<ChatBubbleOutlineIcon />}
          aria-label="Chats"
        />
        <BottomNavigationAction
          label="Groups"
          value="groups"
          icon={<GroupsIcon />}
          aria-label="Groups"
        />
        <BottomNavigationAction
          label="Calls"
          value="calls"
          icon={<CallOutlinedIcon />}
          aria-label="Calls"
        />
      </BottomNavigation>
    </Paper>
  );
}
