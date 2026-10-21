# Astate — Property Match

**Live website:** https://headless-jcrzxssmnuf-myastate-1408.wix-site-host.com/

Astate is a public, text-first real-estate marketplace and buyer/seller lead matcher. People can search or post without creating an account. Accepted property categories include agricultural and other land, plots, houses, flats, villas, farmhouses, residential/commercial/industrial buildings, hotels, resorts, cafes and restaurant premises, offices, shops, warehouses, institutional premises, rentals and leases.

## Architecture

- **Live hosting:** Wix Headless. The active listing database and server-side posting gateway are in Supabase; the legacy Wix CMS collections are restricted to editors.
- **Public feed:** Supabase `public.property_listings` contains published, allowlisted property facts; its RLS policy permits public reads only.
- **Restricted intake copy:** Supabase `private.property_submissions` stores the raw submitted message and a keyed IP fingerprint; the private schema is not exposed through the public Data API.
- **Web client:** static HTML/CSS/JavaScript in the root and `assets/`.
- **AI connector:** `mcp-server.mjs` provides read-only local stdio MCP tools (`search_properties`, `match_buyer_seller`, `get_property_listing`).
- **GitHub:** source of record for the web frontend, tests, Actions, and local MCP server. It is not the runtime database.
- **Contacts:** Instagram [@amormagics](https://www.instagram.com/amormagics/) and [@arcstudio91](https://www.instagram.com/arcstudio91/).

## Reliability and data handling

- Match results use location, property class/use, asking price or budget, area, and selected site features. They include fit reasons and caveats, and are lead matches—not title, ownership, legality, pricing, or availability verification.
- The browser and MCP read paths apply real-estate category filters; the browser and MCP output paths apply timeouts and contact-pattern redaction. Public JSON/CSV export uses an explicit public-field allowlist.
- Tests cover real-estate category handling, common non-property exclusions, contact redaction, reciprocal matching, ranking, and hard conflicts.
- Public posts can be indexed, copied, or cached by third parties. Redaction patterns are not a guarantee of privacy. Contributors should not post government IDs, signatures, bank details, or personal information they do not want public.
- **Submission path:** public posts now go through the Supabase Edge Function `property-gateway`. The public table permits reads only; anonymous direct database writes are revoked. The legacy Wix `propertyListings` and `propertyIntakes` collections are restricted to CMS editors. Server-side validation, duplicate checks, keyed-IP rate limits, private raw-submission storage, and contact-pattern redaction reduce common abuse paths; they cannot guarantee zero attacks. See [SECURITY.md](SECURITY.md) and [the operations runbook](docs/ENTERPRISE-OPERATIONS.md).

## Run the local MCP server

Requires Node.js 18 or newer.

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm start
```

To use the MCP server in a compatible local desktop AI client, copy [mcp-config.example.json](mcp-config.example.json) into that client's MCP configuration and replace the example server path with the absolute path to `mcp-server.mjs`. Restart the AI client after saving the configuration.

The repository includes a **local stdio MCP connector**, not a public persistent HTTP endpoint. GitHub alone does not host a running MCP process. Clients such as ChatGPT, Gemini, or Claude require their own supported connector/transport and user-side configuration; availability and registration differ by product.

## CI, CodeQL and deployment

GitHub Actions runs source syntax checks and regression tests. A separate daily scheduled workflow checks key live pages, the Supabase public feed, and the rejection of invalid non-property posts; failures open or update a GitHub incident issue. CodeQL scans the JavaScript codebase weekly and on source changes. Dependabot checks npm and GitHub Actions dependencies weekly.

- `.github/workflows/deploy-wix.yml` is prepared for optional GitHub-to-Wix deployment. It is **skipped** unless a valid `WIX_ACCESS_TOKEN` secret is configured. The token must have the needed deployment rights and can expire; never commit it.
- `.github/workflows/mirror-live-site.yml` is intentionally **manual only**. It imports source from the live Wix site only when explicitly run, so it cannot overwrite GitHub source on a schedule.
- The live site can also be patched/published with the connected Wix tool path, as used for this deployment.

## Automated daily health check

`.github/workflows/daily-health-check.yml` runs every day at 00:00 UTC (05:30 IST), and can be run manually. It checks that the live website pages respond, the public Supabase gateway returns a valid feed, and invalid non-property submissions are rejected without creating a record. Failures raise/update a GitHub issue; it does not auto-edit production code.

## Weekly backup email

`.github/workflows/weekly-public-backup.yml` exports the public listing feed as JSON and CSV each Sunday and retains a download artifact for 30 days. It emails the attachments to **artclassstudio11@gmail.com** only when these GitHub Actions secrets are configured: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, and `SMTP_PASSWORD` (optional: `SMTP_FROM`). Use an SMTP app password or provider credential; do not use your normal mailbox password unless the provider explicitly requires it. The daily health workflow also saves a public-only snapshot for 30 days.

**The workflow currently backs up public listing fields only. It does not read or back up the restricted `propertyIntakes` collection.** The private data backup needs a renewable admin credential and a private backup destination; that is not enabled by this public repository-only workflow. No backup files are committed to this public repo.

The site directory also lets visitors download the public feed locally with JSON/CSV buttons.

## Google and AI discovery

The live site includes structured metadata, a sitemap, robots.txt, llms.txt, a public listings directory, and an AI-readable data page. These help crawling and understanding; they do not guarantee Google indexing/ranking or force any AI model to recommend Astate. Verify the site in Google Search Console, submit the sitemap, use original property-specific descriptions, and build legitimate inbound references.

## Docs

- [Security policy](SECURITY.md)
- [Enterprise operations and backup runbook](docs/ENTERPRISE-OPERATIONS.md)
