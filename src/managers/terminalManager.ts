import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TerminalEntry {
  terminalId: string;
  toolInstanceId: string;
  terminal: vscode.Terminal;
  title: string;
  createdAt: string;
}

/**
 * Public shape returned to callers (e.g. the webview via dispatchTerminal).
 * Matches ToolBoxAPI.Terminal from @pptb/types.
 */
export interface TerminalInfo {
  id: string;
  name: string;
  toolId: string;
  toolInstanceId: string | null;
  shell: string;
  cwd: string;
  isVisible: boolean;
  createdAt: string;
}

export interface TerminalOutputEvent {
  terminalId: string;
  toolInstanceId: string;
  data: string;
}

export interface TerminalClosedEvent {
  terminalId: string;
  toolInstanceId: string;
}

export interface TerminalCommandCompletedEvent {
  terminalId: string;
  toolInstanceId: string;
  exitCode: number | undefined;
}

export interface TerminalCreateOptions {
  name?: string;
  /** Preferred shell executable (e.g. "pwsh", "/bin/zsh"). Falls back to system default if not found. */
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  /** Whether terminal should be visible initially (default: true). */
  visible?: boolean;
}

// Internal storage extends the public TerminalEntry with extra fields needed
// to reconstruct a full TerminalInfo.
interface StoredEntry extends TerminalEntry {
  toolId: string;
  shell: string;
  cwd: string;
  isVisible: boolean;
}

// ── TerminalManager ───────────────────────────────────────────────────────────

/**
 * Wraps `vscode.window.createTerminal`.  One `vscode.Terminal` per `terminalId`,
 * scoped to a tool instance.
 *
 * Events
 * ------
 * `onTerminalOutput` – fired for each data chunk when a shell-integration-tracked
 *   command produces output (via `vscode.window.onDidStartTerminalShellExecution`
 *   and `TerminalShellExecution.read()`). Requires shell integration to be active
 *   in the terminal; silently no-ops when it is not.
 *
 * `onTerminalCommandCompleted` – fired when a shell-integration-tracked command
 *   finishes (via `vscode.window.onDidEndTerminalShellExecution`). Carries the
 *   exit code reported by the shell.
 *
 * `onTerminalClosed` – fired when a terminal is closed, either programmatically
 *   via `close()` or by the user via the VS Code UI.
 */
