# Astate production-hardening runbook

## Current architecture

- **Frontend:** static HTML/CSS/JavaScript hosted on Wix Headless.
- **Public write gateway:** Supabase Edge Function `property-gateway`; no-login visitors can submit plain-text property facts, but cannot write database rows directly.
- **Public database:** Supabase `public.property_listings`; RLS allows public reads only, and the frontend receives a limited public field mapping.
- **Private data:** Supabase `private.property_submissions` retains the raw message and keyed IP fingerprint; `private.submission_rate_limits` tracks attempt windows. Both have RLS, explicit deny policies for browser roles, no browser table grants, and service-side access only.
- **Legacy Wix CMS:** `propertyListings` and `propertyIntakes` are restricted to CMS editors. They remain archived/source records, not the active listing feed.
- **Repository:** [artclass11/Astate](https://github.com/artclass11/Astate) stores source and tests; it is not the runtime database.
- **Local AI connector:** `mcp-server.mjs` provides read-only local stdio MCP tools for public listings. It is not a publicly hosted HTTP MCP service.
- **Public discovery / export:** `/listings.html`, `/ai-data.html`, `/llms.txt`, `/robots.txt`, and `/sitemap.xml` describe public property data. JSON/CSV exports include only public fields.

## Server-side security controls

The website submits to `https://qebuxmnvgkksueikhxya.supabase.co/functions/v1/property-gateway`. The frontend's Supabase publishable key is public by design. Supabase's server-side environment credentials are used only by the Edge Function and must never be copied to client files, GitHub, logs, issues, or chat.

The gateway validates property-only plain text and allowed property types, caps the message length, redacts common phone/email/URL patterns from the public description, rejects duplicate submissions, and uses keyed IP fingerprints to limit five attempts per 15-minute window. Its database insertion RPC is executable only by `service_role`. Public roles cannot insert/update/delete rows directly.

These controls reduce common attack paths, but cannot guarantee that no one will hack or abuse the site. The rate limit is not a CAPTCHA/WAF and depends on trustworthy edge IP headers. Sophisticated distributed abuse, logic bugs and upstream platform incidents remain possible. Do not add credentials or private submission data to public repo files.

## Quality gates and recurring monitoring

Run locally or through GitHub Actions:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm test
node scripts/site-health-check.mjs
```

The daily workflow runs at 00:00 UTC (05:30 IST) plus on source pushes and can be run manually. It checks the live pages, public data gateway contract, and rejection of a non-property submission without creating a listing. Failures open or update one GitHub incident issue. The workflow reports and tests; it deliberately does not silently hotfix production code.

## Deployment policy

Wix is the live host. The published site was updated through the connected Wix deployment path. The optional GitHub-to-Wix workflow still requires a privileged `WIX_ACCESS_TOKEN` secret and must not be reported as active when its steps were skipped. Every static-site upload replaces the complete file set, so upload all 11 public site files when deploying.

After changes, confirm GitHub Actions checks, the public site pages, and the gateway health check. Check Supabase Security Advisors after schema changes and after new public endpoints are introduced. Never report success from a skipped workflow.

## Backups and recovery

The weekly workflow exports public listing fields as JSON and CSV. It emails those attachments to artclassstudio11@gmail.com only when `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, and `SMTP_PASSWORD` are configured in GitHub Actions secrets; optional `SMTP_FROM` overrides the sender. It excludes private submissions and never commits data backups to the public repo.

The private raw-submission table is in Supabase, but a complete private backup schedule, retention policy and restore rehearsal are still open items. Do not treat a public backup as disaster recovery. Configure a private backup destination only after checking current costs and access controls.

## Incident response

1. Review the daily health issue and the linked GitHub Actions logs.
2. Inspect Supabase Edge Function logs and Security Advisors.
3. If the write gateway is being abused, disable the function or temporarily return a maintenance response, then restore after review.
4. Use an authorized server-side/admin path for moderation and removal. Anonymous users must not edit or delete public listings.
5. Before destructive cleanup, export a private copy and review reference IDs and timestamps.
6. Add a regression test for each incident and rotate any privileged credential that might have been exposed.

## Enterprise gaps still open

- Full private-data backup automation and a successful restore drill.
- Authenticated internal admin tools for edits/removals, a durable audit trail, data-retention rules, and review/appeal flow.
- Stronger anti-bot protection (e.g. a free challenge service) if spam volume warrants it.
- Real hosted remote MCP endpoint if other AI clients need URL-based connector registration.
- Verified domain/Search Console ownership and SEO/indexation monitoring.
- Independent penetration testing and operational monitoring; no security control guarantees the site is unhackable.
