use gloo_events::EventListener;
use xcss_web::{
    api,
    children::ToChildren,
    component::{component_props_builder, component_view},
    components::{AccountPage, AdminShell, Dialog, HeaderActions, HeaderNavigation, notify},
    ev, html,
    i18n::t,
    prelude::*,
    wasm_bindgen::prelude::wasm_bindgen,
};

#[wasm_bindgen(start)]
pub fn start() {
    let query = web_sys::Url::new(&web_sys::window().unwrap().location().href().unwrap())
        .unwrap()
        .search_params();
    let landing = match query.get("landing").as_deref() {
        Some("hash") => "#workspace",
        Some("path") => "/#workspace",
        _ => "",
    };
    xcss_web::mount("root", move || {
        component_view(
            AdminShell,
            component_props_builder(&AdminShell)
                .product("xcss")
                .landing(landing)
                .children(ToChildren::to_children(workspace))
                .build(),
        )
    });
}

fn workspace() -> impl IntoView {
    let window = web_sys::window().unwrap();
    let hash = RwSignal::new(window.location().hash().unwrap_or_default());
    let dialog = RwSignal::new(false);
    let listener =
        send_wrapper::SendWrapper::new(EventListener::new(&window, "hashchange", move |_| {
            hash.set(
                web_sys::window()
                    .unwrap()
                    .location()
                    .hash()
                    .unwrap_or_default(),
            );
        }));
    on_cleanup(move || drop(listener));
    (
        component_view(
            HeaderNavigation,
            component_props_builder(&HeaderNavigation)
                .label(t("主要导航", "Primary navigation"))
                .children(ToChildren::to_children(|| {
                    (
                        html::a().href("#overview").child(t("概览", "Overview")),
                        html::a().href("#workspace").child(t("工作区", "Workspace")),
                    )
                }))
                .build(),
        ),
        component_view(
            HeaderActions,
            component_props_builder(&HeaderActions)
                .children(ToChildren::to_children(move || {
                    html::button()
                        .r#type("button")
                        .class("xcss-button")
                        .on(ev::click, move |_| dialog.set(true))
                        .child(t("创建", "Create"))
                }))
                .build(),
        ),
        move || {
            if hash.get() == "#account" {
                component_view(AccountPage, ()).into_any()
            } else {
                html::section()
                    .class("xcss-content-panel")
                    .child((
                        html::h1().child(if hash.get() == "#workspace" {
                            t("完整工作区", "Full-width workspace")
                        } else {
                            t("产品概览", "Product overview")
                        }),
                        html::p()
                            .child(t("业务内容由产品提供。", "Product-owned business content.")),
                        html::button()
                            .r#type("button")
                            .class("xcss-button")
                            .on(ev::click, |_| {
                                notify(t("操作已完成。", "Operation completed."))
                            })
                            .child(t("显示通知", "Notify")),
                        html::button()
                            .r#type("button")
                            .class("xcss-button")
                            .on(ev::click, |_| {
                                xcss_web::task::spawn_local(async {
                                    let _ = api::restore().await;
                                });
                            })
                            .child(t("恢复会话", "Restore session")),
                        request_probe(),
                    ))
                    .into_any()
            }
        },
        move || {
            dialog.get().then(|| {
                component_view(
                    Dialog,
                    component_props_builder(&Dialog)
                        .title(t("确认操作", "Confirm action"))
                        .close(Callback::new(move |_| dialog.set(false)))
                        .children(ToChildren::to_children(|| {
                            (
                                html::p().child(t("对话框内容", "Modal details")),
                                html::button()
                                    .r#type("button")
                                    .class("xcss-button")
                                    .attr("data-xcss-initial-focus", "")
                                    .child(t("主要操作", "First action")),
                            )
                        }))
                        .build(),
                )
            })
        },
    )
}

// This product-owned fixture uses the public transport exactly like a consumer.
// Controlled HTTP responses exercise WASM-only decoding and browser cancellation.
fn request_probe() -> impl IntoView {
    let path = NodeRef::<html::Input>::new();
    let result = RwSignal::new(String::from("idle"));
    (
        html::input()
            .node_ref(path)
            .aria_label("Probe API path")
            .value("/api/v1/probe"),
        html::button()
            .r#type("button")
            .on(ev::click, move |_| {
                let path = path.get_untracked().unwrap().value();
                result.set("running".into());
                xcss_web::task::spawn_local(async move {
                    let outcome = api::request_with_options(
                        &path,
                        "GET",
                        None,
                        api::RequestOptions {
                            max_response_bytes: 128,
                            timeout_ms: 1_000,
                            ..Default::default()
                        },
                    )
                    .await;
                    result.set(match outcome {
                        Ok(value) => format!("ok:{value}"),
                        Err(error) => format!("error:{}:{}", error.code, error.status),
                    });
                });
            })
            .child("Probe request"),
        html::output()
            .id("probe-result")
            .child(move || result.get()),
    )
}

fn main() {}

// Exercise the public restore API even while the protected workspace is absent.
#[wasm_bindgen]
pub async fn restore_session() -> String {
    match api::restore().await {
        Ok(_) => "authenticated".into(),
        Err(error) => error.code,
    }
}
