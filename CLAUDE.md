@AGENTS.md

# LeadForge

**LeadForge** is the product name. Write it as one word with a capital L and F (npm package: `leadforge`). Use it everywhere in the UI, metadata and docs. The repo folder is still called `linkedin-leads-automation`.

LeadForge is a single-user Next.js app for cold outreach. You paste raw LinkedIn / Sales Navigator profile text. The app then:

1. extracts the person and their current companies with an LLM,
2. maps URLs to companies and crawls those sites for emails and phone numbers,
3. verifies each email with DNS/MX checks and an SMTP handshake,
4. writes a personalized HTML email per company, plus a personal one,
5. lets you approve drafts, group them into campaigns and send them one at a time over SMTP with random delays between sends.

Data is stored in MongoDB (Mongoose). There is no auth: every route is open.

## Commands

```bash
npm run dev            # next dev (localhost:3000)
npm run build          # next build
npm run lint           # eslint (flat config, eslint-config-next)
npm test               # jest (all unit/integration tests)
npx jest path/to/file.test.ts          # single test file
npx jest -t "name of test"             # single test by name
npm run test:coverage
npm run test:e2e       # playwright; needs the dev server running (E2E_BASE_URL overrides localhost:3000)
npm run brand:assets   # regenerate every icon in public/ from src/lib/brand/logo.ts
```

`postinstall` runs `playwright install chromium`. Chromium is used by the e2e tests and by the optional headless-render fallback in `src/lib/research/browserFetch.ts`.

## Stack and versions

- **Next.js 16.3 (App Router), React 19.2, TypeScript strict, Tailwind v4** (via `@tailwindcss/postcss`, no tailwind config file).
- Next 16 conventions used throughout. Route handler `params` is a **Promise** (`{ params }: { params: Promise<{ id: string }> }` → `const { id } = await params`). Background work after the response uses `after()` from `next/server`. Client pages read params with `use(params)`.
- **Mongoose 9**, **LangChain** (`@langchain/groq`, `@langchain/openai`, `@langchain/ollama`), **nodemailer**, `validator`, `zod`.
- Path alias: `@/*` → `src/*`.

## Two pipelines live side by side

The codebase has a **current** system and an **older legacy** system. Know which one you are touching.

### 1. Current: Lead Ingestion (the sidebar app)

Models: `Client`, `LeadIngestion`, `Campaign`, `PromptSetting`. Code lives in `src/services/lead-ingestion/`, `src/app/api/{lead-ingestion,clients,campaigns,settings}/`, `src/components/lead-ingestion/` and `src/app/lead-ingestion/`.

**Flow:**
- `/lead-ingestion` (`LeadIngestionPage`) is a **two-step intake: preview, then confirm**. Nothing is written until the user confirms.
  1. `POST /api/lead-ingestion/preview` → `intake.previewIngestion`: validates the text (`lib/validation/ingestionInput.ts`: 40–50,000 chars, at least four words), runs `extractWithAi`, and returns what was found plus `warnings` and any `duplicate` (same text hash). It **writes nothing**, so a bad paste costs one model call and no records.
  2. `POST /api/lead-ingestion/confirm` → `intake.createLeadFromPreview`: re-sanitises the extraction the browser sends back against the pasted text, refuses a duplicate with 409 unless `force`, allocates `"<Name> #NN"` through an atomic counter (`clientcounters`), saves `Client` + `LeadIngestion`, and **deletes the client again if the lead insert fails**. Then it starts the pipeline with `after()` and returns the lead id.
