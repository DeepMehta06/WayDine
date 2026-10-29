/** Structured JSON logs. Callers must not pass secrets, tokens, or precise user coordinates. */
type Level = "info" | "warn" | "error";

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (process.env.LOG_LEVEL === "silent") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Strips query strings (which carry API keys and coordinates) from URLs before logging. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/-?\d+\.\d+,-?\d+\.\d+/g, "<coords>")}`;
  } catch {
    return "<invalid-url>";
  }
}
