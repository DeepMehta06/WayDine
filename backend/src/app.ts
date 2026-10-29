import cors from "cors";
import express, { type Express } from "express";
import type { AppConfig } from "./config.js";
import type { SearchLogger } from "./db/searchLog.js";
import { errorHandler, notFound, requestContext } from "./lib/express.js";
import { ClientRateLimiter } from "./lib/quota.js";
import type { ProviderContext } from "./providers/context.js";
import { healthRouter, readyRouter } from "./routes/health.js";
import { placesRouter } from "./routes/places.js";
import { recommendRouter } from "./routes/recommend.js";

export function createApp(config: AppConfig, ctx: ProviderContext, searchLog: SearchLogger): Express {
  const app = express();
  app.disable("x-powered-by");
  if (config.TRUST_PROXY === "true") app.set("trust proxy", 1);

  app.use(cors({ origin: config.CORS_ORIGIN.split(",").map((o) => o.trim()), exposedHeaders: ["x-request-id", "Retry-After"] }));
  app.use(express.json({ limit: "16kb" }));
  app.use(requestContext);

  app.use("/api/health", healthRouter());
  app.use("/api/ready", readyRouter(config, ctx));
  app.use("/api/places", placesRouter(ctx, new ClientRateLimiter(config.CLIENT_SUGGEST_PER_MINUTE)));
  app.use("/api/recommend", recommendRouter(ctx, new ClientRateLimiter(config.CLIENT_RECOMMEND_PER_MINUTE), searchLog));

  app.use("/api", notFound);
  app.use(errorHandler);
  return app;
}
