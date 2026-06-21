type Level = "info" | "warn" | "error";

export const logger = {
  log(level: Level, obj: Record<string, unknown>, msg?: string) {
    const ts = new Date().toISOString();
    const context = Object.entries(obj)
      .map(([k, v]) => {
        if (k == 'stack') {
          return "\n"+v
        } else {
          return  `${k}=${v}`
        }
    });
    console.log(`[${ts}] [${level.toUpperCase()}] ${msg} ${context}`);
  },
  info(obj: Record<string, unknown>, msg?: string) { this.log("info", obj, msg); },
  warn(obj: Record<string, unknown>, msg?: string) { this.log("warn", obj, msg); },
  error(obj: Record<string, unknown>, msg?: string) { this.log("error", obj, msg); },
};