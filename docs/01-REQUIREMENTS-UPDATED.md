# REQUIREMENTS DOCUMENT (UPDATED)
## LinkedIn Sales Navigator Lead Research & Outreach Automation System

**Project Name:** LinkedIn Lead Intelligence & Outreach Engine  
**Version:** 2.0 (MongoDB Edition)  
**Status:** In Development  
**Build Environment:** Next.js  
**Database:** MongoDB Atlas (free tier)  
**Deployment:** Vercel (Free Tier)  
**Cost Target:** Zero or Minimal  

---

## 1. PROJECT OVERVIEW

The system automates the process of researching LinkedIn Sales Navigator leads and generating personalized outreach emails. All data is stored in MongoDB and managed through a web-based dashboard.

### Workflow Summary
```
User: Copy Sales Navigator lead page
     ↓
System: Parse lead data
     ↓
System: Research company
     ↓
System: Discover email
     ↓
System: Validate email
     ↓
System: Generate personalized email
     ↓
System: Save to MongoDB
     ↓
Dashboard: Display lead in table
     ↓
User: Review, edit, approve, or delete
```

---

## 2. FUNCTIONAL REQUIREMENTS

### 2.1 Input Processing (Phase 1)

**FR-1.1:** The system must accept user-pasted Sales Navigator lead page content (HTML, Markdown, or plain text).

**FR-1.2:** The system must parse the pasted content and extract the following fields:
- Full name
- LinkedIn profile URL
- Current job title
- Current company name
- Current company LinkedIn URL
- Company website (if provided)
- Location (city, state/province, country)
- Current role start date (if available)
- Current role description
- Recent activity (posts, comments, engagement)
- About section content
- Work experience (list of previous companies)
- Education (schools, degrees, fields)
- Skills (list)
- Public contact information (if any email is visible)

**FR-1.3:** The system must normalize extracted data into a consistent JSON structure.

**FR-1.4:** The system must ignore irrelevant content (navigation, UI elements, images, SVG placeholders).

**FR-1.5:** If the current company cannot be determined with confidence, mark as `CURRENT_COMPANY_UNCERTAIN`.

**FR-1.6:** If no public email is found during parsing, the email field must be `null`, not invented.

---

### 2.2 Company Research (Phase 2)

**FR-2.1:** Given a company name and optional LinkedIn URL or website, identify the official company website.

**FR-2.2:** If a company website is explicitly provided in pasted data, verify it corresponds to the company before using it.

**FR-2.3:** If no website provided, research and identify the official website using free services.

**FR-2.4:** Inspect public company pages (homepage, about, contact, contact-us, team, footer) for useful information.

**FR-2.5:** Return company information with confidence levels (HIGH, MEDIUM, LOW).

**FR-2.6:** Never invent company information.

---

### 2.3 Email Discovery (Phase 3)

**FR-3.1:** Follow strict decision tree:
1. If email exists in Sales Navigator contact information → Use it
2. If no email → Get company website
3. Search public pages (contact, about, footer)
4. Extract any emails found
5. If still no email → Mark as `NOT_FOUND`

**FR-3.2:** Identify emails from publicly accessible pages only.

**FR-3.3:** Do not guess or invent email addresses.

**FR-3.4:** Return discovered email, its source, and confidence level.

---

### 2.4 Email Validation (Phase 4)

**FR-4.1:** Validate discovered email addresses using free methods:
- Syntax validation (RFC-compliant format)
- Domain validation
- DNS MX record checking
- Disposable email domain detection
- Role email detection

**FR-4.2:** Use only these validation statuses:
- `VALIDATION_PASS` — Email meets all checks
- `VALIDATION_FAIL` — Email fails one or more checks
- `NEEDS_REVIEW` — Email is ambiguous
- `NOT_FOUND` — No email discovered

**FR-4.3:** Never claim an email "definitely exists".

**FR-4.4:** Provide detailed validation reasons.

---

### 2.5 Email Personalization (Phase 5)

**FR-5.1:** Generate personalized email subject and body based on complete lead profile.

**FR-5.2:** Personalization based ONLY on evidence found in pasted data or company research.

**FR-5.3:** Never write statements like "I saw your recent post" unless it exists in extracted data.

**FR-5.4:** Follow email writing style:
- Maximum 350 characters for subject line
- No dashes or em-dashes
- Minimal commas (lists only)
- No abbreviations or shortforms
- Seamless, robust language
- Personalized and compelling
- Start with recipient's first name

**FR-5.5:** Extract and return personalization signals used.

---

### 2.6 MongoDB Integration (NEW - Phase 6)

