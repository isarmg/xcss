//! Product-neutral reports shared by signed offline maintenance tools.
//!
//! Products own configuration, schema and migration rules. Their runtimes do
//! not depend on, detect or invoke an installation or upgrade tool.
use crate::contracts::SchemaIdentity;
use serde::{Deserialize, Serialize};
use std::{
    net::SocketAddr,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigReport {
    pub product: String,
    pub root: PathBuf,
    pub data_dir: PathBuf,
    pub state_paths: Vec<PathBuf>,
    pub schema_identity: SchemaIdentity,
    pub bind: SocketAddr,
    pub writable_paths: Vec<PathBuf>,
    /// Existing business directories whose permissions and ownership are
    /// preserved; the helper checks access under the actual service identity.
    pub shared_paths: Vec<PathBuf>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CheckReport {
    #[serde(flatten)]
    pub config: ConfigReport,
    pub initialized: bool,
}

/// One explicit installation root; never infer it from the process directory.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Layout {
    pub root: PathBuf,
}

impl Layout {
    pub fn new(root: &Path) -> anyhow::Result<Self> {
        anyhow::ensure!(
            root.to_str()
                .is_some_and(|name| !name.chars().any(char::is_control)),
            "installation root must be UTF-8 without control characters"
        );
        anyhow::ensure!(root.is_absolute(), "installation root must be absolute");
        anyhow::ensure!(
            root != Path::new("/"),
            "installation root cannot be the filesystem root"
        );
        anyhow::ensure!(
            root.components()
                .all(|part| matches!(part, Component::RootDir | Component::Normal(_)))
                && root.components().collect::<PathBuf>().as_os_str() == root.as_os_str(),
            "installation root must be normalized"
        );
        Ok(Self {
            root: root.to_path_buf(),
        })
    }
    pub fn config(&self) -> PathBuf {
        self.root.join("config/config.json")
    }
    pub fn state(&self) -> PathBuf {
        self.root.join("state")
    }
    pub fn logs(&self) -> PathBuf {
        self.root.join("logs")
    }
    pub fn run(&self) -> PathBuf {
        self.root.join("run")
    }
    pub fn maintenance(&self) -> PathBuf {
        self.root.join("maintenance")
    }
}
