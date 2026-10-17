use xcss_web::prelude::*;
use xcss_web::{html, wasm_bindgen::prelude::wasm_bindgen};

#[wasm_bindgen(start)]
pub fn start() {
    xcss_web::mount("root", || html::p().child("Startup fixture ready"));
}

fn main() {}
