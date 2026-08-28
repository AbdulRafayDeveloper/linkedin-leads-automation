# MASTER PROMPT (UPDATED - MONGODB EDITION)
## Build Complete LinkedIn Sales Navigator Lead Research & Outreach System with Web Dashboard

**Status:** Execute this single prompt in Claude Code  
**Duration:** 3-5 hours of automated implementation  
**Scope:** Entire project from setup through end-to-end testing  
**Result:** Production-ready Next.js application with MongoDB backend deployed to Vercel  
**Key Change:** MongoDB instead of Google Sheets + Complete Web Dashboard  

---

## CRITICAL CHANGES FROM ORIGINAL

✅ **REMOVED:**
- ❌ Google Sheets API integration
- ❌ Google OAuth authentication
- ❌ Google Sheets as database
- ❌ Sheets-based lead management

✅ **ADDED:**
- ✅ MongoDB Atlas integration 
- ✅ Mongoose for data modeling
- ✅ Web-based lead dashboard
- ✅ Table view of all leads
- ✅ Filtering and searching
- ✅ Edit/update leads
- ✅ Delete leads
- ✅ Bulk operations
- ✅ Left sidebar navigation
- ✅ Complete CRUD operations

---

## YOUR MISSION

Build a fully functional, production-ready Next.js application that:

1. ✅ Accepts pasted Sales Navigator lead page content
2. ✅ Parses and extracts lead information
3. ✅ Researches the lead's current company
4. ✅ Discovers the lead's email address
5. ✅ Validates the email using free DNS/MX methods
6. ✅ Generates personalized outreach emails
7. ✅ **Saves all data to MongoDB (NOT Google Sheets)**
8. ✅ **Displays all leads in web dashboard table**
9. ✅ **Allows filtering, searching, editing, deleting leads**
10. ✅ Manages everything through web interface
11. ✅ Passes comprehensive testing
12. ✅ Deploys to Vercel on free tier

---

## BEFORE YOU START

### Critical Differences from Original:

**Database:**
- Old: Google Sheets
- New: MongoDB Atlas (free tier)

**Lead Management:**
- Old: Manual review in Sheets
- New: Web dashboard with table, filters, editing

**Architecture:**
- Old: Separate external system (Sheets)
- New: Complete internal system

**User Experience:**
- Old: Paste → Process → Check Google Sheets separately
- New: Paste → Process → View in dashboard all in one place

### Setup Required:
1. MongoDB Atlas free account (512MB free)
2. MongoDB connection string (URI format)
3. Mongoose models and schemas
4. Web dashboard UI components
5. CRUD API endpoints

---

## YOUR EXECUTION PLAN

Execute in this exact order:

---

## PHASE 1: PROJECT SETUP & MONGODB CONFIGURATION

### Task 1.1: Initialize Environment Configuration

**Setup all environment variables:**
```
NODE_ENV=development
LOG_LEVEL=debug
DEBUG=false
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/leads?retryWrites=true&w=majority
MONGODB_DATABASE=leads
MONGODB_COLLECTION_LEADS=leads
MONGODB_TIMEOUT_MS=10000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3000/api
ITEMS_PER_PAGE=50
```

**Verification:**
- `.env.local` loads without errors
- MongoDB URI is valid format
- All variables accessible via process.env

---

### Task 1.2: Set Up TypeScript & Project Structure

**Create directories:**
- `/src/lib/parser/` — Lead parsing
- `/src/lib/research/` — Company research
- `/src/lib/email/` — Email discovery, validation, generation
- `/src/lib/db/` — MongoDB connection, models, schemas
- `/src/lib/db/models/` — Mongoose Lead model
- `/src/lib/types/` — TypeScript interfaces
- `/src/components/process/` — Lead processing page
- `/src/components/dashboard/` — Dashboard components
- `/src/components/leads/` — Leads table, filters
- `/src/components/sidebar/` — Navigation sidebar
- `/src/app/api/leads/` — API routes for CRUD

**TypeScript Configuration:**
- Strict mode enabled
- Mongoose types installed
- Interfaces for Lead, Company, Email, ValidationResult

**Verification:**
- No TypeScript errors: `npx tsc --noEmit`
- Directory structure matches specification

---

### Task 1.3: Configure MongoDB Connection

**File: `/src/lib/db/connection.ts`**

