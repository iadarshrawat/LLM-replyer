import axios from "axios";
import { generateContent } from "../config/openai.js";
import { queryVectors } from "../config/pinecone.js";
import { embedText } from "../services/embedding.js";
import { buildReplyPrompt } from "../utils/prompts.js";

// Bot assignee identifier - change this to match your bot's user ID or name
const BOT_ASSIGNEE_ID = process.env.BOT_ASSIGNEE_ID || "8447388090494";
const BOT_ASSIGNEE_NAME = process.env.BOT_ASSIGNEE_NAME || "adarsh";

// Track recent bot replies to prevent infinite loops
// Map: ticketId -> { timestamp, count }
const recentBotReplies = new Map();
const REPLY_COOLDOWN_MS = 60000; // 1 minute cooldown between replies
const MAX_REPLIES_PER_WINDOW = 1; // Max 1 reply per cooldown window

/**
 * Check if we should reply to prevent loops
 * Returns true if safe to reply, false if too soon or too many replies
 */
function shouldReplyToTicket(ticketId) {
  const now = Date.now();
  const recent = recentBotReplies.get(ticketId);

  if (!recent) {
    // No recent reply, safe to reply
    recentBotReplies.set(ticketId, { timestamp: now, count: 1 });
    return true;
  }

  const timeSinceLastReply = now - recent.timestamp;

  if (timeSinceLastReply > REPLY_COOLDOWN_MS) {
    // Cooldown expired, reset and allow reply
    recentBotReplies.set(ticketId, { timestamp: now, count: 1 });
    return true;
  }

  if (recent.count >= MAX_REPLIES_PER_WINDOW) {
    // Already replied max times in this window
    console.log(`⏸️  Rate limit: Ticket ${ticketId} already replied ${recent.count} times in the last ${timeSinceLastReply}ms`);
    return false;
  }

  // Increment count and allow reply
  recent.count++;
  console.log(`📊 Reply count for ticket ${ticketId}: ${recent.count}/${MAX_REPLIES_PER_WINDOW}`);
  return true;
}

/**
 * Webhook handler for Zendesk ticket.created events
 * Automatically generates and sends AI reply to new tickets
 */
