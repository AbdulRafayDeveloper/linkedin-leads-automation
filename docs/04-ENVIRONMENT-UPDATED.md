# ENVIRONMENT VARIABLES & CONFIGURATION DOCUMENT (UPDATED)
## LinkedIn Sales Navigator Lead Research & Outreach Automation System - MongoDB Edition

**Purpose:** Define all environment variables required for MongoDB setup and deployment  
**File Location:** `.env.local` (root of Next.js project)  
**Database:** MongoDB Atlas (Free Tier)  
**Status:** Required before deployment  

---

## REQUIRED ENVIRONMENT VARIABLES

### 1. APPLICATION ENVIRONMENT

#### NODE_ENV
- **Description:** Node.js environment
- **Required:** Yes
- **Allowed Values:** `development`, `production`, `test`
- **Default Value:** `development`
- **Example:** `NODE_ENV=development`
- **Purpose:** Controls logging level, build optimization
- **When to Set:** Always set in .env.local

#### LOG_LEVEL
- **Description:** Application logging level
- **Required:** No
- **Allowed Values:** `debug`, `info`, `warn`, `error`, `off`
- **Default Value:** `info`
- **Example:** `LOG_LEVEL=debug`
- **Purpose:** Controls verbosity of logs
- **When to Set:** Use `debug` during development, `info` in production

#### DEBUG
- **Description:** Enable debug mode
- **Required:** No
- **Allowed Values:** `true`, `false`
- **Default Value:** `false`
- **Example:** `DEBUG=false`
- **Purpose:** Enables additional logging
- **When to Set:** Set to `true` during development only

---

### 2. MONGODB ATLAS CONFIGURATION

#### MONGODB_URI
- **Description:** MongoDB Atlas connection string
- **Required:** Yes (replaces GOOGLE_SHEETS_ID)
- **Value Format:** `mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority`
- **Example:** `mongodb+srv://<your-username>:<your-password>@<your-cluster>.mongodb.net/leads?retryWrites=true&w=majority`
- **Obtain From:**
  1. Go to https://www.mongodb.com/cloud/atlas/
  2. Sign up for free account (or log in)
  3. Create new project called "Lead Research Engine"
  4. Create new cluster (M0 free tier)
  5. Click "Connect"
  6. Choose "Connect your application"
  7. Select Node.js 4.0+ driver
  8. Copy connection string
  9. Replace `<password>` with your database user password
  10. Replace `myFirstDatabase` with `leads`
  11. Paste full string as MONGODB_URI
- **Length:** ~100-150 characters
- **Storage:** `.env.local` (DO NOT COMMIT)
- **⚠️ WARNING:** Contains password — keep secret, never expose

#### MONGODB_DATABASE
- **Description:** Database name
- **Required:** No (optional, defaults to "leads")
- **Allowed Values:** Any valid MongoDB database name
- **Default Value:** `leads`
- **Example:** `MONGODB_DATABASE=leads`
- **Purpose:** Specifies which database to use (for multi-database setups)
- **When to Set:** Leave default unless you have multiple databases

#### MONGODB_COLLECTION_LEADS
- **Description:** MongoDB collection name for leads
- **Required:** No (optional, defaults to "leads")
- **Allowed Values:** Any valid MongoDB collection name
- **Default Value:** `leads`
- **Example:** `MONGODB_COLLECTION_LEADS=leads`
- **Purpose:** Collection where lead documents are stored
- **When to Set:** Leave default unless using different collection names

#### MONGODB_TIMEOUT_MS
- **Description:** MongoDB connection timeout (milliseconds)
- **Required:** No
- **Allowed Values:** 5000-30000
- **Default Value:** 10000 (10 seconds)
- **Example:** `MONGODB_TIMEOUT_MS=10000`
- **Purpose:** Prevents connection from hanging indefinitely
- **When to Set:** Leave default unless experiencing timeout issues

---

### 3. APPLICATION CONFIGURATION

#### NEXT_PUBLIC_APP_URL
- **Description:** Public URL of the application
- **Required:** Yes
- **Value Format:** Full URL including protocol
- **Development Value:** `http://localhost:3000`
- **Production Value:** `https://your-vercel-domain.vercel.app`
- **Example:** `NEXT_PUBLIC_APP_URL=http://localhost:3000`
- **Purpose:** Used for redirects, links, and API requests from frontend
- **When to Set:** Different values in development and production

#### NEXT_PUBLIC_API_URL
- **Description:** API endpoint URL
- **Required:** No (defaults to NEXT_PUBLIC_APP_URL)
- **Value Format:** Full URL to API
- **Development Value:** `http://localhost:3000/api`
- **Production Value:** `https://your-vercel-domain.vercel.app/api`
- **Example:** `NEXT_PUBLIC_API_URL=http://localhost:3000/api`
- **Purpose:** Frontend uses this to call backend APIs
- **When to Set:** Usually same as NEXT_PUBLIC_APP_URL + /api

