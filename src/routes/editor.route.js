import express from "express";
import { composeReply, debugSearch, sendReply, translateText } from "../controllers/editor.js";

const router = express.Router();

// Compose RAG-based reply for ticket
router.post("/compose-reply", composeReply);

router.post("/debug-search", debugSearch);

// Translate text to target language
router.post("/translate", translateText);

// Auto-reply for new tickets
router.post("/auto-reply", sendReply);

export default router;