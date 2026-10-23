import type { BrowserPortal } from '../models/canvas.js';

export interface GraphifyBuildOptions {
  /** Mode: 'code-only' (deterministic AST extraction without external LLM keys) or 'full' */
  mode?: 'code-only' | 'full';
  /** Incremental update */
  update?: boolean;
}

export interface GraphifyQueryOptions {
  /** Depth-first search instead of breadth-first */
  dfs?: boolean;
  /** Token budget ceiling (default 2000) */
  budget?: number;
}

export interface GraphBuildResult {
  /** Total nodes indexed in the AST graph */
  nodeCount: number;
  /** Total edges discovered */
  edgeCount: number;
  /** Path to the generated interactive HTML viewer */
  htmlPath: string;
  /** Path to the graph.json file */
  jsonPath: string;
  /** Path to the markdown summary report */
  reportPath: string;
}

/**
 * Knowledge Graph API for mindAgentics.
 * Analyzes codebases deterministically via AST and builds persistent queryable architecture graphs.
 */
export interface KnowledgeGraphAPI {
  /**
   * Build a knowledge graph from a local directory or remote repository.
   *
   * @example
   * ```bash
   * mindagentics graphify build .
   * mindagentics graphify build "https://github.com/facebook/react.git"
   * ```
   */
  build(targetDirOrUrl: string, options?: GraphifyBuildOptions): Promise<GraphBuildResult>;

  /**
   * Query the knowledge graph using semantic breadth-first traversal.
   *
   * @example
   * ```bash
   * mindagentics graphify query "How does agent communication work?"
   * ```
   */
  query(question: string, options?: GraphifyQueryOptions): Promise<string>;

  /**
   * Explain a symbol or community node and its neighbors in plain language.
   *
   * @example
   * ```bash
   * mindagentics graphify explain "CanvasToolbar"
   * ```
   */
  explain(symbol: string, options?: { all?: boolean }): Promise<string>;

  /**
   * Discover the shortest relationship path between two nodes in the graph.
   *
   * @example
   * ```bash
   * mindagentics graphify path "recruitAgent" "TerminalNode"
   * ```
   */
  path(fromNode: string, toNode: string, options?: { undirected?: boolean }): Promise<string>;

  /**
   * Open the interactive visualizer (graph.html) inside a browser portal on the canvas.
   *
   * @example
   * ```bash
   * mindagentics graphify open
   * ```
   */
  open(targetDir?: string): Promise<BrowserPortal>;
}