```typescript
import mongoose from 'mongoose';

export async function connectToMongoDB() {
  if (mongoose.connection.readyState === 1) return;
  
  try {
    await mongoose.connect(process.env.MONGODB_URI || '', {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: process.env.MONGODB_TIMEOUT_MS || 10000
    });
    console.log('✓ MongoDB connected');
  } catch (error) {
    console.error('✗ MongoDB connection failed:', error);
    throw error;
  }
}
```

**Features:**
- Connection pooling
- Timeout handling
- Error logging
- Connection reuse

**Verification:**
- Test connection to MongoDB Atlas: `node -e "require('./src/lib/db/connection.ts').connectToMongoDB()"`
- Successfully connects without errors
- Connection pooling configured

---

### Task 1.4: Define Mongoose Lead Schema

**File: `/src/lib/db/models/Lead.ts`**

**Schema Fields (20+):**
- _id: ObjectId (auto)
- fullName: String (required)
- linkedinProfileUrl: String
- currentTitle: String
- currentCompany: String
- currentCompanyLinkedInUrl: String
- currentCompanyWebsite: String
- location: String
- about: String
- experience: [String]
- education: [String]
- skills: [String]
- recentActivity: [String]
- email: String (indexed, sparse)
- emailSource: String
- emailConfidence: String (HIGH, MEDIUM, LOW)
- validationStatus: String (PASS, FAIL, NEEDS_REVIEW, NOT_FOUND)
- validationDetails: String
- personalizationSignals: Object
- emailSubject: String
- emailBody: String
- approvalStatus: String (PENDING, APPROVED, REJECTED) (indexed)
- processingStatus: String (COMPLETE, ERROR)
- sentStatus: String (NOT_SENT, DRAFT_CREATED, SENT, BOUNCED) (indexed)
- errorMessage: String
- createdAt: Date (auto, indexed)
- updatedAt: Date (auto)
- sentAt: Date
- processingTimeMs: Number
- sourceText: String

**Indexes:**
- email (sparse unique)
- approvalStatus
- sentStatus
- validationStatus
- createdAt (descending)

**Validation:**
- Required fields: fullName, currentCompany
- Email format validation if provided
- Status enums enforced
- Timestamps auto-generated

**Verification:**
- Schema created and exported as model
- Indexes created in MongoDB
- Mongoose validates documents

---

## PHASE 2-5: LEAD PARSER, RESEARCH, EMAIL DISCOVERY & VALIDATION

(Same as original specifications — implement exactly as in updated TASKS document)

Build modules:
- `/src/lib/parser/parser.ts` — Extract 14 fields
- `/src/lib/research/research.ts` — Find company website
- `/src/lib/email/discovery.ts` — Find email
- `/src/lib/email/validation.ts` — Validate email
- `/src/lib/email/generation.ts` — Generate personalized email

All with unit tests (80%+ coverage).

**Verification:** All modules have passing tests.

---

## PHASE 6: MONGODB CRUD OPERATIONS (NEW - Replaces Google Sheets)

### Task 6.1: Create Lead in MongoDB

**File: `/src/lib/db/operations/create.ts`**

```typescript
export async function createLead(processingResult: ProcessingResult): Promise<LeadDocument> {
  const lead = new Lead({
    fullName: processingResult.lead.fullName,
    linkedinProfileUrl: processingResult.lead.linkedinProfileUrl,
    currentTitle: processingResult.lead.currentTitle,
    currentCompany: processingResult.lead.currentCompany,
    // ... all 20+ fields
    email: processingResult.email.email,
    emailSource: processingResult.email.emailSource,
    emailConfidence: processingResult.email.confidence,
    validationStatus: processingResult.validation.status,
    validationDetails: JSON.stringify(processingResult.validation.validationChecks),
    personalizationSignals: processingResult.generatedEmail.personalizationSignalsUsed,
    emailSubject: processingResult.generatedEmail.subject,
    emailBody: processingResult.generatedEmail.body,
    approvalStatus: 'PENDING', // Default
    processingStatus: 'COMPLETE',
    sentStatus: 'NOT_SENT', // Default
    processingTimeMs: processingResult.totalProcessingTimeMs,
    sourceText: processingResult.lead.sourceText
  });
  
  return await lead.save();
}
```

**Verification:**
- Lead saved to MongoDB
- All fields present
- Auto-generated _id
- Timestamps created

---

### Task 6.2: Read Leads from MongoDB

**File: `/src/lib/db/operations/read.ts`**

