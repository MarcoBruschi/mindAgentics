export interface NodeStyleOptions {
  name?: string;
  color?: string;
  icon?: string;
}

/**
 * Arrange or restyle a node on the canvas (rename, recolor, icon).
 *
 * @example
 * ```bash
 * mindagentics arrange "Backend Dev" --color "#3b82f6" --icon "server"
 * ```
 */
export declare function arrange(targetName: string, options: NodeStyleOptions): Promise<void>;
