import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import type { CommandHandler } from '../../daemon/pipeServer.js';
import { portalCommand } from './portal.js';

const execFileAsync = promisify(execFile);

async function runGraphify(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const isWin = process.platform === 'win32';
    try {
      const { stdout, stderr } = await execFileAsync('graphify', args, { cwd, shell: isWin, timeout: 120000 });
      return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
    } catch (err: any) {
      if (err.code === 'ENOENT' || (err.message && err.message.includes('not recognized'))) {
        const { stdout, stderr } = await execFileAsync('python', ['-m', 'graphify', ...args], { cwd, shell: isWin, timeout: 120000 });
        return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
      }
      return {
        stdout: err.stdout?.toString().trim() || '',
        stderr: err.stderr?.toString().trim() || err.message,
        code: typeof err.code === 'number' ? err.code : 1,
      };
    }
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString().trim() || '',
      stderr: err.stderr?.toString().trim() || err.message,
      code: typeof err.code === 'number' ? err.code : 1,
    };
  }
}

export const graphifyCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const [subaction, ...restArgs] = req.args;
  const action = (subaction || '').toLowerCase();

  const caller = state.terminals.get(req.terminalId);
  const ws = caller ? state.workspaces.get(caller.workspaceId) : undefined;
  const targetDir = (req.options?.dir as string) || (req.options?.cwd as string) || ws?.workingDirectory || process.cwd();

  switch (action) {
    case 'build':
    case 'create': {
      let dir = restArgs[0] || targetDir;
      const isMindAgenticsRoot = fs.existsSync(path.join(dir, 'packages', 'public-api'));
      const targetScanDir = isMindAgenticsRoot ? path.join(dir, 'packages', 'public-api') : dir;

      const flags: string[] = [targetScanDir];
      if (req.options?.mode) {
        flags.push('--mode', String(req.options.mode));
      } else if (isMindAgenticsRoot) {
        flags.push('--code-only');
      }
      if (req.options?.update) flags.push('--update');
      if (req.options?.mcp) flags.push('--mcp');

      const res = await runGraphify(flags, targetScanDir);
      if (res.code !== 0) {
        return {
          error: `Graphify build failed:\n${res.stderr || res.stdout}`,
          exitCode: res.code,
        };
      }

      // If we scanned public-api, copy the output to root graphify-out so queries and canvas portals find it
      if (isMindAgenticsRoot) {
        const srcOut = path.join(targetScanDir, 'graphify-out');
        const destOut = path.join(dir, 'graphify-out');
        if (fs.existsSync(srcOut)) {
          fs.cpSync(srcOut, destOut, { recursive: true, force: true });
        }
      }

      const outDir = path.join(dir, 'graphify-out');
      const htmlPath = path.join(outDir, 'graph.html');
      const jsonPath = path.join(outDir, 'graph.json');
      const reportPath = path.join(outDir, 'GRAPH_REPORT.md');

      let summary = res.stdout;
      if (fs.existsSync(htmlPath)) {
        summary += `\n\nKnowledge Graph generated successfully:\n- Interactive Visualizer: ${htmlPath}\n- Full Graph JSON: ${jsonPath}\n- Report: ${reportPath}\n\nTip: Run 'mindagentics graphify open' to view the interactive graph on your mindAgentics canvas!`;
      }
      return { output: summary, exitCode: 0 };
    }

    case 'query': {
      const question = restArgs.join(' ') || (req.options?.q as string);
      if (!question) {
        return { error: 'mindagentics graphify query: question required. Usage: mindagentics graphify query "<question>"', exitCode: 1 };
      }
      const flags: string[] = ['query', question];
      if (req.options?.dfs) flags.push('--dfs');
      if (req.options?.budget) flags.push('--budget', String(req.options.budget));

      const res = await runGraphify(flags, targetDir);
      return {
        output: res.stdout || res.stderr,
        exitCode: res.code,
      };
    }

    case 'explain': {
      const concept = restArgs.join(' ');
      if (!concept) {
        return { error: 'mindagentics graphify explain: concept/symbol required. Usage: mindagentics graphify explain "<symbol>"', exitCode: 1 };
      }
      const flags: string[] = ['explain', concept];
      if (req.options?.all) flags.push('--all');

      const res = await runGraphify(flags, targetDir);
      return {
        output: res.stdout || res.stderr,
        exitCode: res.code,
      };
    }

    case 'path': {
      const [nodeA, nodeB] = restArgs;
      if (!nodeA || !nodeB) {
        return { error: 'mindagentics graphify path: two nodes required. Usage: mindagentics graphify path "<nodeA>" "<nodeB>"', exitCode: 1 };
      }
      const flags: string[] = ['path', nodeA, nodeB];
      if (req.options?.undirected) flags.push('--undirected');

      const res = await runGraphify(flags, targetDir);
      return {
        output: res.stdout || res.stderr,
        exitCode: res.code,
      };
    }

    case 'open':
    case 'view': {
      const dir = restArgs[0] || targetDir;
      const htmlPath = path.join(dir, 'graphify-out', 'graph.html');
      if (!fs.existsSync(htmlPath)) {
        return {
          error: `No graph.html found in ${path.join(dir, 'graphify-out')}. Run 'mindagentics graphify build' first.`,
          exitCode: 1,
        };
      }

      const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
      const portalReq = {
        ...req,
        command: 'portal',
        args: ['open', fileUrl],
        options: {
          ...req.options,
          name: 'Knowledge Graph',
          title: 'Knowledge Graph (Graphify)',
        },
      };

      return await portalCommand(portalReq, state, router, scheduler, sendToMain);
    }

    case 'status': {
      const outDir = path.join(targetDir, 'graphify-out');
      const hasGraphJson = fs.existsSync(path.join(outDir, 'graph.json'));
      const hasHtml = fs.existsSync(path.join(outDir, 'graph.html'));
      const hasReport = fs.existsSync(path.join(outDir, 'GRAPH_REPORT.md'));

      let nodeCount = 0;
      let edgeCount = 0;
      let communityCount = 0;

      if (hasGraphJson) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(outDir, 'graph.json'), 'utf8'));
          nodeCount = raw.nodes?.length || 0;
          edgeCount = raw.links?.length || raw.edges?.length || 0;
          const comms = new Set(raw.nodes?.map((n: any) => n.community).filter(Boolean));
          communityCount = comms.size;
        } catch {}
      }

      const lines = [
        'Graphify Knowledge Graph Status:',
        `  Target Directory: ${targetDir}`,
        `  Output Directory: ${outDir}`,
        `  Graph Exists:     ${hasGraphJson ? 'Yes' : 'No'}`,
        `  Interactive HTML: ${hasHtml ? 'Yes' : 'No'}`,
        `  Report Markdown:  ${hasReport ? 'Yes' : 'No'}`,
      ];

      if (hasGraphJson) {
        lines.push(
          `  Total Nodes:      ${nodeCount}`,
          `  Total Edges:      ${edgeCount}`,
          `  Communities:      ${communityCount}`
        );
      }

      return { output: lines.join('\n'), exitCode: 0 };
    }

    case 'help':
    default: {
      return {
        output: [
          'Graphify Knowledge Graph CLI for mindAgentics:',
          '',
          'Commands:',
          '  mindagentics graphify build [path] [--mode deep] [--update]  Parse codebase AST and build graph',
          '  mindagentics graphify query "<pergunta>" [--dfs]            Query architecture or relationships',
          '  mindagentics graphify explain "<symbol>"                     Explain symbol and its connections',
          '  mindagentics graphify path "<nodeA>" "<nodeB>"              Find shortest path between 2 concepts',
          '  mindagentics graphify open [path]                            Open interactive HTML graph in Portal',
          '  mindagentics graphify status                                 Check knowledge graph health & stats',
          '',
          'Examples:',
          '  mindagentics graphify build .',
          '  mindagentics graphify open',
          '  mindagentics graphify query "Como funciona a comunicação entre agentes?"',
          '  mindagentics graphify explain "pipeServer"',
        ].join('\n'),
        exitCode: 0,
      };
    }
  }
};
