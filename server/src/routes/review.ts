import { Router } from "express";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { listPendingReview, markReviewDone } from "../db/queries/review.js";

export const reviewRouter = Router();
reviewRouter.use(requireAuth, requireAdmin);

reviewRouter.get("/", (_req, res) => {
  res.json({ items: listPendingReview() });
});

reviewRouter.patch("/:id/done", (req, res) => {
  const id = Number(req.params.id);
  markReviewDone(id);
  res.json({ ok: true });
});
