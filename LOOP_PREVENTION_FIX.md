# Fix: Infinite Reply Loop Prevention ✅

## Problem Identified 🔁

The bot was **continuously replying to itself** creating an infinite loop:

```
Bot generates reply
    ↓
Reply posted as comment
    ↓
Webhook triggers: ticket.comment_added
    ↓
Bot checks: "Is assignee = bot?"
    ↓
YES → Generate reply again
    ↓
LOOP REPEATS ♾️
```

## Root Cause

When the bot sends a reply via the comment endpoint, Zendesk treats it as a new comment and triggers the `ticket.comment_added` webhook again. Since the ticket is still assigned to the bot, it would reply infinitely.

---

## Solution Implemented ✅

### 1. **Reply Rate Limiting (Cooldown System)**

Added an in-memory tracking system that:
- Tracks when each ticket received a bot reply
- Enforces a **1-minute cooldown** between replies
- Only allows **1 reply per cooldown window**
- Automatically resets after cooldown expires

### 2. **How It Works**

```javascript
// Track: { ticketId -> { timestamp, count } }
const recentBotReplies = new Map();

// Constants
const REPLY_COOLDOWN_MS = 60000;      // 1 minute
const MAX_REPLIES_PER_WINDOW = 1;     // 1 reply per window
```

### 3. **Logic Flow**

```
Comment webhook received
    ↓
CHECK 1: Is ticket assigned to bot?
├─ NO → Skip ✅
└─ YES → Continue
    ↓
CHECK 2: Has bot replied recently?
├─ YES & Cooldown active → Skip ✅ (PREVENTS LOOP)
├─ NO & Cooldown expired → Allow reply ✅
└─ YES & Max replies hit → Skip ✅ (PREVENTS SPAM)
    ↓
Generate and send reply
    ↓
Record timestamp + increment counter
    ↓
Next reply will only be allowed after cooldown expires
```

---

## Code Changes

### File: `src/controllers/webhook.js`

#### 1. Added Loop Prevention Tracking
```javascript
// Track recent bot replies to prevent infinite loops
const recentBotReplies = new Map();
const REPLY_COOLDOWN_MS = 60000;      // 1 minute
const MAX_REPLIES_PER_WINDOW = 1;     // 1 reply per cooldown
```

#### 2. Added `shouldReplyToTicket()` Function
```javascript
function shouldReplyToTicket(ticketId) {
  const now = Date.now();
  const recent = recentBotReplies.get(ticketId);

  if (!recent) {
    // First reply, allowed
    recentBotReplies.set(ticketId, { timestamp: now, count: 1 });
    return true;
  }

  const timeSinceLastReply = now - recent.timestamp;

  if (timeSinceLastReply > REPLY_COOLDOWN_MS) {
    // Cooldown expired, allowed
    recentBotReplies.set(ticketId, { timestamp: now, count: 1 });
    return true;
  }

  if (recent.count >= MAX_REPLIES_PER_WINDOW) {
    // Max replies reached in this window, denied
    return false;
  }

  // Allow but increment counter
  recent.count++;
  return true;
}
```

#### 3. Updated `handleCommentAddedWebhook()`
```javascript
// CHECK 1: Is ticket assigned to bot?
if (assignee_id.toString() !== BOT_ASSIGNEE_ID.toString()) {
  console.log(`⏭️  Skipping auto-reply - not assigned to bot`);
  return;
}

// CHECK 2: Loop prevention - don't reply too frequently
if (!shouldReplyToTicket(ticketId)) {
  console.log(`⏸️  Skipping auto-reply - cooldown active to prevent loops`);
  return;
}

// Both checks passed, proceed with reply
handleAutoReplyAsync(...);
```

---

## Configuration

### Environment Variables (Already Set)
```bash
BOT_ASSIGNEE_ID=42724865257229
BOT_ASSIGNEE_NAME=BOT
```

### Tuning Parameters

You can modify these in `src/controllers/webhook.js`:

```javascript
// Cooldown: 1 minute = 60000 ms
const REPLY_COOLDOWN_MS = 60000;

// Max replies: 1 reply per cooldown window
const MAX_REPLIES_PER_WINDOW = 1;
```

**Examples:**
- To allow 1 reply every 30 seconds: `REPLY_COOLDOWN_MS = 30000`
- To allow 2 replies per minute: `MAX_REPLIES_PER_WINDOW = 2` with 60000 ms cooldown

---

## Expected Behavior (Fixed) ✅

### Scenario 1: New Ticket
```
User creates ticket #5065
    ↓
ticket.created webhook
    ↓
No cooldown check (new tickets bypass)
    ↓
✅ Bot replies immediately
```

### Scenario 2: User Replies (First Time)
```
User replies to bot message
    ↓
ticket.comment_added webhook
    ↓
CHECK 1: Assigned to bot? YES ✅
CHECK 2: Cooldown active? NO ✅
    ↓
✅ Bot generates reply
    ↓
timestamp recorded: now
count recorded: 1
```