```typescript
// Get all leads with pagination
export async function getLeads(page: number = 1, limit: number = 50) {
  const skip = (page - 1) * limit;
  const leads = await Lead.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  const total = await Lead.countDocuments();
  return { leads, total, page, pages: Math.ceil(total / limit) };
}

// Get single lead by ID
export async function getLeadById(id: string) {
  return await Lead.findById(id);
}

// Search by email or name
export async function searchLeads(query: string) {
  return await Lead.find({
    $or: [
      { email: new RegExp(query, 'i') },
      { fullName: new RegExp(query, 'i') }
    ]
  });
}

// Filter by approval status
export async function getLeadsByApprovalStatus(status: string, page: number = 1, limit: number = 50) {
  const skip = (page - 1) * limit;
  return await Lead.find({ approvalStatus: status })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
}

// Filter by validation status
export async function getLeadsByValidationStatus(status: string) {
  return await Lead.find({ validationStatus: status });
}

// Filter by date range
export async function getLeadsByDateRange(startDate: Date, endDate: Date) {
  return await Lead.find({
    createdAt: { $gte: startDate, $lte: endDate }
  }).sort({ createdAt: -1 });
}
```

**Verification:**
- All query functions work
- Pagination works
- Filters return correct results
- Sorting works

---

### Task 6.3: Update Leads in MongoDB

**File: `/src/lib/db/operations/update.ts`**

```typescript
export async function updateLead(id: string, updates: Partial<LeadDocument>) {
  return await Lead.findByIdAndUpdate(id, updates, { new: true });
}

export async function updateLeadEmail(id: string, email: string, subject: string, body: string) {
  return await updateLead(id, {
    email,
    emailSubject: subject,
    emailBody: body,
    updatedAt: new Date()
  });
}

export async function updateApprovalStatus(id: string, status: 'PENDING' | 'APPROVED' | 'REJECTED') {
  return await updateLead(id, { approvalStatus: status });
}

export async function updateSentStatus(id: string, status: 'NOT_SENT' | 'DRAFT_CREATED' | 'SENT' | 'BOUNCED') {
  return await updateLead(id, { sentStatus: status });
}
```

**Verification:**
- Updates saved to MongoDB
- updatedAt timestamp changes
- Partial updates work

---

### Task 6.4: Delete Leads from MongoDB

**File: `/src/lib/db/operations/delete.ts`**

```typescript
export async function deleteLead(id: string) {
  return await Lead.findByIdAndDelete(id);
}

export async function deleteLeadsByIds(ids: string[]) {
  return await Lead.deleteMany({ _id: { $in: ids } });
}

export async function deleteLeadsByApprovalStatus(status: string) {
  return await Lead.deleteMany({ approvalStatus: status });
}
```

**Verification:**
- Leads deleted from MongoDB
- Deletion is permanent

---

### Task 6.5: Create MongoDB CRUD API Routes

**Files: `/src/app/api/leads/`**

Create API routes:
- `GET /api/leads` — Get all leads with pagination
- `GET /api/leads/:id` — Get single lead
- `GET /api/leads/search` — Search leads
- `GET /api/leads/filter` — Filter leads
- `POST /api/leads` — Create new lead (from processing)
- `PUT /api/leads/:id` — Update lead
- `DELETE /api/leads/:id` — Delete lead
- `DELETE /api/leads` — Bulk delete

Each route:
- Validates input
- Connects to MongoDB
- Returns JSON response
- Error handling
- Appropriate HTTP status codes

**Verification:**
- All API routes work
- Curl/Postman tests pass
- Error responses clear

---

## PHASE 7: WEB DASHBOARD - UI COMPONENTS

### Task 7.1: Build Lead Processing Page

**File: `/src/components/process/LeadProcessingPage.tsx`**

Features:
- Textarea for pasting content
- Submit button
- Real-time progress indicator (7 steps)
- Results display
- Error handling
- Link to view lead in dashboard

**Verification:**
- Page loads without errors
- Can paste content
- Processing starts on submit
- Progress indicator works
- Results display correctly

---

### Task 7.2: Build Sidebar Navigation

**File: `/src/components/sidebar/Sidebar.tsx`**

Features:
- Left sidebar (desktop) / hamburger menu (mobile)
- Links:
  - Dashboard (home)
  - Process New Lead
  - My Leads (table)
  - Settings (optional)
- Current page indicator
- Responsive design

