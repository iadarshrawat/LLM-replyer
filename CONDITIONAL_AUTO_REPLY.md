# Conditional Auto-Reply System

## Overview
The system now supports **intelligent conditional auto-replies** for Zendesk tickets. It will:
1. ✅ Auto-reply to **new tickets** automatically
2. ✅ **Re-reply when user responds** to the bot's message
3. 🎯 **BUT only if the ticket is assigned to the bot** (adarsh)
4. ❌ Skip replies if ticket is assigned to someone else

---

## How It Works

### Flow Diagram

```
Zendesk Ticket Event
        ↓
┌───────────────────────────┐
│ ticket.created event      │
└───────────┬───────────────┘
            ↓
    ❌ Check if bot assigned? ← New tickets = auto-reply
    (new tickets always auto-reply)
            ↓
    🤖 Generate AI Reply
            ↓
    📤 Send to Zendesk
            ↓
    ✅ Ticket now has bot reply


    ─────────────────────────


┌───────────────────────────┐
│ ticket.comment_added      │
│ (user replies to bot)     │
└───────────┬───────────────┘
            ↓
    ❌ Check if bot assigned?
    (Only proceed if YES)
            ↓
    ⏭️  YES → Generate reply
    ⏭️  NO  → Skip (don't reply)
            ↓
    🤖 Generate AI Reply
            ↓
    📤 Send to Zendesk
            ↓
    ✅ Bot replies to user's response
```

---

## Configuration

### Environment Variables (.env)

```bash
# Bot Configuration - for conditional auto-reply
BOT_ASSIGNEE_ID=8447388090494      # Zendesk user ID of the bot (adarsh)
BOT_ASSIGNEE_NAME=adarsh           # Display name of the bot
```

**How to find your Bot Assignee ID:**
1. Go to Zendesk Admin → Users
2. Click on the bot user (adarsh in your case)
3. Copy the user ID from the URL or profile page

---

## Webhook Endpoints

### 1. New Ticket Auto-Reply
**Endpoint:** `POST /webhook/ticket-created`

**Zendesk Event:** `zen:event-type:ticket.created`

**Behavior:**
- Triggered when a new ticket is created
- **Always replies** (no assignee check needed)
- Searches KB and generates AI response

### 2. Comment Reply (Conditional)
**Endpoint:** `POST /webhook/comment-added`

**Zendesk Event:** `zen:event-type:ticket.comment_added`

**Behavior:**
- Triggered when someone adds a comment to an existing ticket
- **Only replies if ticket is assigned to bot** (adarsh)
- If assigned to someone else → **silently skip**

---

## Setup in Zendesk

### 1. Create Webhook Triggers

Go to **Zendesk Admin → Webhooks**

**Trigger 1: New Ticket Auto-Reply**
```
Event: Ticket is created
Webhook: POST https://your-domain.com/webhook/ticket-created
```

**Trigger 2: User Response Auto-Reply**
```
Event: Comment is added AND Ticket Status = Open AND Ticket is not a spam/deleted
Webhook: POST https://your-domain.com/webhook/comment-added
```

---

## Example Scenarios

### Scenario 1: New Ticket (Always Reply)
```
1. Customer creates ticket #1234
   ↓
2. Webhook triggers: ticket.created
   ↓
3. ❌ No assignee check (new tickets always get reply)
   ↓
4. 🤖 AI generates reply
   ↓
5. ✅ Reply sent to Zendesk
```

### Scenario 2: User Replies (Assignee = Bot)
```
1. Customer replies to ticket #1234
   ↓
2. Webhook triggers: ticket.comment_added
   ↓
3. ❌ Check assignee: "Is it adarsh (8447388090494)?"
   ✅ YES → Continue
   ↓
4. 🤖 AI generates reply to customer's message
   ↓
5. ✅ Reply sent to Zendesk
```

### Scenario 3: User Replies (Assignee = Someone Else)
```
1. Customer replies to ticket #1234
   ↓
2. Webhook triggers: ticket.comment_added
   ↓
3. ❌ Check assignee: "Is it adarsh (8447388090494)?"
   ❌ NO (assigned to John) → Stop
   ↓
4. 🚫 NO REPLY SENT
   (Human agent John handles it)
```

---

## Code Implementation

### Main Files Modified

