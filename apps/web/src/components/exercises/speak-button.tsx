"use client";

import { useSpeak } from "@/lib/use-speak";

/**
 * Głośnik przy słówku. Gdy przeglądarka nie ma głosu dla tego języka ani nagrania, przycisk
 * znika — lepiej, żeby go nie było, niż żeby dziecko klikało i nic się nie działo.
 */
export function SpeakButton({
  text,
  lang,
  audioUrl,
  big = false,
  label = "Posłuchaj",
}: {
  text: string;
  lang: string;
  audioUrl?: string | null;
  big?: boolean;
  label?: string;
}) {
  const { speak, speaking, canSpeak, hasVoice, voicesLoaded } = useSpeak(lang);

  // Głosy dochodzą z opóźnieniem — dopóki ich nie znamy, pokazujemy przycisk.
  const usable = canSpeak && (!voicesLoaded || hasVoice || Boolean(audioUrl));
  if (!usable) return null;

  if (big) {
    return (
      <button
        type="button"
        className="btn-primary w-full"
        style={{ minHeight: "5rem", fontSize: "1.5rem" }}
        onClick={() => speak(text, audioUrl)}
      >
        <span aria-hidden>{speaking ? "🔊" : "🔈"}</span> {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => speak(text, audioUrl)}
      aria-label={`${label}: ${text}`}
      title={label}
      className="inline-flex items-center justify-center rounded-full border-2 transition-colors"
      style={{
        width: "3rem",
        height: "3rem",
        borderColor: "var(--line)",
        background: "var(--surface)",
        fontSize: "1.5rem",
      }}
    >
      <span aria-hidden>{speaking ? "🔊" : "🔈"}</span>
    </button>
  );
}
