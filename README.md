# Go.AI CRM — fictional demo

A public, browser-only demonstration of the CRM with exactly 100 generated fictional contacts across 40 fictional accounts. All emails use example.com. No real lead data, customer exports, production database, credentials, server configuration, or private Git history is included.

Explore Today, the pipeline, accounts, scored purchased leads, tasks, prospecting Insights, and the field-visit map. Edit records and log activity locally; changes belong only to the current browser tab. Use Reset demo to restore the original fictional dataset. AI buttons use labeled scripted samples. Imports and server backups are disabled.

## Hosting

GitHub Pages deploys the static files in this repository. SQLite runs in the browser through vendored sql.js 1.14.2 (MIT). No API server is required. A static server can also serve this directory locally.

## Updating

This repo is a sanitized snapshot with a fresh history. The private CRM's build-demo.mjs creates it from an explicit application-code allowlist and the fictional generator; it never reads the CRM database or purchased CSVs. Modify the public source files here and push to main to redeploy.

## Fictional data and methodology

Names and account descriptions are invented examples and are not representations of real organizations or people. Scores use the account-priority model with synthetic fit, role, reach and timing inputs. Demo tiers use a smaller illustrative work queue of 12 A and 16 B accounts; production tier capacities are separate. Metrics and sample AI text illustrate app behavior and are not actual sales results.
