//! Common fresh-install CLI contract for server integration tests.
use std::{
    io::Write,
    path::Path,
    process::{Command, Output, Stdio},
};

/// The caller provides a valid new-format configuration and absent data directory.
/// `persistent_files` are paths relative to data_dir, including credentials and DB.
/// This creates test state but never starts a listener or installs a service.
pub fn assert_deployment_cli_contract(
    binary: &Path,
    config: &Path,
    data_dir: &Path,
    persistent_files: &[&str],
) {
    assert!(
        !data_dir.exists(),
        "contract requires fresh installation state"
    );
    let invoke = |arguments: &[&str], password: Option<&str>| -> Output {
        let mut child = Command::new(binary)
            .arg("--config")
            .arg(config)
            .args(arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn server CLI");
        if let Some(password) = password {
            child
                .stdin
                .take()
                .unwrap()
                .write_all(password.as_bytes())
                .expect("write initialization password");
        } else {
            drop(child.stdin.take());
        }
        child.wait_with_output().expect("wait for server CLI")
    };
    let configuration = std::fs::read(config).expect("read test configuration");
    assert!(
        invoke(&["config", "validate"], None).status.success(),
        "config validation must not need initialized state"
    );
    assert!(
        !data_dir.exists(),
        "config validation must not create state"
    );
    assert!(
        !invoke(&["check"], None).status.success(),
        "check must detect missing initialization"
    );
    assert!(!data_dir.exists(), "check must not initialize state");
    let initialized = invoke(
        &["init", "--username", "admin"],
        Some("correct horse battery\n"),
    );
    assert!(
        initialized.status.success(),
        "init failed: {}",
        String::from_utf8_lossy(&initialized.stderr)
    );
    let snapshots: Vec<_> = persistent_files
        .iter()
        .map(|file| std::fs::read(data_dir.join(file)).expect("read initialized state"))
        .collect();
    assert!(
        !invoke(
            &["init", "--username", "admin"],
            Some("another correct horse\n")
        )
        .status
        .success(),
        "repeated initialization must not replace state"
    );
    for (file, expected) in persistent_files.iter().zip(snapshots) {
        assert_eq!(
            std::fs::read(data_dir.join(file)).unwrap(),
            expected,
            "repeated initialization changed {file}"
        );
    }
    assert!(invoke(&["config", "validate"], None).status.success());
    assert!(
        invoke(&["check"], None).status.success(),
        "initialized state must pass check"
    );
    assert_eq!(
        std::fs::read(config).unwrap(),
        configuration,
        "CLI must not rewrite user configuration"
    );
}
