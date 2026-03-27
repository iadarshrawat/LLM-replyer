# Visual Flow Diagrams - Survey System

## Lifecycle Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                    TICKET LIFECYCLE                            │
└────────────────────────────────────────────────────────────────┘

    PHASE 1: INITIAL REPLY
    ├─ Customer creates ticket
    ├─ Bot generates AI reply
    ├─ Bot sends reply + survey
    ├─ Survey marked: PENDING ✅
    └─ Wait for customer response

         ↓ (Customer replies)

    PHASE 2A: SATISFIED (YES)
    ├─ Detect: "yes" keyword ✅
    ├─ Action: Close ticket ✅
    ├─ Status: CLOSED ✅
    └─ End ✅

         OR ↓

    PHASE 2B: NOT SATISFIED (NO)
    ├─ Detect: "no" keyword ✅
    ├─ Action: Reassign ✅
    ├─ Assignee: Human agent ✅
    └─ End ✅

         OR ↓

    PHASE 2C: ARGUING (CONTINUE)
    ├─ Detect: "but/why" keywords ✅
    ├─ Clear survey state ✅
    ├─ Generate new reply ✅
    ├─ Send new survey ✅
    ├─ Mark PENDING again ✅
    └─ Return to PHASE 2 (wait for response)

         ↓ (Loop until satisfied/unsatisfied)

    END: Ticket either CLOSED or with HUMAN AGENT
```

---

## Decision Tree

```
                    Comment Arrives
                          │
                          ↓
                  ┌─────────────────┐
                  │ Bot Assigned?   │
                  └─────────────────┘
                    YES │ │ NO
                        │ │
                       ✅ │ ❌ Skip
                        │
                        ↓
                  ┌─────────────────────────────┐
                  │ Survey Pending?             │
                  └─────────────────────────────┘
                   YES │ │ NO
                       │ │
         ┌─────────────┘ └─────────────┐
         │                             │
         ↓                             ↓
    ┌──────────────────┐      ┌──────────────────┐
    │ Analyze Sentiment│      │ Generate Reply   │
    └──────────────────┘      └──────────────────┘
         │   │   │                    │
    ┌───┴───┴───┴───┐                 ↓
    │               │          ┌─────────────────┐
    ↓               ↓          │ Send Reply      │
┌─────────┐  ┌─────────┐      └─────────────────┘
│YES?     │  │NO?      │              │
└─────────┘  └─────────┘              ↓
    │           │            ┌─────────────────┐
    │           │            │ Send Survey     │
    │           │            └─────────────────┘
    │           │                    │
    ↓           ↓                    ↓
┌─────────┐  ┌─────────┐    ┌─────────────────┐
│ CLOSE   │  │REASSIGN │    │Mark PENDING     │
└─────────┘  └─────────┘    └─────────────────┘
    │           │                    │
    └───────┬───┘                    │
            │                        ↓
            ↓                    Return & Wait
        RETURN ✅
        (STOP)
        
    BUT there's 4th path:
    
    ARGUING? → Clear state → Generate reply →
    Send reply → Send survey → Mark PENDING →
    Return & Wait for next response
```

---

## State Machine

```
                            [NEW TICKET]
                                 │
                                 ↓
                        ┌────────────────┐
                        │ INITIAL_REPLY  │ (Send reply + survey)
                        └────────────────┘
                                 │
                                 ↓ (Mark survey PENDING)
                        ┌────────────────┐
                        │ SURVEY_PENDING │ (Waiting for response)
                        └────────────────┘
                        
        ┌───────────────────────┬───────────────────────┬─────────────────┐
        │                       │                       │                 │
    YES ↓                   NO  ↓                 ARGUING↓                 │
        │                       │                       │                 │
    ┌───────────┐        ┌──────────────┐     ┌──────────────────┐        │
    │ CLOSING   │        │ REASSIGNING  │     │ CONTINUE_REPLY   │        │
    └───────────┘        └──────────────┘     └──────────────────┘        │
        │                       │                       │                 │
        ↓                       ↓                       ↓                 │
    CLOSED ✅              ESCALATED ✅        BACK TO SURVEY_PENDING    │
                                                    (Loop)
                                                      ↑
                                                      │
                                              ┌─────────────┐
                                              │ Clear State │
                                              └─────────────┘
                                                      ↑
                                                      │
                                              Continue flow →