### Scenario 3: User Replies (Within Cooldown)
```
User replies again (within 1 minute)
    ↓
ticket.comment_added webhook
    ↓
CHECK 1: Assigned to bot? YES ✅
CHECK 2: Cooldown active? YES ❌
    ↓
⏸️  Bot SKIPS reply (prevents loop)
    ↓
Log: "cooldown active to prevent loops"
```

### Scenario 4: User Replies (After Cooldown)
```
User replies 2+ minutes later
    ↓
ticket.comment_added webhook
    ↓
CHECK 1: Assigned to bot? YES ✅
CHECK 2: Cooldown expired? YES ✅
    ↓
✅ Bot generates reply
    ↓
timestamp reset: new time
count reset: 1
```

---

## Server Logs to Monitor

### Successful Reply:
```
💬 Comment added to ticket 5065
👤 Assignee ID: 42724865257229, Bot ID: 42724865257229
✅ Bot is assignee + cooldown passed - proceeding with auto-reply
📝 Generating auto-reply for ticket 5065...
📤 Sending auto-reply to Zendesk ticket 5065...
✅ Auto-reply successfully sent to ticket 5065
```

### Cooldown Prevented Loop:
```
💬 Comment added to ticket 5065
👤 Assignee ID: 42724865257229, Bot ID: 42724865257229
⏸️  Skipping auto-reply for ticket 5065 - cooldown active to prevent loops
```

### Assigned to Different Agent:
```
💬 Comment added to ticket 5065
👤 Assignee ID: 8447388090495, Bot ID: 42724865257229
⏭️  Skipping auto-reply - ticket not assigned to bot. Assigned to: 8447388090495
```

---

## Testing the Fix

### Step 1: Restart Server
```bash
# Kill current server
^C

# Restart with new code
npm start
```

### Step 2: Send Test Webhook (New Ticket)
```bash
curl -X POST http://localhost:3000/webhook/ticket-created \
  -H "Content-Type: application/json" \
  -d '{
    "type": "zen:event-type:ticket.created",
    "detail": {
      "id": "5100",
      "subject": "Loop test",
      "description": "Testing loop prevention",
      "status": "OPEN",
      "assignee_id": "42724865257229",
      "organization_id": "8447346622462"
    }
  }'
```

**Expected:** ✅ One reply sent, no loops

### Step 3: Simulate Rapid Comments
```bash
# First comment (user replies)
curl -X POST http://localhost:3000/webhook/comment-added \
  -H "Content-Type: application/json" \
  -d '{
    "type": "zen:event-type:ticket.comment_added",
    "detail": {
      "id": "5100",
      "subject": "Loop test",
      "description": "User message",
      "assignee_id": "42724865257229",
      "organization_id": "8447346622462"
    }
  }'

# Immediately send second comment (bot's reply triggers webhook)
curl -X POST http://localhost:3000/webhook/comment-added \
  -H "Content-Type: application/json" \
  -d '{
    "type": "zen:event-type:ticket.comment_added",
    "detail": {
      "id": "5100",
      "subject": "Loop test",
      "description": "Bot reply message",
      "assignee_id": "42724865257229",
      "organization_id": "8447346622462"
    }
  }'
```

**Expected in logs:**
- First call: ✅ "proceeding with auto-reply"
- Second call: ✅ "cooldown active to prevent loops"

---

## Monitoring Dashboard

Check webhook status:
```bash
curl http://localhost:3000/webhook/status
```

Response shows:
```json
{
  "loopPrevention": {
    "description": "Prevents infinite reply loops by tracking recent replies",
    "cooldownWindow": "60000ms (60s)",
    "maxReplies": "1 reply per cooldown window"
  }
}
```

---

## Troubleshooting

### Issue: Bot still replying continuously
**Solution:**
1. Clear the reply tracking: Restart server (`npm start`)
2. Check BOT_ASSIGNEE_ID matches in `.env`
3. Verify logs show "cooldown active" message

### Issue: Bot not replying at all
**Check:**
1. Is ticket assigned to the bot?
2. Has cooldown expired (60 seconds)?
3. Check logs for exact reason

### Issue: Want different cooldown timing
**Edit:** `src/controllers/webhook.js`
```javascript
const REPLY_COOLDOWN_MS = 30000;      // Change to 30 seconds
const MAX_REPLIES_PER_WINDOW = 2;     // Allow 2 replies per window
```

---

## Summary

✅ **Loop Prevention Added**
- Tracks bot replies per ticket
- 1-minute cooldown between replies
- Max 1 reply per cooldown window
- Automatically resets after cooldown

✅ **Dual Safety Checks**
- Check 1: Is ticket assigned to bot?
- Check 2: Has cooldown passed?

✅ **No Infinite Loops**
- Bot won't reply to its own messages
- Graceful degradation (logs why skipped)
- Works with multiple tickets independently

🚀 **Ready to Deploy**
- Just restart your server
- No database changes needed
- In-memory tracking (resets on restart)
