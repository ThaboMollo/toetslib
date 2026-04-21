import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import waitOn from "wait-on";
import treeKill from "tree-kill";
import { Logger } from "@toetslib/shared";

export class DevServerManager {
  private process: ChildProcess | null = null;
  private logger: Logger;

  constructor(verbose = false) {
    this.logger = new Logger(verbose);
  }

  async start(
    dir: string,
    devCommand: string,
    baseUrl: string,
    workspaceRoot: string | null
  ): Promise<void> {
    // Install dependencies from workspace root if applicable
    const installDir = workspaceRoot ?? dir;
    this.logger.debug(`Installing dependencies from ${installDir}`);

    await this.runCommand("npm", ["install"], installDir);

    // Start dev server from the project dir
    const [cmd, ...args] = devCommand.split(" ");
    this.logger.debug(`Starting dev server: ${devCommand} in ${dir}`);

    this.process = spawn(cmd!, args, {
      cwd: dir,
      stdio: "pipe",
      shell: true,
      env: { ...process.env, NODE_ENV: "development" },
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.logger.debug(`[dev-server] ${data.toString().trim()}`);
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      this.logger.debug(`[dev-server:err] ${data.toString().trim()}`);
    });

    // Wait for the server to be ready
    this.logger.debug(`Waiting for server at ${baseUrl}`);

    const isHttps = baseUrl.startsWith("https");
    try {
      await waitOn({
        resources: [baseUrl.replace("https://", "https-get://").replace("http://", "http-get://")],
        timeout: 60000,
        interval: 500,
        strictSSL: false,
        headers: isHttps ? { "Accept": "text/html" } : undefined,
      });
    } catch (error) {
      await this.stop();
      throw new Error(
        `Dev server failed to start at ${baseUrl} within 60s. ` +
        `Make sure '${devCommand}' works when run from ${dir}`
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.process || this.process.pid === undefined) return;

    return new Promise<void>((resolve) => {
      treeKill(this.process!.pid!, "SIGTERM", (err) => {
        if (err) {
          this.logger.debug(`Error killing dev server: ${err.message}`);
        }
        this.process = null;
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  private runCommand(
    cmd: string,
    args: string[],
    cwd: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd,
        stdio: "pipe",
        shell: true,
      });

      let stderr = "";
      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(`'${cmd} ${args.join(" ")}' exited with code ${code}: ${stderr}`)
          );
        }
      });

      proc.on("error", reject);
    });
  }
}