#### ITEMS_PER_PAGE
- **Description:** Number of leads to show per page in dashboard
- **Required:** No
- **Allowed Values:** 10-100
- **Default Value:** 50
- **Example:** `ITEMS_PER_PAGE=50`
- **Purpose:** Pagination for leads table
- **When to Set:** Adjust based on performance needs

---

### 4. CLAUDE API (IF NOT USING CLAUDE CODE BUILT-IN)

#### CLAUDE_API_KEY
- **Description:** Anthropic Claude API key (optional if using Claude Code)
- **Required:** No (Claude Code has built-in access)
- **Value Format:** String starting with `sk-`
- **Example:** `sk-ant-abc123def456ghi789jkl012mno345pqr678`
- **Obtain From:**
  1. Go to https://console.anthropic.com/
  2. Sign in with Anthropic account
  3. Go to "API Keys"
  4. Click "Create Key"
  5. Copy the key immediately
  6. Paste as CLAUDE_API_KEY
- **Storage:** `.env.local` (DO NOT COMMIT)
- **Note:** Only required if calling Claude API directly (Claude Code has built-in access)

#### CLAUDE_MODEL
- **Description:** Which Claude model to use
- **Required:** No (if using Claude Code built-in)
- **Allowed Values:** `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`
- **Recommended:** `claude-sonnet-5`
- **Example:** `CLAUDE_MODEL=claude-sonnet-5`
- **Purpose:** Specifies Claude model for API calls
- **When to Set:** Only if using CLAUDE_API_KEY directly

---

## TEMPLATE .env.local FILE

Copy this template to `.env.local` and fill in your values:

```env
# ============================================
# APPLICATION ENVIRONMENT
# ============================================
NODE_ENV=development
LOG_LEVEL=debug
DEBUG=false

# ============================================
# MONGODB ATLAS CONFIGURATION
# ============================================
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/leads?retryWrites=true&w=majority
MONGODB_DATABASE=leads
MONGODB_COLLECTION_LEADS=leads
MONGODB_TIMEOUT_MS=10000

# ============================================
# APPLICATION URLS
# ============================================
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3000/api

# ============================================
# PAGINATION
# ============================================
ITEMS_PER_PAGE=50

# ============================================
# CLAUDE API (Optional - use Claude Code built-in if available)
# ============================================
# CLAUDE_API_KEY=your_claude_key_here (optional)
# CLAUDE_MODEL=claude-sonnet-5 (optional)

# ============================================
# DO NOT ADD HARDCODED VALUES BELOW THIS LINE
# ============================================
```

---

## VERCEL DASHBOARD CONFIGURATION

When deploying to Vercel, set these environment variables:

### Vercel Dashboard Steps:
1. Go to https://vercel.com/dashboard
2. Select your project
3. Go to "Settings" → "Environment Variables"
4. Add each variable:

| Variable | Development | Production |
|----------|-------------|------------|
| `NODE_ENV` | `development` | `production` |
| `LOG_LEVEL` | `debug` | `info` |
| `MONGODB_URI` | [Your URI] | [Your URI] |
| `MONGODB_DATABASE` | `leads` | `leads` |
| `MONGODB_COLLECTION_LEADS` | `leads` | `leads` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://[your-domain].vercel.app` |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000/api` | `https://[your-domain].vercel.app/api` |
| `ITEMS_PER_PAGE` | `50` | `50` |

---

## OBTAINING MONGODB ATLAS CREDENTIALS

### Step 1: Create MongoDB Atlas Account

1. Go to https://www.mongodb.com/cloud/atlas/
2. Click "Try MongoDB Free"
3. Sign up with email
4. Confirm email
5. Log in to MongoDB Atlas

### Step 2: Create MongoDB Project

1. You should see "Create a deployment" screen
2. Click "Create" (for M0 free cluster)
3. Name your cluster: "Lead Research Engine"
4. Choose provider: AWS (default is fine)
5. Choose region: Closest to you or `us-east-1`
6. Click "Create Deployment"
7. Wait 2-3 minutes for cluster to be created

### Step 3: Get Connection String

1. Once cluster is created, click "Connect"
2. Choose "Connect your application"
3. Select Node.js 4.0+ driver
4. Copy the connection string
5. Replace `<password>` with your database user password
6. Replace `myFirstDatabase` with `leads`

**Example transformation:**
```
Original:
mongodb+srv://<username>:<password>@cluster.mongodb.net/myFirstDatabase?retryWrites=true&w=majority

Becomes:
mongodb+srv://<your-username>:<your-password>@cluster.mongodb.net/leads?retryWrites=true&w=majority
```

7. Paste into `.env.local` as MONGODB_URI

### Step 4: Create Database User

If prompted during connection setup:

1. Go to "Database Access" in MongoDB Atlas
2. Click "Add New Database User"
3. Username: `leadbot` (or your preference)
4. Password: Create secure password
5. Database User Privileges: "Read and write to any database"
6. Click "Add User"
7. Note the username and password for connection string

### Step 5: Whitelist IP Address (or Allow All)

