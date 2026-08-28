# TASKS DOCUMENT (UPDATED)
## LinkedIn Sales Navigator Lead Research & Outreach Automation System - MongoDB Edition

**Project:** Next.js Lead Intelligence Engine  
**Database:** MongoDB Atlas (Free Tier)  
**Total Phases:** 10  
**Total Tasks:** Main tasks + subtasks  

---

## PHASE 1: PROJECT SETUP & CONFIGURATION

### Task 1.1: Initialize Environment Configuration

**Task Name:** Environment Variables & Configuration Setup

**Detailed Description:**
Set up all environment variables and configuration files. Create `.env.local` with all necessary API keys and MongoDB connection string.

**Edge Cases:**
- Missing or invalid environment variables
- Invalid MongoDB connection string format
- .env.local file not found
- Special characters in connection string
- Different environments (development vs production)

**Exact Completion Conditions:**
1. `.env.local` file exists with all required variables
2. All required environment variables defined
3. MongoDB connection string validated
4. No hardcoded credentials
5. Configuration file loads without errors
6. TypeScript types defined for environment variables
7. Development and production configurations separated

**How to Check the Task:**
```bash
ls -la .env.local
grep "MONGODB_URI\|NEXT_PUBLIC\|NODE_ENV" .env.local
grep -r "mongodb+srv\|password" src/ --exclude-dir=node_modules | grep -v "process.env"
```

**How AI Should Verify Functionality:**
1. Load configuration at startup
2. Check MongoDB connection string is valid format
3. Test connection to MongoDB Atlas
4. Verify all required variables accessible
5. No errors when accessing environment variables

**How AI Should Confirm Task Completion:**
- Create test file that validates all environment variables
- Run test and confirm all variables load successfully
- Log: "✓ All X environment variables loaded and validated"
- Test MongoDB connection: "✓ MongoDB Atlas connection successful"

---

### Task 1.2: Set Up TypeScript Configuration & Project Structure

**Task Name:** TypeScript & Project Directory Structure

**Detailed Description:**
Configure TypeScript with strict mode, set up Next.js structure, and define core data types for MongoDB documents.

**Edge Cases:**
- TypeScript strict mode conflicts
- Circular dependencies
- Incorrect path aliases
- Missing type definitions for Mongoose
- MongoDB ObjectId type handling

**Exact Completion Conditions:**
1. `tsconfig.json` configured with strict mode
2. Directory structure: `/src/lib/{parser,research,email,validation,db,types}`
3. MongoDB directory: `/src/lib/db/{models,schemas}`
4. TypeScript interfaces for Lead, Company, Email, ValidationResult
5. Mongoose model definitions for Lead document
6. No TypeScript errors
7. All files are `.ts` or `.tsx`

**How AI Should Verify Functionality:**
1. Compile TypeScript without errors
2. Type checking works correctly
3. Mongoose models can be imported

**How AI Should Confirm Task Completion:**
- Compilation succeeds: `npx tsc --noEmit` returns no errors
- Mongoose models exported and documented
- Log: "✓ TypeScript configuration and project structure complete"

---

## PHASE 2: MONGODB SETUP

### Task 2.1: Configure MongoDB Connection

**Task Name:** MongoDB Atlas Connection & Mongoose Setup

**Detailed Description:**
Set up MongoDB Atlas connection, implement Mongoose connection pool, and handle connection lifecycle.

**Edge Cases:**
- Connection timeout
- Invalid connection string
- MongoDB Atlas IP whitelist
- Network connectivity issues
- Connection pool exhaustion
- Duplicate key errors on create

**Exact Completion Conditions:**
1. MongoDB connection string from environment variable
2. Mongoose connected on app startup
3. Connection pooling configured
4. Error handling for connection failures
5. Graceful shutdown of connection
6. Connection retry logic
7. Database selected correctly

**How to Check the Task:**
```bash
# Test connection
node -e "require('./src/lib/db/connection.ts').testConnection()"
```