**Verification:**
- Sidebar renders
- Links work
- Mobile responsive
- Current page highlighted

---

### Task 7.3: Build Leads Table Component

**File: `/src/components/leads/LeadsTable.tsx`**

Features:
- Table with leads from MongoDB
- Columns: Name, Title, Company, Email, Validation Status, Approval Status, Created Date
- Sortable columns
- Pagination (50 leads per page by default)
- Click row to open details
- Responsive design (scroll on mobile)
- Loading state
- Empty state

**Verification:**
- Table displays leads
- Can sort columns
- Pagination works
- Responsive on mobile

---

### Task 7.4: Build Filters Component

**File: `/src/components/leads/FiltersPanel.tsx`**

Features:
- Filter by Approval Status (Pending, Approved, Rejected, All)
- Filter by Validation Status (Pass, Fail, Needs Review, Not Found, All)
- Filter by Sent Status (Not Sent, Sent, Bounced, All)
- Search by name or email
- Date range picker
- Reset filters button
- Apply filters in real-time

**Verification:**
- All filters work
- Can combine filters
- Search works
- Date filter works
- Reset clears all

---

### Task 7.5: Build Lead Details Modal/Page

**File: `/src/components/leads/LeadDetailsModal.tsx`**

Features:
- View all lead fields
- Editable fields:
  - Email
  - Email Subject
  - Email Body
  - Approval Status
- Save changes
- Delete lead option
- Preview email (formatted)
- Confirmation before delete
- Error handling
- Success message on update

**Verification:**
- Can open details
- Can edit fields
- Changes save to MongoDB
- Can delete lead
- Confirmation works

---

### Task 7.6: Build Dashboard Layout

**File: `/src/app/app/dashboard/page.tsx`**

Layout:
- Sidebar (left)
- Main content area
- Header with title and buttons
- Filters panel (top right of table)
- Leads table with pagination
- All components integrated

**Verification:**
- Layout renders correctly
- Responsive design
- All components visible and functional

---

## PHASE 8: API INTEGRATION & DATA FLOW

### Task 8.1: Create Lead Processing API Endpoint

**File: `/src/app/api/process/route.ts`**

**POST /api/process:**
- Accept pasted content
- Run through all processing phases (parse → research → email → validate → generate)
- Save result to MongoDB
- Return complete lead with MongoDB _id
- Error handling

**Verification:**
- Endpoint accepts POST requests
- Processes leads correctly
- Saves to MongoDB
- Returns correct response

---

### Task 8.2: Connect Dashboard to MongoDB

**Frontend → API → MongoDB Flow:**

1. Dashboard loads → `GET /api/leads?page=1` → Fetch from MongoDB → Display table
2. User filters → `GET /api/leads/filter?approval=PENDING` → Filter MongoDB → Update table
3. User searches → `GET /api/leads/search?q=email@example.com` → Search MongoDB → Display results
4. User edits → `PUT /api/leads/:id` → Update MongoDB → Refresh table
5. User deletes → `DELETE /api/leads/:id` → Delete from MongoDB → Remove from table

**Verification:**
- All flows work end-to-end
- Data persists in MongoDB
- UI updates correctly

---

## PHASE 9: TESTING

### Task 9.1: Create Unit Tests for CRUD Operations

**File: `/src/lib/db/__tests__/crud.test.ts`**

Tests:
- Create lead
- Read leads with pagination
- Read single lead
- Filter by approval status
- Filter by validation status
- Search by email
- Update lead
- Update approval status
- Delete lead
- Handle errors

**Verification:**
- All CRUD tests pass
- 80%+ coverage

---

### Task 9.2: Create E2E Tests

**File: `__tests__/e2e.test.ts`**

Tests:
- Paste lead → Process → Save to MongoDB → Display in dashboard
- Edit lead email → Save → Verify in MongoDB
- Filter leads → Verify correct results
- Delete lead → Verify removed from database
- Search leads → Verify correct results
- Update approval status → Verify changes

**Verification:**
- All E2E tests pass
- Processing time < 30 seconds per lead
- Data correctly persists and displays

---

### Task 9.3: Create UI Component Tests

Test all React components:
- Lead processing page
- Sidebar navigation
- Leads table
- Filters panel
- Lead details modal
- Dashboard layout

**Verification:**
- All UI tests pass
- 75%+ coverage

---

## PHASE 10: DEPLOYMENT

### Task 10.1: Prepare for Deployment