- Both endpoints are rate limited per IP (`lib/api/rateLimit.ts`) and reject oversized bodies early.
- `/lead-ingestion/client/[id]`: **watches** the pipeline (polls `GET /api/lead-ingestion/[id]` every 3s) instead of driving it, and shows a Retry when it fails. `POST /api/lead-ingestion/[id]/resume` restarts a stalled run; the page calls it on load and when nothing has moved for a while.
- **The pipeline** (`src/services/lead-ingestion/pipeline.ts`) runs on the server after the lead is created, so closing the tab no longer strands it. Stages, each saved as it finishes so a cut-short run resumes where it stopped: `mapping` → `crawling` → `verifying` → `generating` → `done` (or `failed` with `pipelineError`). `runIngestionPipeline` claims the lead through `pipelineStartedAt`; a claim older than `STALE_RUN_MS` (3 min) is treated as dead and can be taken over, which is what makes resume safe. Stages write with **atomic `updateOne`, never `document.save()`** — the page can save an edit mid-run, and a long-held document would fail Mongoose's version check and strand the lead.
  - `mapping`: `mapUrlsToCompaniesWithAi` assigns each URL to a company or marks it as the portfolio site.
  - `crawling`: `emailFinder.findEmailsOnWebsite` for at most 3 sites, each first passed through `toSafePublicUrl` so a pasted profile can never point the crawler at localhost or a private address. Per site it fetches the homepage, up to 3 JS bundles, and nav/footer links; it asks the AI to pick contact pages and also tries fixed paths like `/contact`, crawling up to 8 pages. Afterwards `mapEmailsToCompanies` sorts emails by domain into company and personal ones.
  - `verifying`: `smtpVerifier.verifyEmailSmtp`.
  - `generating`: `emailGenerator.generateLeadEmail(..., { forceRegenerate: true })`. Every email (first time and on regenerate, including the lead page's "Ask AI to refine" bar) takes **two LLM calls**: step 1 writes it with the writing prompt, step 2 (`checkEmailFormat`) checks and fixes only its format with the format check prompt. Step 2 is skipped when that prompt is saved empty, and its answer is thrown away (keeping step 1's draft) if every model fails or `keepsWording` sees the wording changed (under 85% of words kept, or over 25% + 10 added). The fixed guards (plain one-line subject, dashes stripped, 350-char cap, `Hi FirstName` opening) run after both steps. The Drafts page "AI refine" (`refineEmailWithAi`) uses neither prompt.
- **Pasted text is untrusted.** `extractWithAi` frames it as data in the prompt and then checks the model's answer against the source: an email, URL or phone number that is not literally in the pasted text is dropped (`sanitizeExtraction`), so an injected `ceo@victim.com` is never stored and an invented host is never crawled. `usedFallback` records when every model failed and the regex parser produced the data; that lead is marked `extractionSource: 'regex_fallback'` and the page shows a warning.
- `/lead-ingestion/emails` (`OutreachEmailsPage` → `components/lead-ingestion/drafts/`): review, edit, AI-refine and approve drafts across all clients. **The unit here is a draft box, not a lead** (`DraftItem`, `src/services/lead-ingestion/draftItems.ts`: pure builders/filters/counters shared by the API and the UI; `companyIndex -1` = personal).
  - `GET /api/lead-ingestion/drafts` flattens leads into draft items server-side and filters, counts and **paginates per item**, so "Drafts only" never shows an approved box and a page is never silently empty. Filter values: `approval`, `smtp` (valid/unverified/invalid/no_contact_email, where "valid" means valid **or risky**), `sendStatus`, `clientId`, `search` (includes subjects and bodies). It scans at most 1000 leads and reports `truncated`.
  - Writes go through **targeted** endpoints, never the whole-document PUT: `PATCH /api/lead-ingestion/[id]/draft` (subject/body/approved/websiteUrl of one box) and `POST /api/lead-ingestion/[id]/draft-email` (add/remove/replace/verify one address, rate limited, real SMTP verification for company boxes too). Both live in `services/lead-ingestion/draftWrites.ts`, which enforces the approval rule (`approvalEligibility`), blocks edits to a box that is in a campaign, sanitizes the body (`lib/utils/sanitizeHtml.ts`) and re-checks approval when contacts change. Never rebuild `currentCompanies` from client data: that is what used to wipe `inCampaign`/`campaignSendStatus`.
  - The editor (`DraftEditorModal`) always re-reads the draft from `GET …/draft?companyIndex=` when it opens, so it can't save stale content over someone else's change. Filters live in the URL; the list cancels in-flight requests on every filter change.
