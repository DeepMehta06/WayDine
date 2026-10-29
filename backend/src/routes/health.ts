import { Router } from "express";
import type { AppConfig } from "../config.js";
import { describeConfigProblems } from "../config.js";
import type { ProviderContext } from "../providers/context.js";

/** Liveness only: the process is up. */
export function healthRouter(): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({ status: "ok" });
  });
  return router;
}

/** Readiness: configured capabilities and remaining free-tier budget (no secrets). */
export function readyRouter(config: AppConfig, ctx: ProviderContext): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    const quota = ctx.quota.snapshot();
    const routingReady = config.capabilities.mapbox && ctx.quota.remaining("mapbox_directions") > 0;
    res.status(routingReady ? 200 : 503).json({
      status: routingReady ? "ready" : "degraded",
      capabilities: config.capabilities,
      problems: describeConfigProblems(config),
      quota,
    });
  });
  return router;
}