**Checklist:**
- All tests pass
- No TypeScript errors
- No console errors
- No hardcoded MongoDB URI or API keys
- Production build succeeds

**Verification:**
```bash
npm run build  # Should succeed
npm run test   # All tests pass
npm start      # Should start without errors
```

---

### Task 10.2: Deploy to Vercel

**Steps:**
1. Push code to GitHub
2. Connect GitHub to Vercel
3. Set environment variables in Vercel dashboard:
   - MONGODB_URI
   - All other environment variables
4. Deploy
5. Verify production build succeeds
6. Verify app is accessible

**Verification:**
- Deployment succeeds
- App accessible at Vercel URL
- All features work in production
- MongoDB accessible from production

---

### Task 10.3: Final Verification

**Checklist:**
1. Production URL accessible
2. Can process new lead end-to-end
3. Lead appears in dashboard
4. Can filter and search leads
5. Can edit lead
6. Can delete lead
7. MongoDB has data persisted
8. No errors in production

**Generate Final Report:**

```
╔════════════════════════════════════════════════════════════╗
║        PROJECT COMPLETION REPORT                           ║
║   LinkedIn Sales Navigator Lead Intelligence Engine        ║
║            MongoDB + Web Dashboard Edition                 ║
╚════════════════════════════════════════════════════════════╝

✓ Phase 1: Environment & TypeScript Setup — COMPLETE
✓ Phase 2-5: Parser, Research, Email Modules — COMPLETE (80%+ coverage)
✓ Phase 6: MongoDB CRUD Operations — COMPLETE
✓ Phase 7: Web Dashboard UI — COMPLETE
✓ Phase 8: API Integration — COMPLETE
✓ Phase 9: Testing — COMPLETE (80%+ coverage)
✓ Phase 10: Deployment — COMPLETE

FEATURES IMPLEMENTED:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Lead parsing (14 fields)
✓ Company research
✓ Email discovery
✓ Free email validation
✓ Personalized email generation
✓ MongoDB storage (512MB free tier)
✓ Web dashboard with table view
✓ Filtering and searching
✓ Lead editing
✓ Lead deletion
✓ Bulk operations
✓ Sidebar navigation
✓ Responsive design

DATABASE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Platform: MongoDB Atlas
  Plan: Free tier (512MB)
  Database: leads
  Collections: leads
  Indexes: email, approvalStatus, sentStatus, createdAt
  Documents: [Number of test leads]

DEPLOYMENT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Platform: Vercel Free Tier
  URL: https://[your-project].vercel.app
  Status: ✓ HEALTHY
  Last Deploy: [Timestamp]

TESTING:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Unit Tests: 50+ (85% coverage)
  E2E Tests: 8/8 passing
  UI Tests: 15+ (75% coverage)
  Total Coverage: 82%

PERFORMANCE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Lead Processing: 22 seconds (target <30s) ✓
  Dashboard Load: 1.5 seconds (target <2s) ✓
  API Response: 0.3 seconds (target <1s) ✓

COST:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MongoDB Atlas: $0/month (free tier)
  Vercel: $0/month (free tier)
  Claude API: $0/month (via Claude Code)
  Total: $0/month ✓

SECURITY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Zero hardcoded secrets
  ✓ All config from environment variables
  ✓ MongoDB connection secure
  ✓ No sensitive data logged
  ✓ Input validation on all endpoints

SYSTEM READY FOR PRODUCTION USE ✓

You can now:
1. Process new leads instantly
2. View all leads in dashboard
3. Filter, search, and edit leads
4. Track processing status
5. Approve or reject leads
6. Manage everything from web interface
```

---

## KEY RULES TO FOLLOW

1. **Never hardcode anything** — All config from environment
2. **Never use paid services** — Free tiers only
3. **Never skip tests** — All phases must pass testing
4. **MongoDB only** — No Google Sheets anywhere
5. **Web dashboard required** — No external systems
6. **All CRUD operations** — Create, Read, Update, Delete all required
7. **Web interface first** — Manage everything through the app

---

## IF YOU GET BLOCKED

Common issues that need user input:
- MongoDB connection string format
- Vercel environment variables
- Missing API credentials

Everything else, solve independently.

---

## START NOW

You have everything you need. MongoDB setup is done in environment variables. Begin Phase 1.

**Build the complete system. Make it production-ready. Deploy to Vercel.**

**Start NOW.**

