export interface AppMap {
  project: {
    name: string;
    path: string;
    framework: "react-vite" | "react-cra" | "nextjs";
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
}