**How AI Should Verify Functionality:**
1. Test connection to MongoDB Atlas
2. Create test document
3. Query test document
4. Delete test document
5. Verify connection pooling works

**How AI Should Confirm Task Completion:**
- Connection successful: "✓ MongoDB connection established"
- Test CRUD operations successful
- Log: "✓ MongoDB connection and pooling configured"

---

### Task 2.2: Define Mongoose Schemas and Models

**Task Name:** Mongoose Lead Document Schema

**Detailed Description:**
Define Mongoose schema for Lead document with all required fields, validation, and indexes.

**Edge Cases:**
- Missing required fields
- Invalid field types
- Duplicate emails
- Large document sizes
- Special characters in fields
- Nested objects validation

**Exact Completion Conditions:**
1. Mongoose schema with all 20+ fields
2. Required field validation
3. Field type enforcement
4. Indexes on: email, approval status, created date
5. Timestamps (createdAt, updatedAt) automatic
6. Default values for statuses
7. Pre-save hooks for validation
8. Schema exported as Mongoose model

**How AI Should Verify Functionality:**
1. Create lead document
2. Query by email
3. Update fields
4. Delete document
5. Verify timestamps

**How AI Should Confirm Task Completion:**
- Schema created and validated: "✓ Mongoose Lead schema defined"
- All indexes created
- Log: "✓ Lead model ready for CRUD operations"

---

## PHASE 3: LEAD PARSER MODULE

### Task 3.1: Build Input Parser

**Task Name:** Sales Navigator Lead Content Parser

**Detailed Description:**
Build parser that accepts pasted Sales Navigator content and extracts 14 fields.

**Edge Cases:**
- Missing sections
- Malformed URLs
- Non-Latin characters
- HTML entities
- Very long text
- Duplicate information

**Exact Completion Conditions:**
1. Parser accepts pasted content as string
2. Returns structured Lead object
3. All 14 core fields extracted
4. Handles missing sections
5. Marks uncertain data as "UNCERTAIN"
6. Tolerates HTML, Markdown, mixed formats
7. Unit tests pass with Gus Gollings sample
8. No fabricated data

**How AI Should Confirm Task Completion:**
- All unit tests pass
- Parser output matches expected structure for sample
- Log: "✓ Sales Navigator parser complete, 14 fields extracted"

---

## PHASE 4: COMPANY RESEARCH MODULE

### Task 4.1: Build Company Research Engine

**Task Name:** Company Research & Website Discovery

**Detailed Description:**
Research company and identify official website.

**Edge Cases:**
- Generic company names
- Multiple websites
- Unreachable sites
- Timeouts
- Outdated information

**Exact Completion Conditions:**
1. Module accepts company name, location, optional website
2. Returns company info with confidence level
3. Verifies provided website
4. Researches and identifies official website if missing
5. Inspects public pages
6. No fabricated information

**How AI Should Confirm Task Completion:**
- Company research tests pass
- Sample companies correctly identified
- Log: "✓ Company research module complete"

---

## PHASE 5: EMAIL DISCOVERY & VALIDATION

### Task 5.1: Build Email Discovery Engine

**Task Name:** Email Discovery from Company Data

**Detailed Description:**
Follow decision tree to discover email from lead contact info or company website.

**Edge Cases:**
- No email found
- Multiple emails
- Obfuscated emails
- Email images
- Contact form only

**Exact Completion Conditions:**
1. Follows strict decision tree
2. Returns NOT_FOUND if no email
3. Includes confidence level
4. Logs all pages searched
5. No fabricated emails

**How AI Should Confirm Task Completion:**
- Email discovery tests pass
- Log: "✓ Email discovery module complete"

---

### Task 5.2: Build Email Validation Engine

**Task Name:** Email Validation using DNS/MX

**Detailed Description:**
Validate email using free DNS/MX checks only.

**Edge Cases:**
- Disposable emails
- Role emails
- Invalid domains
- DNS timeouts
- New domains

