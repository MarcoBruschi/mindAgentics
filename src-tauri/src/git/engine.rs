use std::path::{Path, PathBuf};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflightVerdict {
    pub can_land: bool,
    pub has_conflicts: bool,
    pub dirty_files: Vec<String>,
    pub message: Option<String>,
}

#[derive(Clone, Default)]
pub struct GitEngine;

impl GitEngine {
    pub fn new() -> Self {
        Self
    }

    fn base_command(&self, dir: &Path) -> tokio::process::Command {
        let mut cmd = tokio::process::Command::new("git");
        cmd.current_dir(dir);

        #[cfg(windows)]
        {
            // 0x08000000 = CREATE_NO_WINDOW (prevents black console flashes)
            cmd.creation_flags(0x08000000);
        }

        cmd
    }

    pub async fn is_git_repo(&self, dir: &Path) -> bool {
        let mut cmd = self.base_command(dir);
        cmd.args(["rev-parse", "--is-inside-work-tree"]);
        match cmd.output().await {
            Ok(output) => output.status.success(),
            Err(_) => false,
        }
    }

    pub async fn list_branches(&self, dir: &Path) -> Result<Vec<BranchInfo>> {
        let mut cmd = self.base_command(dir);
        cmd.args(["branch", "--list", "--no-color"]);
        let output = cmd.output().await.context("Failed to list git branches")?;
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut branches = Vec::new();

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let is_current = trimmed.starts_with('*');
            let name = trimmed.trim_start_matches('*').trim().to_string();
            branches.push(BranchInfo { name, is_current });
        }

        Ok(branches)
    }

    pub async fn create_worktree(
        &self,
        base_dir: &Path,
        branch_name: &str,
        target_path: &Path,
    ) -> Result<PathBuf> {
        let mut cmd = self.base_command(base_dir);
        cmd.args(["worktree", "add", "-b", branch_name])
            .arg(target_path);

        let output = cmd.output().await.context("Failed to create worktree")?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("git worktree add failed: {}", err);
        }

        Ok(target_path.to_path_buf())
    }

    pub async fn remove_worktree(
        &self,
        base_dir: &Path,
        worktree_path: &Path,
        delete_branch: bool,
        branch_name: Option<&str>,
    ) -> Result<()> {
        let mut cmd = self.base_command(base_dir);
        cmd.args(["worktree", "remove", "--force"])
            .arg(worktree_path);

        let output = cmd.output().await.context("Failed to remove worktree")?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("git worktree remove failed: {}", err);
        }

        if delete_branch {
            if let Some(branch) = branch_name {
                let mut del_cmd = self.base_command(base_dir);
                del_cmd.args(["branch", "-D", branch]);
                let _ = del_cmd.output().await;
            }
        }

        Ok(())
    }

    pub async fn preflight_landing(&self, _base_dir: &Path, floor_dir: &Path) -> Result<PreflightVerdict> {
        let mut status_cmd = self.base_command(floor_dir);
        status_cmd.args(["status", "--porcelain"]);
        let status_out = status_cmd.output().await?;
        let status_str = String::from_utf8_lossy(&status_out.stdout);

        let mut dirty_files = Vec::new();
        for line in status_str.lines() {
            let trimmed = line.trim();
            if trimmed.len() > 3 {
                dirty_files.push(trimmed[3..].to_string());
            }
        }

        let can_land = dirty_files.is_empty();
        Ok(PreflightVerdict {
            can_land,
            has_conflicts: false,
            dirty_files,
            message: if can_land { None } else { Some("Worktree has uncommitted changes".to_string()) },
        })
    }

    pub async fn land_worktree(
        &self,
        base_dir: &Path,
        worktree_path: &Path,
        branch_name: &str,
    ) -> Result<()> {
        let preflight = self.preflight_landing(base_dir, worktree_path).await?;
        if !preflight.can_land {
            anyhow::bail!("Cannot land worktree: uncommitted changes detected");
        }

        let mut merge_cmd = self.base_command(base_dir);
        merge_cmd.args(["merge", "--no-ff", branch_name, "-m", &format!("Merge floor branch '{branch_name}'")]);
        let output = merge_cmd.output().await?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("git merge failed: {}", err);
        }

        self.remove_worktree(base_dir, worktree_path, true, Some(branch_name)).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempGitDir {
        path: PathBuf,
    }

    impl TempGitDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "mindagentics-git-test-{label}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).expect("create temp git dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempGitDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[tokio::test]
    async fn is_git_repo_returns_true_for_current_repo_and_false_for_empty_temp_dir() {
        let engine = GitEngine::new();
        let repo_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        assert!(
            engine.is_git_repo(repo_dir).await,
            "expected CARGO_MANIFEST_DIR ({}) to be detected as a git repo",
            repo_dir.display()
        );

        let empty_dir = TempGitDir::new("non-git");
        assert!(
            !engine.is_git_repo(empty_dir.path()).await,
            "expected empty temp dir ({}) not to be detected as a git repo",
            empty_dir.path().display()
        );

        let missing_dir = empty_dir.path().join("does-not-exist");
        assert!(!engine.is_git_repo(&missing_dir).await);
    }
}
