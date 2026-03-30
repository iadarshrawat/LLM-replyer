/**
 * Zendesk Sunshine Conversations Controller
 * Handles customer messages through Zendesk Sunshine API
 * Messages are managed as conversations in Zendesk, not tickets
 */

import axios from "axios";
import dotenv from "dotenv";
import { generateContent } from "../config/openai.js";
import { queryVectors } from "../config/pinecone.js";
import { embedText } from "../services/embedding.js";
import { buildReplyPrompt } from "../utils/prompts.js";

dotenv.config();

/**
 * Create Sunshine Conversations API client
 */
function createSunshineClient() {
  if (!process.env.ZENDESK_DOMAIN || !process.env.SUNSHINE_API_KEY) {
    throw new Error("Zendesk Sunshine credentials not configured");
  }

  return axios.create({
    baseURL: `https://${process.env.ZENDESK_DOMAIN}.zendesk.com/api/v1`,
    headers: {
      'Authorization': `Bearer ${process.env.SUNSHINE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Handle incoming message from Sunshine Conversations webhook
 * Called when a customer sends a message via web widget/Zendesk channel
 */
export async function handleSunshineMessage(req, res) {
  try {
    console.log("📨 Sunshine message received:", JSON.stringify(req.body, null, 2));

    const { user, messages } = req.body;

    if (!user || !messages || messages.length === 0) {
      return res.status(400).json({ error: "Invalid payload structure" });
    }

    // Get the latest customer message
    const latestMessage = messages[messages.length - 1];
    const { id: messageId, text, authorId } = latestMessage;

    const userId = user.id;
    const userName = user.name || "Guest";
    const userEmail = user.email || "unknown@example.com";
    const brand = req.body.brand || "default_brand";

    console.log(`💬 Processing message from ${userName}: "${text}"`);

    // Extract conversation ID from the webhook payload
    let conversationId = req.body.conversationId;

    if (!conversationId && req.body.conversation) {
      conversationId = req.body.conversation.id;
    }

    if (!conversationId) {
      return res.status(400).json({ error: "conversationId not found in payload" });
    }

    // Step 1: Generate embedding for the customer message
    let messageEmbedding;
    try {
      messageEmbedding = await embedText(text);
    } catch (err) {
      console.error("❌ Embedding error:", err.message);
      messageEmbedding = null;
    }

    // Step 2: Search knowledge base (2-phase search)
    let searchResults = [];
    let selectedArticles = [];

    if (messageEmbedding) {
      try {
        // PHASE 1: Search manually uploaded KB with higher threshold (0.7)
        const phase1Results = await queryVectors(
          messageEmbedding,
          10,
          { source: "manual_upload", brand: brand }
        );

        const phase1Filtered = phase1Results.filter(r => r.score >= 0.7);

        if (phase1Filtered.length > 0) {
          searchResults = phase1Filtered;
          console.log(`✅ PHASE 1 (Manual KB) found ${phase1Filtered.length} results`);
        } else {
          // PHASE 2: Fall back to ticket conversations with lower threshold (0.6)
          console.log(`⏳ PHASE 1 found no results, trying PHASE 2...`);
          const phase2Results = await queryVectors(
            messageEmbedding,
            10,
            { source: "ticket_chat", brand: brand }
          );

          const phase2Filtered = phase2Results.filter(r => r.score >= 0.6);
          if (phase2Filtered.length > 0) {
            searchResults = phase2Filtered;
            console.log(`✅ PHASE 2 (Ticket Chat) found ${phase2Filtered.length} results`);
          }
        }

        selectedArticles = searchResults.slice(0, 5); // Top 5 articles
      } catch (err) {
        console.error("⚠️ KB search error:", err.message);
        selectedArticles = [];
      }
    }

    // Step 3: Generate reply using OpenAI
    let botReply;
    try {
      const prompt = buildReplyPrompt(text, selectedArticles, brand);
      botReply = await generateContent(prompt);
    } catch (err) {
      console.error("❌ OpenAI generation error:", err.message);
      botReply = "I'm sorry, I encountered an issue generating a response. Please try again.";
    }

    // Step 4: Send bot reply back through Sunshine Conversations
    await sendSunshineMessage(conversationId, botReply);

    // Step 5: Return success response
    res.json({
      success: true,
      conversationId,
      messageId,
      botReply,
      articlesUsed: selectedArticles.length,
    });

  } catch (err) {
    console.error("❌ Error handling Sunshine message:", err.message);
    res.status(500).json({
      error: "Failed to process message",
      details: err.message,
    });
  }
}

/**
 * Send bot reply back to Zendesk Sunshine Conversations
 */
async function sendSunshineMessage(conversationId, message) {
  try {
    const sunshineClient = createSunshineClient();

    const payload = {
      messages: [
        {
          role: "appMaker",
          type: "text",
          text: message,
          metadata: {
            timestamp: new Date().toISOString(),
            source: "ai-bot",
          },
        },
      ],
    };

    console.log(`📤 Sending Sunshine message to conversation: ${conversationId}`);

    const response = await sunshineClient.post(
      `/conversations/${conversationId}/messages`,
      payload
    );

    console.log(`✅ Message sent successfully. Message ID: ${response.data.messages?.[0]?.id}`);
    return response.data;

  } catch (err) {
    console.error("❌ Failed to send Sunshine message:", err.response?.data || err.message);
    throw err;
  }
}

/**
 * Get conversation details
 */
export async function getConversation(req, res) {
  try {
    const { conversationId } = req.params;

    if (!conversationId) {
      return res.status(400).json({ error: "conversationId is required" });
    }

    const sunshineClient = createSunshineClient();
    const response = await sunshineClient.get(`/conversations/${conversationId}`);

    res.json(response.data);

  } catch (err) {
    console.error("❌ Error fetching conversation:", err.message);
    res.status(500).json({
      error: "Failed to fetch conversation",
      details: err.message,
    });
  }
}

/**
 * Get conversation history (messages)
 */
export async function getConversationHistory(req, res) {
  try {
    const { conversationId } = req.params;

    if (!conversationId) {
      return res.status(400).json({ error: "conversationId is required" });
    }

    const sunshineClient = createSunshineClient();
    const response = await sunshineClient.get(`/conversations/${conversationId}/messages`);

    res.json({
      conversationId,
      messageCount: response.data.messages?.length || 0,
      messages: response.data.messages || [],
    });

  } catch (err) {
    console.error("❌ Error fetching conversation history:", err.message);
    res.status(500).json({
      error: "Failed to fetch conversation history",
      details: err.message,
    });
  }
}

/**
 * Health check for Sunshine integration
 */
export async function getSunshineStatus(req, res) {
  try {
    const sunshineClient = createSunshineClient();

    // Try to fetch app info
    const response = await sunshineClient.get("/apps");

    res.json({
      status: "ok",
      message: "Sunshine Conversations API is connected",
      appsCount: response.data.apps?.length || 0,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error("❌ Sunshine status error:", err.message);
    res.status(500).json({
      status: "error",
      message: "Failed to connect to Sunshine Conversations API",
      details: err.message,
    });
  }
}

/**
 * Configure webhook - Call this once to set up the incoming webhook
 * POST /sunshine/configure-webhook with:
 * { webhookUrl: "https://your-backend.com/sunshine/webhook" }
 */
export async function configureWebhook(req, res) {
  try {
    const { webhookUrl } = req.body;

    if (!webhookUrl) {
      return res.status(400).json({ error: "webhookUrl is required" });
    }

    const sunshineClient = createSunshineClient();

    const payload = {
      webhook: {
        target: webhookUrl,
        events: [
          "conversation:message", // When customer sends a message
          "conversation:read",    // When conversation is read
        ],
      },
    };

    console.log(`🔧 Configuring webhook: ${webhookUrl}`);

    const response = await sunshineClient.post("/webhooks", payload);

    res.json({
      success: true,
      webhookId: response.data.webhook?.id,
      message: "Webhook configured successfully",
    });

  } catch (err) {
    console.error("❌ Webhook configuration error:", err.message);
    res.status(500).json({
      error: "Failed to configure webhook",
      details: err.message,
    });
  }
}
