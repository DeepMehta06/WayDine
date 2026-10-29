import "dotenv/config";
import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.js";
import { restaurantsRouter } from "./routes/restaurants.js";
import { recommendRouter } from "./routes/recommend.js";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 4000;
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/restaurants", restaurantsRouter);
app.use("/api/recommend", recommendRouter);

app.listen(port, () => {
  console.log(`WayDine backend listening on port ${port}`);
});
