import { Router } from "express";
import { supabase } from "../db/supabaseClient.js";

export const restaurantsRouter = Router();

restaurantsRouter.get("/", async (_req, res) => {
  const { data, error } = await supabase.from("restaurants").select("*").order("name");

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ restaurants: data });
});
