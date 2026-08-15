type LogLevel = "debug" | "info" | "warn" | "error";

function ts(): string {
  return new Date().toISOString();
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const line =
    meta && Object.keys(meta).length > 0
      ? `[${ts()}] ${level.toUpperCase()} ${message} ${JSON.stringify(meta)}`
      : `[${ts()}] ${level.toUpperCase()} ${message}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};
