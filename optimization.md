Looking at your code, I can spot several real bugs. Let me break them down:

Bug 1: The Survey Never Actually Detects the Customer's Reply
The core problem — when a comment is added, description is being read from ticketData.description, but that's the original ticket description, not the latest comment. So sentiment detection always runs on the same old text.
js// ❌ WRONG - this is the ticket's original description, not the new comment
const description = ticketData.description || "";
You need to extract the latest comment body from the webhook payload. Zendesk sends it separately — likely at ticketData.latest_comment?.body or req.body.comment?.body. Fix:
js// ✅ CORRECT - use the actual new comment text
const description = ticketData.latest_comment?.body || ticketData.comment?.body || ticketData.description || "";

Bug 2: The Survey Sending Triggers handleCommentAddedWebhook Again (Loop)
When the bot sends the survey comment, Zendesk fires ticket.comment_added again. At that point:

The ticket is still assigned to the bot ✅
surveyTracker hasn't been set yet (it's set after the survey comment is sent in handleAutoReplyAsync)
So it falls through to shouldReplyToTicket — which blocks it only if within 60s

The survey and the reply are sent as two separate Zendesk API calls, each triggering a webhook. The surveyTracker.set(...) happens after both are sent, so there's a race condition where the survey webhook arrives before the tracker is set.
Fix — set the survey tracker before sending the survey comment:
js// ✅ Set BEFORE sending survey, not after
surveyTracker.set(ticketId, { surveyPending: true, lastReplyTime: Date.now() });

await zendeskClient.put(`/tickets/${ticketId}.json`, {
  ticket: {
    comment: { body: surveyQuestion, public: true }
  }
});

Bug 3: Ticket Closure Doesn't Actually Work — Wrong API Call
js// ❌ WRONG - you can't set status AND add a comment in one PUT like this reliably
await zendeskClient.put(`/tickets/${ticketId}.json`, {
  ticket: {
    status: "closed",
    comment: { body: closingMessage, public: true }
  }
});
Zendesk requires the status to be "solved" before it can be "closed" (closed is a system state in many setups). Also, combining status change + comment in one call can silently fail depending on your Zendesk plan/triggers.
Fix — use "solved" or do it in two steps:
js// ✅ CORRECT
await zendeskClient.put(`/tickets/${ticketId}.json`, {
  ticket: {
    status: "solved", // use "solved", not "closed"
    comment: { body: closingMessage, public: true }
  }
});

Bug 4: Reassignment — assignee_id Is a String, Zendesk Expects a Number
js// ❌ WRONG - assignee_id must be a number, not a string
const randomAgent = AVAILABLE_AGENTS[Math.floor(Math.random() * AVAILABLE_AGENTS.length)];
// randomAgent is "8447388090495" (string) from .split(',')

await zendeskClient.put(`/tickets/${ticketId}.json`, {
  ticket: {
    assignee_id: randomAgent, // Zendesk silently ignores this
  }
});
Fix:
js// ✅ CORRECT
assignee_id: parseInt(randomAgent, 10)

Bug 5: Bot's Own Survey Comment Re-triggers the Whole Flow
Even with the cooldown, the bot posting a survey comment fires ticket.comment_added. Since the survey comment is public and the ticket is bot-assigned, the cooldown is the only thing saving you — and it's just 60 seconds. You should identify bot-authored comments and skip them entirely.
The cleanest fix is to check ticketData.latest_comment?.author_id against BOT_ASSIGNEE_ID:
js// ✅ Add this as CHECK 0, before everything else
const commentAuthorId = ticketData.latest_comment?.author_id;
if (commentAuthorId?.toString() === BOT_ASSIGNEE_ID.toString()) {
  console.log("⏭️ Skipping - comment was authored by the bot itself");
  return;
}

Summary of Fixes
BugRoot CauseFixSurvey never worksReading original ticket description instead of new commentUse latest_comment.bodyRace condition on survey stateTracker set after survey is sentSet tracker before sendingTicket not closingUsing "closed" statusUse "solved"Assignee not changingAgent ID is a stringparseInt() the agent IDBot triggers itselfNo author checkSkip comments authored by the bot