export class TerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<string, StoredEntry>();
  private commandCounter = 0;

  private readonly _onTerminalOutput =
    new vscode.EventEmitter<TerminalOutputEvent>();
  private readonly _onTerminalClosed =
    new vscode.EventEmitter<TerminalClosedEvent>();
  private readonly _onTerminalCommandCompleted =
    new vscode.EventEmitter<TerminalCommandCompletedEvent>();
  private disposables: vscode.Disposable[] = [];

  /** Fired for each output chunk when shell integration is active on the terminal. */
  readonly onTerminalOutput: vscode.Event<TerminalOutputEvent> =
    this._onTerminalOutput.event;

  /** Fired when a managed terminal is closed (programmatically or by the user). */
  readonly onTerminalClosed: vscode.Event<TerminalClosedEvent> =
    this._onTerminalClosed.event;

  /**
   * Fired when a shell-integration-tracked command finishes.
   * Carries the exit code reported by the shell (`undefined` when unknown).
   */
  readonly onTerminalCommandCompleted: vscode.Event<TerminalCommandCompletedEvent> =
    this._onTerminalCommandCompleted.event;

  constructor() {
    this.disposables.push(
      // Stream output from shell-integration-tracked commands.
      vscode.window.onDidStartTerminalShellExecution((event) => {
        const terminalId = this.findTerminalId(event.terminal);
        if (!terminalId) {
          return;
        }
        const entry = this.terminals.get(terminalId);
        if (!entry) {
          return;
        }
        void this.streamOutput(terminalId, entry.toolInstanceId, event.execution);
      }),

      // Emit command-completion events when shell integration reports an exit code.
      vscode.window.onDidEndTerminalShellExecution((event) => {
        const terminalId = this.findTerminalId(event.terminal);
        if (!terminalId) {
          return;
        }
        const entry = this.terminals.get(terminalId);
        if (!entry) {
          return;
        }
        this._onTerminalCommandCompleted.fire({
          terminalId,
          toolInstanceId: entry.toolInstanceId,
          exitCode: event.exitCode,
        });
      }),

      // Track terminals closed externally (e.g. by the user).
      vscode.window.onDidCloseTerminal((terminal) => {
        const terminalId = this.findTerminalId(terminal);
        if (!terminalId) {
          return;
        }
        const entry = this.terminals.get(terminalId);
        if (!entry) {
          return;
        }
        this.terminals.delete(terminalId);
        this._onTerminalClosed.fire({
          terminalId,
          toolInstanceId: entry.toolInstanceId,
        });
      })
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Create a new VS Code terminal for the given tool instance.
   * Returns a `TerminalInfo` that can be serialised and sent to the webview.
   */
  create(
    options: TerminalCreateOptions,
    toolId: string,
    toolInstanceId: string
  ): TerminalInfo {
    const id = uuidv4();
    const name = options.name ?? "PPTB Terminal";
    const shellPath =
      typeof options.shell === "string" ? options.shell : undefined;

    const terminal = vscode.window.createTerminal({
      name,
      cwd: options.cwd,
      env: options.env,
      shellPath,
    });

    const entry: StoredEntry = {
      terminalId: id,
      toolInstanceId,
      terminal,
      title: name,
      createdAt: new Date().toISOString(),
      toolId,
      shell: options.shell ?? "default",
      cwd: options.cwd ?? "",
      isVisible: options.visible !== false,
    };

    this.terminals.set(id, entry);

    if (entry.isVisible) {
      terminal.show();
    }

    return this.toTerminalInfo(entry);
  }

  /**
   * Send a command to a terminal via `sendText`.
   *
   * When shell integration is active on the terminal, output and completion
   * events will be emitted via `onTerminalOutput` and `onTerminalCommandCompleted`.
   * Without shell integration those events are silent, but the command is still
   * executed.
   */
  execute(
    terminalId: string,
    command: string
  ): { terminalId: string; commandId: string } {
    const entry = this.terminals.get(terminalId);
    if (!entry) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }
    entry.terminal.sendText(command, true);
    return {
      terminalId,
      commandId: `${terminalId}:${++this.commandCounter}`,
    };
  }

  /**
   * Close and dispose a terminal.
   * Fires `onTerminalClosed` synchronously before returning.
   */
  close(terminalId: string): void {
    const entry = this.terminals.get(terminalId);
    if (!entry) {
      return;
    }
    // Remove from map first so the onDidCloseTerminal handler does not double-fire.
    this.terminals.delete(terminalId);
    entry.terminal.dispose();
    this._onTerminalClosed.fire({
      terminalId,
      toolInstanceId: entry.toolInstanceId,
    });
  }

  /** Return the `TerminalInfo` for a given ID, or `undefined` if not found. */
  get(terminalId: string): TerminalInfo | undefined {
    const entry = this.terminals.get(terminalId);
    return entry ? this.toTerminalInfo(entry) : undefined;
  }

  /** Return `TerminalInfo` for all managed terminals. */
  list(): TerminalInfo[] {
    return Array.from(this.terminals.values()).map((e) =>
      this.toTerminalInfo(e)
    );
  }

  /**
   * Show or hide a terminal.
   * Passing `visible = false` does not hide the terminal panel in VS Code (the
   * VS Code API has no "hide" method); it only updates the stored flag so that
   * callers know the intended visibility.
   */
  setVisibility(terminalId: string, visible: boolean): void {
    const entry = this.terminals.get(terminalId);
    if (!entry) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }
    entry.isVisible = visible;
    if (visible) {
      entry.terminal.show();
    }
  }

  dispose(): void {
    // Clear the map before disposing terminals so the onDidCloseTerminal
    // handler finds an empty map and does not re-fire closed events.
    const entries = Array.from(this.terminals.values());
    this.terminals.clear();
    entries.forEach(({ terminal }) => terminal.dispose());

    this._onTerminalOutput.dispose();
    this._onTerminalClosed.dispose();
    this._onTerminalCommandCompleted.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Return the terminalId for a given VS Code Terminal instance, or undefined. */
  private findTerminalId(terminal: vscode.Terminal): string | undefined {
    for (const [terminalId, entry] of this.terminals) {
      if (entry.terminal === terminal) {
        return terminalId;
      }
    }
    return undefined;
  }

  /**
   * Async-iterate over the shell execution's output stream and fire
   * `onTerminalOutput` for each chunk.  Errors are swallowed to avoid
   * unhandled-rejection noise when the terminal closes mid-stream.
   */
  private async streamOutput(
    terminalId: string,
    toolInstanceId: string,
    execution: vscode.TerminalShellExecution
  ): Promise<void> {
    try {
      for await (const data of execution.read()) {
        this._onTerminalOutput.fire({ terminalId, toolInstanceId, data });
      }
    } catch {
      // The terminal may have been closed mid-stream; ignore the error.
    }
  }

  private toTerminalInfo(entry: StoredEntry): TerminalInfo {
    return {
      id: entry.terminalId,
      name: entry.title,
      toolId: entry.toolId,
      toolInstanceId: entry.toolInstanceId,
      shell: entry.shell,
      cwd: entry.cwd,
      isVisible: entry.isVisible,
      createdAt: entry.createdAt,
    };
  }
}
