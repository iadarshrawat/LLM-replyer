# 🔴 Webhook Payload Structure Issue

## Problem
Your Zendesk Sunshine webhook test shows: `{"error":"Invalid payload structure"}`

## Root Cause
The webhook handler expects this payload structure:
```javascript
{
  user: { id, name, email },
  messages: [ { id, text, authorId } ],
  conversationId: "...",
  brand: "..."
}
```

But Zendesk Sunshine is likely sending a **different structure**.

## Solution: Debug the Actual Payload

### Step 1: Add Debug Endpoint
Add this temporary endpoint to `server.js` to log what Zendesk sends:

```javascript
// Add this BEFORE the app.listen() call
app.post("/webhook/debug-payload", (req, res) => {
  console.log("🔍 RECEIVED WEBHOOK PAYLOAD:");
  console.log(JSON.stringify(req.body, null, 2));
  res.status(200).json({ status: "logged" });
});
```

### Step 2: Test with Debug Endpoint
In Zendesk Sunshine webhook settings, change the URL to:
```
https://yourdomain.com/webhook/debug-payload
```

Then send a test message.

### Step 3: Check Server Logs
Look for the logged JSON structure and share it here.

---

## Common Zendesk Sunshine Payload Formats

### Format 1: Direct Message Structure
```json
{
  "event_type": "conversation.message",
  "data": {
    "id": "message_id",
    "body": "customer message",
    "author": {
      "id": "author_id",
      "name": "Customer Name"
    },
    "conversation_id": "conversation_id"
  }
}
```

### Format 2: Conversation + Messages
```json
{
  "event_type": "conversation.created",
  "data": {
    "conversation": {
      "id": "conv_id",
      "participant_id": "customer_id"
    },
    "messages": [
      {
        "id": "msg_id",
        "text": "message text",
        "author_id": "customer_id"
      }
    ]
  }
}
```

### Format 3: Your Current Expected Format
```json
{
  "user": { "id": "...", "name": "...", "email": "..." },
  "messages": [ { "id": "...", "text": "...", "authorId": "..." } ],
  "conversationId": "..."
}
```

---

## Quick Fix Options

### Option A: Parse Any Format (Most Robust)
Update `handleSunshineMessage` to accept multiple formats:

```javascript
export async function handleSunshineMessage(req, res) {
  try {
    console.log("📨 Sunshine message received:", JSON.stringify(req.body, null, 2));
    
    const body = req.body;
    
    // Try to extract data from different possible structures
    let user, messages, conversationId, text;
    
    // Format 1: Direct message in data.data
    if (body.data?.body) {
      text = body.data.body;
      conversationId = body.data.conversation_id;
      user = {
        id: body.data.author?.id || "unknown",
        name: body.data.author?.name || "Guest"
      };
      messages = [{ text, id: body.data.id }];
    }
    // Format 2: Messages array in data.messages
    else if (body.data?.messages?.length > 0) {
      messages = body.data.messages;
      conversationId = body.data.conversation?.id;
      text = messages[messages.length - 1].text;
      user = { id: body.data.participant_id };
    }
    // Format 3: Your current format
    else if (body.user && body.messages?.length > 0) {
      user = body.user;
      messages = body.messages;
      conversationId = body.conversationId;
      text = messages[messages.length - 1].text;
    }
    else {
      console.log("❌ Cannot parse webhook payload");
      return res.status(400).json({ 
        error: "Invalid payload structure",
        received: body
      });
    }
    
    // Rest of the handler...
  } catch (err) {
    // ...
  }
}
```

### Option B: Check Zendesk Documentation
1. Go to Zendesk Admin → Sunshine Conversations
2. Look for webhook payload example in docs
3. Adjust handler to match

---

## Immediate Next Steps

1. Add the debug endpoint to `server.js`
2. Restart: `npm start`
3. Send a test message in Zendesk Sunshine
4. Share the logged payload JSON
5. I'll update the handler to parse it correctly

---

## Files to Modify

If you can't add debug endpoint:
- Send me the Zendesk Sunshine webhook payload documentation URL
- Or check Zendesk logs to see what they're sending

Current file: `src/controllers/sunshine.js` (lines 35-40)

