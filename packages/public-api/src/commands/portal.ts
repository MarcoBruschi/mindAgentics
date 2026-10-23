import type { BrowserPortal } from '../models/canvas.js';

export interface PortalOpenOptions {
  /** Optional custom title for the portal window */
  name?: string;
  /** Initial window width */
  width?: number;
  /** Initial window height */
  height?: number;
}

/**
 * Manage and automate interactive browser portals on the mindAgentics canvas.
 */
export interface CanvasPortalAPI {
  /**
   * Open a web portal or local file (e.g. graph.html) on the canvas.
   *
   * @example
   * ```bash
   * mindagentics portal open "https://react.dev" --name "React Documentation"
   * mindagentics portal open "file:///C:/prog/mindAgentics/graphify-out/graph.html" --name "Knowledge Graph"
   * ```
   */
  open(url: string, options?: PortalOpenOptions): Promise<BrowserPortal>;

  /**
   * Navigate an existing portal to a new URL.
   *
   * @example
   * ```bash
   * mindagentics portal navigate "https://nextjs.org/docs" --name "Web Reference"
   * ```
   */
  navigate(url: string, portalName?: string): Promise<void>;

  /**
   * Click an element inside the browser portal via CSS selector.
   *
   * @example
   * ```bash
   * mindagentics portal click "button#submit"
   * ```
   */
  click(selector: string, portalName?: string): Promise<void>;

  /**
   * Fill an input field inside the browser portal.
   *
   * @example
   * ```bash
   * mindagentics portal fill "input[name='search']" "Knowledge Graph"
   * ```
   */
  fill(selector: string, value: string, portalName?: string): Promise<void>;

  /**
   * Capture a PNG screenshot of the browser portal.
   *
   * @example
   * ```bash
   * mindagentics portal screenshot --out "docs/portal-view.png"
   * ```
   */
  screenshot(outputPath?: string, portalName?: string): Promise<string>;

  /**
   * Evaluate a JavaScript expression inside the browser portal.
   *
   * @example
   * ```bash
   * mindagentics portal eval "document.title"
   * ```
   */
  eval(expression: string, portalName?: string): Promise<any>;
}