```

---

## Timeline Comparison

### BEFORE (Wrong - Infinite Loop)
```
Time  Event
────────────────────────────────────────────────
00:00 Bot sends reply + survey
00:01 Survey marked PENDING
00:02 Customer replies "Yes"
00:03 Webhook: New comment
00:04 ❌ Sentiment checked (wrong place)
00:05 ❌ New reply generated (wrong!)
00:06 ❌ Survey sent again (loop!)
00:07 Webhook: New comment (from bot's reply)
00:08 ❌ Sentiment checked again
00:09 ❌ New reply generated again
00:10 ❌ Survey sent AGAIN (loop!)
...   ♾️ INFINITE LOOP
```

### AFTER (Correct)
```
Time  Event
────────────────────────────────────────────────
00:00 Bot sends reply + survey
00:01 Survey marked PENDING ✅
00:02 Customer replies "Yes"
00:03 Webhook: New comment
00:04 Check: Survey pending? YES ✅
00:05 Analyze sentiment ✅
00:06 Sentiment: satisfied ✅
00:07 Close ticket ✅
00:08 Clear survey state ✅
00:09 RETURN (STOP) ✅
00:10 No more replies sent ✅
00:11 Ticket is CLOSED ✅
```

---

## Message Flow

```
ACTOR: Customer
ACTOR: Bot
ACTOR: Zendesk
PARTICIPANT: Survey Tracker

Customer ->> Zendesk: Create ticket (Problem)
Zendesk ->> Bot: ticket.created webhook
Bot ->> Zendesk: Generate & send reply
Bot ->> Zendesk: Send survey question
Bot ->> Survey Tracker: Mark PENDING ✅
Note over Survey Tracker: {"5100": {surveyPending: true}}

Customer ->> Zendesk: Reply "Yes, thank you!"
Zendesk ->> Bot: ticket.comment_added webhook

Bot ->> Survey Tracker: Check if PENDING?
Survey Tracker -->> Bot: YES, survey pending ✅

Bot ->> Bot: Analyze sentiment: "Yes" = satisfied ✅
Bot ->> Bot: Call handleTicketClosure()

Bot ->> Zendesk: Update ticket status: CLOSED
Bot ->> Zendesk: Send closing message
Bot ->> Survey Tracker: Delete entry (cleanup)
Note over Survey Tracker: {"5100": deleted ✅}

Bot -->> Zendesk: Return (NO MORE REPLIES)

Customer ->> Zendesk: Sees "Ticket Closed" ✅
```

---

## Sentiment Analysis Flow

```
Customer Message
       │
       ↓
┌──────────────────────────────┐
│ detectCustomerSentiment()    │
├──────────────────────────────┤
│ Count keywords in message:   │
│ - Satisfied (15+ keywords)   │
│ - Not satisfied (15+ words)  │
│ - Arguing (13+ keywords)     │
└──────────────────────────────┘
       │   │   │
   ┌───┴───┼───┴───┐
   │       │       │
SATISFIED NOT_SAT ARGUING → NEUTRAL
   │       │       │       │
   │       │       │       └─→ Re-ask survey
   │       │       │
   └───────┼───────┴─────→ Count highest matches
           ↓
    Sentiment = Highest count
```

---

## Survey State Lifecycle

```
                    START
                      │
                      ↓
        ┌─────────────────────────┐
        │ surveyTracker: EMPTY    │
        └─────────────────────────┘
                      │
                      ↓ (Bot sends survey)
        ┌─────────────────────────────────────┐
        │ surveyTracker[id] = {               │
        │   surveyPending: true,              │
        │   lastReplyTime: 1709049600000      │
        │ }                                   │
        └─────────────────────────────────────┘
                      │
      ┌───────────────┼───────────────┐
      │               │               │
   (YES)           (NO)         (ARGUING)
      │               │               │
      ↓               ↓               ↓
   DELETE        DELETE            DELETE
      │               │               │
      └───────────────┼───────────────┘
                      ↓
        ┌─────────────────────────┐
        │ surveyTracker: EMPTY    │
        │ (Until next survey)     │
        └─────────────────────────┘
```

---

## Webhook Flow Simplified

```
                    Webhook Received
                            │
                            ↓
                    ┌──────────────────┐
                    │ Is ticket ID OK? │
                    └──────────────────┘
                      YES  │  NO
                          │  │
                         ✅ │ ❌ SKIP
                          │
                          ↓
                    ┌──────────────────────┐
                    │ Is bot assigned?     │
                    └──────────────────────┘
                      YES  │  NO
                          │  │
                         ✅ │ ❌ SKIP
                          │
                          ↓
                    ┌──────────────────────────┐
                    │ Is survey pending?       │
                    └──────────────────────────┘
                      YES  │  NO
                          │  │
                    ┌─────┘  └─────┐
                    │              │
                    ↓              ↓
            PROCESS SURVEY    NORMAL REPLY
            (close/reassign)  (generate reply)
```

---

## Summary Icons

| Icon | Meaning |
|------|---------|
| ✅ | Correct / Proceed / Yes |
| ❌ | Stop / Skip / Error |
| 🔐 | Close ticket |
| 🔄 | Reassign ticket |
| 🔥 | Continue replying |
| 📊 | Survey marked pending |
| ♾️ | Infinite loop (old bug) |
| ↓ | Flow continues |
| → | Alternative path |

---

## Print-Friendly Quick Reference

```
══════════════════════════════════════════════════════════════
                    SURVEY SYSTEM FLOW
══════════════════════════════════════════════════════════════

1. BOT SENDS SURVEY
   └─ Survey marked: PENDING ✅

2. CUSTOMER RESPONDS
   └─ Webhook checks survey state ✅

3. ANALYZE SENTIMENT
   ├─ YES → Close ✅
   ├─ NO → Reassign ✅
   └─ ARGUING → Continue ✅

4. EXECUTE ACTION & STOP
   └─ No more replies sent ✅

══════════════════════════════════════════════════════════════
```

---

This visual format makes it easy to understand the flow at a glance!
