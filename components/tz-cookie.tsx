"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Tells the server the time zone of this browser (cookie "tz"), so times are shown in it. */
export function TzCookie() {
  const router = useRouter();
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && !document.cookie.includes(`tz=${encodeURIComponent(tz)}`)) {
        document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }
    } catch { /* the default zone stays */ }
  }, [router]);
  return null;
}
