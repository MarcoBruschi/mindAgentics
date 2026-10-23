import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import type { FloorDescriptor } from '@mindagentics/shared';

const execFileAsync = promisify(execFile);

export class GitWorktreeService {
  private async runGit(args: string[], cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd });
      return stdout.trim();
    } catch (err: any) {
      throw new Error(`Git command failed: git ${args.join(' ')} (cwd: ${cwd}) - ${err.message || err}`);
    }
  }

  public async isGitRepo(dir: string): Promise<boolean> {
    try {
      const res = await this.runGit(['rev-parse', '--is-inside-work-tree'], dir);
      return res === 'true';
    } catch {
      return false;
    }
  }

  public async getRepoRoot(dir: string): Promise<string> {
    return this.runGit(['rev-parse', '--show-toplevel'], dir);
  }

  public async getCommonDir(dir: string): Promise<string> {
    const raw = await this.runGit(['rev-parse', '--git-common-dir'], dir);
    return path.resolve(dir, raw);
  }

  public async listBranches(dir: string): Promise<string[]> {
    try {
      const out = await this.runGit(['branch', '-a', '--format=%(refname:short)'], dir);
      return out.split('\n').map(b => b.trim()).filter(b => b.length > 0);
    } catch {
      return [];
    }
  }

  public async createIsolatedFloor(options: {
    workspaceId: string;
    floorId: string;
    repoDir: string;
    branch: string;
    baseBranch?: string;
  }): Promise<FloorDescriptor> {
    const repoRoot = await this.getRepoRoot(options.repoDir);
    const commonDir = await this.getCommonDir(options.repoDir);
    const worktreePath = path.join(repoRoot, '.maestri', 'floors', options.floorId);

    await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });

    // Check if branch already exists
    const branches = await this.listBranches(repoRoot);
    const branchExists = branches.includes(options.branch);

    if (branchExists) {
      await this.runGit(['worktree', 'add', worktreePath, options.branch], repoRoot);
    } else {
      const base = options.baseBranch || 'HEAD';
      await this.runGit(['worktree', 'add', '-b', options.branch, worktreePath, base], repoRoot);
    }

    const descriptor: FloorDescriptor = {
      version: 1,
      workspaceId: options.workspaceId,
      floorId: options.floorId,
      commonDir,
      repoRoot,
      worktreePath,
      branch: options.branch,
      branchCreatedByMaestri: !branchExists,
      createdAt: new Date().toISOString(),
      state: 'ready'
    };

    // Save descriptor in the worktree
    const descPath = path.join(worktreePath, '.maestri-floor.json');
    await fs.promises.writeFile(descPath, JSON.stringify(descriptor, null, 2), 'utf-8');

    return descriptor;
  }

  public async removeIsolatedFloor(descriptor: FloorDescriptor, deleteBranch = false): Promise<void> {
    const normWorktree = path.resolve(descriptor.worktreePath);
    const normRoot = path.resolve(descriptor.repoRoot);

    // Verify it is inside repo root
    if (!normWorktree.startsWith(normRoot)) {
      throw {
        ok: false,
        refusal: {
          code: 'outsideManagedRoot',
          message: `Path ${normWorktree} is outside managed root ${normRoot}`
        }
      };
    }

    try {
      await this.runGit(['worktree', 'remove', '--force', descriptor.worktreePath], descriptor.repoRoot);
    } catch (err: any) {
      console.warn(`[GitWorktree] worktree remove warning:`, err.message);
    }

    if (deleteBranch && descriptor.branch) {
      try {
        await this.runGit(['branch', '-D', descriptor.branch], descriptor.repoRoot);
      } catch (err: any) {
        console.warn(`[GitWorktree] branch delete warning:`, err.message);
      }
    }
  }

  public async landingPreflight(repoDir: string, worktreePath: string, targetBranch: string): Promise<any> {
    const diffStat = await this.runGit(['diff', '--stat', targetBranch], worktreePath).catch(() => '');
    const commits = await this.runGit(['log', `${targetBranch}..HEAD`, '--oneline'], worktreePath).catch(() => '');

    return {
      canLand: true,
      diffStat,
      commits: commits ? commits.split('\n').filter(Boolean) : []
    };
  }

  public async landFloor(
    repoDir: string,
    worktreePath: string,
    sourceBranch: string,
    targetBranch: string,
    deleteBranch = false
  ): Promise<any> {
    // Merge source branch into target
    await this.runGit(['checkout', targetBranch], repoDir);
    await this.runGit(['merge', sourceBranch], repoDir);

    if (deleteBranch) {
      try {
        await this.runGit(['worktree', 'remove', '--force', worktreePath], repoDir);
        await this.runGit(['branch', '-D', sourceBranch], repoDir);
      } catch (e: any) {
        console.warn(`[GitWorktree] clean up after land:`, e.message);
      }
    }

    return { ok: true };
  }
}
