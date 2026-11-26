# UI refresh verification

Baseline: `812d7e9e8bb27dcc06db43f2c5d854af4d8c0868` (main, read via GitHub). Seven changed existing files and the original `globals.css` were reconstructed locally and matched their full Git blob SHAs. No remote branch was changed by this refresh.

## Executed locally

- TS/TSX transpile-only syntax checks for the seven changed TSX files.
- PostCSS parsing of the new stylesheet.
- Chromium 144, Playwright, six viewport widths (1536, 1366, 1024, 768, 390, 320; login also 1440), 63 layout assertions passed. Covered three/two/one-column states, 68px collapsed navigation, mobile navigation visibility, mobile and desktop composer within viewport, no page-wide overflow, empty state, disabled action when no selection, modal label association and visible focus, login password input, dashboard and mobile task lists. No external HTTP requests were allowed.
- Layout review used actual source component markup via a render-only TSX adapter, synthetic fixtures, a minimal Tailwind-like reset and both verified original CSS and new CSS. Icons are locally drawn test doubles. It is not a real React/Next runtime, business-flow test, or a pixel-level baseline comparison. Effects and event handlers are intentionally suppressed. Screenshots are marked OFFLINE FIXTURE.

## Run locally on the repository

```bash
# Install the normal web dependencies first.
(cd apps/web && npm ci) # use npm install if no package-lock.json exists
python -m pip install playwright
python -m playwright install chromium
UI_EVIDENCE_DIR=./ui-layout-evidence python scripts/check-ui-layout.py
```

The offline fixture resolves TypeScript from apps/web or a global installation. It does not use enterprise credentials or a live backend. `UI_CHROMIUM_EXECUTABLE` can select an installed Chromium. `UI_LEGACY_CSS` is only a local test override; defaults to actual repository `globals.css`.

## Pending full application acceptance

```bash
(cd apps/web && npm run typecheck && npm run build)
node --experimental-strip-types scripts/check-login-return.mjs
node --experimental-strip-types scripts/check-wecom-oauth.mjs
```

Run `scripts/browser-acceptance.py` in its documented isolated Compose environment with synthetic data. Verify real React focus trapping and restoration, actual navigation and mobile back behavior, message switching/races, ticket source snapshot, logout, card OAuth/password return, custom fields and reports. Confirm real Tailwind compilation order and browsers used by the enterprise WeCom client. No production deployment or live WeCom calls are required for visual testing.

Current blockers: the local container could not clone the private repository over the network or install the missing Next/React/lucide dependencies, so full typechecking, Next build, and real app acceptance have not run. Test results are limited to the assertions described above.
