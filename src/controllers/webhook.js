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

// Track satisfaction survey state
// Map: ticketId -> { surveyPending, lastReplyTime }
const surveyTracker = new Map();

// Available agents to reassign to (excluding the bot)
const AVAILABLE_AGENTS = process.env.AVAILABLE_AGENTS 
  ? process.env.AVAILABLE_AGENTS.split(',') 
  : ["8447388090495", "8447388090496"]; // Fallback agent IDs

/**
 * Detect customer sentiment and satisfaction status from their message
 * Returns: 'satisfied' | 'not_satisfied' | 'arguing' | 'neutral'
 */
function detectCustomerSentiment(message) {
  if (!message) return 'neutral';
  
  const lowerMsg = message.toLowerCase();
  
  // Satisfaction keywords (positive)
  const satisfiedKeywords = [
    'yes', 'great', 'perfect', 'excellent', 'thank', 'thanks', 'helpful', 'works',
    'solved', 'fixed', 'good', 'appreciate', 'awesome', 'wonderful', 'brilliant'
  ];
  
  // Dissatisfaction keywords (negative)
  const dissatisfiedKeywords = [
    'no', 'not satisfied', 'unsatisfied', 'unhappy', 'bad', 'terrible', 'waste',
    'useless', 'didn\'t help', 'didn\'t work', 'disappointed', 'frustrated', 'angry'
  ];
  
  // Arguing keywords
  const arguingKeywords = [
    'but', 'however', 'disagree', 'wrong', 'incorrect', 'not true', 'not right',
    'that\'s not', 'you\'re wrong', 'that doesn\'t', 'doesn\'t work', 'problem',
    'issue', 'broken', 'error', 'failed', 'why', 'explain'
  ];
  
  // Check for satisfaction
  const satisfiedCount = satisfiedKeywords.filter(kw => lowerMsg.includes(kw)).length;
  const dissatisfiedCount = dissatisfiedKeywords.filter(kw => lowerMsg.includes(kw)).length;
  const arguingCount = arguingKeywords.filter(kw => lowerMsg.includes(kw)).length;
  
  if (satisfiedCount > dissatisfiedCount && satisfiedCount > arguingCount && satisfiedCount > 0) {
    return 'satisfied';
  }
  
  if (dissatisfiedCount > satisfiedCount && dissatisfiedCount > arguingCount && dissatisfiedCount > 0) {
    return 'not_satisfied';
  }
  
  if (arguingCount > 0) {
    return 'arguing';
  }
  
  return 'neutral';
}

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
 * Close a ticket when customer is satisfied
 */
async function handleTicketClosure(ticketId) {
  try {
    console.log(`🔐 Closing satisfied ticket ${ticketId}...`);
    const { createZendeskClient } = await import("../config/zendesk.js");
    const zendeskClient = createZendeskClient();

    // Add closing comment
    const closingMessage = `✅ **Ticket Closed**\n\nThank you for your feedback! We're glad we could help. If you need further assistance in the future, feel free to create a new ticket.\n\n*Closed by AI Support Bot*`;

    await zendeskClient.put(`/tickets/${ticketId}.json`, {
      ticket: {
        status: "closed",
        comment: {
          body: closingMessage,
          public: true,
        }
      }
    });

    console.log(`✅ Ticket ${ticketId} closed successfully`);
    surveyTracker.delete(ticketId);

  } catch (err) {
    console.error(`❌ Failed to close ticket ${ticketId}:`, err.message);
  }
}

/**
 * Reassign a ticket to another agent when customer is not satisfied
 */