**FR-6.1:** Store each processed lead in MongoDB with these fields:
- Lead ID (auto-generated UUID)
- Full Name
- Job Title
- Company
- Location
- LinkedIn URL
- Company Website
- Email
- Email Source (LinkedIn, Company Website, etc.)
- Validation Status (PASS, FAIL, NEEDS_REVIEW, NOT_FOUND)
- Validation Details
- Email Confidence (HIGH, MEDIUM, LOW)
- Personalization Signals (JSON)
- Email Subject
- Email Body
- Approval Status (PENDING, APPROVED, REJECTED)
- Processing Status (COMPLETE, ERROR)
- Sent Status (NOT_SENT, DRAFT_CREATED, SENT, BOUNCED)
- Created At (ISO timestamp)
- Updated At (ISO timestamp)
- Sent At (null until actually sent)
- Error Message (null unless error occurred)

**FR-6.2:** Connect to MongoDB Atlas using connection string from environment variable.

**FR-6.3:** Implement database schema validation using Mongoose or similar.

**FR-6.4:** Support CRUD operations (Create, Read, Update, Delete).

**FR-6.5:** Implement database indexing for performance (email, approval status, created date).

---

### 2.7 Web Dashboard (NEW - Phase 7)

**FR-7.1:** Create a complete web dashboard for lead management with these views:

**View 1: Lead Processing**
- Textarea to paste Sales Navigator content
- Submit button to trigger processing
- Real-time progress indicator (7 steps)
- Display extracted lead data
- Display processing results

**View 2: Leads Table**
- Display all leads from MongoDB in a table
- Show columns: Name, Title, Company, Email, Status, Created Date
- Show additional columns (editable): Subject, Body, Approval Status
- Sortable columns (by date, name, status)
- Responsive design (scroll on mobile)

**View 3: Filters & Search**
- Filter by approval status (All, Pending, Approved, Rejected)
- Filter by validation status (Pass, Fail, Needs Review, Not Found)
- Filter by sent status (Not Sent, Sent, Bounced)
- Search by name or email
- Filter by date range (created date)

**View 4: Lead Details & Editing**
- Click on any lead to open detail view
- Edit lead information:
  - Email field
  - Email Subject
  - Email Body
  - Approval Status
  - Any other extracted fields
- Save changes back to MongoDB
- Preview email (formatted)
- Delete lead option

**FR-7.2:** Application must display clear UI with navigation.

**FR-7.3:** Display any errors clearly.

**FR-7.4:** Responsive design (mobile + desktop).

---

### 2.8 Sidebar Navigation (NEW - Phase 7)

**FR-8.1:** Left sidebar with navigation links to:
- Dashboard (home)
- Process New Lead (form)
- My Leads (table view with filters)
- Settings (optional: for future features)

**FR-8.2:** Current page indicator in sidebar.

**FR-8.3:** Responsive sidebar (collapse on mobile).

---

### 2.9 Bulk Operations (NEW - Phase 8)

**FR-9.1:** Support bulk actions on leads:
- Select multiple leads via checkboxes
- Bulk approve/reject
- Bulk delete
- Bulk mark as sent

**FR-9.2:** Confirmation dialog before bulk operations.

---

## 3. NON-FUNCTIONAL REQUIREMENTS

### 3.1 Performance

**NFR-1.1:** Lead processing completes within 30 seconds.

**NFR-1.2:** Dashboard loads initial table within 2 seconds (pagination for 1000+ leads).

**NFR-1.3:** API responses < 1 second for simple queries.

**NFR-1.4:** Database queries optimized with proper indexing.

---

### 3.2 Reliability

**NFR-2.1:** If processing fails, error message is clear and actionable.

**NFR-2.2:** No lead data lost on errors.

**NFR-2.3:** Graceful handling of network failures.

**NFR-2.4:** MongoDB connection pooling for stability.

---

### 3.3 Security

**NFR-3.1:** All API keys and credentials in environment variables.

**NFR-3.2:** MongoDB connection string never hardcoded.

**NFR-3.3:** No sensitive data logged.

**NFR-3.4:** Input validation on all API endpoints.

**NFR-3.5:** Optional: Basic authentication or rate limiting (future phase).

---

### 3.4 Cost

**NFR-4.1:** Free services only where possible.

**NFR-4.2:** MongoDB Atlas free tier (512MB storage).

**NFR-4.3:** Vercel free tier deployment.

**NFR-4.4:** Email validation via free DNS/MX.

**NFR-4.5:** Claude via Claude Code (built-in access).

---

### 3.5 Data Persistence

**NFR-5.1:** All leads permanently stored in MongoDB.

