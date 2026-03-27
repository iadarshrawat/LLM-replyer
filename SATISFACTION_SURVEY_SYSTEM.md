# Satisfaction Survey & Smart Ticket Management System

## Overview 🎯

The system now includes **intelligent satisfaction surveys** and **automatic ticket management**:

1. ✅ **Auto-reply** to customer messages with AI-generated responses
2. ❓ **Satisfaction Survey** - Ask "Are you satisfied with this response?"
3. ✅ **If YES** → **Close ticket** automatically
4. ❌ **If NO** → **Reassign to human agent** for better assistance
5. 🔥 **If arguing** → **Continue replying** with AI (bot handles escalation)

---

## How It Works

### Complete Workflow

```
Customer creates ticket
        ↓
🤖 Bot generates AI reply
        ↓
❓ Bot sends satisfaction survey question:
   "Are you satisfied with this response?"
        ↓
Customer responds...
        ↓
┌─────────────────────────────────────┐
│ Sentiment Analysis (3 outcomes)     │
├─────────────────────────────────────┤
│ 1. Customer says YES                │
│    ↓                                │
│    🔐 CLOSE TICKET                  │
│    └─→ Status: Closed               │
│                                     │
│ 2. Customer says NO                 │
│    ↓                                │
│    🔄 REASSIGN TO AGENT             │
│    └─→ Assigned to human support    │
│                                     │
│ 3. Customer argues/questions        │
│    ↓                                │
│    🔥 CONTINUE REPLYING             │
│    └─→ Bot generates another reply  │
└─────────────────────────────────────┘
```

---

## Sentiment Detection Keywords

### ✅ Satisfied (Closes Ticket)
```
'yes', 'great', 'perfect', 'excellent', 'thank', 'thanks', 
'helpful', 'works', 'solved', 'fixed', 'good', 'appreciate', 
'awesome', 'wonderful', 'brilliant'
```

### ❌ Not Satisfied (Reassigns Ticket)
```
'no', 'not satisfied', 'unsatisfied', 'unhappy', 'bad', 
'terrible', 'waste', 'useless', 'didn't help', 'didn't work', 
'disappointed', 'frustrated', 'angry'
```

### 🔥 Arguing (Continues Reply)
```
'but', 'however', 'disagree', 'wrong', 'incorrect', 'not true', 
'that's not', 'you're wrong', 'problem', 'issue', 'broken', 
'error', 'failed', 'why', 'explain'
```

---

## Configuration

### Environment Variables (.env)

```bash
# Bot ID (already set)
BOT_ASSIGNEE_ID=42724865257229
BOT_ASSIGNEE_NAME=BOT

# Available agents to reassign to (NEW)
# Add your human agents' Zendesk user IDs here
AVAILABLE_AGENTS=8447388090495,8447388090496,8447388090497
```

**To find agent IDs:**
1. Go to Zendesk Admin → Users
2. Click on an agent
3. Copy the ID from the URL or profile

### Tuning Parameters (in webhook.js)

```javascript
// Rate limiting
const REPLY_COOLDOWN_MS = 60000;      // 1 minute cooldown
const MAX_REPLIES_PER_WINDOW = 1;     // 1 reply per cooldown
```

---

## Code Implementation

### Key Functions Added

#### 1. **detectCustomerSentiment(message)**
Analyzes customer message and returns:
- `'satisfied'` → Customer happy, close ticket
- `'not_satisfied'` → Customer unhappy, reassign
- `'arguing'` → Customer questioning, continue reply
- `'neutral'` → Ambiguous, send default reply

#### 2. **handleTicketClosure(ticketId)**
When customer is satisfied:
- Changes ticket status to `"closed"`
- Sends closing confirmation message
- Clears survey tracking

#### 3. **handleTicketReassignment(ticketId)**
When customer is not satisfied:
- Picks random agent from `AVAILABLE_AGENTS`
- Changes `assignee_id` to selected agent
- Sends escalation message to customer

#### 4. **Survey Tracking**
```javascript
const surveyTracker = new Map();
// Tracks: ticketId -> { surveyPending, lastReplyTime }
```

---

## Message Examples

### 🤖 Bot Reply Message
```
We understand your issue with [topic]. Based on our knowledge base:

[AI-generated helpful response]

This solution has worked for similar cases. Please try it and let us know!
```

### ❓ Satisfaction Survey
```
---

**Are you satisfied with this response?** 😊

Please let us know:
- Reply "yes" if this solved your issue
- Reply "no" if you need further help
- Feel free to share any feedback

Thank you for your patience!
```

### ✅ Closing Message
```
✅ **Ticket Closed**

Thank you for your feedback! We're glad we could help. 
If you need further assistance in the future, feel free to create a new ticket.

*Closed by AI Support Bot*
```

