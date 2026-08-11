// SPDX-License-Identifier: AGPL-3.0-or-later

//! Instance branding for the admin panel.
//!
//! The panel is one instance's control surface, so it names that instance rather than
//! the software. The name and favicon come from the same `app_public.branding` the web
//! app renders, read from the public discovery document so the unauthenticated login and
//! error pages can use them too.
//!
//! Held in a process-wide cell rather than threaded through `AdminConfig` because the
//! error page renders from `AppError` alone, with no configuration in scope.

use crate::state::AppState;
use serde::Deserialize;
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

/// Used until the first successful fetch, and whenever the instance sets no name.
pub const DEFAULT_PRODUCT_NAME: &str = "Fluxer";

const REFRESH_INTERVAL: Duration = Duration::from_secs(300);
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug)]
pub struct InstanceBranding {
    pub product_name: String,
    pub favicon_url: Option<String>,
}

impl Default for InstanceBranding {
    fn default() -> Self {
        Self {
            product_name: DEFAULT_PRODUCT_NAME.to_owned(),
            favicon_url: None,
        }
    }
}

fn cell() -> &'static RwLock<InstanceBranding> {
    static CELL: OnceLock<RwLock<InstanceBranding>> = OnceLock::new();
    CELL.get_or_init(|| RwLock::new(InstanceBranding::default()))
}

/// The branding to render right now. Falls back to the default rather than failing a
/// page render, so a poisoned lock costs the instance name and nothing else.
pub fn current() -> InstanceBranding {
    cell()
        .read()
        .map(|branding| branding.clone())
        .unwrap_or_default()
}

pub fn store(branding: InstanceBranding) {
    if let Ok(mut slot) = cell().write() {
        *slot = branding;
    }
}

/// The panel's own name, e.g. `Blobbs Admin`.
pub fn admin_title() -> String {
    format!("{} Admin", current().product_name)
}

#[derive(Deserialize)]
struct DiscoveryDocument {
    app_public: Option<DiscoveryAppPublic>,
}

#[derive(Deserialize)]
struct DiscoveryAppPublic {
    branding: Option<DiscoveryBranding>,
}

#[derive(Deserialize)]
struct DiscoveryBranding {
    product_name: Option<String>,
    favicon_url: Option<String>,
}

/// An instance that sets no name, or only whitespace, is treated as having none.
fn branding_from_document(document: DiscoveryDocument) -> Option<InstanceBranding> {
    let branding = document.app_public?.branding?;
    let product_name = branding
        .product_name
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| DEFAULT_PRODUCT_NAME.to_owned());
    let favicon_url = branding
        .favicon_url
        .map(|url| url.trim().to_owned())
        .filter(|url| !url.is_empty());
    Some(InstanceBranding {
        product_name,
        favicon_url,
    })
}

async fn fetch(state: &AppState) -> Option<InstanceBranding> {
    let url = format!("{}/.well-known/fluxer", state.config().api_endpoint);
    let response = state
        .http_client()
        .get(&url)
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        tracing::warn!(status = %response.status(), "instance branding fetch returned non-success");
        return None;
    }
    let document = response.json::<DiscoveryDocument>().await.ok()?;
    branding_from_document(document)
}

/// Keeps the cached branding fresh. Polls rather than reading once at startup, so the
/// panel survives booting before the API is reachable and picks up a name changed from
/// the instance config page without a restart.
pub fn spawn_refresher(state: AppState) {
    tokio::spawn(async move {
        loop {
            match fetch(&state).await {
                Some(branding) => {
                    tracing::debug!(product_name = %branding.product_name, "instance branding refreshed");
                    store(branding);
                }
                None => {
                    tracing::warn!("instance branding unavailable, keeping previous value");
                }
            }
            tokio::time::sleep(REFRESH_INTERVAL).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Option<InstanceBranding> {
        branding_from_document(serde_json::from_str(json).expect("valid discovery json"))
    }

    #[test]
    fn reads_the_instance_name_and_favicon() {
        let branding = parse(
            r#"{"app_public":{"branding":{"product_name":"Blobbs","favicon_url":"https://cdn.example/f.ico"}}}"#,
        )
        .expect("branding");
        assert_eq!(branding.product_name, "Blobbs");
        assert_eq!(
            branding.favicon_url.as_deref(),
            Some("https://cdn.example/f.ico")
        );
    }

    #[test]
    fn falls_back_when_the_instance_sets_no_name() {
        let branding = parse(r#"{"app_public":{"branding":{}}}"#).expect("branding");
        assert_eq!(branding.product_name, DEFAULT_PRODUCT_NAME);
        assert_eq!(branding.favicon_url, None);
    }

    #[test]
    fn treats_blank_values_as_unset() {
        let branding =
            parse(r#"{"app_public":{"branding":{"product_name":"   ","favicon_url":"  "}}}"#)
                .expect("branding");
        assert_eq!(branding.product_name, DEFAULT_PRODUCT_NAME);
        assert_eq!(branding.favicon_url, None);
    }

    #[test]
    fn trims_surrounding_whitespace() {
        let branding = parse(r#"{"app_public":{"branding":{"product_name":"  Blobbs  "}}}"#)
            .expect("branding");
        assert_eq!(branding.product_name, "Blobbs");
    }

    #[test]
    fn yields_nothing_when_the_document_omits_branding() {
        assert!(parse(r#"{}"#).is_none());
        assert!(parse(r#"{"app_public":{}}"#).is_none());
    }

    #[test]
    fn admin_title_appends_admin_to_the_instance_name() {
        store(InstanceBranding {
            product_name: "Blobbs".to_owned(),
            favicon_url: None,
        });
        assert_eq!(admin_title(), "Blobbs Admin");
        store(InstanceBranding::default());
        assert_eq!(admin_title(), "Fluxer Admin");
    }
}
