# Astate production-hardening runbook

## Current architecture

- **Frontend:** static HTML/CSS/JavaScript hosted on Wix Headless.
- **Primary database:** Wix CMS `propertyListings` is the public lead feed; `propertyIntakes` is intended for restricted raw submissions/backup copies.
- **Repository:** [artclass11/Astate](https://github.com/artclass11/Astate) stores public source and tests. It is not the database and should not contain private submissions.
- **Local AI connector:** `mcp-server.mjs` provides read-only stdio MCP tools for public listings. It does not write properties and is not a hosted remote MCP endpoint.
- **Public search feed:** `/listings.html`, `/ai-data.html`, `/llms.txt`, `/robots.txt`, and the Wix sitemap describe the public site to humans, crawlers, and compatible AI agents.
- **Local data export:** Explore and AI data pages export public listings as JSON or CSV. This is a local download initiated by the visitor.

## Quality gates

Run these checks locally or through GitHub Actions:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

Tests cover category validation, contact-pattern redaction, fit ranking, two-way matching, budget/area compatibility, and hard-conflict filtering. GitHub Actions is the source of truth for the most recent CI result.

## Deployment policy

Wix remains the live host. GitHub is version control/CI and is not the current serving host. The optional GitHub-to-Wix workflow requires a privileged Wix access token in GitHub Actions secrets; without that credential it intentionally skips deployment. Keep privileged secrets out of the repository and never paste them into chat or source files.

Before production deployment, verify the GitHub Actions run, publish the source using an authorized Wix deployment path, then inspect the saved files and public homepage. Never report success from a skipped workflow.

## Weekly email backups

The scheduled workflow exports **publicly published listing fields only** and emails JSON/CSV attachments to artclassstudio11@gmail.com when SMTP secrets are configured. It deliberately excludes the restricted `propertyIntakes` collection because a public anonymous token must not read it.

Required repository Actions secrets for delivery:

- `SMTP_HOST` — provider SMTP host
- `SMTP_PORT` — usually 465 for SSL or 587 for STARTTLS
- `SMTP_USERNAME` — sending mailbox
- `SMTP_PASSWORD` — an app password or provider-specific SMTP credential, never the normal account password unless the provider explicitly instructs it

The workflow will report that email delivery was skipped if those secrets are missing. It does not commit backups into this public repository. **This is not yet a full private-data disaster-recovery backup.** To back up restricted raw submissions, configure a server-side, renewable administrator credential and a private destination with access control and retention. Never add private-intake data to public Actions artifacts or a public Git branch.

## Incident response

1. For junk listings, suspend public insert or add a server-side write gateway; front-end filters do not stop direct API writes.
2. Keep a local JSON/CSV copy before bulk cleanup.
3. Compare public references and creation times; avoid deleting records based solely on free-text keywords.
4. Inspect GitHub Actions results and Wix saved files before retrying deploys.
5. After restoring service, add a regression test that reproduces the incident.
6. Do not promise Google ranking, title verification, property availability, or contact ownership. Astate matches leads; legal/title diligence remains with users.

## Enterprise gaps still open

- Server-side public-post validation and rate/abuse controls
- Secure administrator-only backup of `propertyIntakes` and restore rehearsal
- Authenticated internal admin tools for edit/remove, audit trail, and retention rules
- Real hosted remote MCP endpoint if other AI clients need URL-based connector registration
- Verified domain/Search Console ownership and recurring SEO/indexation monitoring
