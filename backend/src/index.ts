import { createApp } from "./app.js";
import { config, describeConfigProblems } from "./config.js";
import { createSearchLogger } from "./db/searchLog.js";
import { log } from "./lib/log.js";
import { createProviderContext } from "./providers/context.js";

const ctx = createProviderContext(config);
const searchLog = await createSearchLogger(config);

for (const problem of describeConfigProblems(config)) log("warn", "config.problem", { problem });
log("info", "config.capabilities", { ...config.capabilities, searchLogging: searchLog.enabled });

const server = createApp(config, ctx, searchLog).listen(config.PORT, () => {
  log("info", "server.listening", { port: config.PORT });
});

function shutdown(signal: string) {
  log("info", "server.shutdown", { signal });
  ctx.quota.persistNow();
  ctx.googleMonthlyQuota?.persistNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
