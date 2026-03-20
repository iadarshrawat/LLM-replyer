import { generateContent } from "../config/openai.js";
import { queryVectors } from "../config/pinecone.js";
import { embedText } from "../services/embedding.js";
import { buildReplyPrompt } from "../utils/prompts.js";
import { buildTranslationPrompt } from "../utils/prompts.js";

/**
 * Compose RAG-based reply for ticket
 * Priority: Manually uploaded KB > Ticket conversations
 */
export async function composeReply(req, res) {
  try {
    const ticket = req.body;

    if (!ticket.subject || !ticket.description) {
      return res.status(400).json({ error: "Invalid ticket payload - subject and description required" });
    }

    // Generate query embedding
    const queryEmbedding = await embedText(`${ticket.subject} ${ticket.description}`);

    // Build brand filter if brand is provided
    const filter = ticket.brand ? { brand: { $eq: ticket.brand } } : null;

    // ==================== PHASE 1: Search manually uploaded KB first ====================
    console.log("📚 PHASE 1: Searching manually uploaded knowledge base...");
    
    const kbFilter = filter ? { ...filter, source: { $eq: "manual_upload" } } : { source: { $eq: "manual_upload" } };
    const kbResults = await queryVectors(queryEmbedding, 10, true, kbFilter);
    
    // Filter results with good relevance score (cosine > 0.7)
    const relevantKBMatches = kbResults.matches.filter(m => m.score >= 0.7);
    console.log(`✅ Found ${relevantKBMatches.length} relevant KB articles (score >= 0.7)`);

    let finalResults = null;
    let searchSource = "manual_kb";

    if (relevantKBMatches.length > 0) {
      // ✅ Use manually uploaded KB results
      finalResults = { matches: relevantKBMatches.slice(0, 5) };
      console.log("✅ Using manually uploaded KB for reply generation");
    } else {
      // ==================== PHASE 2: Fall back to ticket conversations if KB not sufficient ====================
      console.log("⚠️  PHASE 2: No good KB matches found. Searching ticket conversations...");
      
      const chatFilter = filter ? { ...filter, source: { $eq: "ticket_chat" } } : { source: { $eq: "ticket_chat" } };
      const chatResults = await queryVectors(queryEmbedding, 10, true, chatFilter);
      
      const relevantChatMatches = chatResults.matches.filter(m => m.score >= 0.6);
      console.log(`✅ Found ${relevantChatMatches.length} relevant chat conversations (score >= 0.6)`);
      
      finalResults = { matches: relevantChatMatches.slice(0, 5) };
      searchSource = "ticket_chat";
    }

    // Extract relevant context from best source
    const kbChunks = finalResults.matches
      .map(match => match.metadata?.content || "")
      .filter(Boolean)
      .join("\n\n") || "No relevant knowledge found.";

    const prompt = buildReplyPrompt(ticket, ticket.tone || "professional", kbChunks);
    console.log("📝 Generating reply for ticket:", ticket.ticketId, `[Brand: ${ticket.brand || 'default'}, Source: ${searchSource}]`);

    const replyText = await generateContent(prompt, {
      temperature: 0.7,
      topP: 0.8,
      topK: 40,
    });

    res.json({
      ticketId: ticket.ticketId,
      reply: replyText,
      source: searchSource,
      sources: finalResults.matches.map(m => ({
        title: m.metadata?.subject || m.metadata?.title,
        type: m.metadata?.type,
        source: m.metadata?.source,
        score: m.score
      })).filter(s => s.title),
    });
  } catch (err) {
    console.error("❌ RAG reply error:", err);
    res.status(500).json({ error: "RAG reply failed", details: err.message });
  }
}

/**
 * Debug search endpoint for testing retrieval
 */
export async function debugSearch(req, res) {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: "query required" });
    }

    const queryEmbedding = await embedText(query);
    const results = await queryVectors(queryEmbedding, 10, true);

    res.json({
      query: query,
      results: results.matches.map(match => ({
        id: match.id,
        score: match.score,
        type: match.metadata?.type,
        ticket_id: match.metadata?.ticket_id,
        subject: match.metadata?.subject || match.metadata?.title,
        content: match.metadata?.content?.slice(0, 200) + "...",
      })),
    });
  } catch (err) {
    console.error("❌ Debug search error:", err);
    res.status(500).json({ error: "Debug search failed", details: err.message });
  }
}