async function handleTicketReassignment(ticketId) {
  try {
    console.log(`🔄 Reassigning unsatisfied ticket ${ticketId}...`);
    const { createZendeskClient } = await import("../config/zendesk.js");
    const zendeskClient = createZendeskClient();

    // Pick a random agent from available agents
    const randomAgent = AVAILABLE_AGENTS[Math.floor(Math.random() * AVAILABLE_AGENTS.length)];
    
    const reassignmentMessage = `ℹ️ **Ticket Reassigned**\n\nWe understand you're still having issues. We're transferring your ticket to one of our specialist agents who can provide more personalized assistance.\n\nThey will be with you shortly. Thank you for your patience!\n\n*Escalated by AI Support Bot*`;

    await zendeskClient.put(`/tickets/${ticketId}.json`, {
      ticket: {
        assignee_id: randomAgent,
        comment: {
          body: reassignmentMessage,
          public: true,
        }
      }
    });

    console.log(`✅ Ticket ${ticketId} reassigned to agent ${randomAgent}`);
    surveyTracker.delete(ticketId);

  } catch (err) {
    console.error(`❌ Failed to reassign ticket ${ticketId}:`, err.message);
  }
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
 * Also handles satisfaction survey responses
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
    const description = ticketData.description || "";

    console.log(`💬 Comment added to ticket ${ticketId}`);
    console.log(`👤 Assignee ID: ${assignee_id}, Bot ID: ${BOT_ASSIGNEE_ID}`);

    // CHECK 1: Only proceed if ticket is assigned to the bot
    if (!assignee_id || assignee_id.toString() !== BOT_ASSIGNEE_ID.toString()) {
      console.log(`⏭️  Skipping auto-reply - ticket not assigned to bot. Assigned to: ${assignee_id}`);
      return;
    }

    // CHECK 2: Check if this is a satisfaction survey response
    const survey = surveyTracker.get(ticketId);
    if (survey && survey.surveyPending) {
      console.log(`📊 Processing satisfaction survey response for ticket ${ticketId}`);
      const sentiment = detectCustomerSentiment(description);

      if (sentiment === 'satisfied') {
        console.log(`✅ Customer confirmed satisfaction - closing ticket`);
        await handleTicketClosure(ticketId);
        return;
      }

      if (sentiment === 'not_satisfied') {
        console.log(`❌ Customer confirmed dissatisfaction - reassigning ticket`);
        await handleTicketReassignment(ticketId);
        return;
      }

      if (sentiment === 'arguing') {
        console.log(`🔥 Customer arguing in survey response - continue with bot reply`);
        surveyTracker.delete(ticketId); // Clear survey state and proceed with reply
      }
    }

    // CHECK 3: Loop prevention - don't reply too frequently
    if (!shouldReplyToTicket(ticketId)) {
      console.log(`⏸️  Skipping auto-reply for ticket ${ticketId} - cooldown active to prevent loops`);
      return;
    }

    const subject = ticketData.subject || "";
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
 * Also handles satisfaction survey and post-reply actions
 */
async function handleAutoReplyAsync(ticketId, subject, description, organization_id, ticketData) {
  try {
    console.log(`⏳ Starting async auto-reply for ticket ${ticketId}...`);

    // Step 0: Check customer sentiment from their message
    const customerSentiment = detectCustomerSentiment(description);
    console.log(`💭 Customer sentiment detected: ${customerSentiment}`);

    // SENTIMENT ACTIONS
    if (customerSentiment === 'satisfied') {
      console.log(`✅ Customer satisfied - attempting to close ticket ${ticketId}`);
      await handleTicketClosure(ticketId);
      return;
    }

    if (customerSentiment === 'not_satisfied') {
      console.log(`❌ Customer not satisfied - attempting to reassign ticket ${ticketId}`);
      await handleTicketReassignment(ticketId);
      return;
    }

    if (customerSentiment === 'arguing') {
      console.log(`🔥 Customer arguing - continuing with bot reply for ticket ${ticketId}`);
      // Continue with normal reply
    }

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

    await zendeskClient.put(`/tickets/${ticketId}.json`, {
      ticket: {
        comment: {
          body: replyText,
          public: true,
        }
      }
    });

    console.log(`✅ Auto-reply successfully sent to ticket ${ticketId}`);

    // Step 6: Send satisfaction survey question
    console.log(`❓ Sending satisfaction survey for ticket ${ticketId}...`);
    const surveyQuestion = `\n\n---\n\n**Are you satisfied with this response?** 😊\n\nPlease let us know:\n- Reply "yes" if this solved your issue\n- Reply "no" if you need further help\n- Feel free to share any feedback\n\nThank you for your patience!`;

    await zendeskClient.put(`/tickets/${ticketId}.json`, {
      ticket: {
        comment: {
          body: surveyQuestion,
          public: true,
        }
      }
    });

    console.log(`✅ Satisfaction survey sent for ticket ${ticketId}`);
    surveyTracker.set(ticketId, { surveyPending: true, lastReplyTime: Date.now() });

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
      description: "Automatically generates and sends AI replies with satisfaction survey and smart ticket management",
      features: {
        autoReplyOnNewTicket: true,
        conditionalReplyOnComment: true,
        botAssigneeCheck: true,
        loopPrevention: true,
        satisfactionSurvey: true,
        ticketClosure: true,
        ticketReassignment: true,
        sentimentDetection: true,
        arguementHandling: true,
        brandIsolation: true,
        kbPrioritization: true,
        errorNotifications: true
      },
      botConfig: {
        botAssigneeId: BOT_ASSIGNEE_ID,
        botAssigneeName: BOT_ASSIGNEE_NAME,
        replyCooldownMs: REPLY_COOLDOWN_MS,
        maxRepliesPerWindow: MAX_REPLIES_PER_WINDOW,
        availableAgents: AVAILABLE_AGENTS,
        note: "Only replies if ticket is assigned to bot, with satisfaction survey"
      },
      workflow: {
        step1: "New ticket → Generate AI reply + send satisfaction survey",
        step2: "Customer responds with YES → Close ticket",
        step3: "Customer responds with NO → Reassign to human agent",
        step4: "Customer argues → Continue with AI reply"
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
