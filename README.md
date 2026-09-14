<img src="public/favicon.svg" alt="LeadForge logo" width="56" height="56" />

# LeadForge

LeadForge takes a LinkedIn or Sales Navigator profile you paste in and prepares cold outreach for it:

1. It extracts the person and their current companies.
2. It finds contact emails on the company websites.
3. It verifies those emails.
4. It writes a personalized email for each company.
5. It sends the approved emails as campaigns, with random delays between sends.

It's built with Next.js 16, MongoDB (Mongoose), LangChain (Groq, with OpenAI as fallback) and Nodemailer.

## Getting started

```bash
npm install
npm run dev
```

Create a `.env.local` file before the first run. At minimum it needs:

- `MONGODB_URI`
- `GROQ_API_KEY`
- the `SMTP_*` settings, which are needed only to send emails

[CLAUDE.md](CLAUDE.md) lists every environment variable.

Then open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Make a production build and serve it |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Jest unit and integration tests |
| `npm run test:e2e` | Run the Playwright tests (the dev server must be running) |
| `npm run brand:assets` | Regenerate every favicon, app icon and PWA icon in `public/` from `src/lib/brand/logo.ts` |

For architecture and conventions, see [CLAUDE.md](CLAUDE.md).
