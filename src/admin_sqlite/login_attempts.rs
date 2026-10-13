//! Bounded registry of physical administrator-database admission scopes.

use crate::admin_core::{AuthenticationState, AuthenticationStateError, LOGIN_ATTEMPTS_SCOPES_MAX};
use sqlx::{SqlitePool, sqlite::SqliteConnectOptions};
use std::{
    collections::HashMap,
    os::unix::fs::MetadataExt,
    sync::{Arc, Mutex, OnceLock, Weak},
};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum Scope {
    File { device: u64, inode: u64 },
    Memory(usize),
}

#[derive(Debug)]
struct Entry {
    state: Arc<AuthenticationState>,
    owner: Weak<SqliteConnectOptions>,
}

#[derive(Debug, Default)]
struct Registry {
    entries: HashMap<Scope, Entry>,
}

impl Registry {
    fn acquire(
        &mut self,
        scope: Scope,
        owner: &Arc<SqliteConnectOptions>,
    ) -> Result<Arc<AuthenticationState>, AuthenticationStateError> {
        if let Some(entry) = self.entries.get_mut(&scope) {
            entry.owner = Arc::downgrade(owner);
            return Ok(entry.state.clone());
        }
        // Never evict a live counter or an unexpired window: recreating a
        // service/pool must not reset the installation's admitted attempts.
        self.entries.retain(|_, entry| {
            entry.owner.strong_count() != 0
                || Arc::strong_count(&entry.state) != 1
                || !entry.state.can_retire()
        });
        if self.entries.len() == LOGIN_ATTEMPTS_SCOPES_MAX {
            return Err(AuthenticationStateError::Unavailable);
        }
        let state = Arc::new(AuthenticationState::new());
        self.entries.insert(
            scope,
            Entry {
                state: state.clone(),
                owner: Arc::downgrade(owner),
            },
        );
        Ok(state)
    }
}

pub(super) async fn state_for_pool(
    pool: &SqlitePool,
) -> Result<Arc<AuthenticationState>, AuthenticationStateError> {
    let filename: String =
        sqlx::query_scalar("SELECT file FROM pragma_database_list WHERE name='main'")
            .fetch_one(pool)
            .await
            .map_err(|_| AuthenticationStateError::Unavailable)?;
    let owner = pool.connect_options();
    let scope = if filename.is_empty() {
        Scope::Memory(Arc::as_ptr(&owner) as usize)
    } else {
        let metadata =
            std::fs::metadata(filename).map_err(|_| AuthenticationStateError::Unavailable)?;
        if !metadata.is_file() {
            return Err(AuthenticationStateError::Unavailable);
        }
        Scope::File {
            device: metadata.dev(),
            inode: metadata.ino(),
        }
    };
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY
        .get_or_init(|| Mutex::new(Registry::default()))
        .lock()
        .map_err(|_| AuthenticationStateError::Unavailable)?
        .acquire(scope, &owner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admin_core::LOGIN_ATTEMPTS_MAX;

    #[tokio::test(start_paused = true)]
    async fn registry_is_bounded_and_preserves_dropped_unexpired_scopes() {
        let mut registry = Registry::default();
        let owner = Arc::new(SqliteConnectOptions::new());
        let state = registry
            .acquire(
                Scope::File {
                    device: 1,
                    inode: 1,
                },
                &owner,
            )
            .unwrap();
        for _ in 0..LOGIN_ATTEMPTS_MAX {
            state.admit_login_attempt().unwrap();
        }
        drop(state);
        drop(owner);
        let owner = Arc::new(SqliteConnectOptions::new());
        for inode in 2..=LOGIN_ATTEMPTS_SCOPES_MAX as u64 {
            registry
                .acquire(Scope::File { device: 1, inode }, &owner)
                .unwrap();
        }
        assert!(matches!(
            registry.acquire(
                Scope::File {
                    device: 1,
                    inode: 999
                },
                &owner
            ),
            Err(AuthenticationStateError::Unavailable)
        ));
        let state = registry
            .acquire(
                Scope::File {
                    device: 1,
                    inode: 1,
                },
                &owner,
            )
            .unwrap();
        assert!(matches!(
            state.admit_login_attempt(),
            Err(AuthenticationStateError::LoginAttemptsExceeded { .. })
        ));
        drop(state);
        drop(owner);
        tokio::time::advance(std::time::Duration::from_secs(60)).await;
        let owner = Arc::new(SqliteConnectOptions::new());
        assert!(
            registry
                .acquire(
                    Scope::File {
                        device: 1,
                        inode: 999
                    },
                    &owner
                )
                .is_ok()
        );
        assert_eq!(registry.entries.len(), 1);
    }

    #[tokio::test]
    async fn fresh_stores_and_pools_share_one_physical_database()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::admin_core::AdministratorStore;
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("administrator.sqlite3");
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let first = SqlitePool::connect_with(options.clone()).await?;
        let second = SqlitePool::connect_with(options).await?;
        let first_state = super::super::SqliteAdministratorStore::new(first.clone())
            .authentication_state()
            .await
            .unwrap();
        let second_state = super::super::SqliteAdministratorStore::new(second.clone())
            .authentication_state()
            .await
            .unwrap();
        assert!(Arc::ptr_eq(&first_state, &second_state));
        for _ in 0..LOGIN_ATTEMPTS_MAX {
            first_state.admit_login_attempt().unwrap();
        }
        assert!(matches!(
            second_state.admit_login_attempt(),
            Err(AuthenticationStateError::LoginAttemptsExceeded { .. })
        ));
        first.close().await;
        second.close().await;
        let recreated =
            SqlitePool::connect_with(SqliteConnectOptions::new().filename(&path)).await?;
        let recreated_state = super::super::SqliteAdministratorStore::new(recreated.clone())
            .authentication_state()
            .await
            .unwrap();
        assert!(Arc::ptr_eq(&first_state, &recreated_state));
        assert!(matches!(
            recreated_state.admit_login_attempt(),
            Err(AuthenticationStateError::LoginAttemptsExceeded { .. })
        ));
        recreated.close().await;
        Ok(())
    }
}