### 🔄 Reassignment Message
```
ℹ️ **Ticket Reassigned**

We understand you're still having issues. We're transferring your ticket 
to one of our specialist agents who can provide more personalized assistance.

They will be with you shortly. Thank you for your patience!

*Escalated by AI Support Bot*
```

---

## Real-World Scenarios

### Scenario 1: Happy Customer ✅

```
Customer: "My login issue is fixed! Thanks so much!"
        ↓
detectCustomerSentiment() → 'satisfied'
        ↓
✅ Keywords found: ['fixed', 'thanks']
        ↓
🔐 handleTicketClosure(ticketId)
        ↓
✅ Ticket status changed to "closed"
✅ Closing message sent
✅ Survey tracker cleared
```

**Log Output:**
```
💭 Customer sentiment detected: satisfied
✅ Customer satisfied - attempting to close ticket 5065
🔐 Closing satisfied ticket 5065...
✅ Ticket 5065 closed successfully
```

### Scenario 2: Unhappy Customer ❌

```
Customer: "No, this doesn't work. Still having problems."
        ↓
detectCustomerSentiment() → 'not_satisfied'
        ↓
❌ Keywords found: ['no', 'doesn't work', 'problems']
        ↓
🔄 handleTicketReassignment(ticketId)
        ↓
🔄 Random agent selected from AVAILABLE_AGENTS
🔄 Ticket reassigned
✅ Escalation message sent
```

**Log Output:**
```
💭 Customer sentiment detected: not_satisfied
❌ Customer not satisfied - attempting to reassign ticket 5065
🔄 Reassigning unsatisfied ticket 5065...
✅ Ticket 5065 reassigned to agent 8447388090495
```

### Scenario 3: Arguing Customer 🔥

```
Customer: "Wait, but that's not right. My error says something different."
        ↓
detectCustomerSentiment() → 'arguing'
        ↓
🔥 Keywords found: ['but', 'not right', 'error']
        ↓
🔥 Continue with bot reply
        ↓
🤖 Generate response addressing their concern
❓ Send satisfaction survey again
```

**Log Output:**
```
💭 Customer sentiment detected: arguing
🔥 Customer arguing - continuing with bot reply for ticket 5065
📝 Generating auto-reply for ticket 5065...
✅ Auto-reply successfully sent to ticket 5065
✅ Satisfaction survey sent for ticket 5065
```

### Scenario 4: Multiple Exchanges 🔄

```
Exchange 1:
Customer: "How do I reset my password?"
Bot: "Here's how to reset... [instructions] ... Are you satisfied?"
Customer: "That doesn't work for me."
        ↓
Bot: Reassigns to human agent
        ↓
Exchange ends - Human agent takes over
```

---

## Data Structures

### Survey Tracker
```javascript
surveyTracker = Map {
  '5065' => { 
    surveyPending: true, 
    lastReplyTime: 1709049600000 
  },
  '5066' => { 
    surveyPending: true, 
    lastReplyTime: 1709049700000 
  }
}
```

### Reply Tracker (existing)
```javascript
recentBotReplies = Map {
  '5065' => { 
    timestamp: 1709049600000, 
    count: 1 
  }
}
```

---

## API Response Example

**GET /webhook/status**

```json
{
  "status": "active",
  "features": {
    "satisfactionSurvey": true,
    "ticketClosure": true,
    "ticketReassignment": true,
    "sentimentDetection": true,
    "arguementHandling": true
  },
  "workflow": {
    "step1": "New ticket → Generate AI reply + send satisfaction survey",
    "step2": "Customer responds with YES → Close ticket",
    "step3": "Customer responds with NO → Reassign to human agent",
    "step4": "Customer argues → Continue with AI reply"
  },
  "botConfig": {
    "botAssigneeId": "42724865257229",
    "availableAgents": ["8447388090495", "8447388090496", "8447388090497"]
  }
}
```

---

## Server Logs to Monitor

### Successful Survey Flow
```
💬 Comment added to ticket 5065
📊 Processing satisfaction survey response for ticket 5065
💭 Customer sentiment detected: satisfied
✅ Customer confirmed satisfaction - closing ticket
🔐 Closing satisfied ticket 5065...
✅ Ticket 5065 closed successfully
```

### Reassignment Flow
```
💬 Comment added to ticket 5065
📊 Processing satisfaction survey response for ticket 5065
💭 Customer sentiment detected: not_satisfied
❌ Customer confirmed dissatisfaction - reassigning ticket
🔄 Reassigning unsatisfied ticket 5065...
✅ Ticket 5065 reassigned to agent 8447388090495
```

