import { useEffect, useState } from "react";

// Phone sized, or a phone held sideways (about 850px wide but short and touch
// driven). Without the second half, rotating mid-session would swap layouts.
export const PHONE_QUERY = "(max-width: 640px), (pointer: coarse) and (max-height: 500px)";

const matches = () => typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia(PHONE_QUERY).matches;

export function useIsPhone() {
  const [isPhone, setIsPhone] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return isPhone;
}
