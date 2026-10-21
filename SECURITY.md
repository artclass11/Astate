# Security Policy

## Reporting

Report suspected vulnerabilities privately to **artclassstudio11@gmail.com**. Do not post exploit details, personal information, or unredacted listing data in public issues.

## Public-data model

Astate is a public real-estate lead directory. Anything successfully published to the public listing collection may be indexed, copied, cached, or redistributed by third parties. Public listing descriptions are pattern-redacted for common phone numbers, email addresses, and URLs, but pattern redaction is not a privacy guarantee. Contributors should not submit identity documents, bank details, signatures, or sensitive personal data.

The anonymous visitor OAuth client ID in frontend code is a public identifier, not a secret. Never add Wix API secrets, refresh tokens, SMTP credentials, Supabase service-role keys, or other privileged credentials to frontend assets or this public repository.

## Current security boundary

The public frontend now filters public-feed records to real-estate categories, redacts common contact patterns in cards/exports, and bounds browser data requests with timeouts. The MCP server applies its own read-side filtering/redaction and timeout behavior.

**Important limitation:** this site still uses a public Wix CMS collection with anonymous insert permission so visitors can post without accounts. Client-side checks can be bypassed by callers that invoke the Wix Data API directly. Read-side filtering reduces what Astate displays but does not prevent invalid records from being written to Wix. A server-side posting gateway, server-side validation, abuse/rate limiting, and moderation/removal controls are still required before the write path should be considered enterprise-secure.

## Response process

1. Preserve timestamps and public reference IDs; do not copy personal details into public issue threads.
2. Disable or restrict the public insert permission if active abuse is detected.
3. Remove the public record through an authorized CMS editor; do not let anonymous users update or remove records.
4. Rotate any accidentally exposed privileged credentials, and inspect Git history and Actions logs.
5. Publish a short incident note after remediation, without disclosing affected people's personal data.
