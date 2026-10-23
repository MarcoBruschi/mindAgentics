/**
 * Broadcast an announcement or message to all connected agent terminals across the canvas workspace.
 *
 * @example
 * ```bash
 * mindagentics say "Release build completed successfully. QA phase starting."
 * ```
 *
 * @param message Content of the message to broadcast
 */
export declare function say(message: string): Promise<{ deliveredCount: number }>;
