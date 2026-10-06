// The five rows and the length buckets, shared by the desktop board and the
// phone layout.
import { LearnIcon, EyeIcon, MusicIcon, GamepadIcon, ArchiveIcon } from "./components/icons.jsx";

export const ROWS = [
  { key: "learn", label: "Worth learning from", tint: "var(--cat-learn)", icon: LearnIcon,
    empty: "No lessons pending." },
  { key: "watch", label: "Worth watching", tint: "var(--cat-watch)", icon: EyeIcon,
    empty: "Your eyes are off the hook." },
  { key: "music", label: "Music", tint: "var(--cat-music)", icon: MusicIcon,
    empty: "All quiet in here." },
  { key: "entertainment", label: "Just for fun", tint: "var(--cat-entertainment)", icon: GamepadIcon,
    empty: "No fun pending." },
  { key: "outdated", label: "Outdated", tint: "var(--cat-outdated)", icon: ArchiveIcon,
    empty: "Nothing has aged out yet." },
];

export const DURATIONS = [
  { key: "xs", label: "< 5 min", test: (d) => d != null && d < 300 },
  { key: "md", label: "5–20 min", test: (d) => d != null && d >= 300 && d < 1200 },
  { key: "lg", label: "20–60 min", test: (d) => d != null && d >= 1200 && d < 3600 },
  { key: "xl", label: "1 hr +", test: (d) => d != null && d >= 3600 },
];
