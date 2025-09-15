import express from "express";
import { createShortUrl } from "../controller/shortUrlController.js";
import cors from "cors";

const router = express.Router();

router.options("/", cors(), (req, res) => {
  res.sendStatus(204);
});

router.post("/", createShortUrl);

export default router;
