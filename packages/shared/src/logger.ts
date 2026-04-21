import ora, { type Ora } from "ora";
import chalk from "chalk";

export class Logger {
  private spinner: Ora | null = null;
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  start(text: string): void {
    this.spinner = ora(text).start();
  }

  succeed(text: string): void {
    if (this.spinner) {
      this.spinner.succeed(text);
      this.spinner = null;
    } else {
      console.log(chalk.green("✓") + " " + text);
    }
  }

  fail(text: string): void {
    if (this.spinner) {
      this.spinner.fail(text);
      this.spinner = null;
    } else {
      console.log(chalk.red("✗") + " " + text);
    }
  }

  info(text: string): void {
    if (this.spinner) {
      this.spinner.info(text);
      this.spinner = null;
    } else {
      console.log(chalk.blue("ℹ") + " " + text);
    }
  }

  warn(text: string): void {
    if (this.spinner) {
      this.spinner.warn(text);
      this.spinner = null;
    } else {
      console.log(chalk.yellow("⚠") + " " + text);
    }
  }

  debug(text: string): void {
    if (this.verbose) {
      console.log(chalk.gray("[debug]") + " " + text);
    }
  }

  progress(text: string): void {
    if (this.spinner) {
      this.spinner.text = text;
    }
  }
}
