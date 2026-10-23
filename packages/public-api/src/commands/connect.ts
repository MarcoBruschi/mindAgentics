import type { CableTie } from '../models/canvas.js';

export interface ConnectOptions {
  /** Visual wire style: solid, dashed, or highlighted accent */
  style?: 'solid' | 'dashed' | 'accent';
  /** Optional descriptive label attached to the wire */
  label?: string;
}

/**
 * Connect two nodes on the canvas using a CableTie wire (e.g. Agent to Portal, Agent to Note, Agent to Agent).
 *
 * @example
 * ```bash
 * mindagentics connect "Frontend Dev" "React Documentation"
 * mindagentics connect "Backend Dev" "API Specifications Note"
 * ```
 *
 * @param from Node name or ID
 * @param to Target node name or ID
 * @param options Styling and labeling options
 */
export declare function connectNodes(
  from: string,
  to: string,
  options?: ConnectOptions
): Promise<CableTie>;
