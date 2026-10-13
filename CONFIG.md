# `.toetslib.json` reference

| Key | Default | Meaning |
|-----|---------|---------|
| `baseUrl` | `http://localhost:<devPort>` | URL to crawl. Setting it implies `externalServer`. |
| `externalServer` | `false` | Skip dependency install and dev-server spawn; the app is already running. |
| `devCommand` | detected | Command that starts the app. Ignored when `externalServer` is true. |
| `devPort` | detected | Port the app listens on. |
| `routes` | `[]` | Extra seed paths, merged with statically discovered routes. |
| `crawl.maxPages` | `150` | Hard ceiling on pages visited. |
| `crawl.followLinks` | `true` | Follow internal links beyond the known routes. |
| `browserChannel` | _(bundled Chromium)_ | Drive an installed browser (`chrome`, `msedge`) instead of downloading one. |
| `crawl.exclude` | `/logout`, `/signout`, `/sign-out` | Path prefixes never visited. |
| `outputDir` | `./e2e` | Where generated tests land. |
| `maxHealCycles` | `3` | Self-healing attempts per failing test. |

## Authentication

`auth.fields` holds **CSS selectors** for the login form. It is not a credential
source — the crawler locates inputs by trying `input[type=email]`,
`input[name=email]`, `input[name=username]`, `#email`, then the password and
submit equivalents.

Credentials come from the CLI, so they stay out of version control:

```bash
toetslib crawl . --base-url http://localhost:8080 \
  --auth-email dev-candidate@example.test \
  --auth-password "$TOETSLIB_TEST_PASSWORD"
```

`auth.email` / `auth.password` are accepted in the config file too, for a
throwaway local account. Do not commit real credentials.

> Earlier versions read `auth.fields.email` as the login address, so a config
> using the documented selector shape attempted to log in with the literal
> string `#email`. Credentials and selectors are now separate keys.