1. Go to "Network Access" in MongoDB Atlas
2. Click "Add IP Address"
3. For development: Click "Allow Access from Anywhere" (0.0.0.0/0)
4. For production: Add your Vercel server IPs (Vercel handles this)
5. Click "Confirm"

### Step 6: Test Connection

```bash
# Test MongoDB connection
node -e "
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);
mongoose.connection.on('open', () => {
  console.log('✓ MongoDB connection successful');
  process.exit(0);
});
mongoose.connection.on('error', (err) => {
  console.error('✗ MongoDB connection failed', err);
  process.exit(1);
});
"
```

---

## CLAUDE API (OPTIONAL)

Only needed if NOT using Claude Code built-in. To set up Claude API:

### Step 1: Get API Key

1. Go to https://console.anthropic.com/
2. Sign in or create account
3. Go to "API Keys"
4. Click "Create Key"
5. Copy key immediately
6. Paste as CLAUDE_API_KEY in `.env.local`

### Step 2: Verify Setup

```bash
# Test Claude API
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $CLAUDE_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-sonnet-5",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "say hello"}]
  }'
```

---

## SECURITY CHECKLIST

### Before Committing Code:
- [ ] `.env.local` is in `.gitignore`
- [ ] No MONGODB_URI in any source files
- [ ] No hardcoded credentials in code
- [ ] No API keys in console.log()
- [ ] Check git history: `git log -S "mongodb+srv" --all`

### Before Deploying to Vercel:
- [ ] All variables set in Vercel dashboard
- [ ] MONGODB_URI correctly formatted
- [ ] Database user password is strong
- [ ] IP whitelist configured in MongoDB
- [ ] Test connection before deploying

### If You Expose MongoDB Credentials:
1. **Immediately change** database user password
2. **Create new user** with different credentials
3. **Update** MONGODB_URI in .env.local and Vercel
4. **Monitor** MongoDB access logs for unauthorized access
5. **Review** all existing data for security breaches

---

## TROUBLESHOOTING ENVIRONMENT SETUP

### Error: "MONGODB_URI is undefined"
**Cause:** Variable not set in `.env.local`  
**Solution:**
1. Check `.env.local` exists
2. Verify `MONGODB_URI=value` is present (not commented out)
3. Restart dev server: `npm run dev`

### Error: "MongoServerError: connect ECONNREFUSED"
**Cause:** Cannot connect to MongoDB Atlas  
**Solution:**
1. Verify connection string format is correct
2. Check IP address is whitelisted (MongoDB Atlas Network Access)
3. Verify database user exists and password is correct
4. Check internet connection
5. Ensure cluster is actually deployed (can take 2-3 minutes)

### Error: "MongoNetworkError: getaddrinfo ENOTFOUND"
**Cause:** DNS cannot resolve MongoDB connection string  
**Solution:**
1. Check connection string domain is typed correctly
2. Verify internet connectivity
3. Try simpler connection string (without all options)
4. Restart computer/clear DNS cache

### Error: "MongoAuthenticationError"
**Cause:** Database user credentials are incorrect  
**Solution:**
1. Verify username and password in connection string
2. Password must be URL-encoded (special chars like @, %, etc. must be encoded)
3. Check if database user exists in MongoDB Atlas
4. Reset password if forgotten:
   - Go to MongoDB Atlas Database Access
   - Click user → "Edit"
   - Change password
   - Update MONGODB_URI

### Error: "Database connection pooling error"
**Cause:** Too many concurrent connections  
**Solution:**
1. MongoDB free tier limited to 500 concurrent connections
2. Increase `MONGODB_TIMEOUT_MS` to allow slower connections
3. Verify application isn't creating multiple connection instances
4. Restart application

### Error: "Collection doesn't exist"
**Cause:** Collection name mismatch or not created  
**Solution:**
1. MongoDB auto-creates collections on first insert
2. Verify `MONGODB_COLLECTION_LEADS` matches what code uses
3. Try processing a lead to auto-create collection

---

## SUMMARY

| Variable | Required | Sensitivity | Obtain From |
|----------|----------|-------------|------------|
| `NODE_ENV` | ✅ | Public | Set manually |
| `LOG_LEVEL` | ❌ | Public | Set manually |
| `MONGODB_URI` | ✅ | **HIGHLY SECRET** | MongoDB Atlas |
| `MONGODB_DATABASE` | ❌ | Public | Set manually |
| `NEXT_PUBLIC_APP_URL` | ✅ | Public | Your domain |
| `CLAUDE_API_KEY` | ❌ | **HIGHLY SECRET** | Anthropic (if needed) |

**Total credentials to obtain:** 1-2  
**Estimated setup time:** 10-15 minutes  
**Difficulty level:** Beginner-friendly  

**Key Difference from Google Sheets:**
- ✅ MongoDB stores data permanently (not spreadsheet)
- ✅ Web dashboard interface (not Google Sheets UI)
- ✅ Supports filtering, searching, pagination
- ✅ Better for large datasets
- ✅ Same free tier availability