1. **`src/controllers/webhook.js`**
   - Added `handleCommentAddedWebhook()` function
   - Implements assignee check logic
   - Uses shared `handleAutoReplyAsync()` for reply generation

2. **`src/routes/webhook.route.js`**
   - Added route: `POST /webhook/comment-added`
   - Points to `handleCommentAddedWebhook()`

3. **`.env`**
   - Added `BOT_ASSIGNEE_ID` configuration
   - Added `BOT_ASSIGNEE_NAME` configuration

### Key Logic

```javascript
// Check if ticket is assigned to bot
if (!assignee_id || assignee_id.toString() !== BOT_ASSIGNEE_ID.toString()) {
  console.log(`⏭️  Skipping auto-reply - ticket not assigned to bot`);
  return; // Don't reply
}

// If assignee IS the bot, generate and send reply
console.log(`✅ Bot is assignee - proceeding with auto-reply`);
handleAutoReplyAsync(...); // Generate and send
```

---

## Testing

### Test Scenario 1: New Ticket
```bash
curl -X POST http://localhost:3000/webhook/ticket-created \
  -H "Content-Type: application/json" \
  -d '{
    "type": "zen:event-type:ticket.created",
    "detail": {
      "id": "5065",
      "subject": "Test ticket",
      "description": "Testing auto-reply",
      "status": "OPEN",
      "assignee_id": null,
      "organization_id": "8447346622462"
    }
  }'
```

**Expected:** ✅ Auto-reply generated and sent

### Test Scenario 2: User Comment (Bot Assigned)
```bash
curl -X POST http://localhost:3000/webhook/comment-added \
  -H "Content-Type: application/json" \
  -d '{
    "type": "zen:event-type:ticket.comment_added",
    "detail": {
      "id": "5065",
      "subject": "Test ticket",
      "description": "User reply here",
      "status": "OPEN",
      "assignee_id": "8447388090494",
      "organization_id": "8447346622462"
    }
  }'
```

**Expected:** ✅ Auto-reply generated and sent

### Test Scenario 3: User Comment (Non-Bot Assigned)
```bash
curl -X POST http://localhost:3000/webhook/comment-added \
  -H "Content-Type: application/json" \
  -d '{
    "type": "zen:event-type:ticket.comment_added",
    "detail": {
      "id": "5065",
      "subject": "Test ticket",
      "description": "User reply here",
      "status": "OPEN",
      "assignee_id": "8447388090495",  # Different user ID
      "organization_id": "8447346622462"
    }
  }'
```

**Expected:** ✅ No reply sent (skipped gracefully)

---

## Logs to Monitor

Watch your server logs for these messages:

```
✅ Bot is assignee - proceeding with auto-reply for ticket 5065
⏭️  Skipping auto-reply - ticket not assigned to bot (adarsh). Assigned to: 8447388090495
🔔 Comment webhook received: zen:event-type:ticket.comment_added
💬 Comment added to ticket 5065
👤 Assignee ID: 8447388090494, Bot ID: 8447388090494
```

---

## Troubleshooting

### Issue: Replies not being sent on user comments
**Check:**
1. Is `BOT_ASSIGNEE_ID` set correctly in `.env`?
2. Is the ticket actually assigned to the bot in Zendesk?
3. Check logs for "Assigned to: X" - verify it matches `BOT_ASSIGNEE_ID`

### Issue: Replies being sent when they shouldn't
**Check:**
1. Verify the assignee ID in the webhook payload
2. Make sure ticket is assigned to someone other than the bot

### Issue: "Invalid webhook payload"
**Check:**
1. Zendesk webhook payload includes `detail` field
2. `detail` includes `id`, `subject`, `description`, `assignee_id`
3. All fields are present in the webhook trigger

---

## Future Enhancements

- [ ] Add rate limiting to prevent reply spam
- [ ] Add logic to prevent replying to bot's own comments
- [ ] Add configurable assignee list (multiple agents)
- [ ] Add reply frequency limiting (max replies per hour)
- [ ] Add sentiment analysis to detect when human intervention is needed
- [ ] Add metrics dashboard for reply statistics

---

## Contact & Support

If you need to modify the bot assignee ID, update `.env` and restart the server:

```bash
# Kill current server
^C

# Update .env
BOT_ASSIGNEE_ID=YOUR_NEW_ID

# Restart
npm start
```
