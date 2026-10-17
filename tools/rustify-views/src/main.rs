use anyhow::{Context, Result, bail, ensure};
use serde_json::json;
use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn files(path: &Path, output: &mut Vec<PathBuf>) -> Result<()> {
    let metadata =
        fs::symlink_metadata(path).with_context(|| format!("inspect {}", path.display()))?;
    ensure!(
        !metadata.file_type().is_symlink(),
        "refusing a symlink: {}",
        path.display()
    );
    if metadata.is_file() {
        ensure!(
            path.extension().is_some_and(|e| e == "rs"),
            "expected Rust source: {}",
            path.display()
        );
        output.push(path.to_owned());
    } else if metadata.is_dir() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            if ["target", ".git", "vendor", "pkg", "dist"]
                .iter()
                .any(|name| entry.file_name() == *name)
            {
                continue;
            }
            let child = entry.path();
            if child.is_dir() || child.extension().is_some_and(|ext| ext == "rs") {
                files(&child, output)?;
            }
        }
    } else {
        bail!("not a file or directory: {}", path.display());
    }
    Ok(())
}
fn main() -> Result<()> {
    let mut mode = "dry-run";
    let mut inputs = Vec::new();
    let mut repair = false;
    for arg in env::args().skip(1) {
        match arg.as_str() {
            "--repair-erasure" => {
                repair = true;
            }
            "--check" | "--write" | "--stdout" | "--dry-run" => {
                ensure!(mode == "dry-run", "select one operation mode");
                mode = match arg.as_str() {
                    "--check" => "check",
                    "--write" => "write",
                    "--stdout" => "stdout",
                    _ => "dry-run",
                };
            }
            "--help" | "-h" => {
                println!(
                    "rustify-views [--dry-run|--check|--write|--stdout] SOURCE.rs|SOURCE_DIR ...\n\nDefault: parse and generate in memory, print JSON reports, change no files.\n--check: fail if any source view macros remain.\n--write: replace only original view macro spans; all files validate before writes.\n--stdout: print the converted source for exactly one input file.\nDirectories exclude vendor, target, pkg, dist and .git; symlinks are rejected.\nRun rustfmt and cargo check after reviewing conversion."
                );
                return Ok(());
            }
            option if option.starts_with('-') => bail!("unknown option: {option}"),
            _ => files(Path::new(&arg), &mut inputs)?,
        }
    }
    ensure!(
        !inputs.is_empty(),
        "supply at least one Rust source file or source directory"
    );
    inputs.sort();
    inputs.dedup();
    ensure!(
        mode != "stdout" || inputs.len() == 1,
        "--stdout requires exactly one source file"
    );
    let mut prepared = Vec::new();
    let mut total = 0;
    for path in inputs {
        let source = fs::read_to_string(&path)?;
        let converted = if repair {
            xcss_rustify_views::repair_erased_codegen(&source)
        } else {
            xcss_rustify_views::convert(&source)
        }
        .with_context(|| format!("convert {}", path.display()))?;
        total += converted.view_macros;
        if mode == "stdout" {
            println!("{}", converted.source);
        } else {
            println!(
                "{}",
                json!({"path":path,"view_macros":converted.view_macros,"rounds":converted.rounds,"changed":converted.source != source,"mode":mode})
            );
        }
        let changed = converted.source != source;
        prepared.push((path, converted, changed));
    }
    if mode == "check" {
        ensure!(total == 0, "{total} source view macros remain");
    }
    if mode == "write" {
        for (path, converted, _) in prepared.into_iter().filter(|(_, _, changed)| *changed) {
            let temporary = path.with_extension(format!("rs.rustify-{}", std::process::id()));
            ensure!(
                !temporary.exists(),
                "temporary path already exists: {}",
                temporary.display()
            );
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)?;
            use std::io::Write;
            file.write_all(converted.source.as_bytes())?;
            fs::set_permissions(&temporary, fs::metadata(&path)?.permissions())?;
            drop(file);
            fs::rename(&temporary, &path)?;
        }
    }
    Ok(())
}
