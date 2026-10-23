import type { CanvasListing } from '../models/canvas.js';

/**
 * List all active agents, sticky notes, browser portals, and cable connections on the canvas.
 *
 * @example
 * ```bash
 * mindagentics list
 * ```
 */
export declare function listCanvas(): Promise<CanvasListing>;
