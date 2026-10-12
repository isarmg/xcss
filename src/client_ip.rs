//! Resolve client addresses once at the HTTP boundary using explicitly trusted peers.
use axum::{
    extract::{ConnectInfo, Request, State},
    http::{Extensions, HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use ipnet::IpNet;
use std::net::{IpAddr, SocketAddr};

const MAX_HOPS: usize = 32;

#[derive(Clone, Debug, Default)]
pub struct TrustedProxies(Vec<IpNet>);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClientIp(pub IpAddr);

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("trusted proxy must be an IP address or CIDR network")]
    InvalidTrustedProxy,
    #[error("forwarded client address chain is invalid or exceeds 32 hops")]
    InvalidForwardedChain,
}

impl TrustedProxies {
    pub fn parse(entries: &[String]) -> Result<Self, Error> {
        entries
            .iter()
            .map(|entry| {
                entry
                    .parse::<IpNet>()
                    .or_else(|_| entry.parse::<IpAddr>().map(IpNet::from))
                    .map_err(|_| Error::InvalidTrustedProxy)
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Self)
    }

    fn contains(&self, address: IpAddr) -> bool {
        self.0
            .iter()
            .any(|network| network.contains(&address.to_canonical()))
    }
}

/// Ignore forwarded headers from untrusted peers. For trusted peers, walk the
/// chain from the socket inward and stop at its first untrusted address.
pub fn resolve(
    peer: IpAddr,
    headers: &HeaderMap,
    trusted: &TrustedProxies,
) -> Result<IpAddr, Error> {
    let peer = peer.to_canonical();
    if !trusted.contains(peer) {
        return Ok(peer);
    }
    let mut chain = Vec::new();
    for value in headers.get_all("x-forwarded-for") {
        let value = value.to_str().map_err(|_| Error::InvalidForwardedChain)?;
        for address in value.split(',') {
            if chain.len() == MAX_HOPS {
                return Err(Error::InvalidForwardedChain);
            }
            chain.push(
                address
                    .trim()
                    .parse::<IpAddr>()
                    .map_err(|_| Error::InvalidForwardedChain)?
                    .to_canonical(),
            );
        }
    }
    let mut current = peer;
    for address in chain.into_iter().rev() {
        if !trusted.contains(current) {
            break;
        }
        current = address;
    }
    Ok(current)
}

/// Use the resolved boundary address, or the actual peer without proxy middleware.
pub fn from_extensions(extensions: &Extensions) -> Option<IpAddr> {
    extensions
        .get::<ClientIp>()
        .map(|ip| ip.0.to_canonical())
        .or_else(|| {
            extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|peer| peer.0.ip().to_canonical())
        })
}

pub async fn middleware(
    State(trusted): State<TrustedProxies>,
    mut request: Request,
    next: Next,
) -> Response {
    if let Some(peer) = request.extensions().get::<ConnectInfo<SocketAddr>>() {
        match resolve(peer.0.ip(), request.headers(), &trusted) {
            Ok(address) => {
                request.extensions_mut().insert(ClientIp(address));
            }
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    [(axum::http::header::CACHE_CONTROL, "no-store")],
                    axum::Json(crate::contracts::ErrorEnvelope::new(
                        crate::error::HttpStatus::BadRequest,
                        "invalid forwarded client address chain",
                    )),
                )
                    .into_response();
            }
        }
    }
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn address(value: &str) -> IpAddr {
        value.parse().unwrap()
    }
    fn trusted() -> TrustedProxies {
        TrustedProxies::parse(&["10.0.0.0/8".into(), "::1".into()]).unwrap()
    }
    #[tokio::test]
    async fn middleware_sets_one_address_and_rejects_invalid_trusted_headers() {
        use axum::{Router, body::Body, routing::get};
        use tower::ServiceExt;
        let app = Router::new().route("/", get(|axum::Extension(ip): axum::Extension<ClientIp>| async move { ip.0.to_string() }))
            .layer(axum::middleware::from_fn_with_state(trusted(), middleware));
        let mut request = Request::builder()
            .uri("/")
            .header("x-forwarded-for", "192.0.2.1")
            .body(Body::empty())
            .unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo("10.0.0.1:42".parse::<SocketAddr>().unwrap()));
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            axum::body::to_bytes(response.into_body(), 128)
                .await
                .unwrap(),
            "192.0.2.1"
        );
        let mut request = Request::builder()
            .uri("/")
            .header("x-forwarded-for", "spoofed")
            .body(Body::empty())
            .unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo("10.0.0.1:42".parse::<SocketAddr>().unwrap()));
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(response.headers()["cache-control"], "no-store");
    }

    #[test]
    fn only_trusted_peers_can_supply_a_chain() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "not an address".parse().unwrap());
        assert_eq!(
            resolve(address("192.0.2.1"), &headers, &trusted()).unwrap(),
            address("192.0.2.1")
        );
        assert!(resolve(address("10.0.0.1"), &headers, &trusted()).is_err());
        headers.insert(
            "x-forwarded-for",
            "198.51.100.1, 192.0.2.2, 10.0.0.2".parse().unwrap(),
        );
        assert_eq!(
            resolve(address("10.0.0.1"), &headers, &trusted()).unwrap(),
            address("192.0.2.2")
        );
        headers.insert("x-forwarded-for", "2001:db8::1, ::1".parse().unwrap());
        assert_eq!(
            resolve(address("::1"), &headers, &trusted()).unwrap(),
            address("2001:db8::1")
        );
    }
    #[test]
    fn multiple_headers_and_mapped_addresses_and_limits() {
        let mut headers = HeaderMap::new();
        headers.append("x-forwarded-for", "::ffff:192.0.2.1".parse().unwrap());
        headers.append("x-forwarded-for", "10.0.0.2".parse().unwrap());
        assert_eq!(
            resolve(address("::ffff:10.0.0.1"), &headers, &trusted()).unwrap(),
            address("192.0.2.1")
        );
        headers.insert(
            "x-forwarded-for",
            vec!["10.0.0.1"; 33].join(",").parse().unwrap(),
        );
        assert!(resolve(address("10.0.0.1"), &headers, &trusted()).is_err());
        headers.clear();
        assert_eq!(
            resolve(address("10.0.0.1"), &headers, &trusted()).unwrap(),
            address("10.0.0.1")
        );
        headers.insert("x-forwarded-for", "".parse().unwrap());
        assert!(resolve(address("10.0.0.1"), &headers, &trusted()).is_err());
    }
    #[test]
    fn extensions_prefer_resolved_address_without_changing_peer() {
        let mut extensions = Extensions::new();
        assert!(from_extensions(&extensions).is_none());
        extensions.insert(ConnectInfo("10.0.0.1:1234".parse::<SocketAddr>().unwrap()));
        assert_eq!(from_extensions(&extensions), Some(address("10.0.0.1")));
        extensions.insert(ClientIp(address("192.0.2.1")));
        assert_eq!(from_extensions(&extensions), Some(address("192.0.2.1")));
    }
}