export async function handleTicketCreatedWebhook(req, res) {
  try {
    console.log("🔔 Webhook received:", req.body.type || "unknown");
    
    // Acknowledge webhook immediately (Zendesk expects 200 OK within 10s)
    res.status(200).json({ status: "received" });

    // Extract ticket data from 'detail' field (Zendesk event payload structure)
    const ticketData = req.body.detail;
    
    if (!ticketData || !ticketData.id) {
      console.warn("⚠️ Invalid webhook payload - missing ticket detail");
      console.log("Received payload structure:", Object.keys(req.body));
      return;
    }

    const ticketId = ticketData.id;
    const subject = ticketData.subject || "";
    const description = ticketData.description || "";
    const organization_id = ticketData.organization_id || "default_brand";

    console.log(`🎫 New ticket webhook received: ID=${ticketId}, Subject="${subject.substring(0, 50)}..."`);
    console.log(`📋 Ticket Details - Priority: ${ticketData.priority}, Status: ${ticketData.status}, Type: ${ticketData.type}`);

    // Auto-generate and send reply asynchronously (don't wait)
    handleAutoReplyAsync(ticketId, subject, description, organization_id, ticketData).catch(err => {
      console.error(`❌ Async auto-reply failed for ticket ${ticketId}:`, err.message);
    });

  } catch (err) {
    console.error("❌ Webhook handler error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

/**
 * Webhook handler for Zendesk ticket.comment_added events
 * Re-replies only if assignee is the bot (adarsh)
 * Includes loop prevention to stop infinite replies
 */
export async function handleCommentAddedWebhook(req, res) {
  try {
    console.log("🔔 Comment webhook received:", req.body.type || "unknown");
    
    // Acknowledge webhook immediately (Zendesk expects 200 OK within 10s)
    res.status(200).json({ status: "received" });

    const ticketData = req.body.detail;
    
    if (!ticketData || !ticketData.id) {
      console.warn("⚠️ Invalid webhook payload - missing ticket detail");
      return;
    }

    const ticketId = ticketData.id;
    const assignee_id = ticketData.assignee_id;

    console.log(`💬 Comment added to ticket ${ticketId}`);
    console.log(`👤 Assignee ID: ${assignee_id}, Bot ID: ${BOT_ASSIGNEE_ID}`);

    // CHECK 1: Only proceed if ticket is assigned to the bot
    if (!assignee_id || assignee_id.toString() !== BOT_ASSIGNEE_ID.toString()) {
      console.log(`⏭️  Skipping auto-reply - ticket not assigned to bot. Assigned to: ${assignee_id}`);
      return;
    }

    // CHECK 2: Loop prevention - don't reply too frequently
    if (!shouldReplyToTicket(ticketId)) {
      console.log(`⏸️  Skipping auto-reply for ticket ${ticketId} - cooldown active to prevent loops`);
      return;
    }

    const subject = ticketData.subject || "";
    const description = ticketData.description || "";
    const organization_id = ticketData.organization_id || "default_brand";

    console.log(`✅ Bot is assignee + cooldown passed - proceeding with auto-reply for ticket ${ticketId}`);

    // Auto-generate and send reply asynchronously
    handleAutoReplyAsync(ticketId, subject, description, organization_id, ticketData).catch(err => {
      console.error(`❌ Async auto-reply failed for ticket ${ticketId}:`, err.message);
    });

  } catch (err) {
    console.error("❌ Comment webhook handler error:", err);
    res.status(500).json({ error: "Comment webhook processing failed" });
  }
}

/**
 * Asynchronous handler for auto-reply generation and sending
 */
async function handleAutoReplyAsync(ticketId, subject, description, organization_id, ticketData) {
  try {
    console.log(`⏳ Starting async auto-reply for ticket ${ticketId}...`);

    // Step 1: Generate embedding
    const queryEmbedding = await embedText(`${subject} ${description}`);
    const filter = organization_id ? { organization_id: { $eq: organization_id } } : null;

    // Step 2: PHASE 1 - Search manually uploaded KB
    console.log("📚 Searching manual KB for auto-reply...");
    const kbFilter = filter ? { ...filter, source: { $eq: "manual_upload" } } : { source: { $eq: "manual_upload" } };
    const kbResults = await queryVectors(queryEmbedding, 10, true, kbFilter);
    const relevantKBMatches = kbResults.matches.filter(m => m.score >= 0.7);

    let finalResults;
    let searchSource = "manual_kb";

    if (relevantKBMatches.length > 0) {
      finalResults = { matches: relevantKBMatches.slice(0, 5) };
      console.log(`✅ Found ${relevantKBMatches.length} relevant KB articles`);
    } else {
      // Step 3: PHASE 2 - Fall back to ticket conversations
      console.log("⚠️  Searching ticket conversations for auto-reply...");
      const chatFilter = filter ? { ...filter, source: { $eq: "ticket_chat" } } : { source: { $eq: "ticket_chat" } };
      const chatResults = await queryVectors(queryEmbedding, 10, true, chatFilter);
      const relevantChatMatches = chatResults.matches.filter(m => m.score >= 0.6);

      finalResults = { matches: relevantChatMatches.slice(0, 5) };
      searchSource = "ticket_chat";
      console.log(`✅ Found ${relevantChatMatches.length} relevant conversations`);
    }

    // Step 4: Extract context and generate reply
    const kbChunks = finalResults.matches
      .map(match => match.metadata?.content || "")
      .filter(Boolean)
      .join("\n\n") || "No relevant knowledge found.";

    const prompt = buildReplyPrompt(
      { subject, description, ticketId },
      "professional",
      kbChunks
    );

    console.log(`📝 Generating auto-reply for ticket ${ticketId}...`);
    const replyText = await generateContent(prompt, {
      temperature: 0.7,
      topP: 0.8,
      topK: 40,
    });

    // Step 5: Send reply to Zendesk
    console.log(`📤 Sending auto-reply to Zendesk ticket ${ticketId}...`);
    const { createZendeskClient } = await import("../config/zendesk.js");
    const zendeskClient = createZendeskClient();

    console.log("this is zendeskClient -> ",zendeskClient);

    console.log(`📤 Sending auto-reply to Zendesk ticket ${ticketId}...`);
// ADD HERE ↓
console.log("🔗 Full URL:", `https://d3v-itbytes.zendesk.com/api/v2/tickets/${Number(ticketId)}.json`);
console.log("🎫 Ticket ID:", ticketId, "| type:", typeof ticketId);

    await zendeskClient.put(`/tickets/${ticketId}.json`, {
      ticket: {
        comment: {
          body: replyText,
          public: true,
        }
      }
    });

    console.log(`✅ Auto-reply successfully sent to ticket ${ticketId}`);

  } catch (err) {
    console.error(`❌ Auto-reply generation failed for ticket ${ticketId}:`, err.message);
    
    // Optionally send error notification to Zendesk
    try {
      const { createZendeskClient } = await import("../config/zendesk.js");
      const zendeskClient = createZendeskClient();
      
      await zendeskClient.put(`/tickets/${ticketId}.json`, {
        ticket: {
          comment: {
            body: "⚠️ AI auto-reply generation failed. Please provide a manual response.",
            public: false, // Internal note
          }
        }
      });
    } catch (notificationErr) {
      console.error("Failed to send error notification:", notificationErr.message);
    }
  }
}

/**
 * Webhook handler for general Zendesk events
 * Logs event for debugging and validation
 */
export async function handleWebhookEvent(req, res) {
  try {
    console.log("🔔 Webhook event received");
    console.log("Event type:", req.body.event_type);
    console.log("Timestamp:", req.body.timestamp);

    // Acknowledge immediately
    res.status(200).json({ status: "acknowledged" });

    // Log event details
    console.log("Full event data:", JSON.stringify(req.body, null, 2).substring(0, 500));

  } catch (err) {
    console.error("❌ Webhook event handler error:", err);
    res.status(200).json({ status: "error_acknowledged" }); // Still return 200 to avoid retries
  }
}

/**
 * Get webhook status and statistics
 */
export async function getWebhookStatus(req, res) {
  try {
    res.json({
      status: "active",
      endpoints: {
        ticketCreated: "/webhook/ticket-created",
        commentAdded: "/webhook/comment-added"
      },
      events: ["ticket.created", "ticket.comment_added"],
      description: "Automatically generates and sends AI replies to new tickets and user responses",
      features: {
        autoReplyOnNewTicket: true,
        conditionalReplyOnComment: true,
        botAssigneeCheck: true,
        loopPrevention: true,
        brandIsolation: true,
        kbPrioritization: true,
        errorNotifications: true
      },
      botConfig: {
        botAssigneeId: BOT_ASSIGNEE_ID,
        botAssigneeName: BOT_ASSIGNEE_NAME,
        replyCooldownMs: REPLY_COOLDOWN_MS,
        maxRepliesPerWindow: MAX_REPLIES_PER_WINDOW,
        note: "Only replies if ticket is assigned to bot, with rate limiting to prevent loops"
      },
      loopPrevention: {
        description: "Prevents infinite reply loops by tracking recent replies",
        cooldownWindow: `${REPLY_COOLDOWN_MS}ms (${REPLY_COOLDOWN_MS / 1000}s)`,
        maxReplies: `${MAX_REPLIES_PER_WINDOW} reply per cooldown window`
      }
    });
  } catch (err) {
    console.error("❌ Status error:", err);
    res.status(500).json({ error: "Failed to get webhook status" });
  }
}