**Exact Completion Conditions:**
1. Syntax validation
2. Domain verification
3. MX record checking
4. Disposable domain detection
5. Role email detection
6. Status values: PASS, FAIL, NEEDS_REVIEW, NOT_FOUND
7. No paid APIs
8. Detailed reasons for pass/fail

**How AI Should Confirm Task Completion:**
- Validation tests pass
- No paid email APIs found
- Log: "✓ Email validation module complete"

---

## PHASE 6: EMAIL GENERATION

### Task 6.1: Build Email Generation Engine

**Task Name:** AI-Powered Personalized Email Generation

**Detailed Description:**
Generate personalized subject and body using Claude, based only on evidence from extracted data.

**Edge Cases:**
- Lead with minimal data
- No recent activity
- Generic skills
- Uncertain signals
- Missing company info

**Exact Completion Conditions:**
1. Subject max 350 chars
2. Body follows writing style rules
3. Only mentions actual evidence
4. No fabricated signals
5. Includes confidence level
6. Documents signals used

**How AI Should Confirm Task Completion:**
- Generation tests pass
- Sample emails reviewed for fabrication
- Log: "✓ Email generation module complete"

---

## PHASE 7: MONGODB INTEGRATION (REPLACE GOOGLE SHEETS)

### Task 7.1: Build Lead Creation & Storage

**Task Name:** Save Processed Leads to MongoDB

**Detailed Description:**
Create function to save complete ProcessingResult to MongoDB Lead document.

**Edge Cases:**
- Duplicate emails
- Connection failures
- Large field values
- Missing fields
- Validation errors

**Exact Completion Conditions:**
1. Function accepts ProcessingResult
2. Creates new Lead document in MongoDB
3. All 20+ fields saved
4. Auto-generated Lead ID (UUID)
5. Timestamps created automatically
6. Default statuses set (PENDING, NOT_SENT, COMPLETE)
7. Error handling
8. Returns saved document with _id

**How to Check the Task:**
```bash
npm run test -- src/lib/db/__tests__/create.test.ts
```

**How AI Should Verify Functionality:**
1. Create test lead
2. Verify in MongoDB
3. Query by email
4. Verify all fields present
5. Check timestamps

**How AI Should Confirm Task Completion:**
- Creation tests pass
- Test lead visible in MongoDB Atlas
- Log: "✓ Lead creation and storage working"

---

### Task 7.2: Build Lead Read & Query Operations

**Task Name:** Retrieve Leads from MongoDB

**Detailed Description:**
Create functions to fetch leads with filtering and pagination.

**Edge Cases:**
- Large result sets
- Complex filters
- Invalid query parameters
- Sorting issues
- Pagination edge cases

**Exact Completion Conditions:**
1. Function to get all leads with pagination
2. Function to get lead by ID
3. Function to filter by approval status
4. Function to filter by validation status
5. Function to filter by sent status
6. Function to search by name or email
7. Function to sort by various fields
8. Support for date range filters
9. Limit results (for performance)

**How AI Should Confirm Task Completion:**
- Read operations tests pass
- Filters work correctly
- Pagination works
- Log: "✓ Lead read and query operations complete"

---

### Task 7.3: Build Lead Update Operations

**Task Name:** Update Leads in MongoDB

**Detailed Description:**
Create functions to update individual lead fields.

**Edge Cases:**
- Invalid updates
- Partial updates
- Field validation
- Timestamp updates
- Approval status changes

**Exact Completion Conditions:**
1. Function to update email field
2. Function to update email subject
3. Function to update email body
4. Function to update approval status
5. Function to update sent status
6. Function to update any field safely
7. Validation before saving
8. UpdatedAt timestamp automatic
9. Error handling for invalid updates

**How AI Should Confirm Task Completion:**
- Update tests pass
- Changes verified in database
- Log: "✓ Lead update operations complete"

---

### Task 7.4: Build Lead Deletion Operations

**Task Name:** Delete Leads from MongoDB

**Detailed Description:**
Create function to delete individual leads or bulk delete.

