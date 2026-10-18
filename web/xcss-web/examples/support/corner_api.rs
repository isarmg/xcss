//! Thin browser-test access to the production Rust controller and geometry.
use serde::Deserialize;
use wasm_bindgen::prelude::*;
use xcss_web::server_corners::{ServerCornersController, geometry};

#[wasm_bindgen]
pub struct CornerController {
    inner: ServerCornersController,
}

#[wasm_bindgen]
impl CornerController {
    pub fn refresh(&self) {
        self.inner.refresh();
    }

    pub fn stop(&self) {
        self.inner.stop();
    }

    pub fn same_instance(&self, other: &CornerController) -> bool {
        self.inner.same_instance(&other.inner)
    }
}

#[wasm_bindgen]
pub fn start_server_corners(document: web_sys::Document) -> Result<CornerController, JsValue> {
    xcss_web::server_corners::start(&document).map(|inner| CornerController { inner })
}

#[derive(Deserialize)]
struct GeometryOptions {
    width: f64,
    height: f64,
    extent: f64,
    #[serde(default = "default_tolerance")]
    tolerance: f64,
}

fn default_tolerance() -> f64 {
    0.05
}

#[wasm_bindgen]
pub fn corner_geometry_json(options: &str) -> Result<String, JsValue> {
    let options: GeometryOptions =
        serde_json::from_str(options).map_err(|error| JsValue::from_str(&error.to_string()))?;
    let geometry = geometry::create(
        options.width,
        options.height,
        options.extent,
        options.tolerance,
    )
    .map_err(|error| JsValue::from_str(&error))?;
    serde_json::to_string(geometry.as_ref()).map_err(|error| JsValue::from_str(&error.to_string()))
}
