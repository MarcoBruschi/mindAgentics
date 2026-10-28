import { exec, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface GraphifyBuildParams {
  target: string;
  isGitUrl?: boolean;
  branch?: string;
  directed?: boolean;
  mode?: 'code-only' | 'full';
}

export interface GraphifyBuildResult {
  ok: boolean;
  projectName: string;
  projectDir: string;
  htmlUrl: string;
  graphHtmlPath: string;
  graphReportPath: string;
  reportContent: string;
  nodesCount: number;
  edgesCount: number;
  error?: string;
}

export interface GraphifyEnv {
  pythonBin: string;
  scriptsDir: string;
  graphifyBin?: string;
  augmentedEnv: NodeJS.ProcessEnv;
}

export class GraphifyService {
  private cachedEnv: GraphifyEnv | null = null;
  private isInstalling = false;

  /**
   * Discovers Python, Graphify binaries, and builds an augmented environment PATH
   * that guarantees child processes find Python and its Scripts directory.
   */
  public async resolveEnvironment(): Promise<GraphifyEnv> {
    if (this.cachedEnv) {
      return this.cachedEnv;
    }

    const isWin = process.platform === 'win32';
    const pathSep = isWin ? ';' : ':';
    const currentPath = process.env.PATH || '';

    // Collect candidate Python executables
    const candidatePythons: string[] = [];

    // 1. From PATH
    candidatePythons.push('python', 'python3', 'py');

    // 2. Standard Windows Python locations
    if (isWin) {
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData) {
        const pyPrograms = path.join(localAppData, 'Programs', 'Python');
        if (fs.existsSync(pyPrograms)) {
          try {
            const dirs = fs.readdirSync(pyPrograms);
            // Sort to prefer newer versions e.g. Python312, Python311, Python310
            dirs.sort().reverse();
            for (const d of dirs) {
              const fullPy = path.join(pyPrograms, d, 'python.exe');
              if (fs.existsSync(fullPy)) {
                candidatePythons.push(fullPy);
              }
            }
          } catch {}
        }
      }

      const programFiles = process.env.ProgramFiles;
      if (programFiles) {
        try {
          const dirs = fs.readdirSync(programFiles).filter((d) => d.startsWith('Python3'));
          dirs.sort().reverse();
          for (const d of dirs) {
            const fullPy = path.join(programFiles, d, 'python.exe');
            if (fs.existsSync(fullPy)) candidatePythons.push(fullPy);
          }
        } catch {}
      }

      const programFilesX86 = process.env['ProgramFiles(x86)'];
      if (programFilesX86) {
        try {
          const dirs = fs.readdirSync(programFilesX86).filter((d) => d.startsWith('Python3'));
          dirs.sort().reverse();
          for (const d of dirs) {
            const fullPy = path.join(programFilesX86, d, 'python.exe');
            if (fs.existsSync(fullPy)) candidatePythons.push(fullPy);
          }
        } catch {}
      }

      // Root C:\Python3*
      try {
        const rootDirs = fs.readdirSync('C:\\').filter((d) => d.startsWith('Python3'));
        for (const d of rootDirs) {
          const fullPy = path.join('C:\\', d, 'python.exe');
          if (fs.existsSync(fullPy)) candidatePythons.push(fullPy);
        }
      } catch {}
    } else {
      // Unix candidates
      candidatePythons.push(
        '/usr/local/bin/python3',
        '/opt/homebrew/bin/python3',
        '/usr/bin/python3',
        path.join(os.homedir(), '.local/bin/python3')
      );
    }

    // Try each Python candidate to find a valid interpreter and its sysconfig scripts path
    let resolvedPython = '';
    let resolvedScriptsDir = '';

    for (const py of candidatePythons) {
      try {
        const cmd = py === 'py' ? 'py -3' : `"${py}"`;
        const { stdout } = await execAsync(
          `${cmd} -c "import sys, sysconfig; print('PY:' + sys.executable); print('SCRIPTS:' + (sysconfig.get_path('scripts') or ''))"`,
          { timeout: 5000 }
        );
        const lines = stdout.trim().split(/\r?\n/);
        for (const line of lines) {
          if (line.startsWith('PY:')) resolvedPython = line.substring(3).trim();
          if (line.startsWith('SCRIPTS:')) resolvedScriptsDir = line.substring(8).trim();
        }
        if (resolvedPython && fs.existsSync(resolvedPython)) {
          break;
        }
      } catch {}
    }

    if (!resolvedPython) {
      throw new Error(
        'Python 3 não foi localizado no sistema. O motor integrado Graphify requer o Python 3 instalado para análise determinística via AST. Baixe em https://www.python.org/downloads/ ou instale via winget ("winget install Python.Python.3.11").'
      );
    }

    // Locate graphify binary in scripts dir or in PATH
    let graphifyBin: string | undefined;
    if (resolvedScriptsDir) {
      const candidateGraphify = path.join(resolvedScriptsDir, isWin ? 'graphify.exe' : 'graphify');
      if (fs.existsSync(candidateGraphify)) {
        graphifyBin = candidateGraphify;
      }
    }

    // Augment PATH with Python's directory and Scripts directory
    const newPaths = [resolvedScriptsDir, path.dirname(resolvedPython)].filter(Boolean);
    const augmentedPath = [...newPaths, currentPath].join(pathSep);

    const augmentedEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: augmentedPath,
      PYTHONIOENCODING: 'utf-8',
    };

    this.cachedEnv = {
      pythonBin: resolvedPython,
      scriptsDir: resolvedScriptsDir,
      graphifyBin,
      augmentedEnv,
    };

    return this.cachedEnv;
  }

  /**
   * Ensures that the graphifyy package and command are installed and runnable.
   * If not installed, it auto-bootstraps `pip install graphifyy` automatically.
   */
  public async ensureGraphifyReady(onProgress?: (msg: string) => void): Promise<GraphifyEnv> {
    const env = await this.resolveEnvironment();

    // Test if graphify is runnable
    const isReady = await this.testGraphify(env);
    if (isReady) {
      return env;
    }

    if (this.isInstalling) {
      while (this.isInstalling) {
        await new Promise((r) => setTimeout(r, 500));
      }
      return this.ensureGraphifyReady(onProgress);
    }

    this.isInstalling = true;
    try {
      onProgress?.('Integrando motor Graphify à plataforma mindAgentics (1ª execução)...');

      // Run pip install graphifyy
      await execFileAsync(
        env.pythonBin,
        ['-m', 'pip', 'install', 'graphifyy', '--disable-pip-version-check'],
        { env: env.augmentedEnv, timeout: 300000 }
      );

      // Invalidate cache to discover newly created scripts/binaries
      this.cachedEnv = null;
      const refreshedEnv = await this.resolveEnvironment();

      const verify = await this.testGraphify(refreshedEnv);
      if (!verify) {
        throw new Error('Falha ao verificar instalação do Graphify após pip install.');
      }

      onProgress?.('Motor Graphify integrado com sucesso!');
      return refreshedEnv;
    } finally {
      this.isInstalling = false;
    }
  }

  private async testGraphify(env: GraphifyEnv): Promise<boolean> {
    try {
      if (env.graphifyBin && fs.existsSync(env.graphifyBin)) {
        await execFileAsync(env.graphifyBin, ['--help'], {
          env: env.augmentedEnv,
          timeout: 8000,
        });
        return true;
      }

      await execFileAsync(env.pythonBin, ['-m', 'graphify', '--help'], {
        env: env.augmentedEnv,
        timeout: 8000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Runs graphify with the given arguments, using the resolved binary or python -m graphify.
   */
  public async runGraphify(
    args: string[],
    options?: { cwd?: string; timeout?: number }
  ): Promise<{ stdout: string; stderr: string }> {
    const env = await this.ensureGraphifyReady();
    const cwd = options?.cwd || process.cwd();
    const timeout = options?.timeout || 180000;

    if (env.graphifyBin && fs.existsSync(env.graphifyBin)) {
      try {
        const { stdout, stderr } = await execFileAsync(env.graphifyBin, args, {
          cwd,
          env: env.augmentedEnv,
          timeout,
          maxBuffer: 50 * 1024 * 1024,
        });
        return { stdout: stdout.trim(), stderr: stderr.trim() };
      } catch (err: any) {
        // Fall back to python -m graphify if the .exe failed
        const { stdout, stderr } = await execFileAsync(env.pythonBin, ['-m', 'graphify', ...args], {
          cwd,
          env: env.augmentedEnv,
          timeout,
          maxBuffer: 50 * 1024 * 1024,
        });
        return { stdout: stdout.trim(), stderr: stderr.trim() };
      }
    }

    const { stdout, stderr } = await execFileAsync(env.pythonBin, ['-m', 'graphify', ...args], {
      cwd,
      env: env.augmentedEnv,
      timeout,
      maxBuffer: 50 * 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  }

  /**
   * Clones a remote repository using Graphify's clone command with a fallback to native git clone.
   */
  public async cloneRepo(
    url: string,
    branch?: string,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    onProgress?.(`Clonando repositório ${url}...`);

    try {
      const cloneArgs = ['clone', url];
      if (branch) cloneArgs.push('--branch', branch);

      const { stdout } = await this.runGraphify(cloneArgs);
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

      // Look for line starting with "Ready at:" or the last directory line
      for (const line of lines) {
        if (line.startsWith('Ready at:')) {
          const parsed = line.replace('Ready at:', '').trim();
          if (fs.existsSync(parsed)) return parsed;
        }
      }

      const lastLine = lines[lines.length - 1];
      if (lastLine && fs.existsSync(lastLine)) {
        return lastLine;
      }
    } catch (err: any) {
      console.warn('[GraphifyService] Built-in clone failed, trying git clone fallback:', err.message);
    }

    // Git fallback: clone into ~/.graphify/repos/<owner>/<repo>
    const urlParts = url.replace(/\/$/, '').split('/');
    const repoName = (urlParts.pop() || 'repo').replace(/\.git$/, '');
    const ownerName = urlParts.pop() || 'external';
    const destDir = path.join(os.homedir(), '.graphify', 'repos', ownerName, repoName);

    if (fs.existsSync(destDir)) {
      onProgress?.(`Repositório existente detectado em ${destDir}, atualizando...`);
      try {
        await execAsync('git pull', { cwd: destDir });
        if (branch) {
          await execAsync(`git checkout "${branch}"`, { cwd: destDir });
        }
        return destDir;
      } catch {}
      return destDir;
    }

    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    const gitCmd = `git clone --depth 1 ${branch ? `-b "${branch}"` : ''} "${url}" "${destDir}"`;
    await execAsync(gitCmd);
    return destDir;
  }

  /**
   * Main build pipeline: ensures environment, clones if needed, extracts AST, clusters communities,
   * generates interactive visualizer, and returns full metadata.
   */
  public async build(
    params: GraphifyBuildParams,
    onProgress?: (msg: string) => void
  ): Promise<GraphifyBuildResult> {
    const target = params?.target?.trim() || '.';
    const directed = params?.directed !== false;
    let projectDir = target;

    // 1. Ensure Graphify is ready & installed
    onProgress?.('Verificando motor Graphify integrado...');
    await this.ensureGraphifyReady(onProgress);

    // 2. Clone if remote git repo
    if (params?.isGitUrl || target.startsWith('http://') || target.startsWith('https://')) {
      projectDir = await this.cloneRepo(target, params.branch, onProgress);
    }

    projectDir = path.resolve(projectDir);

    if (!fs.existsSync(projectDir)) {
      throw new Error(`Diretório do projeto não encontrado: ${projectDir}`);
    }

    // 3. Extract AST deterministically
    onProgress?.('Extraindo AST e relações de dependências determinísticas...');
    const extractArgs = [projectDir];
    if (directed) extractArgs.push('--directed');
    if (params.mode === 'code-only' || true) {
      // By default use code-only for deterministic zero-token local execution
      extractArgs.push('--code-only');
    }

    try {
      await this.runGraphify(extractArgs, { cwd: projectDir });
    } catch (err: any) {
      console.warn('[GraphifyService] Extraction warning, attempting fallback:', err.message);
      await this.runGraphify([projectDir, '--code-only'], { cwd: projectDir });
    }

    const outDir = path.join(projectDir, 'graphify-out');
    const graphHtml = path.join(outDir, 'graph.html');
    const graphJson = path.join(outDir, 'graph.json');
    const graphReport = path.join(outDir, 'GRAPH_REPORT.md');

    // 4. Community clustering and visualizer generation
    if (!fs.existsSync(graphReport) || !fs.existsSync(graphHtml)) {
      onProgress?.('Agrupando comunidades arquiteturais e gerando visualizador interativo...');
      try {
        await this.runGraphify(['cluster-only', projectDir, '--no-label'], { cwd: projectDir });
      } catch (err: any) {
        console.warn('[GraphifyService] Cluster-only notice:', err.message);
      }

      if (!fs.existsSync(graphHtml) && fs.existsSync(graphJson)) {
        try {
          await this.runGraphify(['export', 'html', '--graph', graphJson], { cwd: projectDir });
        } catch {}
      }
    }

    // 5. Read output stats
    let reportText = '';
    if (fs.existsSync(graphReport)) {
      reportText = fs.readFileSync(graphReport, 'utf-8');
    }

    let nodesCount = 0;
    let edgesCount = 0;
    if (fs.existsSync(graphJson)) {
      try {
        const data = JSON.parse(fs.readFileSync(graphJson, 'utf-8'));
        nodesCount = data.nodes?.length || 0;
        edgesCount = (data.links || data.edges)?.length || 0;
      } catch {}
    }

    const projectName = path.basename(projectDir);
    const htmlUrl = 'file:///' + graphHtml.replace(/\\/g, '/');

    onProgress?.(`Grafo concluído com sucesso: ${nodesCount} nós, ${edgesCount} arestas.`);

    return {
      ok: true,
      projectName,
      projectDir,
      htmlUrl,
      graphHtmlPath: graphHtml,
      graphReportPath: graphReport,
      reportContent: reportText,
      nodesCount,
      edgesCount,
    };
  }

  /**
   * Check if a directory or any of its parents has a generated knowledge graph.
   */
  public check(dir: string): {
    hasGraph: boolean;
    projectName?: string;
    projectDir?: string;
    reportContent?: string;
    htmlUrl?: string;
    graphHtmlPath?: string;
    graphJsonPath?: string;
  } {
    let curr = path.resolve(dir || process.cwd());
    for (let i = 0; i < 4; i++) {
      const rep = path.join(curr, 'graphify-out', 'GRAPH_REPORT.md');
      const html = path.join(curr, 'graphify-out', 'graph.html');
      const json = path.join(curr, 'graphify-out', 'graph.json');
      if (fs.existsSync(json) && (fs.existsSync(rep) || fs.existsSync(html))) {
        return {
          hasGraph: true,
          projectName: path.basename(curr),
          projectDir: curr,
          reportContent: fs.existsSync(rep) ? fs.readFileSync(rep, 'utf-8') : '',
          htmlUrl: 'file:///' + html.replace(/\\/g, '/'),
          graphHtmlPath: html,
          graphJsonPath: json,
        };
      }
      const parent = path.dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
    return { hasGraph: false };
  }

  /**
   * Query the knowledge graph using semantic breadth-first traversal.
   */
  public async query(dir: string, question: string, dfs?: boolean): Promise<string> {
    const args = ['query', question];
    if (dfs) args.push('--dfs');
    const { stdout, stderr } = await this.runGraphify(args, { cwd: dir });
    return stdout || stderr;
  }

  /**
   * Explain a symbol or community node and its neighbors in plain language.
   */
  public async explain(dir: string, symbol: string, all?: boolean): Promise<string> {
    const args = ['explain', symbol];
    if (all) args.push('--all');
    const { stdout, stderr } = await this.runGraphify(args, { cwd: dir });
    return stdout || stderr;
  }

  /**
   * Find shortest path between two nodes.
   */
  public async path(dir: string, from: string, to: string, undirected?: boolean): Promise<string> {
    const args = ['path', from, to];
    if (undirected) args.push('--undirected');
    const { stdout, stderr } = await this.runGraphify(args, { cwd: dir });
    return stdout || stderr;
  }
}
