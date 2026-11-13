import type { FileRef } from '../models/canvas.js';

export interface RefAddOptions {
  /** Display label of the node (defaults to the base name of the path) */
  label?: string;
  /** Wire the reference to another agent instead of the caller (injects one `[ref] ...` line) */
  to?: string;
  /** Create the node without wiring it to any agent */
  noConnect?: boolean;
}

/**
 * Create a file/folder reference node on the canvas. Only the path and the type
 * (arquivo/pasta) are ever shared with agents — never the file content.
 *
 * @example
 * ```bash
 * mindagentics ref add ./docs
 * mindagentics ref add ./spec.md --to "Backend Dev"
 * ```
 */
export declare function addRef(path: string, options?: RefAddOptions): Promise<FileRef>;

/**
 * List the references wired to the current agent (or every reference with `all`).
 *
 * @example
 * ```bash
 * mindagentics ref list [--all]
 * ```
 */
export declare function listRefs(options?: { all?: boolean }): Promise<FileRef[]>;

/**
 * Remove a reference from the canvas, or only its link to an agent when `from` is given.
 *
 * @example
 * ```bash
 * mindagentics ref remove ./docs [--from "Backend Dev"]
 * ```
 */
export declare function removeRef(pathOrLabel: string, options?: { from?: string }): Promise<void>;
