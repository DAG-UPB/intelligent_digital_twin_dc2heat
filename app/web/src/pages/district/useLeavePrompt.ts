/**
 * Leaving the Site map with unsaved edits: asked once per edit (app/leaveGuard.ts holds the shell on the page
 * meanwhile). `leaving` is the route asked about (null: not asking); `leave` goes there and does not ask again until
 * the next edit (a new `site`).
 */
import { useEffect, useRef, useState } from "react";
import type { Site } from "../../api";
import { setLeaveGuard } from "../../app/leaveGuard";

export function useLeavePrompt(dirty: boolean, site: Site | null) {
  const [leaving, setLeaving] = useState<string | null>(null);
  const asked = useRef(false);
  const dirtyNow = useRef(dirty);
  dirtyNow.current = dirty;
  useEffect(() => {
    asked.current = false; // a new edit: ask again
  }, [site]);
  useEffect(() => {
    setLeaveGuard((to) => {
      if (!dirtyNow.current || asked.current) return true;
      setLeaving(to);
      return false;
    });
    return () => setLeaveGuard(null);
  }, []);
  const leave = () => {
    const to = leaving;
    asked.current = true;
    setLeaving(null);
    if (to) window.location.hash = to;
  };
  return { leaving, setLeaving, leave };
}
