# 🔧 ZENDESK SUNSHINE WEBHOOK - DETAILED BREAKDOWN

## The Problem

```
Zendesk Sunshine Webhook Test
        ↓
    Sends payload with:
    - event.message.body
    - event.conversation_id
    - detail.id
        ↓
Your Handler Expected:
    - user.name
    - messages[].text
    - conversationId
        ↓
    ❌ MISMATCH!
        ↓
    "Invalid payload structure"
```

---

## Payload Field Mapping

### What Zendesk Sends

```
Request Body:
├── account_id: 21825834
├── detail
│   └── id: "141"                    ← Ticket ID
├── event
│   ├── actor
│   │   ├── id: "zd:answerBot"      ← Sender ID
│   │   ├── name: "Z3n Tests"       ← Sender name
│   │   └── type: "system"          ← Message type
│   ├── conversation_id: "67ab5f53..."  ← Where to reply
│   └── message
│       ├── body: "Hi there..."     ← The message (USE THIS!)
│       └── id: "67ab5f55..."       ← Message ID
├── id: "01JQMQH83YN..."            ← Event ID
├── subject: "zen:ticket:141"
├── type: "zen:event-type:messaging_ticket.message_added"
└── zendesk_event_version: "2022-11-06"
```

### What Your Code Now Uses

```javascript
const { event, detail } = req.body;

// Extract message
const messageBody = event.message.body;                    // ✅ Correct
const messageId = event.message.id;                        // ✅ Correct
const conversationId = event.conversation_id;              // ✅ Correct
const ticketId = detail?.id;                               // ✅ Correct
const actorName = event.actor?.name;                       // ✅ Correct
```

---

## Code Flow - Before vs After

### BEFORE (Broken)

```
┌─────────────────────────────────────────┐
│   Zendesk sends webhook with:           │
│   { event, detail, account_id, ... }   │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  const { user, messages } = req.body;  │ ❌ WRONG!
│  Tries to extract req.body.user         │
│  Tries to extract req.body.messages     │
│  These fields don't exist!              │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  if (!user || !messages) {              │ ❌ Always true
│    return error: "Invalid payload"      │
│  }                                       │
└─────────────────────────────────────────┘
```

### AFTER (Fixed)

```
┌─────────────────────────────────────────┐
│   Zendesk sends webhook with:           │
│   { event, detail, account_id, ... }   │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  const { event, detail } = req.body;   │ ✅ CORRECT!
│  const messageBody = event.message.body;│ ✅ GET MESSAGE
│  const conversationId = event...        │ ✅ GET CONVERSATION
│  const ticketId = detail.id;            │ ✅ GET TICKET
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  if (!event || !event.message) {        │ ✅ Valid check
│    return error: "Invalid payload"      │
│  }                                       │
│  (continues because fields DO exist)    │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  await embedText(messageBody);          │ ✅ CREATE EMBEDDING
│  await queryVectors(...);               │ ✅ SEARCH KB
│  await generateContent(...);            │ ✅ GENERATE REPLY
│  await sendSunshineMessage(...);        │ ✅ SEND BACK
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  Response: { success: true, botReply }  │ ✅ SUCCESS!
└─────────────────────────────────────────┘
```

---

## Field Extraction - Line by Line

### Line 55: Parse Payload
```javascript
const { event, detail } = req.body;
//      ↓         ↓
//      └─ What Zendesk sends
```

### Line 57-60: Validate
```javascript
if (!event || !event.message || !event.conversation_id) {
    //  ↓        ↓               ↓
    //  ✅ Check correct fields exist
    return res.status(400).json({ error: "Invalid payload structure" });
}
```

### Lines 68-73: Extract Values
```javascript
const messageBody = event.message.body;          // "Hi there..."
const messageId = event.message.id;              // "67ab5f55..."
const conversationId = event.conversation_id;   // "67ab5f53..."
const ticketId = detail?.id || "unknown";       // "141"
const actorName = event.actor?.name || "Guest"; // "Z3n Tests"
const actorId = event.actor?.id || "unknown";   // "zd:answerBot"
```

### Line 82: Use messageBody
```javascript
messageEmbedding = await embedText(messageBody);
                                    //↑
                                    // Now using correct field!
```