**Edge Cases:**
- Deleting non-existent lead
- Bulk delete edge cases
- Confirmation needed
- Restore requirements

**Exact Completion Conditions:**
1. Function to delete single lead by ID
2. Function to delete multiple leads
3. Soft delete option (mark as deleted, not remove)
4. Confirmation message before deletion
5. Error handling

**How AI Should Confirm Task Completion:**
- Deletion tests pass
- Leads removed from database
- Log: "✓ Lead deletion operations complete"

---

### Task 7.5: Create MongoDB Integration Tests

**Task Name:** MongoDB CRUD Operations Tests

**Exact Completion Conditions:**
1. Test file: `src/lib/db/__tests__/crud.test.ts`
2. Minimum 12 test cases:
   - Create new lead
   - Read lead by ID
   - Read all leads
   - Filter by approval status
   - Filter by validation status
   - Search by email
   - Update email field
   - Update approval status
   - Sort by date
   - Paginate results
   - Delete lead
   - Handle connection errors
3. All tests pass
4. Coverage minimum 80%

**How AI Should Confirm Task Completion:**
- Log: "✓ 12/12 MongoDB CRUD tests passing, 81% coverage"

---

## PHASE 8: WEB DASHBOARD - LEAD PROCESSING PAGE

### Task 8.1: Build Lead Processing Input Page

**Task Name:** Main Lead Processing UI Component

**Detailed Description:**
Create page where users paste Sales Navigator content and trigger processing.

**Exact Completion Conditions:**
1. Page route: `/app/process`
2. Textarea input for content
3. Submit button
4. Real-time progress indicator (7 steps)
5. Results display
6. Error handling
7. Link to view lead in dashboard

**How AI Should Confirm Task Completion:**
- Page loads without errors
- Full workflow completes
- Results display correctly
- Log: "✓ Lead processing page complete"

---

## PHASE 9: WEB DASHBOARD - LEADS TABLE & MANAGEMENT

### Task 9.1: Build Leads Table View

**Task Name:** Display All Leads in Table

**Detailed Description:**
Create table displaying all leads from MongoDB with columns and features.

**Exact Completion Conditions:**
1. Page route: `/app/leads` or `/app/dashboard`
2. Display all leads in table format
3. Columns: Name, Title, Company, Email, Validation Status, Approval Status, Created Date
4. Sortable columns
5. Pagination (50 leads per page)
6. Loading state
7. Empty state (no leads)
8. Responsive design (scroll on mobile)
9. Click row to view details

**How AI Should Verify Functionality:**
1. Load dashboard
2. Verify table displays leads
3. Test sorting
4. Test pagination
5. Test responsive view

**How AI Should Confirm Task Completion:**
- Table displays correctly
- All features working
- Log: "✓ Leads table view complete"

---

### Task 9.2: Build Filters & Search

**Task Name:** Filter and Search Leads

**Detailed Description:**
Implement filters and search functionality in dashboard.

**Exact Completion Conditions:**
1. Filter by approval status (Pending, Approved, Rejected, All)
2. Filter by validation status (Pass, Fail, Needs Review, Not Found, All)
3. Filter by sent status (Not Sent, Sent, Bounced, All)
4. Search by name or email
5. Filter by date range
6. Reset filters button
7. Filter UI intuitive and responsive
8. Apply filters in real-time
9. URL preserves filter state (optional)

**How AI Should Confirm Task Completion:**
- All filters work correctly
- Filters can be combined
- Search works accurately
- Log: "✓ Filters and search complete"

---

### Task 9.3: Build Lead Details & Editing Modal

**Task Name:** View and Edit Lead Details

**Detailed Description:**
Create modal/page to view and edit individual lead.

**Exact Completion Conditions:**
1. Click lead row to open details
2. Display all lead fields
3. Editable fields:
   - Email
   - Email Subject
   - Email Body
   - Approval Status
4. Save changes button
5. Delete lead button
6. Preview email (formatted)
7. Confirmation before delete
8. Error handling on save
9. Success message on update

