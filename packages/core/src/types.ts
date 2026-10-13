export interface AppMap {
  project: {
    name: string;
    path: string;
    framework: "react-vite" | "react-cra" | "nextjs" | "spring-thymeleaf";
    packageManager: "npm" | "yarn" | "pnpm" | "bun";
    devCommand: string;
    devPort: number;
    srcDir: string;
  };

  routes: Route[];
  components: ComponentMap[];
  forms: FormSpec[];
  apiCalls: ApiCall[];
  auth: AuthConfig;

  pages: CrawledPage[];
  interactions: InteractiveElement[];
  screenshots: Screenshot[];
  navigationGraph: NavEdge[];

  testPlan: TestPlan;

  results: TestResult[];
  healAttempts: HealAttempt[];
}

export interface Route {
  path: string;
  componentFile: string;
  componentName: string;
  isPublic: boolean;
  authGuard: string | null;
  /**
   * True when the path contains placeholders ({id}, :id, [slug]) and so cannot
   * be fetched literally. Such routes seed the crawl's known-path set but are
   * only visited once a real link to a concrete instance is discovered.
   */
  templated?: boolean;
}

export interface FormSpec {
  pageRoute: string;
  fields: FormField[];
  submitSelector: string;
  validationRules: string[];
}

export interface FormField {
  name: string;
  type:
    | "text"
    | "number"
    | "date"
    | "select"
    | "checkbox"
    | "radio"
    | "money"
    | "textarea";
  label: string;
  required: boolean;
  selector: string;
}

export interface ApiCall {
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  sourceFile: string;
  hookName: string | null;
}

export interface AuthConfig {
  type: "context" | "redirect" | "cookie" | "none";
  loginRoute: string | null;
  trialMode: boolean;
  restrictions: string[];
}

export interface CrawledPage {
  url: string;
  route: string;
  title: string;
  screenshotPath: string;
  interactiveElements: InteractiveElement[];
  consoleErrors: string[];
  networkErrors: string[];
}

export interface InteractiveElement {
  type: "button" | "link" | "input" | "select" | "checkbox";
  text: string;
  selector: string;
  ariaRole: string | null;
  ariaLabel: string | null;
}

export interface TestPlan {
  files: TestFileSpec[];
  totalTests: number;
}

export interface TestFileSpec {
  name: string;
  pageObject: string;
  tests: TestCaseSpec[];
}

export interface TestCaseSpec {
  name: string;
  category: "smoke" | "happy-path" | "validation" | "edge-case" | "responsive";
  steps: string[];
}

export interface TestResult {
  testName: string;
  specFile: string;
  status: "passed" | "failed" | "healed" | "needs-review";
  error: string | null;
  healHistory: string[];
}

export interface HealAttempt {
  cycle: number;
  testName: string;
  specFile: string;
  originalError: string;
  fix: string;
  succeeded: boolean;
}

export interface ComponentMap {
  route: string;
  pageComponent: string;
  filePath: string;
  childComponents: string[];
  imports: string[];
}

export interface Screenshot {
  route: string;
  viewport: "mobile" | "tablet" | "desktop";
  filePath: string;
  width: number;
  height: number;
}

export interface NavEdge {
  from: string;
  to: string;
  trigger: "link" | "button" | "redirect";
  selector: string | null;
}

export interface PipelineConfig {
  repoPath: string;
  outputDir: string;
  baseUrl: string | null;
  auth: {
    url: string | null;
    email: string | null;
    password: string | null;
  };
  maxHealCycles: number;
  verbose: boolean;
  skipValidation: boolean;
  jsonOutput: boolean;

  /**
   * Treat the app at baseUrl as already running: skip dependency install and
   * dev-server spawn entirely. Required for stacks toetsLib cannot boot itself
   * (Spring Boot, Rails, Django, or anything started by hand).
   */
  externalServer: boolean;
  /** Overrides detection. Ignored when externalServer is true. */
  devCommand: string | null;
  /** Overrides detection. */
  devPort: number | null;
  /** Extra seed paths for the crawl, merged with statically discovered routes. */
  routes: string[];
  /**
   * Launch an installed browser instead of Playwright's bundled Chromium
   * ("chrome", "msedge", "chrome-beta", ...). Useful where the bundled
   * download is unavailable, blocked, or simply not worth fetching.
   */
  browserChannel: string | null;
  crawl: CrawlConfig;
}

export interface CrawlConfig {
  /** Hard ceiling on pages visited, so link-following cannot run away. */
  maxPages: number;
  /** Follow internal links to pages that static analysis never found. */
  followLinks: boolean;
  /** Path prefixes to never visit (logout, destructive actions, binaries). */
  exclude: string[];
}
