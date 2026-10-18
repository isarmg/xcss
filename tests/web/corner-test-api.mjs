// Browser-test bridge only. All geometry and controller behavior runs in Rust.
const fixture = location.pathname === "/continuous-corners.html" ? "corners" : "csr";
const wasm = await import(`/pkg/${fixture}_fixture.js`);
await wasm.default();
const controllers = new WeakMap();

export function startServerCorners(document) {
  const handle = wasm.start_server_corners(document);
  const previous = controllers.get(document);
  if (previous?.handle.same_instance(handle)) {
    handle.free();
    return previous.controller;
  }
  const controller = { refresh: () => handle.refresh(), stop: () => handle.stop() };
  controllers.set(document, { handle, controller });
  return controller;
}

export function createServerCornerGeometry(options) {
  return JSON.parse(wasm.corner_geometry_json(JSON.stringify(options)));
}