### Continued Argument
```
💬 Comment added to ticket 5065
📊 Processing satisfaction survey response for ticket 5065
💭 Customer sentiment detected: arguing
🔥 Customer arguing in survey response - continue with bot reply
✅ Bot is assignee + cooldown passed - proceeding with auto-reply
📝 Generating auto-reply for ticket 5065...
✅ Auto-reply successfully sent to ticket 5065
✅ Satisfaction survey sent for ticket 5065
```

---

## Testing

### Test 1: Satisfaction Flow
```bash
# Step 1: New ticket
curl -X POST http://localhost:3000/webhook/ticket-created \
  -H "Content-Type: application/json" \
  -d '{
    "type": "zen:event-type:ticket.created",
    "detail": {
      "id": "5100",
      "subject": "Test ticket",
      "description": "Help with login",
      "assignee_id": "42724865257229",
      "organization_id": "8447346622462"
    }
  }'

# Expect: Auto-reply + survey question

# Step 2: Customer says YES
curl -X POST http://localhost:3000/webhook/comment-added \
  -H "Content-Type: application/json" \
  -d '{
    "type": "zen:event-type:ticket.comment_added",
    "detail": {
      "id": "5100",
      "subject": "Test ticket",
      "description": "Yes! That worked perfectly, thank you!",
      "assignee_id": "42724865257229",
      "organization_id": "8447346622462"
    }
  }'

# Expect: Ticket closed ✅
```

### Test 2: Reassignment Flow
```bash
# Step 2: Customer says NO
curl -X POST http://localhost:3000/webhook/comment-added \
  -H "Content-Type: application/json" \
  -d '{
    "type": "zen:event-type:ticket.comment_added",
    "detail": {
      "id": "5101",
      "subject": "Test ticket",
      "description": "No, I'm still having the same problem. Not satisfied.",
      "assignee_id": "42724865257229",
      "organization_id": "8447346622462"
    }
  }'

# Expect: Ticket reassigned to human agent 🔄
```

### Test 3: Arguing Flow
```bash
# Step 2: Customer argues
curl -X POST http://localhost:3000/webhook/comment-added \
  -H "Content-Type: application/json" \
  -d '{
    "type": "zen:event-type:ticket.comment_added",
    "detail": {
      "id": "5102",
      "subject": "Test ticket",
      "description": "Wait, but that doesn't explain why my error message is different.",
      "assignee_id": "42724865257229",
      "organization_id": "8447346622462"
    }
  }'

# Expect: Bot continues with another reply 🔥
```

---

## Metrics & Monitoring

Track these metrics:

| Metric | Meaning |
|--------|---------|
| Tickets Closed | % of tickets resolved automatically |
| Tickets Reassigned | % escalated to human agents |
| Bot Reply Accuracy | % of helpful responses (based on YES votes) |
| Survey Response Rate | % of customers answering survey |
| Average Resolution Time | Time from creation to closure |

---

## Troubleshooting

### Issue: Bot not closing satisfied tickets
**Check:**
1. Customer message contains satisfaction keywords
2. Survey was pending (`surveyTracker` has entry)
3. Check logs for "sentiment detected: satisfied"

### Issue: Tickets not reassigning
**Check:**
1. `AVAILABLE_AGENTS` configured in `.env`
2. Agent IDs are valid Zendesk user IDs
3. Check logs for reassignment confirmation

### Issue: Bot keeps replying (not detecting sentiment)
**Check:**
1. Message has clear yes/no/arguing keywords
2. Sentiment detection is working (check logs)
3. Cooldown still active (check timestamp)

### Issue: Survey not sending
**Check:**
1. Zendesk API token is valid
2. Ticket has proper permissions
3. Check error logs for API failures

---

## Future Enhancements

- [ ] Custom satisfaction survey questions per category
- [ ] Track satisfaction metrics dashboard
- [ ] Multi-language sentiment detection
- [ ] A/B test different survey wordings
- [ ] Route to specific agents based on category
- [ ] Delayed survey (ask after 5 mins to let solution work)
- [ ] Follow-up survey for reassigned tickets
- [ ] Sentiment confidence score (0-100%)

---

## Summary

✅ **Complete satisfaction workflow**
- Auto-reply → Survey → Action based on sentiment

✅ **Three response types handled**
- YES: Close ticket automatically
- NO: Escalate to human agent
- Arguing: Continue with AI reply

✅ **Smart sentiment detection**
- 15+ satisfaction keywords
- 15+ dissatisfaction keywords  
- 13+ arguing keywords

✅ **Production-ready**
- Rate limiting (no loops)
- Error handling
- Logging throughout
- Configurable agents

🚀 **Ready to Deploy** - Just update `.env` with your agent IDs and restart!
