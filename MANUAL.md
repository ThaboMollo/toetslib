# toetsLib Manual

**Version:** 0.1.0  
**"toets" is Afrikaans for "test"**

toetsLib is an AI-powered CLI tool that analyzes React repositories and automatically generates comprehensive Playwright end-to-end test suites. Point it at your repo, and it figures out your routes, forms, API calls, and auth patterns, then writes tests that actually work.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [How It Works](#how-it-works)
3. [Installation](#installation)
4. [Commands](#commands)
   - [generate](#generate)
   - [analyze](#analyze)
   - [crawl](#crawl)
   - [validate](#validate)
5. [Configuration](#configuration)
6. [Authentication](#authentication)
7. [What Gets Generated](#what-gets-generated)
8. [Self-Healing](#self-healing)
9. [Supported Frameworks](#supported-frameworks)
10. [Troubleshooting](#troubleshooting)
11. [Examples](#examples)

---

## Quick Start

Generate a full Playwright test suite for your React project in one command:

```bash
toetslib generate ./my-react-app
```

That's it. toetsLib will:
1. Detect your framework, dev server, and port
2. Parse your source code for routes, forms, and API calls
3. Start your app and crawl it with a headless browser
4. Use AI to generate Playwright tests with page objects
5. Run the tests and automatically fix any failures

Your tests land in `./e2e` (or wherever you specify with `--output`).

---

## How It Works

toetsLib runs a 5-stage pipeline. Each stage builds on the previous one.

```
INGEST  -->  ANALYZE  -->  CRAWL  -->  GENERATE  -->  VALIDATE
```

### Stage 1: Ingest

Reads your project and detects its setup.

- **Package manager:** npm, yarn, pnpm, or bun (detected from lock files)
- **Framework:** React+Vite, Create React App, or Next.js (detected from dependencies)
- **Dev command:** reads `scripts.dev` or `scripts.start` from package.json
- **Dev port:** parsed from vite.config.js, next.config.js, or uses defaults (5173 for Vite, 3000 for Next.js)
- **Source directory:** finds src/, app/, or pages/

### Stage 2: Analyze (Static)

Parses your source code using AST analysis to understand the application structure.

- **Routes:** extracts React Router `<Route>` definitions, file-based routes, route arrays
- **Components:** maps which components render on which routes
- **Forms:** finds form fields, input types, labels, validation logic
- **API calls:** extracts endpoints from axios, fetch, TanStack Query hooks
- **Auth patterns:** detects auth contexts, route guards, login redirects, trial/guest modes

### Stage 3: Crawl (Live)

Starts your dev server and visits your app with a headless Playwright browser.

- Visits every discovered route
- Takes screenshots at 3 viewport sizes (mobile 375px, tablet 768px, desktop 1280px)
- Finds all interactive elements (buttons, links, inputs, selects, checkboxes)
- Records which pages link to which (navigation graph)
- Logs console errors and failed network requests
- Handles authentication if credentials are provided

### Stage 4: Generate (AI)

Uses Claude AI to produce Playwright test code in three passes.

- **Pass 1 - Test Plan:** decides what to test per page (smoke, happy path, validation, edge cases, responsive)
- **Pass 2 - Page Objects:** generates TypeScript Page Object Models with selectors from the crawl data
- **Pass 3 - Test Code:** writes .spec.ts files using the page objects

Screenshots are sent to the AI so it can "see" each page while writing tests.

### Stage 5: Validate (Self-Healing)

Runs the generated tests and feeds failures back to the AI for automatic fixes.

- Runs all tests via Playwright
- Parses failures: wrong selectors, timing issues, assertion mismatches
- AI rewrites broken tests (up to 3 cycles)
- Tests that still fail are marked "needs-review" with an explanation
- Writes a report to `.toetslib-report.json`

---

## Installation

### Prerequisites

- **Node.js** 18 or later
- **npm** (or yarn/pnpm/bun)
- **ANTHROPIC_API_KEY** environment variable set (get one at https://console.anthropic.com)

### From Source

```bash
git clone <repo-url> toetslib
cd toetslib
npm install
npx turbo build
```

After building, you can run the CLI directly:

```bash
node apps/cli/dist/index.js --help
```

Or link it globally:

```bash
cd apps/cli
npm link
toetslib --help
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes (for generate/validate) | Your Anthropic API key for Claude AI |

Set it in your shell profile or before running:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

---

## Commands

### generate

The main command. Runs the full pipeline: analyze, crawl, generate tests, and validate them.

```bash
toetslib generate <repo-path> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `repo-path` | Path to your React project root (where package.json lives) |

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <dir>` | `./e2e` | Where to write the generated test files |
| `--auth-url <url>` | none | Login page URL (e.g. `http://localhost:3000/login`) |
| `--auth-email <email>` | none | Test account email for authentication |
| `--auth-password <pass>` | none | Test account password |
| `--config <path>` | `.toetslib.json` in repo | Path to config file |
| `--max-heal-cycles <n>` | `3` | Maximum self-healing retry cycles |
| `--no-validate` | false | Skip the validation stage (just generate, don't run tests) |
| `--verbose` | false | Print detailed debug output |
| `--json` | false | Output the full AppMap as JSON |

**Examples:**

```bash
# Basic usage
toetslib generate ./my-app

# Custom output directory
toetslib generate ./my-app --output ./tests/e2e

# With authentication
toetslib generate ./my-app \
  --auth-url http://localhost:3000/login \
  --auth-email test@example.com \
  --auth-password secret123

# Generate only (skip running tests)
toetslib generate ./my-app --no-validate

# Verbose output for debugging
toetslib generate ./my-app --verbose
```

---

### analyze

Runs stages 1 and 2 only. Useful for checking what toetsLib detects in your project without starting the app or generating tests.

```bash
toetslib analyze <repo-path> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to config file |
| `--verbose` | Detailed output |
| `--json` | Output the AppMap as JSON |

**Example:**

```bash
# See what toetsLib finds in your project
toetslib analyze ./my-app --json

# Output includes:
# - project: framework, package manager, dev command, port
# - routes: all discovered routes with components
# - forms: form fields, types, labels
# - apiCalls: endpoints and HTTP methods
# - auth: authentication patterns detected
```

This is your go-to debugging command. If generated tests are wrong, check what the analyzer sees first.

---

### crawl

Runs stages 1-3. Analyzes the code AND starts the app to crawl it with a browser. Useful for checking what the browser finds before generating tests.

```bash
toetslib crawl <repo-path> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--auth-url <url>` | Login page URL |
| `--auth-email <email>` | Test account email |
| `--auth-password <pass>` | Test account password |
| `--config <path>` | Path to config file |
| `--verbose` | Detailed output |
| `--json` | Output the AppMap as JSON |

**Example:**

```bash
# Analyze + crawl, see screenshots and interactive elements
toetslib crawl ./my-app --json

# Screenshots are saved to .toetslib/screenshots/ in your project
```

---

### validate

Runs stage 5 only. Takes existing Playwright tests, runs them, and self-heals any failures using AI.

```bash
toetslib validate <repo-path> [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <dir>` | `./e2e` | Directory containing your tests |
| `--max-heal-cycles <n>` | `3` | Maximum retry cycles |
| `--config <path>` | `.toetslib.json` | Path to config file |
| `--verbose` | false | Detailed output |
| `--json` | false | Output results as JSON |

**Example:**

```bash
# Fix failing tests automatically
toetslib validate ./my-app --output ./e2e

# Limit healing attempts
toetslib validate ./my-app --max-heal-cycles 1
```

---

## Configuration

You can configure toetsLib per-project using a `.toetslib.json` file in your project root. CLI options override config file values.

### Configuration File

Create a `.toetslib.json` in your project root:

```json
{
  "devCommand": "npm run dev",
  "devPort": 5173,
  "baseUrl": "http://localhost:5173",
  "auth": {
    "strategy": "form",
    "loginUrl": "/login",
    "fields": {
      "email": "#email",
      "password": "#password"
    },
    "submitSelector": "button[type=submit]"
  },
  "exclude": ["/admin/*"],
  "outputDir": "./e2e",
  "maxHealCycles": 3
}
```

### Config Fields

| Field | Type | Description |
|-------|------|-------------|
| `devCommand` | string | Command to start your dev server. Auto-detected if not set. |
| `devPort` | number | Port your dev server runs on. Auto-detected from Vite/Next config. |
| `baseUrl` | string | Full base URL for your app. Constructed from port if not set. |
| `auth` | object | Authentication configuration (see below) |
| `exclude` | string[] | Route patterns to skip (glob syntax). E.g. `["/admin/*", "/internal/*"]` |
| `outputDir` | string | Where to write generated tests. Default: `./e2e` |
| `maxHealCycles` | number | Maximum self-healing retry cycles. Default: `3` |

### Auth Config

| Field | Type | Description |
|-------|------|-------------|
| `auth.strategy` | string | Auth method. Currently supports `"form"` (fill a login form). |
| `auth.loginUrl` | string | Path to your login page (e.g. `"/login"`) |
| `auth.fields` | object | CSS selectors for login form fields. Keys are field names, values are selectors. |
| `auth.submitSelector` | string | CSS selector for the login submit button |

### Priority Order

When the same setting appears in multiple places, this is the priority:

1. **CLI flags** (highest priority)
2. **.toetslib.json** config file
3. **Auto-detected values** (lowest priority)

---

## Authentication

toetsLib supports testing authenticated pages by logging in with test credentials.

### Option 1: CLI Flags

```bash
toetslib generate ./my-app \
  --auth-url http://localhost:3000/login \
  --auth-email test@example.com \
  --auth-password s3cret
```

### Option 2: Config File

```json
{
  "auth": {
    "strategy": "form",
    "loginUrl": "/login",
    "fields": {
      "email": "#email-input",
      "password": "#password-input"
    },
    "submitSelector": "#login-button"
  }
}
```

### Trial/Guest Mode

If your app supports unauthenticated or trial mode (like guest access with localStorage-backed data), toetsLib detects this automatically. No credentials needed for trial-mode testing. The analyzer identifies:

- localStorage usage for data persistence
- Conditional rendering based on `isAuthenticated`
- Feature restrictions for unauthenticated users

Tests are generated for both the trial flow and (if credentials are provided) authenticated flows.

---

## What Gets Generated

After running `toetslib generate`, you get a complete Playwright test suite:

```
e2e/
  playwright.config.ts           # Configured for your project
  pages/                         # Page Object Models
    landing.page.ts
    dashboard.page.ts
    user-form.page.ts
    ...
  fixtures/                      # Test data and setup
    auth.setup.ts                # Login flow (if auth configured)
    test-data.ts                 # Mock form data
    base.fixture.ts              # Extended Playwright fixtures
  tests/                         # Test specs
    navigation.spec.ts           # Nav links, routing, mobile menu
    landing.spec.ts              # Landing page, CTAs, hero section
    dashboard.spec.ts            # Main dashboard functionality
    user-create.spec.ts          # Form submission, validation
    user-edit.spec.ts            # Editing existing records
    responsive.spec.ts           # Mobile/tablet/desktop layouts
    ...
  .toetslib-report.json          # Generation report
```

### Page Objects

Each page gets a Page Object Model with:
- Typed selectors for every interactive element
- Helper methods for common actions (fill form, submit, navigate)
- Selectors prioritized for stability: `data-testid` > `getByRole` > `getByLabel` > `getByText` > CSS

### Test Categories

Tests are organized by category:

| Category | What it tests |
|----------|---------------|
| **Smoke** | Page loads, no console errors, key elements visible |
| **Navigation** | All links work, routing is correct, mobile menu |
| **Happy path** | Core user flows end-to-end (create, edit, submit) |
| **Validation** | Form errors on bad/missing input |
| **Edge cases** | Empty states, loading states, error states |
| **Responsive** | Layout at mobile (375px), tablet (768px), desktop (1280px) |

### Generation Report

`.toetslib-report.json` contains:

```json
{
  "totalTests": 45,
  "passed": 43,
  "failed": 0,
  "healed": 2,
  "needsReview": 0,
  "tests": [
    {
      "testName": "creates user with valid data",
      "specFile": "user-create.spec.ts",
      "status": "healed",
      "healHistory": ["Fixed selector: .save-btn -> getByRole('button', { name: 'Save' })"]
    }
  ]
}
```

---

## Diagnostic Reports

When toetsLib runs your generated tests, it produces a diagnostic report that tells your team exactly what failed and how to fix it.

### Output Files

After validation, two files are written to your output directory:

- **`DIAGNOSTIC.md`** — human-readable report with fix instructions per failure
- **`.toetslib-report.json`** — machine-readable report for CI/CD integration

### What the Report Contains

For each failing test, the report includes:

| Field | Description |
|-------|-------------|
| **Test name** | Which test failed |
| **File** | Which spec file it's in |
| **Category** | selector / timeout / assertion / navigation |
| **Error** | The exact error message from Playwright |
| **Selector** | The locator that failed (if applicable) |
| **Expected / Actual** | What was expected vs what was found |
| **How to fix** | Step-by-step instructions specific to the failure category |

### Failure Categories

| Category | What it means | Typical fix |
|----------|---------------|-------------|
| **Selector** | Element not found in the DOM | Update the locator to match the actual element (add `data-testid`, use `getByRole`) |
| **Timeout** | Element didn't appear in time | Check if backend APIs are running, or if the element needs data to render |
| **Assertion** | Element exists but content is wrong | Check formatting (currency, dates), use flexible matchers like `toContainText` |
| **Navigation** | Page didn't load or redirect failed | Check route configuration, authentication, HTTPS settings |

### Recommendations

The report includes actionable recommendations based on the failure patterns found, such as:

- Adding `data-testid` attributes to key elements for stable selectors
- Setting up API mocks for tests that depend on backend data
- Configuring auth credentials for routes that require login

---

## Supported Frameworks

### Currently Supported

| Framework | Detection | Notes |
|-----------|-----------|-------|
| **React + Vite** | `vite` + `@vitejs/plugin-react` in dependencies | Full support including workspace monorepos |
| **Create React App** | `react-scripts` in dependencies | Detected from `scripts.start` |
| **Next.js** | `next` in dependencies | App Router and Pages Router |

### Route Detection

| Pattern | Supported |
|---------|-----------|
| `<Route path="..." element={...} />` | Yes |
| `createBrowserRouter([...])` | Yes |
| Route arrays mapped with `.map()` | Yes |
| Route constants in separate files | Yes |
| File-based routing (Next.js) | Yes |
| Dynamic route params (`/user/:id`) | Yes |

### Form Detection

toetsLib recognizes both native HTML form elements and common React form libraries:

- Native: `<input>`, `<select>`, `<textarea>`, `<form>`
- Custom components: detected by prop patterns (name, label, onChange, value)
- Common libraries: configurable component-to-type mapping

---

## Troubleshooting

### "Framework not detected"

Make sure your `package.json` lists React and a bundler (Vite, react-scripts, or Next.js) as dependencies. If you have an unusual setup, use `.toetslib.json` to manually specify `devCommand` and `devPort`.

### "Dev server failed to start"

- Check that `npm run dev` (or your dev command) works manually
- If your project uses workspace monorepos, toetsLib walks up to find the workspace root and installs from there
- For HTTPS dev servers (self-signed certs), toetsLib handles this automatically

### "No routes found"

Run `toetslib analyze ./my-app --json --verbose` to see what the static analyzer finds. Common issues:
- Routes defined in an unusual pattern that the parser doesn't recognize
- Routes generated dynamically at runtime (not visible in source code)
- Route file not within the detected `srcDir`

### "Tests fail after healing"

Check `.toetslib-report.json` for `"needs-review"` tests. Common causes:
- The app requires backend state (database records, API responses) that doesn't exist in the test environment
- Authentication is required but no credentials were provided
- The page has client-side rendering that depends on timing

### "ANTHROPIC_API_KEY not set"

The `generate` and `validate` commands require an Anthropic API key for AI-powered test generation and healing. Set it:

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
```

The `analyze` and `crawl` commands work without an API key since they don't use AI.

---

## Examples

### Basic React + Vite App

```bash
toetslib generate ./my-vite-app
```

### Next.js App with Auth

```bash
toetslib generate ./my-nextjs-app \
  --auth-url http://localhost:3000/login \
  --auth-email admin@test.com \
  --auth-password testpass123
```

### Monorepo with Specific Client

```bash
# Point to the specific client package
toetslib generate ./monorepo/apps/web --output ./monorepo/apps/web/e2e
```

### Debug What the Analyzer Sees

```bash
# Step 1: Check static analysis
toetslib analyze ./my-app --json | jq '.routes'

# Step 2: Check what the browser finds
toetslib crawl ./my-app --json | jq '.pages'

# Step 3: Generate without running tests
toetslib generate ./my-app --no-validate

# Step 4: Run tests with healing
toetslib validate ./my-app
```

### Using a Config File

```bash
# Create config
cat > .toetslib.json << 'EOF'
{
  "devCommand": "npm run dev",
  "devPort": 3000,
  "baseUrl": "http://localhost:3000",
  "exclude": ["/admin/*", "/internal/*"],
  "outputDir": "./tests/e2e",
  "maxHealCycles": 2
}
EOF

# Run with config (auto-detected from project root)
toetslib generate .

# Or specify config path explicitly
toetslib generate . --config ./custom-config.json
```

### CI/CD Integration

```yaml
# GitHub Actions example
- name: Generate e2e tests
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    npx toetslib generate . --output ./e2e

- name: Run generated tests
  run: |
    cd e2e && npx playwright test
```

---

## Architecture Overview

toetsLib is built as a Turborepo monorepo with focused packages:

| Package | Purpose |
|---------|---------|
| `@toetslib/cli` | CLI entry point (commander) |
| `@toetslib/core` | Pipeline orchestrator, AppMap types |
| `@toetslib/shared` | Logger, file utils, LLM client |
| `@toetslib/ingest` | Framework detection, dev server management |
| `@toetslib/analyzer` | AST-based static code analysis |
| `@toetslib/crawler` | Headless browser crawling with Playwright |
| `@toetslib/generator` | AI-powered test code generation |
| `@toetslib/validator` | Test runner and self-healing loop |

The central data structure is the **AppMap** -- a single object that each pipeline stage enriches with its findings. The AppMap flows through all 5 stages, accumulating project info, routes, forms, crawled pages, and finally test results.