- `/lead-ingestion/approved` (`ApprovedEmailsPage`): pick approved drafts and create a campaign.
- `/lead-ingestion/campaigns` and `/lead-ingestion/campaigns/[id]`: campaign list and runner.
- `/lead-ingestion/prompt` (`PromptSettingsPage` + `PromptEditorModal`): one card per editable prompt; clicking a card opens a near full-screen editor (Esc closes, Ctrl/Cmd+S saves, "Reset to default"). Prompts are defined in **`src/services/prompts/definitions.ts`** (`PROMPT_DEFINITIONS`: key, title, description, stage, default text) and stored one `PromptSetting` document per `key`; `getPromptText(key)` in `promptStore.ts` returns the saved text, or the default if never saved (a prompt saved empty stays empty, which turns that step off). API: `GET /api/settings/prompts`, `PUT /api/settings/prompts/[key]`. To add a prompt, add a definition and read it with `getPromptText`; the page lists it automatically. Current prompts:
  - `global_outreach_prompt` (Email writing prompt): the **only** sender context for current-pipeline emails (who the sender is, pitch, tone, sign-off and contact details). There is no sender profile in the current pipeline; `lib/config/senderProfile.ts` is used only by the legacy pipeline.
  - `email_format_check_prompt` (Email format check prompt): the structure and spacing rules for step 2. The default wants one `<p>` per paragraph and no empty `<p></p>` spacers, since `.email-body` in the app and `withParagraphSpacing` on send already put a blank line between paragraphs.

