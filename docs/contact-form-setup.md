# Contact form setup and release

The static site now uses `/contact` and the Vercel Node.js function `/api/contact`. There is no frontend build step and no runtime npm dependency. Node 22 is selected in package.json. Keep the existing Vercel project and Git integration. This PR must be reviewed and merged by Michael; do not deploy production as part of preparation.

## Current status

No LVW Resend sender/domain, API access, recipient ownership, Turnstile account/site, or remote Vercel environment values could be verified from the available tools. No credentials/accounts were created, remote settings changed, or real emails sent. The previous website's contact inbox is the intended destination, but Michael must confirm that it is still owned and monitored before enabling delivery. Do not put that address into public HTML or JavaScript.

Resend is the preferred provider because Michael already uses it transactionally for another business. Do not reuse that business's sender identity or modify its settings. No marketing integration, auto-response, mailing-list signup, recurring monitoring or automated inquiry handling is included.

## Environment settings

Set these in the existing Vercel project's environment settings, scoped to the intended Preview or Production environment. Never put secrets in source, screenshots, PR comments, chat, or client-side variables. `.env.example` contains names only.

| Variable | Value / prerequisite |
| --- | --- |
| `CONTACT_ENABLED` | `true` only after all checks below; absent/false disables sending |
| `RESEND_API_KEY` | Existing approved sending credential with access to the verified LVW sender domain |
| `CONTACT_FROM` | Bare sender email on the verified LVW domain or approved LVW subdomain |
| `CONTACT_TO` | Michael's confirmed, monitored existing inbox, set only server-side |
| `CONTACT_ALLOWED_ORIGINS` | Exact comma-separated origins, e.g. `https://lvwservices.com,https://www.lvwservices.com`; add an explicit preview alias if used |
| `TURNSTILE_SITE_KEY` | Public site key for an existing approved Cloudflare Turnstile widget |
| `TURNSTILE_SECRET_KEY` | Matching server-only secret for that widget |

The exact `https://${VERCEL_URL}` deployment origin is also accepted when Vercel supplies it. Configure the Turnstile widget hostname allowlist for the production hostname(s) and the exact preview hostname being tested. Do not disable hostname validation or use an unrestricted hostname configuration. Production should use real keys, never Cloudflare's test keys.

If there is no existing suitable Turnstile account/widget or sending credential, **stop for Michael's approval** before creating an account or persistent credential. No paid service or purchase is needed by the implementation. If a new account is not acceptable, agree a replacement spam-control mechanism before enabling the form; do not remove verification merely to launch.

For LVW domain verification, use the DNS records provided by Resend and check existing SPF/DMARC records before changes. Do not guess records, alter the other business's domain, or expose DNS/account credentials. Changes require the relevant account access and authorization.

## Spam controls and privacy

- Mandatory server-side Turnstile verification, including action and hostname. Tokens expire and cannot be reused successfully.
- Honeypot, origin allowlist, JSON-only POST, 16 KB application payload cap, strict field type/length/header validation.
- Best-effort in-memory throttle: five submissions per ten minutes per hashed Vercel-provided IP per function instance. It is **not a global/durable limit** and resets on cold starts. Configure the existing Vercel Firewall rate-limiting rule for POST `/api/contact` before opening the form broadly if the current plan supports it; do not purchase a plan. Turnstile remains mandatory either way.
- Provider errors and credentials are not returned to visitors. No inquiry text or IP is logged by this code. Provider/platform logs and inbox retention remain governed by their settings.
- Recipient/from address are fixed server settings. Visitor email is used only as Reply-To. Messages are plain text with a fixed subject; visitor content cannot create HTML or change recipients.
- Stable provider idempotency key avoids duplicate sends for a retry of the same submission in the same page session. Editing content changes its key; reloading creates a new request ID. Success means provider acceptance, not proof of inbox delivery.

## Validation and release checklist

1. Run `npm test` (all provider requests are mocked; no mail is sent). Run `node --check assets/contact.js` and `git diff --check`.
2. On a Vercel preview, verify `/`, `/contact`, `/case-studies`, `/case-studies/product-setup`, and `/wildrooted` still load. Vercel previews may require sign-in. Confirm `/api/contact` returns only a public site key when configured, or a generic 503 while disabled. Verify existing framework preset remains Other/static and no build override is introduced.
3. Check form labels, keyboard focus, mobile menu, field errors, spam-check expiry, offline/provider failure with preserved input, and success. Turnstile blocked by a content blocker or JavaScript disabled must show an honest unavailable message.
4. Once the sender and recipient are verified, send one clearly marked synthetic inquiry only to Michael's confirmed inbox. Check Resend acceptance and receipt in that inbox; verify Reply-To. Do not test against third-party addresses or auto-reply.
5. Michael reviews/merges the PR. Apply approved production environment settings and redeploy through the existing Vercel workflow when authorized. Environment changes need a new deployment to take effect. Verify actual production routes and one approved delivery; do not claim delivered based on HTTP 200 alone.

## References

- [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
- [Turnstile server verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