**How AI Should Confirm Task Completion:**
- Can open details
- Can edit fields
- Changes save to MongoDB
- Can delete lead
- Log: "✓ Lead details and editing complete"

---

### Task 9.4: Build Sidebar Navigation

**Task Name:** Navigation Sidebar

**Detailed Description:**
Create left sidebar with navigation links.

**Exact Completion Conditions:**
1. Sidebar with links to:
   - Dashboard (home)
   - Process New Lead
   - My Leads (table)
   - Settings (optional)
2. Current page indicator
3. Responsive (collapse on mobile)
4. User-friendly icons
5. Mobile hamburger menu

**How AI Should Confirm Task Completion:**
- Sidebar renders
- Links work
- Responsive on mobile
- Log: "✓ Navigation sidebar complete"

---

## PHASE 10: TESTING & DEPLOYMENT

### Task 10.1: Create End-to-End Test Suite

**Task Name:** Complete Workflow E2E Tests

**Detailed Description:**
Test complete flow from lead paste to MongoDB storage to dashboard view.

**Exact Completion Conditions:**
1. Test file: `__tests__/e2e.test.ts`
2. Test scenarios:
   - Happy path: Paste → Process → Save → Display
   - Process and view in dashboard
   - Edit lead in dashboard
   - Delete lead from dashboard
   - Filter leads in dashboard
   - Search leads
   - Update approval status
   - Verify data persisted in MongoDB
3. All tests pass
4. Processing time < 30 seconds per lead
5. No data loss on errors

**How AI Should Confirm Task Completion:**
- All E2E tests pass
- Processing time verified
- Log: "✓ End-to-End testing complete, all scenarios passing"

---

### Task 10.2: Create UI Component Tests

**Task Name:** UI Component Tests

**Exact Completion Conditions:**
1. Test all React components
2. Test component rendering
3. Test user interactions
4. Test data display
5. Test error states
6. Coverage minimum 75%

**How AI Should Confirm Task Completion:**
- All UI tests pass
- Log: "✓ UI component tests passing, X% coverage"

---

### Task 10.3: Performance & Security Verification

**Task Name:** Performance & Security Validation

**Exact Completion Conditions:**
1. Average lead processing < 30 seconds
2. Dashboard loads < 2 seconds (with pagination)
3. No hardcoded secrets
4. All config from environment
5. Sensitive data not logged
6. MongoDB connection secure
7. Input validation on API routes
8. Error rate < 1%

**How AI Should Confirm Task Completion:**
- Performance tests pass
- Security audit passed
- Log: "✓ Performance and security requirements met"

---

### Task 10.4: Deploy to Vercel

**Task Name:** Production Deployment

**Exact Completion Conditions:**
1. Repository connected to Vercel
2. All environment variables configured
3. Automatic deployments enabled
4. Production build succeeds
5. Application accessible via Vercel URL
6. All functionality works in production
7. MongoDB accessible from production
8. No console errors in production

**How AI Should Confirm Task Completion:**
- Deployment succeeds
- App accessible at Vercel URL
- All features work
- Log: "✓ Vercel deployment complete and verified"

---

### Task 10.5: Final Verification & Completion Report

**Task Name:** Complete System Verification

**Exact Completion Conditions:**
1. All 10 phases complete
2. All tasks completed
3. All unit tests pass (80%+ coverage)
4. E2E tests pass
5. No TypeScript errors
6. No console errors
7. No hardcoded secrets
8. Deployed to Vercel
9. Real lead can be processed end-to-end
10. Data appears in dashboard
11. Dashboard is fully functional
12. Final report generated

**How AI Should Confirm Final Completion:**
Generate completion report showing all metrics and that project is production-ready.

---

## SUMMARY

**Total Phases:** 10  
**Total Main Tasks:** 25+  
**Total Subtasks:** 40+  
**Expected Duration:** 4-6 hours (automated)  
**Expected Test Coverage:** >80%  
**Expected Success Rate:** 100%

