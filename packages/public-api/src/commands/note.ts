import type { StickyNote } from '../models/canvas.js';

export interface CreateNoteOptions {
  /** Optional stable custom name for the note (defaults to first line) */
  name?: string;
  /** Initial text content */
  content?: string;
  /** Visual background color */
  color?: string;
  /** Stack the note inside a Fichário collection */
  stack?: string;
}

/**
 * Manage spatial sticky notes and fichários on the mindAgentics canvas.
 */
export interface CanvasNotesAPI {
  /**
   * Create a new sticky note on the canvas linked to the current agent.
   *
   * @example
   * ```bash
   * mindagentics note create --name "Architecture Notes" --body "# System Design\n- Clean Architecture"
   * ```
   */
  create(options?: CreateNoteOptions): Promise<StickyNote>;

  /**
   * Read the content of an existing sticky note with optional line slicing.
   *
   * @example
   * ```bash
   * mindagentics note read "Architecture Notes"
   * mindagentics note read "Architecture Notes" 1 20
   * ```
   */
  read(name: string, startLine?: number, lineCount?: number): Promise<string>;

  /**
   * Replace the full content of a sticky note.
   *
   * @example
   * ```bash
   * mindagentics note write "Architecture Notes" "Updated system specifications..."
   * ```
   */
  write(name: string, content: string): Promise<void>;

  /**
   * Edit a specific substring in a sticky note without overwriting entire file.
   *
   * @example
   * ```bash
   * mindagentics note edit "Architecture Notes" "v1.0" "v2.0"
   * ```
   */
  edit(name: string, oldText: string, newText: string): Promise<void>;

  /**
   * File a note into a fichário stack.
   *
   * @example
   * ```bash
   * mindagentics note stack "Architecture Notes" "Documentation Fichario"
   * ```
   */
  stack(name: string, ficharioName: string): Promise<void>;

  /**
   * Unstack a note from its fichário.
   */
  unstack(name: string): Promise<void>;

  /**
   * Delete a note from the canvas. (Destructive: only run when user explicitly requests).
   */
  delete(name: string): Promise<void>;
}
