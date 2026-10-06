/**
 * Elevate — child process helper.
 *
 * Runs external tools (npm, Maven) with an argument list instead of a
 * concatenated command line. On Windows, `npm`, `mvn` and `mvnw` are batch
 * files that can only be started through the shell; there every argument is
 * quoted, and arguments containing shell metacharacters are rejected outright
 * rather than escaped, so a crafted package name can never inject a command.
 * The working directory is handed to the process directly, never through the
 * command line, so callers name files relative to it.
 */

import { exec, spawn } from 'node:child_process';

export interface RunOptions {
  cwd: string;
  /** Kill the process after this many milliseconds. */
  timeoutMs?: number;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Thrown when an argument cannot be passed safely to the shell. */
export class UnsafeArgumentError extends Error {
  constructor(argument: string) {
    super(
      `Cannot pass ${JSON.stringify(argument)} to the Windows command shell: it contains one of the characters ` +
        '" % ! ^ & | < > or a line break, which cmd.exe would interpret. ' +
        'If this is part of a directory or file name, rename it or move the project to a path without these characters.',
    );
    this.name = 'UnsafeArgumentError';
  }
}

const IS_WINDOWS = process.platform === 'win32';

/** Characters cmd.exe interprets even inside double quotes, plus quotes themselves. */
const WINDOWS_UNSAFE = /["%!^&|<>\r\n]/;

/**
 * Runs a command and resolves with its exit code and output. Never rejects for
 * a non-zero exit code; callers decide what a failure means.
 */
export function runCommand(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const spawnOptions = { cwd: options.cwd, windowsHide: true, env: process.env };
    let child;

    if (IS_WINDOWS) {
      for (const arg of [command, ...args]) {
        if (WINDOWS_UNSAFE.test(arg)) {
          reject(new UnsafeArgumentError(arg));
          return;
        }
      }
      // The shell receives one pre-quoted command line; passing an argument
      // array together with `shell: true` is deprecated because Node would
      // concatenate it unescaped.
      const commandLine = [command, ...args].map(quoteWindows).join(' ');
      child = spawn(commandLine, { ...spawnOptions, shell: true });
    } else {
      child = spawn(command, args, spawnOptions);
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child.pid, () => child.kill());
        }, options.timeoutMs)
      : undefined;

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

/**
 * Runs a user-defined command line (`postUpdateScript`) through the shell.
 * The script comes from the repository's own configuration file, not from
 * dependency data, so it is trusted like any other project script.
 */
export function runShellScript(script: string, options: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    exec(
      script,
      { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const timedOut = Boolean(error?.killed);
        const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ exitCode, stdout, stderr, timedOut });
      },
    );
  });
}

/**
 * Kills a process together with its children. On Windows the command runs
 * inside cmd.exe; killing only the shell would leave npm or Java running with
 * the output pipes open, so the 'close' event would never fire.
 */
function killTree(pid: number | undefined, fallback: () => void): void {
  if (!IS_WINDOWS || pid === undefined) {
    fallback();
    return;
  }
  const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  killer.on('error', fallback);
}

/** Returns the last lines of a tool's output for use in error messages. */
export function tail(output: string, lines = 15): string {
  return output.trim().split(/\r?\n/).slice(-lines).join('\n');
}

function quoteWindows(arg: string): string {
  // `=`, `,` and `;` separate arguments for batch files, so they force quoting too.
  return /^[\w.:\\/@+-]+$/.test(arg) ? arg : `"${arg}"`;
}
