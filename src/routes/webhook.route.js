import express from "express";
import { 
  handleTicketCreatedWebhook,
  handleCommentAddedWebhook, 
  handleWebhookEvent, 
  getWebhookStatus 
} from "../controllers/webhook.js";

const router = express.Router();

/**
 * Webhook routes for Zendesk ticket events
 */

// Handle ticket.created events - Auto-reply trigger
router.post("/ticket-created", handleTicketCreatedWebhook);

// Handle ticket.comment_added events - Re-reply if assignee is bot
router.post("/comment-added", handleCommentAddedWebhook);

// General webhook event handler
router.post("/events", handleWebhookEvent);

// Get webhook status
router.get("/status", getWebhookStatus);

export default router;
