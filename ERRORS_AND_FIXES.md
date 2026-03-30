# 🔧 FIXING YOUR SUNSHINE WEBHOOK ERRORS

## Error #1: KB Search Error ✅ FIXED
```
⚠️ KB search error: : invalid value Starting an object on a scalar field
```

### Root Cause
The `queryVectors` function was being called with incorrect parameter order:
```javascript
// ❌ WRONG
queryVectors(vector, topK, { source: "manual_upload" })
// Third param should be includeMetadata (boolean), not filter object!
```

### The Fix (Applied)
```javascript
// ✅ CORRECT
queryVectors(
  vector,
  topK,
  true,  // includeMetadata (boolean)
  { source: { $eq: "manual_upload" } }  // filter (object, proper syntax)
)
```

**Changes made in:** `src/controllers/sunshine.js` Lines 95-122

---

## Error #2: 401 Unauthorized ❌ NEEDS FIX
```
❌ Failed to send Sunshine message: {
  error: 'invalid_token',
  error_description: 'The access token provided is expired, revoked, malformed or invalid for other reasons.'
}
```

### Root Cause
Your `SUNSHINE_API_KEY` in `.env` is either:
- ❌ Expired
- ❌ Revoked
- ❌ Wrong/mistyped
- ❌ Missing

### How to Fix

#### Step 1: Get New API Token from Zendesk

1. Go to **Zendesk Admin → API and integrations → Zendesk API clients**
2. Create new OAuth token or API key
3. Copy the token

#### Step 2: Update `.env` File

```bash
cd /Users/adarshrawat/Desktop/backend/backend
nano .env
```

Find and update:
```bash
# ❌ OLD (expired)
SUNSHINE_API_KEY=old_expired_token_here

# ✅ NEW (fresh from Zendesk)
SUNSHINE_API_KEY=your_new_token_here
```

#### Step 3: Restart Server

```bash
^C  # Stop server
npm start  # Restart with new token
```

#### Step 4: Test

Send another webhook test in Zendesk and check if you still get 401 error.

---

## Verification

### Check 1: Pinecone Query Fix
```bash
grep -A 5 "PHASE 1: Search manually" src/controllers/sunshine.js
```

Should show:
```javascript
const phase1Results = await queryVectors(
  messageEmbedding,
  10,
  true,  // includeMetadata (boolean)
  { source: { $eq: "manual_upload" } }  // filter (object)
);
```

### Check 2: API Token

```bash
cat .env | grep SUNSHINE_API_KEY
```

Should show something like:
```
SUNSHINE_API_KEY=abc123...xyz789
```

NOT empty or expired!

---

## Expected Logs After Fix

### Before Fix ❌
```
💾 Cache hit for text
⚠️ KB search error: invalid value Starting an object on a scalar field
📤 Sending Sunshine message...
❌ Failed to send Sunshine message: invalid_token
```

### After Fix ✅
```
💾 Cache hit for text
📚 Searching manual KB for reply...
✅ PHASE 1 (Manual KB) found 3 results
📝 Generating bot reply...
📤 Sending Sunshine message to conversation...
✅ Sunshine message sent successfully
```

---

## Both Errors Explained

### Error #1: Pinecone Query Error
```
"invalid value Starting an object on a scalar field"
```

This happens when:
- Pinecone receives a filter object in the wrong position
- You were passing filter as 3rd param instead of 4th
- Pinecone tried to parse boolean as object

**Fixed:** Reordered parameters correctly

### Error #2: Zendesk Auth Error  
```
"invalid_token... expired, revoked, malformed or invalid"
```

This happens when:
- `.env` has wrong/expired/missing token
- HTTP request to Zendesk includes bad auth header
- Zendesk rejects request with 401

**Fix:** Update token in `.env`

---

## Step-by-Step Recovery

### Step 1: Fix Pinecone (Done ✅)
Code already updated in `src/controllers/sunshine.js`

### Step 2: Get New Zendesk Token (Do This Now)

**In Zendesk:**
1. Go to Admin → APIs and integrations
2. Click "Zendesk API clients"
3. Create new token or use existing valid one
4. Copy the token value

### Step 3: Update `.env` (Do This Now)

```bash
# Edit .env file
nano /Users/adarshrawat/Desktop/backend/backend/.env

# Find SUNSHINE_API_KEY and replace with new token
SUNSHINE_API_KEY=your_new_token_from_zendesk
```

### Step 4: Restart Server (Do This Now)

```bash
^C  # Kill current process
npm start  # Start fresh
```

### Step 5: Test Again

In Zendesk Sunshine webhook settings, send test webhook.

**Expected response:**
```json
{
  "success": true,
  "conversationId": "...",
  "botReply": "...",
  "articlesUsed": 3
}
```

---

## Troubleshooting

### Still Getting "invalid_token" After Update?

1. [ ] Did you save `.env` file?
2. [ ] Did you restart server? (`npm start`)
3. [ ] Is the new token actually valid in Zendesk?
4. [ ] Did you copy the full token (no extra spaces)?

Try:
```bash
# Verify token is in .env
grep "SUNSHINE_API_KEY=" .env

# Check it's not empty
echo $SUNSHINE_API_KEY
```

### Still Getting "Starting an object on a scalar field"?

The code fix is already applied. If still getting this error:

```bash
# Verify changes were saved
grep -B2 -A2 "includeMetadata" src/controllers/sunshine.js

# Should show the new parameter order
```

If not showing, the file may not have saved. Restart and check again.

---

## Files Modified

### 1. ✅ `src/controllers/sunshine.js` - FIXED
- Lines 95-122: Updated queryVectors calls
- Fixed parameter order
- Fixed filter syntax for Pinecone

### 2. ❌ `.env` - NEEDS UPDATE (You must do this)
- Find: `SUNSHINE_API_KEY=...`
- Replace: with new token from Zendesk
- Save file
- Restart server

---

## Summary

| Error | Cause | Status | Action |
|-------|-------|--------|--------|
| Pinecone query error | Wrong parameter order | ✅ FIXED | Already done |
| 401 Unauthorized | Expired API token | ❌ NEEDS FIX | Update `.env` + restart |

---

## Action Items

1. [ ] Get new SUNSHINE_API_KEY from Zendesk
2. [ ] Update `.env` with new token
3. [ ] Restart server: `npm start`
4. [ ] Test webhook again
5. [ ] Should see success response

---

## Quick Commands

```bash
# 1. Edit .env
nano .env

# 2. Find and replace SUNSHINE_API_KEY

# 3. Save (Ctrl+O, Enter, Ctrl+X)

# 4. Restart server
npm start

# 5. Check logs for successful message processing
```

---

**Current Status:**
- ✅ Pinecone query fixed
- ❌ API token needs update
- 🔄 Ready to test after both fixes

**Next Action:** Update `.env` with new Zendesk token!

