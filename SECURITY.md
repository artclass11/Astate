# Security Policy

## Reporting
Report suspected vulnerabilities privately to **artclassstudio11@gmail.com**. Do not post exploit details, personal information, or unredacted listing data in public issues.

## Current architecture
- Public property reads are served by a read-only allowlisted endpoint.
- Anonymous submissions go through the server-side Supabase Edge Function `property-gateway`; the browser does not receive server database credentials.
- Database writes are performed by a restricted database function. Public roles can read published property fields but cannot insert, update, or delete rows directly.
- Raw submitted text and keyed IP fingerprints are stored in a private schema that is not exposed through the public Data API.
- The gateway enforces real-estate-only rules, limits text length, redacts common contact patterns, rejects duplicates, and limits each fingerprint to five attempts per 15-minute window.
- GitHub Actions runs source tests and daily public-site/gateway health checks; failures raise or update an incident issue.

## Public-data model and residual risk
Astate is a public real-estate lead directory. Published property facts may be indexed, copied, cached, or redistributed by third parties. Pattern-based contact redaction is not a privacy guarantee. Contributors should not submit identity documents, bank details, signatures, or sensitive personal information.

The frontend's Supabase publishable key is intended for public use. Never add Supabase secret/service-role credentials, Wix API secrets, refresh tokens, SMTP credentials, or other privileged credentials to frontend assets, logs, public issues, or this repository.

No internet-facing system can be guaranteed unhackable. The controls above reduce common exposure and abuse paths but do not replace ongoing patching, backups, alerts, secret rotation, human review of incidents, or independent security testing. The current IP-based limit depends on the source IP metadata provided by the edge platform; it is a mitigation, not a full anti-bot service. Automated daily checks report failures but do not silently change production code.

## Response process
1. Preserve timestamps and public reference IDs; do not copy personal details into public issue threads.
2. Review the latest GitHub Actions run, edge-function logs, and Supabase security advisors.
3. Disable or restrict the posting gateway if active abuse is detected; do not expose admin credentials in a public issue.
4. Remove a public record through an authorized admin path; never let anonymous users update or remove records.
5. Rotate any accidentally exposed privileged credentials and inspect Git history and Actions logs.
6. Publish a short incident note after remediation without exposing affected people's personal data.