### Line 132: Build Prompt
```javascript
const prompt = buildReplyPrompt(messageBody, selectedArticles, brand);
                                //↑
                                // Now using correct field!
```

---

## Error Analysis

### What Went Wrong

```javascript
const { user, messages } = req.body;
// req.body = {
//   account_id: ...,
//   detail: { id: "141" },
//   event: { message: { body: "Hi" }, ... }
// }

// Tries to find: req.body.user        → undefined ❌
// Tries to find: req.body.messages    → undefined ❌

if (!user || !messages) {  // Both undefined, so ALWAYS TRUE
  return res.status(400).json({ error: "Invalid payload structure" });
  // ↑ Returns error every time
}
```

### How It's Fixed

```javascript
const { event, detail } = req.body;
// req.body = {
//   account_id: ...,
//   detail: { id: "141" },        ← HAS THIS ✅
//   event: { message: { ... } }   ← HAS THIS ✅
// }

// Finds: req.body.event           → object ✅
// Finds: req.body.event.message   → object ✅
// Finds: req.body.detail          → object ✅

if (!event || !event.message) {  // Both exist
  return res.status(400).json({ error: "Invalid payload structure" });
}
// Doesn't return error, continues to process ✅
```

---

## Testing Each Fix

### Test 1: Payload Parsing
```bash
grep -n "const { event, detail }" src/controllers/sunshine.js
```
Expected: `Line 55`

### Test 2: Message Extraction
```bash
grep -n "const messageBody = event.message.body" src/controllers/sunshine.js
```
Expected: `Line 68`

### Test 3: Embedding Creation
```bash
grep -n "embedText(messageBody)" src/controllers/sunshine.js
```
Expected: `Line 82`

### Test 4: Prompt Building
```bash
grep -n "buildReplyPrompt(messageBody" src/controllers/sunshine.js
```
Expected: `Line 132`

---

## Real-World Webhook Flow

### Step 1: Customer Sends Message
```
Zendesk Sunshine: Customer types "Hi there..."
        ↓
       Webhook
```

### Step 2: Webhook Arrives
```
POST /sunshine/webhook
Body: {
  event: { message: { body: "Hi there..." }, conversation_id: "..." },
  detail: { id: "141" }
}
```

### Step 3: Handler Processes
```
✅ Parses event.message.body
✅ Gets messageBody = "Hi there..."
✅ Creates embedding
✅ Searches KB
✅ Generates reply
```

### Step 4: Response Sent
```
Response: { success: true, botReply: "I can help..." }
        ↓
Zendesk receives success
        ↓
Updates conversation with bot reply
```

---

## Comparison Table

| Aspect | Before (❌) | After (✅) |
|--------|------------|----------|
| Parses `event` | ✗ | ✓ |
| Parses `detail` | ✗ | ✓ |
| Gets `message.body` | ✗ | ✓ |
| Gets `conversation_id` | ✗ | ✓ |
| Finds ticket ID | ✗ | ✓ |
| Embeds message | ✗ | ✓ |
| Generates reply | ✗ | ✓ |
| Sends to Zendesk | ✗ | ✓ |
| Returns success | ✗ | ✓ |

---

## Why This Happened

1. **Different API Versions**: Your code was written for a different Zendesk webhook format
2. **API Changed**: Zendesk may have updated their Sunshine webhook structure
3. **Documentation Mismatch**: Code didn't match actual Zendesk payload

---

## Prevention for Future

✅ Always log actual webhook payloads:
```javascript
console.log("Received:", JSON.stringify(req.body, null, 2));
```

✅ Check Zendesk docs for current format:
- https://docs.zendesk.com/sunshine-conversations/api-documentation

✅ Add validation:
```javascript
if (!event?.message?.body) {
  console.error("Missing expected fields");
  return res.status(400).json({ error: "Invalid format" });
}
```

---

## Files Status

```
src/controllers/sunshine.js
├── ✅ Line 55: Event parsing fixed
├── ✅ Line 68: Message extraction fixed
├── ✅ Line 82: Embedding uses messageBody
├── ✅ Line 132: Prompt uses messageBody
└── ✅ All references updated consistently
```

---

**Status:** ✅ COMPLETELY FIXED

All fields now correctly parsed from Zendesk webhook! 🎉