**NFR-5.2:** Database backups (MongoDB Atlas auto-backup).

**NFR-5.3:** Data accessible 24/7 via dashboard.

---

## 4. SCOPE (IN / OUT)

### In Scope
- Sales Navigator lead parsing
- Company research and website identification
- Email discovery
- Free email validation
- Personalized email generation
- MongoDB data storage
- Web dashboard with table view
- Filtering and searching
- Lead editing and deletion
- Bulk operations

### Out of Scope (Phase 2)
- Chrome extension
- Automated LinkedIn navigation
- Gmail integration (draft/send)
- Lead scoring
- A/B testing
- Multiple user accounts/authentication
- Email campaign tracking

---

## 5. TECHNOLOGY STACK

| Component | Technology | Justification |
|-----------|-----------|---------------|
| Frontend | Next.js 14+ (React) | Full-stack framework, easy deployment |
| Backend | Next.js API Routes | Integrated with frontend |
| Database | MongoDB Atlas (Free tier) | 512MB free, sufficient for MVP |
| Database ORM | Mongoose | Type-safe schema validation |
| AI/LLM | Claude (via Claude Code) | Free tier access |
| Email Validation | Node.js built-in DNS | Free, no API dependency |
| Web Research | Claude web search or scraping | Free methods |
| Deployment | Vercel | Free tier |
| Environment | Node.js 18+ | LTS support |

---

## 6. CONSTRAINTS

1. **No Google Sheets** — Use MongoDB instead
2. **No Chrome Extension** — Manual copy-paste input
3. **No Third-party Paid Services** — Free tiers only
4. **Free Deployment** — Vercel free tier
5. **Free Database** — MongoDB Atlas free tier
6. **All Config Externalized** — No hardcoded values
7. **Next.js Only** — Build inside Next.js project
8. **Single Master Prompt** — Claude Code receives one comprehensive instruction

---

## 7. SUCCESS CRITERIA

1. ✅ Complete workflow from lead paste → MongoDB storage with 0 manual steps
2. ✅ All extracted data accurate and properly validated
3. ✅ Email discovery succeeds for 60%+ of leads
4. ✅ Generated emails personalized and relevant
5. ✅ Web dashboard displays all leads in sortable/filterable table
6. ✅ Can edit, delete, approve/reject leads from dashboard
7. ✅ No hardcoded values; all config from environment variables
8. ✅ Deployment works on Vercel free tier
9. ✅ All required phases complete in under 30 seconds per lead
10. ✅ Clear error reporting and user guidance

---

## 8. ASSUMPTIONS

1. User has MongoDB Atlas account (free tier)
2. User has Vercel account
3. User has Claude Code installed
4. Network connectivity available
5. API rate limits sufficient for daily use

---

## 9. DEPENDENCIES

- Next.js 14+
- React 18+
- Node.js 18+
- MongoDB Atlas (free tier)
- Mongoose for MongoDB
- Claude API access (via Claude Code)
- Node.js DNS libraries

---

## 10. DATA MODEL (MONGODB SCHEMA)

```javascript
{
  _id: ObjectId,
  
  // Lead Information
  fullName: String,
  linkedinProfileUrl: String,
  headline: String,
  currentTitle: String,
  currentCompany: String,
  currentCompanyLinkedInUrl: String,
  currentCompanyWebsite: String,
  location: String,
  currentRoleStartDate: String,
  
  // Extracted Data
  about: String,
  experience: [String],
  education: [String],
  skills: [String],
  recentActivity: [String],
  
  // Email Information
  email: String,
  emailSource: String, // 'LINKEDIN' | 'COMPANY_WEBSITE' | 'NOT_FOUND'
  emailConfidence: String, // 'HIGH' | 'MEDIUM' | 'LOW'
  validationStatus: String, // 'PASS' | 'FAIL' | 'NEEDS_REVIEW' | 'NOT_FOUND'
  validationDetails: String,
  
  // Personalization
  personalizationSignals: Object,
  
  // Email Generation
  emailSubject: String,
  emailBody: String,
  
  // Status Tracking
  approvalStatus: String, // 'PENDING' | 'APPROVED' | 'REJECTED'
  processingStatus: String, // 'COMPLETE' | 'ERROR'
  sentStatus: String, // 'NOT_SENT' | 'DRAFT_CREATED' | 'SENT' | 'BOUNCED'
  errorMessage: String,
  
  // Timestamps
  createdAt: Date,
  updatedAt: Date,
  sentAt: Date,
  
  // Processing
  processingTimeMs: Number,
  sourceText: String // Original pasted content
}
```