**`LeadIngestion` document shape (important):**
- Top-level fields describe the person and their **personal** outreach draft: `email`, `discoveredEmails`, `portfolioUrl`, `emailSubject`, `emailBody`, `approved`, `inCampaign`, `campaignSendStatus` and `emailStatus`.
- `currentCompanies[]` holds one "box" per current role, each with its own `websiteUrl`, `companyEmails`, `emailSubject`, `emailBody`, `approved`, `inCampaign` and `campaignSendStatus`.
- `verifiedEmails[]` = `{ email, status: pending|valid|invalid|risky|unknown }` for every email, personal or company.
- Intake and pipeline bookkeeping: `rawTextHash` (SHA-256 of the pasted text, for duplicate detection), `extractionSource` (`ai` | `regex_fallback`), `pipelineStage`, `pipelineStartedAt` (the run's claim) and `pipelineError`.
- **`companyIndex` convention** (used across API bodies, campaign items and UI state): `-1` = the personal draft/box, `>= 0` = index into `currentCompanies`, `undefined` = all (for generation: every company plus the personal draft).
- After mutating `currentCompanies` or other arrays in place, call `doc.markModified('currentCompanies')` (existing code does this everywhere). Placeholder names `'Unspecified Company'`, `'Unknown Company'` and the title `'Professional'` are treated as "no value" and never overwrite real data.

**Campaign sending:** `POST /api/campaigns/[id]/dispatch-batch` sends **exactly one** pending item per call (or failed ones too with `rerunFailed`). It updates the item status, recomputes the campaign counters and mirrors the status back onto the lead or company box. The **random delay between sends lives in the browser**: `runCampaignLoop` in `app/lead-ingestion/campaigns/[id]/page.tsx` counts down between `minDelaySeconds` and `maxDelaySeconds`. Closing the tab stops the campaign; there is no server-side scheduler. Open tracking is a 1×1 GIF at `GET /api/lead-ingestion/[id]/track?campaignId=&itemId=`, added only when `ENABLE_OPEN_TRACKING=true`. Each campaign item records `sentAt` on delivery, `openedAt` on open and `failedAt` on failure. The dashboard buckets activity by these timestamps.

**Dashboard** (`/dashboard`, `src/components/dashboard/`, `GET /api/dashboard`, `src/services/dashboard/`):
- **How the date range works:** the browser resolves the preset (Today / 7 days / 30 days / All time / Custom, kept in the URL as `?range=…&from=…&to=…`) into ISO instants in its own time zone. It sends them with `tz`, and the server buckets the chart in that zone (`timeBuckets.ts`).
- **What each number is filtered by:**
  - Lead metrics (KPIs, funnel, verification, drafts, research, recent leads) cover **leads imported in the range** (`LeadIngestion.createdAt`).
  - Sending metrics cover **emails sent, opened or failed in the range**.
  - The queue size and the campaign list/status counts are current state, not filtered.
- **Deltas** compare against the previous period of the same length; all time has none.
- **Funnel:** each step is counted independently. Every lead gets a personal draft, even one with no email, so the steps are not cumulative.
- **Code layout:** `summarizeLeads` / `summarizeCampaigns` / `buildSeries` in `dashboardStats.ts` are pure and unit-tested. The DB work is one `$project` aggregation per range that turns subjects and bodies into booleans, plus one light campaign query.

### 2. Legacy: Lead processing / enrichment

Model: `Lead` (collection `leads`). Code lives in `src/lib/{processLead.ts,parser,research,email,enrichment,db/operations}` and routes `POST /api/process`, `/api/leads/[id]` (GET/PUT/DELETE), `/api/leads/[id]/{enrich,emails,find-website}`, `/api/leads/search` and `/api/leads/filter`. The UI is `/process` (`LeadProcessingPage`) and `components/leads/*`. The sidebar does not link to `/process`. There is no page at `/`: `next.config.ts` redirects it (307) to `/dashboard`, the current-pipeline dashboard and the app's home page.

- `processLeadContent`: `extractLeadWithAi` (falls back to the regex `parseLeadContent`) → `researchCompany` → `discoverEmail` → `validateEmail` → `generatePersonalizedEmail`. `/api/process` saves the lead, then runs `enrichLead` via `after()`. That crawls with robots.txt support (`research/crawler.ts`, `robots.ts`), searches DuckDuckGo, verifies the website with AI and validates emails. `enrichLead` claims the lead atomically through `enrichmentStatus`, so don't reset that status before calling it.

**Gotcha:** `GET` / `DELETE /api/leads` (`src/app/api/leads/route.ts`) were repointed to **`LeadIngestion`** (used by `/my-leads`, `OutreachEmailsPage` and `ApprovedEmailsPage`, with filters like `clientId`, `approved`, `emailStatus`, `from`/`to` and `search`). Every other `/api/leads/*` route and `src/lib/api/client.ts` (`fetchLeads`, `updateLeadApi`, …) still use the legacy `Lead` model. Check which model a route uses before changing it.

### The leads list API and `/my-leads`

`GET /api/leads` is one aggregation built by **`src/lib/leads/query.ts`** (`parseLeadListQuery` → `buildLeadPipeline`), so filtering, counting and paging always agree. Points to keep:

- **Filter on the server only.** The two box-level statuses (`unapproved_verified_smtp`, `missing_or_unverified`) are computed in the pipeline (`_personalVerified`, `_allCompaniesVerified`, `_anyBoxIncomplete`). Re-filtering the rows in the browser is what used to make "Showing N" disagree with the database.
- **Dates are instants.** The browser resolves Today / 7 days / custom in its own time zone (`resolveRange` in `src/lib/leads/listFilters.ts`) and sends `from`/`to` as ISO instants. The server never builds a day boundary itself. Bad input (unparsable date, `from` after `to`, malformed `clientId`) is a 400, never silently dropped.
- **Search** is an AND of up to 6 words, case- and accent-insensitive (`searchPattern`), over names, companies, emails and URLs. `rawText` is deliberately not searched: matching the whole pasted profile made unrelated leads appear.
- `limit` is clamped to 200. `view=cards` returns only what the lead cards need plus `rawLinkedinUrl` (one `$regexFind`), which is ~10× smaller than the full documents the Drafts pages still get.
- `DELETE` validates every id (422), returns 404 when nothing matched, and cascades: campaign items for the lead are pulled, the campaign counters and status are recomputed the same way `dispatch-batch` does, and clients left without a lead are removed. It answers `{ deletedCount, removedCampaignItems, removedClients }`.
- The page is `src/components/my-leads/MyLeadsPage.tsx` (+ `LeadCard`, `LeadFilters`). Filters live in the URL (`q`, `status`, `client`, `range`, `from`, `to`), one request per query change through an `AbortController` with a request id, and "Load more" appends a page. Card presentation rules are pure functions in **`src/lib/leads/cards.ts`**: a status badge belongs to that exact address (never borrowed from another email), placeholder values ('Unspecified Company', 'Professional') are dropped instead of displayed, and no company box is invented for a lead that has none.

## AI provider layer (`src/lib/ai/provider.ts`)

- `getFallbackChatModels(temperature)` is what nearly everything uses. It returns a chain: Groq primary (`getGroqModelName()`, default `openai/gpt-oss-120b`) → Groq `openai/gpt-oss-20b` → OpenAI (only if `OPENAI_API_KEY` is set). This chain is **always Groq-first no matter what `AI_PROVIDER` says**.
- `getChatModel()` respects `AI_PROVIDER` (`groq` | `openai` | `ollama`). Only legacy `processLead` uses it.
- `getGroqModelName()` swaps retired model IDs (e.g. `llama-3.3-70b-versatile`) for the default.
- Pattern for every LLM call: loop over models → `invoke(prompt)` → pull text out (string, or an array of content parts) → regex out the `{...}` JSON → `JSON.parse` → on any failure try the next model → finally fall back to a deterministic regex/heuristic path, or throw. Prompts ask for strict JSON only.
- For testability, AI functions accept an injected `models` array (`{ invoke(prompt) }`). Tests pass fakes instead of mocking LangChain.
- Generated emails are HTML. The code forces a `<p>Hi FirstName,</p>` opening, removes dashes and em-dashes from subjects and caps subjects at 350 chars. In the current pipeline (`emailGenerator.ts`) the AI writes the sign-off itself from the global prompt; no signature is appended. Only the legacy `lib/email/generation.ts` still appends `formatSenderSignature`.

## SMTP verification (`smtpVerifier.ts`)

Order of checks: syntax → local disposable-domain list → free disposable-check API → Abstract API (if `ABSTRACT_EMAIL_API_KEY`) → MX lookup via public DNS (8.8.8.8/1.1.1.1) → raw SMTP `RCPT TO` on port 25. **Most ISPs and clouds block port 25.** A blocked port gives `risky`, or `valid` for big providers like gmail and outlook; after that it tries the Eva API. Only 550/551/553/554 give `invalid`. Downstream filters count `risky` as sendable, the same as `valid`.

## API conventions

- Use `jsonOk(data, status?)` / `jsonError(message, status?)` from `src/lib/api/response.ts`. The response shape is `{ success: true, ...data }` / `{ success: false, error }`. (The SSE stream and tracking pixel return raw `Response`s.)
- Call `await connectToMongoDB()` (`src/lib/db/connection.ts`, a cached promise) before any model access. Validate ids with `mongoose.Types.ObjectId.isValid`.
- Models use the `mongoose.models.X || mongoose.model(...)` guard so they survive hot reload.
- Long handlers set `export const maxDuration = 60` (stream: 120).
- Browser API wrappers: `src/services/lead-ingestion/apiClient.ts` (current) and `src/lib/api/client.ts` (legacy). They also hold the client-side record types (`LeadIngestionRecord`, `CampaignRecord`, …).
- Escape user search strings before building a `RegExp` (existing routes use `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`).

## UI conventions

- Pages are thin wrappers that render a component from `src/components/**`. Most pages and components are `'use client'` and fetch through the API wrappers.
- Shared primitives live in `src/components/ui/` (`Button`/`buttonClasses`, `Card`, `Badge`, `Input`, `Field`, `PageHeader`, `EmptyState`, `Icons` as inline SVG components). Merge class names with `cn()` from `src/lib/utils/cn.ts`. Styling is Tailwind utilities on a slate/indigo palette.
- The root layout renders `AppShell` (`src/components/layout/`). It holds the mobile-drawer state and renders the dark `Sidebar`, a sticky `AppHeader` (breadcrumb plus a "New lead" button) and `<main>`.
- Nav items, section labels, the 2–3 word descriptions and breadcrumb labels are all defined in **`src/components/sidebar/navigation.ts`**. `getActiveNav(pathname)` picks the active item by the longest matching prefix, so `/lead-ingestion/emails` → Drafts and `/lead-ingestion/client/[id]` → Leads › Profile. Add new pages there, not in the components.
- Page titles in `PageHeader` use the same names as the sidebar (Dashboard, New Lead, Leads, Drafts, Ready to Send, Campaigns, AI Settings). Keep the two in sync. The logo links to `/dashboard`.
- **SEO:** every page exports `metadata = pageMetadata({ title, description, path })` from `src/lib/seo/metadata.ts` (title uses the sidebar name, plus canonical, Open Graph and Twitter tags). Metadata merges shallowly, so never set `openGraph` by hand without spreading `baseOpenGraph`. Client-only pages get their metadata from a sibling `layout.tsx`; lead and campaign detail layouts use `generateMetadata` with the record's name and `PRIVATE_ROBOTS` (noindex). `app/sitemap.ts` reads routes from `navigation.ts`; `robots.ts` disallows `/api/`, so crawlers never load lead data. The base URL comes from `getSiteUrl()` in `src/lib/config/site.ts` (`NEXT_PUBLIC_APP_URL`, then Vercel's `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL`).
- **Indexing is off by default** (`siteRobots()` → noindex, empty sitemap, no sitemap line in robots.txt) because there is no login and pages show lead data. `ALLOW_SEARCH_INDEXING=true` turns it on. Pages stay crawlable either way so link previews work.
- **In-app brand placements:** sidebar (`Brand`: mark + name + tagline), mobile header (mark), footer (`AppFooter`), home page, and the branded `app/not-found.tsx`, `error.tsx` and `global-error.tsx` (via `StatusScreen`). Every logo links to `APP_HOME_PATH` (`/dashboard`, also the PWA `start_url`); name, tagline and home path come from `lib/config/site.ts`. Size `BrandMark` with its `size` prop, not h-/w- classes (`cn()` doesn't resolve Tailwind conflicts). Server Components import `buttonClasses` from `components/ui/buttonClasses.ts`, not from the `'use client'` `Button.tsx` (calling it through a client module throws on the server). `devIndicators` is off so the Next.js badge never shows.
- **Brand / logo:** `src/lib/brand/logo.ts` is the only source of the logo (glyph paths, gradient, `logoSvg(variant)`). `BrandMark`, the social cards and every icon file come from it. `src/lib/brand/assets.ts` lists every file in `public/` (favicons 16/32/48 + ICO + SVG, Apple touch 120–180, PWA 48–512, maskable 192/512, monochrome, Safari mask icon). After changing the logo, run `npm run brand:assets` (ts-node + sharp) and commit the output. Icon link tags are the `BRAND_ICONS` config in `seo/metadata.ts`, not `app/icon.*` files: a file-based icon would replace the whole config list. `brand/__tests__/assets.test.ts` fails if any referenced icon is missing or the wrong size.
- **Social cards** (`src/lib/brand/ogCard.tsx`, 1200×630, via `next/og`): `app/opengraph-image.tsx` and `twitter-image.tsx` render the site-wide card; `app/og/[...slug]/route.tsx` renders one card per sidebar page (name, section and description come from `navigation.ts`, built at build time, other paths 404). `pageMetadata` picks the page card for sidebar paths and the site card for everything else, so every page has an image. Never put lead or campaign data in a card: shared previews are cached by third parties. `/manifest.json` and `/site.webmanifest` are rewrites to `app/manifest.ts`.
- Charts are hand-rolled SVG (no chart library). `ActivityChart.tsx` is the pattern to follow:
  - one series at a time, in indigo `#4f46e5`
  - 4px rounded bar tops
  - a hover or arrow-key tooltip
  - a Table toggle as the accessible twin
- Verification statuses use the fixed status colors, and every one is shown with an icon and a label.

## Testing

- Jest via `next/jest`. The default environment is **jsdom**, so server-side tests (API routes, DB, services) must start with the `/** @jest-environment node */` docblock.
- Tests sit next to the code in `__tests__/` folders. `e2e/` is Playwright only and is excluded from Jest.
- DB integration tests use `mongodb-memory-server` and set `process.env.MONGODB_URI` in `beforeAll` (see `src/lib/db/__tests__/crud.test.ts`). Route tests mock `@/lib/db/connection` and the model modules with `jest.mock`. The mailer test mocks `nodemailer`.
- Coverage only counts `src/lib/**` and `src/components/**`.
- The stale `aiExtractor`, `regexExtractor` and `ai/provider` tests were rewritten on 2026-10-14 and pass; if `mailer` fails with a missing module, run `npm install` (`nodemailer` is in `package.json`).
- **Browser testing without touching live data:** `NEXT_DIST_DIR` (in `next.config.ts`) lets a second build live in its own folder, so a QA server can run beside `next dev`. Build and start it from PowerShell with `$env:NEXT_PUBLIC_API_URL='/api'` (Git Bash rewrites a leading `/` into a Windows path) and `$env:MONGODB_DATABASE='leadforge-qa'` to keep writes off the real database.

## Environment variables (`.env.local`, git-ignored)

| Var | Used by |
|---|---|
| `MONGODB_URI` (required), `MONGODB_DATABASE` (code default `leads`), `MONGODB_TIMEOUT_MS` | `lib/db/connection.ts`. **The real database is `leads-automation`, the same one production uses; local must use it too.** The `dbName` option overrides the database in the URI path, so keep the two in sync. The old `leads` database on the same cluster is unused: its data was copied into `leads-automation` on 2026-09-14. |
| `GROQ_API_KEY`, `GROQ_MODEL` | AI (primary) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4o-mini`) | AI fallback / `AI_PROVIDER=openai` |
| `AI_PROVIDER` (`groq`\|`openai`\|`ollama`), `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | `getChatModel()` only |
| `SMTP_HOST` (default smtp.gmail.com), `SMTP_PORT` (587), `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_NAME` | `services/lead-ingestion/mailer.ts` |
| `ENABLE_OPEN_TRACKING` (`true` to embed pixel) | campaign dispatch |
| `NEXT_PUBLIC_APP_URL` (public base URL; falls back to the Vercel URLs, then `http://localhost:3000`) | `lib/config/site.ts`: canonical/OG URLs, sitemap, robots, tracking pixel |
| `ALLOW_SEARCH_INDEXING` (`true` to let search engines index; default off), `SITE_TWITTER_HANDLE` (optional, for `twitter:site`/`twitter:creator`) | `lib/config/site.ts` |
| `NEXT_PUBLIC_API_URL` (default `/api`) | browser API wrappers |
| `ABSTRACT_EMAIL_API_KEY` (optional) | SMTP verifier |
| `SENDER_NAME`, `SENDER_TITLE`, `SENDER_POSITIONING` (`\|`-separated), `SENDER_PORTFOLIO_URL`, `SENDER_LINKEDIN_URL`, `SENDER_PHONE` | `lib/config/senderProfile.ts` (legacy pipeline only); `SENDER_NAME` is also the fallback From name in `mailer.ts` |
| `ITEMS_PER_PAGE` | legacy `db/operations/read.ts` |

Never commit `.env.local` or paste its values into code or docs.

## Docs folder

`docs/*-UPDATED.md` are the original planning specs (master prompt, requirements, tasks, env). They describe the **legacy** `Lead` pipeline and mention a Claude API key the code never uses. The code has since moved on (LeadIngestion, campaigns, Groq/LangChain). Treat the code as the source of truth; use the docs only for the original intent.