/**
 * Translate text to target language
 */
export async function translateText(req, res) {
  try {
    const { text, targetLanguage } = req.body;
    console.log(`🌐 Received translation request to ${targetLanguage} and ${text}`);

    if (!text || !targetLanguage) {
      return res.status(400).json({ error: "text and targetLanguage are required" });
    }

    console.log(`🌐 Translating text to ${targetLanguage}...`);

    const prompt = buildTranslationPrompt(text, targetLanguage);

    const translatedText = await generateContent(prompt, {
      temperature: 0.3,
      topP: 0.8,
      topK: 40,
    });

    console.log(`✅ Translation completed`);

    console.log(`🌐 Translated Text: ${translatedText}`);

    res.json({
      originalText: text,
      translatedText: translatedText.trim(),
      targetLanguage: targetLanguage
    });

  } catch (err) {
    console.error("❌ Translation error:", err);
    res.status(500).json({ 
      error: "Translation failed", 
      details: err.message 
    });
  }
}



/**
 * Send auto-reply for new tickets
 * Generates AI reply and automatically sends it to Zendesk ticket
 */
export async function sendReply(req, res) {
  try {
    const { ticketId, subject, description, brand } = req.body;

    if (!ticketId || !subject || !description) {
      return res.status(400).json({ 
        error: "ticketId, subject, and description are required" 
      });
    }

    console.log(`🤖 Auto-reply triggered for ticket ${ticketId}`);

    // Step 1: Generate embedding from ticket content
    const queryEmbedding = await embedText(`${subject} ${description}`);

    // Step 2: Build brand filter
    const filter = brand ? { brand: { $eq: brand } } : null;

    // Step 3: PHASE 1 - Search manually uploaded KB
    console.log("📚 PHASE 1: Searching manually uploaded KB for auto-reply...");
    const kbFilter = filter ? { ...filter, source: { $eq: "manual_upload" } } : { source: { $eq: "manual_upload" } };
    const kbResults = await queryVectors(queryEmbedding, 10, true, kbFilter);
    const relevantKBMatches = kbResults.matches.filter(m => m.score >= 0.7);

    let finalResults = null;
    let searchSource = "manual_kb";

    if (relevantKBMatches.length > 0) {
      finalResults = { matches: relevantKBMatches.slice(0, 5) };
      console.log(`✅ Found ${relevantKBMatches.length} relevant KB articles for auto-reply`);
    } else {
      // Step 4: PHASE 2 - Fall back to ticket conversations
      console.log("⚠️  PHASE 2: Searching ticket conversations for auto-reply...");
      const chatFilter = filter ? { ...filter, source: { $eq: "ticket_chat" } } : { source: { $eq: "ticket_chat" } };
      const chatResults = await queryVectors(queryEmbedding, 10, true, chatFilter);
      const relevantChatMatches = chatResults.matches.filter(m => m.score >= 0.6);

      finalResults = { matches: relevantChatMatches.slice(0, 5) };
      searchSource = "ticket_chat";
      console.log(`✅ Found ${relevantChatMatches.length} relevant chat conversations`);
    }

    // Step 5: Extract context and generate reply
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

    // Step 6: Send reply to Zendesk using Zendesk API
    console.log(`📤 Sending reply to Zendesk ticket ${ticketId}...`);
    const { createZendeskClient } = await import("../config/zendesk.js");
    const zendeskClient = createZendeskClient();

    await zendeskClient.post(`/tickets/${ticketId}/comments`, {
      comment: {
        body: replyText,
        public: true,
        author_id: -1 // System comment
      }
    });

    console.log(`✅ Auto-reply successfully sent to ticket ${ticketId}`);

    res.json({
      success: true,
      ticketId: ticketId,
      replyText: replyText,
      source: searchSource,
      message: "Auto-reply generated and sent to Zendesk"
    });

  } catch (err) {
    console.error("❌ Auto-reply error:", err.message);
    res.status(500).json({ 
      error: "Auto-reply failed", 
      details: err.message,
      ticketId: req.body?.ticketId
    });
  }
}