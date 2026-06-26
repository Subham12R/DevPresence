// Pure, vscode-free presentation/logic helpers for Dev Presence.
// Kept free of the `vscode` import so it runs under plain Node for unit tests.

export type ActivityKind =
  | "writing"
  | "reading"
  | "saving"
  | "idle"
  | "offline"
  | "paused";

interface ActivityMeta {
  icon: string;
  phrase: string;
  animated: boolean; // trailing dots animate
  showTime: boolean; // append "· Active for …"
}

export const ACTIVITY: Record<ActivityKind, ActivityMeta> = {
  writing: { icon: "$(radio-tower)",  phrase: "Writing Code", animated: true,  showTime: true },
  reading: { icon: "$(book)",         phrase: "Reading Code", animated: true,  showTime: true },
  saving:  { icon: "$(save)",         phrase: "Saving",       animated: true,  showTime: true },
  idle:    { icon: "$(clock)",        phrase: "Idle",         animated: false, showTime: true },
  offline: { icon: "$(circle-slash)", phrase: "Offline",      animated: false, showTime: false },
  paused:  { icon: "$(debug-pause)",  phrase: "Paused",       animated: false, showTime: false },
};

// Dot animation frames cycle: "" -> "·" -> "··" -> "···" -> ""
export const DOT_FRAMES = ["", "·", "··", "···"];

export function dotFrame(tick: number): string {
  const frames = DOT_FRAMES.length;
  const index = ((tick % frames) + frames) % frames;
  return DOT_FRAMES[index];
}

export function formatActiveTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function renderStatusText(kind: ActivityKind, tick: number, activeMs: number): string {
  const meta = ACTIVITY[kind];
  const dots = meta.animated ? dotFrame(tick) : "";
  let text = `${meta.icon} ${meta.phrase}${dots}`;
  if (meta.showTime) {
    text += ` · Active for ${formatActiveTime(activeMs)}`;
  }
  return text;
}

export function isLoopbackAgentUrl(agentUrl: string): boolean {
  try {
    const { hostname } = new URL(agentUrl);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}
