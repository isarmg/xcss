import { createServerCornerGeometry, createNestedServerCornerGeometry, offsetServerCornerPath } from "./server-corner-geometry.js";
import type { ServerCornerGeometry } from "./server-corner-geometry.js";
export { createServerCornerGeometry, createNestedServerCornerGeometry, serverCornerProfile, offsetServerCornerPath, SERVER_CORNER_PROFILE, SERVER_CORNER_CONTROL_POINTS, SERVER_CORNER_PROFILE_BOUNDS, SERVER_CORNER_PHOTO_EXTENT } from "./server-corner-geometry.js";
export type { ServerCornerGeometry, ServerCornerOptions, ServerCornerPoint, ServerCornerCurve, ServerCornerSource, ServerCornerName, ServerCornerNested, NestedServerCornerOptions } from "./server-corner-geometry.js";

export interface ServerCornersController { refresh(): void; stop(): void }
const controllers = new WeakMap<Document, ServerCornersController>();
type Saved = { value: string; priority: string; applied?: string };
type RecordState = { saved: Map<string, Saved>; pending: Map<string, string>; transitionDirty: boolean; originalState: string | null; originalReason: string | null; decoration?: HTMLDivElement };
type Shadow = { color: string; x: number; y: number; blur: number; spread: number };
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const number = (s: string) => Number.parseFloat(s) || 0;
const fmt = (n: number) => Number(n.toFixed(6)).toString();
const transitionNames = ["transition-property", "transition-duration", "transition-delay", "transition-timing-function", "transition-behavior"];
const ownedPaintProperty = (name: string) => /^(?:background(?:-|$)|border(?:-|$)|box-shadow$|mask(?:-|$)|backdrop-filter$)/.test(name);
const paintCache = new WeakMap<ServerCornerGeometry, Map<string, { image: string; margin: number; slice?: number } | null>>();
function snapshot(css: CSSStyleDeclaration): CSSStyleDeclaration {
  const properties = ["width", "height", "box-sizing", "display", "position", "transform", "perspective", "translate", "rotate", "scale", "zoom", "overflow-x", "overflow-y", "border-image-source", "box-shadow", "background-color", "background-image", "backdrop-filter", "mask-image", "outline-width", "outline-offset", "--xcss-server-corner-extent", "--xcss-server-corner-mode", "--xcss-server-corner-nested"];
  for (const side of ["top", "right", "bottom", "left"]) properties.push(`padding-${side}`, `border-${side}-width`);
  const values = Object.fromEntries(properties.map(name => [name, css.getPropertyValue(name)]));
  for (const side of ["top", "right", "bottom", "left"]) {
    const visible = number(values[`border-${side}-width`]) > 0;
    values[`border-${side}-color`] = visible ? css.getPropertyValue(`border-${side}-color`) : "transparent";
    values[`border-${side}-style`] = visible ? css.getPropertyValue(`border-${side}-style`) : "none";
  }
  if (values["background-image"] !== "none" || values["backdrop-filter"] !== "none") {
    for (const name of ["background-position", "background-size", "background-repeat", "background-attachment", "background-origin", "background-clip", "background-blend-mode"]) values[name] = css.getPropertyValue(name);
  }
  return new Proxy(values, { get(target, name) { return name === "getPropertyValue" ? (property: string) => target[property] ?? "" : target[String(name).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)]; } }) as unknown as CSSStyleDeclaration;
}
function split(value: string, separator: "comma" | "space") {
  const parts: string[] = []; let depth = 0, start = 0;
  for (let i = 0; i <= value.length; i++) {
    const c = value[i]; if (c === "(") depth++; else if (c === ")") depth--;
    if (i === value.length || depth === 0 && (separator === "comma" ? c === "," : /\s/.test(c))) {
      const part = value.slice(start, i).trim(); if (part) parts.push(part); start = i + 1;
    }
  }
  return parts;
}
function shadows(value: string): Shadow[] | null {
  if (value === "none") return [];
  const result: Shadow[] = [];
  for (const layer of split(value, "comma")) {
    const tokens = split(layer, "space");
    if (tokens.includes("inset")) return null;
    const lengths = tokens.filter(t => /^-?(?:\d+\.?\d*|\.\d+)px$/.test(t)).map(Number.parseFloat);
    const colors = tokens.filter(t => !/^-?(?:\d+\.?\d*|\.\d+)px$/.test(t));
    if (lengths.length < 2 || lengths.length > 4 || colors.length !== 1) return null;
    result.push({ color: colors[0], x: lengths[0], y: lengths[1], blur: lengths[2] ?? 0, spread: lengths[3] ?? 0 });
  }
  return result;
}
function mask(geometry: ServerCornerGeometry, margin: number) {
  const w = geometry.width, h = geometry.height, sw = w + margin * 2, sh = h + margin * 2;
  // White outside the border box keeps native focus and decoration outset.
  // The fixed host mask clips scaled/replaced children in host coordinates.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(sw)}" height="${fmt(sh)}"><path d="M0 0H${fmt(sw)}V${fmt(sh)}H0ZM${margin} ${margin}H${fmt(w + margin)}V${fmt(h + margin)}H${margin}Z" fill="white" fill-rule="evenodd"/><path transform="translate(${margin} ${margin})" d="${geometry.path}" fill="white"/></svg>`;
}
function decoration(geometry: ServerCornerGeometry, css: CSSStyleDeclaration, layers: Shadow[], hasBackgroundImage: boolean): { image: string; margin: number; slice?: number } | null {
  const { width: w, height: h, extent: e } = geometry;
  const sides = ["top", "right", "bottom", "left"];
  const widths = sides.map(side => number(css.getPropertyValue(`border-${side}-width`)));
  const colors = sides.map(side => css.getPropertyValue(`border-${side}-color`));
  const styles = sides.map(side => css.getPropertyValue(`border-${side}-style`));
  const key = JSON.stringify([widths, colors, styles, css.boxShadow, css.backgroundColor, hasBackgroundImage]);
  let cache = paintCache.get(geometry); if (!cache) { cache = new Map(); paintCache.set(geometry, cache); }
  if (cache.has(key)) return cache.get(key)!;
  if (styles.some((style, i) => widths[i] > 0 && !["solid", "dashed", "dotted", "none"].includes(style))) return null;
  if (layers.some(s => s.spread <= -geometry.radius)) return null;
  if (geometry.canonical && !hasBackgroundImage && layers.length === 0 && widths.every(width => width === 0)) {
    // A nine-slice image stretches only the 1px straight centre strips. The
    // four Mac mini corners retain their physical dimensions, so equal-role tiles
    // with varying widths share one SVG and Blob URL without curve distortion.
    const compact = createServerCornerGeometry({ width: e * 2 + 1, height: e * 2 + 1, extent: e, tolerance: .02 });
    const margin = 2, size = e * 2 + 1 + margin * 2;
    const result = { image: `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(size)}" height="${fmt(size)}"><path transform="translate(${margin} ${margin})" d="${compact.path}" fill="${xml(css.backgroundColor)}"/></svg>`, margin, slice: e + margin };
    cache.set(key, result); if (cache.size > 16) cache.delete(cache.keys().next().value!); return result;
  }
  const margin = Math.max(1, Math.ceil(Math.max(0, ...layers.map(s => Math.max(Math.abs(s.x), Math.abs(s.y)) + s.blur * 3 + Math.max(0, s.spread))) + 2));
  const svgWidth = w + margin * 2, svgHeight = h + margin * 2;
  let defs = `<clipPath id="inside"><path d="${geometry.path}"/></clipPath><mask id="outside" maskUnits="userSpaceOnUse" x="-${margin}" y="-${margin}" width="${svgWidth}" height="${svgHeight}"><rect x="-${margin}" y="-${margin}" width="${svgWidth}" height="${svgHeight}" fill="white"/><path d="${geometry.path}" fill="black"/></mask>`;
  let body = "";
  for (let i = layers.length - 1; i >= 0; i--) {
    const s = layers[i];
    const shadowPath = s.spread === 0 ? geometry.path : offsetServerCornerPath(geometry, s.spread);
    defs += `<filter id="shadow${i}" filterUnits="userSpaceOnUse" x="-${margin}" y="-${margin}" width="${svgWidth}" height="${svgHeight}" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="${s.blur / 2}"/><feOffset dx="${s.x}" dy="${s.y}" result="blurred"/><feFlood flood-color="${xml(s.color)}"/><feComposite operator="in" in2="blurred"/></filter>`;
    body += `<path d="${shadowPath}" fill="black" filter="url(#shadow${i})" mask="url(#outside)"/>`;
  }
  if (!hasBackgroundImage) body += `<path d="${geometry.path}" fill="${xml(css.backgroundColor)}"/>`;
  const junction = (a: number, b: number, e: number) => [e * a / Math.max(a, b, 1e-9), e * b / Math.max(a, b, 1e-9)];
  const [tlx, tly] = junction(widths[3], widths[0], geometry.corners[3].extent); const [trx, try_] = junction(widths[1], widths[0], geometry.corners[0].extent);
  const [brx, bry] = junction(widths[1], widths[2], geometry.corners[1].extent); const [blx, bly] = junction(widths[3], widths[2], geometry.corners[2].extent);
  const polygons = [`0,0 ${w},0 ${w - trx},${try_} ${tlx},${tly}`,
    `${w},0 ${w},${h} ${w - brx},${h - bry} ${w - trx},${try_}`,
    `0,${h} ${w},${h} ${w - brx},${h - bry} ${blx},${h - bly}`,
    `0,0 ${tlx},${tly} ${blx},${h - bly} 0,${h}`];
  for (let i = 0; i < sides.length; i++) {
    if (widths[i] === 0 || styles[i] === "none") continue;
    defs += `<clipPath id="side${i}"><polygon points="${polygons[i]}"/></clipPath>`;
    const dash = styles[i] === "dashed" ? ` stroke-dasharray="${widths[i] * 3} ${widths[i] * 2}"` : styles[i] === "dotted" ? ` stroke-dasharray="0 ${widths[i] * 2}" stroke-linecap="round"` : "";
    body += `<g clip-path="url(#inside)"><path d="${geometry.path}" fill="none" stroke="${xml(colors[i])}" stroke-width="${widths[i] * 2}" clip-path="url(#side${i})"${dash}/></g>`;
  }
  const result = { image: `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(svgWidth)}" height="${fmt(svgHeight)}"><defs>${defs}</defs><g transform="translate(${margin} ${margin})">${body}</g></svg>`, margin };
  cache.set(key, result); if (cache.size > 16) cache.delete(cache.keys().next().value!);
  return result;
}

/** Explicitly start server-only Mac mini decoration. No global import side effects.
 * Layout, native controls, hit boxes and focus outlines remain browser-owned.
 * Images/video and overflow-hidden containers use a fixed host mask. Its white
 * exterior keeps focus outlines/shadows outside the border box visible. */
export function startServerCorners(document: Document): ServerCornersController {
  const previous = controllers.get(document); if (previous) return previous;
  const ownerView = document.defaultView;
  if (!ownerView) return { refresh() {}, stop() {} };
  const view = ownerView;
  // Unregistered custom properties inherit. Leave legacy engines at the
  // authored fallback rather than opt a panel's descendants in accidentally.
  if (typeof view.CSS?.registerProperty !== "function" || typeof view.ResizeObserver !== "function") return { refresh() {}, stop() {} };
  for (const registration of [
    { name: "--xcss-server-corner-extent", syntax: "<length-percentage>", inherits: false, initialValue: "0px" },
    { name: "--xcss-server-corner-mode", syntax: "*", inherits: false, initialValue: "paint" },
    { name: "--xcss-server-corner-nested", syntax: "none | all | nearest", inherits: false, initialValue: "none" },
  ]) { try { view.CSS.registerProperty(registration); } catch { /* Stylesheet already registered it. */ } }
  const records = new Map<HTMLElement, RecordState>();
  const draftStyle = document.createElement("div").style;
  const allProperties = Array.from(view.getComputedStyle(document.documentElement)).filter(name => !ownedPaintProperty(name));
  // Raw SVG may be cached across documents; Blob URLs belong to this controller
  // only. Never share a URL that another document's stop() could revoke.
  const imageUrls = new Map<string, string>();
  let usedImages = new Set<string>();
  const imageUrl = (source: string) => {
    usedImages.add(source);
    let url = imageUrls.get(source);
    if (!url) { url = view.URL.createObjectURL(new view.Blob([source], { type: "image/svg+xml" })); imageUrls.set(source, url); }
    return `url("${url}")`;
  };
  let frame = 0, stopped = false, animating = 0;
  const state = (element: HTMLElement) => {
    let value = records.get(element);
    if (!value) { value = { saved: new Map(), pending: new Map(), transitionDirty: true, originalState: element.getAttribute("data-xcss-server-corner-state"), originalReason: element.getAttribute("data-xcss-server-corner-reason") }; records.set(element, value); }
    return value;
  };
  const put = (element: HTMLElement, name: string, value: string) => {
    const record = state(element); let saved = record.saved.get(name);
    if (!saved) { saved = { value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) }; record.saved.set(name, saved); }
    record.pending.set(name, value);
  };
  const restore = (element: HTMLElement, record: RecordState, final: boolean) => {
    draftStyle.cssText = element.style.cssText;
    for (const [name, saved] of record.saved) {
      if (!final && transitionNames.includes(name)) continue;
      const value = element.style.getPropertyValue(name), priority = element.style.getPropertyPriority(name);
      if (saved.applied !== undefined && (value !== saved.applied || priority !== "important")) { saved.value = value; saved.priority = priority; }
      if (saved.value) draftStyle.setProperty(name, saved.value, saved.priority); else draftStyle.removeProperty(name);
      saved.applied = undefined;
    }
    if (element.style.cssText !== draftStyle.cssText) element.style.cssText = draftStyle.cssText;
    record.pending.clear();
    if (record.decoration) record.decoration.style.display = "none";
    if (final) {
      record.decoration?.remove();
      for (const [name, value] of [["data-xcss-server-corner-state", record.originalState], ["data-xcss-server-corner-reason", record.originalReason]]) {
        if (value === null) element.removeAttribute(name!); else element.setAttribute(name!, value!);
      }
      records.delete(element);
    }
  };
  const prepareTransitions = (element: HTMLElement) => {
    const previous = records.get(element);
    if (previous && !previous.transitionDirty) return;
    // Read author transition configuration with paint overrides still in place;
    // no background change occurs while this configuration is restored.
    if (previous) {
      draftStyle.cssText = element.style.cssText;
      for (const name of transitionNames) {
        const saved = previous.saved.get(name); if (!saved) continue;
        const current = element.style.getPropertyValue(name), priority = element.style.getPropertyPriority(name);
        if (saved.applied !== undefined && (current !== saved.applied || priority !== "important")) { saved.value = current; saved.priority = priority; }
        if (saved.value) draftStyle.setProperty(name, saved.value, saved.priority); else draftStyle.removeProperty(name);
        saved.applied = undefined;
      }
      if (element.style.cssText !== draftStyle.cssText) element.style.cssText = draftStyle.cssText;
    }
    const css = view.getComputedStyle(element);
    const properties = split(css.transitionProperty, "comma");
    const lists = transitionNames.slice(1).map(name => split(css.getPropertyValue(name), "comma"));
    // The UA default is `all 0s`, which needs no intervention. Expanding it on
    // every tile would add hundreds of inert declarations and force layouts.
    if (!properties.some((name, index) => (name === "all" || ownedPaintProperty(name)) && number(lists[0][index % lists[0].length]) > 0)) { if (previous) previous.transitionDirty = false; return; }
    const retained: { name: string; index: number }[] = [];
    properties.forEach((name, index) => {
      if (name === "all") retained.push(...allProperties.map(name => ({ name, index })));
      else if (!ownedPaintProperty(name) && name !== "none") retained.push({ name, index });
    });
    // SVG paints change palette at the state boundary. Keeping transitions on
    // the native transparent paint would produce a run/cancel loop on every
    // measurement. Geometry, opacity and transform animations remain native.
    put(element, "transition-property", retained.map(p => p.name).join(",") || "none");
    lists.forEach((list, index) => put(element, transitionNames[index + 1], retained.map(p => list[p.index % list.length] || (index === 3 ? "normal" : "0s")).join(",") || (index === 2 ? "ease" : index === 3 ? "normal" : "0s")));
    const record = state(element); record.transitionDirty = false;
    draftStyle.cssText = element.style.cssText;
    for (const [name, value] of record.pending) draftStyle.setProperty(name, value, "important");
    element.style.cssText = draftStyle.cssText;
    for (const name of record.pending.keys()) record.saved.get(name)!.applied = element.style.getPropertyValue(name);
    record.pending.clear();
  };
  const mark = (element: HTMLElement, status: string, reason?: string) => {
    state(element); element.setAttribute("data-xcss-server-corner-state", status);
    if (reason) element.setAttribute("data-xcss-server-corner-reason", reason); else element.removeAttribute("data-xcss-server-corner-reason");
  };
  const forced = view.matchMedia("(forced-colors: active)");
  const colorScheme = view.matchMedia("(prefers-color-scheme: dark)");
  const observer = new view.MutationObserver(() => { for (const record of records.values()) record.transitionDirty = true; schedule(); });
  const resize = new view.ResizeObserver(() => schedule());
  const observe = () => { observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); };
  function update() {
    frame = 0; if (stopped) return;
    // All self writes happen synchronously while disconnected. App mutations
    // cannot interleave in this JS task; no self-induced observer loop remains.
    observer.disconnect();
    usedImages = new Set();
    for (const element of records.keys()) if (element.isConnected) prepareTransitions(element);
    for (const [element, record] of records) {
      if (!element.isConnected) resize.unobserve(element);
      restore(element, record, !element.isConnected);
      if (record.decoration) record.decoration.style.display = "none";
    }
    const selected = new Set<HTMLElement>();
    type Candidate = { node: HTMLElement; css: CSSStyleDeclaration; rect: DOMRect; fragmented: boolean };
    const candidates: Candidate[] = [];
    // Read every candidate before paint writes, avoiding a style/layout flush
    // per tile in large galleries. Unselected descendants inherit extent=0.
    for (const node of document.querySelectorAll<HTMLElement>("*")) {
      if (node.namespaceURI !== "http://www.w3.org/1999/xhtml" || node.hasAttribute("data-xcss-server-corner-decoration")) continue;
      const live = view.getComputedStyle(node);
      if (number(node.getAttribute("data-xcss-server-corner-extent") ?? live.getPropertyValue("--xcss-server-corner-extent")) <= 0) continue;
      if (!records.has(node)) prepareTransitions(node);
      candidates.push({ node, css: snapshot(view.getComputedStyle(node)), rect: node.getBoundingClientRect(), fragmented: node.getClientRects().length > 1 });
    }
    const candidateByNode = new Map(candidates.map(candidate => [candidate.node, candidate]));
    const geometryByNode = new Map<HTMLElement, ServerCornerGeometry>();
    const nestedCandidates = new Map<HTMLElement, { follow: "all" | "nearest"; parent?: Candidate; reason?: string }>();
    const coordinateSafety = new Map<HTMLElement, boolean>();
    const translatedOnly = (value: string) => {
      if (value === "" || value === "none") return true;
      try {
        const matrix = new view.DOMMatrixReadOnly(value);
        return matrix.is2D && Math.abs(matrix.a - 1) < 1e-9 && Math.abs(matrix.d - 1) < 1e-9 && Math.abs(matrix.b) < 1e-9 && Math.abs(matrix.c) < 1e-9;
      } catch { return false; }
    };
    const unsupportedCoordinates = (element: HTMLElement): boolean => {
      const known = coordinateSafety.get(element); if (known !== undefined) return known;
      const css = candidateByNode.get(element)?.css ?? view.getComputedStyle(element);
      // A common translation cancels in the DOMRect difference. Other affine
      // or 3D transforms distort CSS pixels and must retain independent corners.
      const translate = css.getPropertyValue("translate").trim(), components = split(translate, "space");
      const changed = !translatedOnly(css.getPropertyValue("transform").trim()) ||
        ["perspective", "rotate", "scale"].some(name => { const value = css.getPropertyValue(name).trim(); return value !== "" && value !== "none"; }) ||
        components.length > 2 && !/^[-+]?0(?:\.0+)?(?:px)?$/.test(components[2]) ||
        !["", "normal", "1"].includes(css.getPropertyValue("zoom").trim());
      const unsafe = changed || (element.parentElement !== null && unsupportedCoordinates(element.parentElement));
      coordinateSafety.set(element, unsafe); return unsafe;
    };
    // Resolve ancestors and coordinate safety during the read phase. DOM order
    // puts every ancestor before its child in the geometry/paint pass below.
    for (const candidate of candidates) {
      const { node, css } = candidate;
      const follow = node.getAttribute("data-xcss-server-corner-nested") ?? css.getPropertyValue("--xcss-server-corner-nested").trim();
      if (follow === "none" || follow === "") continue;
      if (follow !== "all" && follow !== "nearest") {
        nestedCandidates.set(node, { follow: "all", reason: "invalid-mode" }); continue;
      }
      let parent: Candidate | undefined;
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const possible = candidateByNode.get(ancestor);
        if (possible && (ancestor.getAttribute("data-xcss-server-corner") ?? possible.css.getPropertyValue("--xcss-server-corner-mode").trim()) !== "none") { parent = possible; break; }
      }
      const reason = !parent ? "no-parent" : unsupportedCoordinates(node) ? "transformed-coordinates" : css.position === "fixed" || css.position === "sticky" ? "positioned-coordinates" : undefined;
      nestedCandidates.set(node, { follow, parent, reason });
    }
    for (const { node, css, rect, fragmented } of candidates) {
      const raw = node.getAttribute("data-xcss-server-corner-extent") ?? css.getPropertyValue("--xcss-server-corner-extent").trim();
      const mode = node.getAttribute("data-xcss-server-corner") ?? css.getPropertyValue("--xcss-server-corner-mode").trim();
      if (mode === "none" || number(raw) <= 0) continue;
      selected.add(node); resize.observe(node);
      const dimension = (axis: "width" | "height") => {
        if (!/^(?:\d+\.?\d*|\.\d+)px$/.test(css[axis])) return axis === "width" ? rect.width : rect.height;
        const value = number(css[axis]);
        const sides = axis === "width" ? ["left", "right"] : ["top", "bottom"];
        return css.boxSizing === "border-box" ? value : value + sides.reduce((sum, side) => sum + number(css.getPropertyValue(`padding-${side}`)) + number(css.getPropertyValue(`border-${side}-width`)), 0);
      };
      const width = dimension("width") || rect.width, height = dimension("height") || rect.height;
      if (forced.matches || width <= 0 || height <= 0 || ["table", "table-row", "table-cell"].includes(css.display) || fragmented) { mark(node, "fallback", forced.matches ? "forced-colors" : width <= 0 || height <= 0 ? "not-visible" : fragmented ? "fragmented-inline" : "table-layout"); continue; }
      if (css.borderImageSource !== "none" || css.maskImage !== "none") { mark(node, "fallback", css.maskImage !== "none" ? "existing-mask" : "existing-border-image"); continue; }
      const extent = raw.endsWith("%") ? number(raw) * Math.min(width, height) / 100 : number(raw);
      let geometry: ServerCornerGeometry;
      try { geometry = createServerCornerGeometry({ width, height, extent, tolerance: 0.02 }); }
      catch { mark(node, "fallback", "invalid-geometry"); continue; }
      const nesting = nestedCandidates.get(node);
      let nestedReason = nesting?.reason;
      if (nesting && !nestedReason) {
        const parent = nesting.parent!, parentGeometry = geometryByNode.get(parent.node);
        if (!parentGeometry) nestedReason = "parent-unavailable";
        else {
          try {
            geometry = createNestedServerCornerGeometry({ width, height, extent, parent: parentGeometry, left: rect.left - parent.rect.left, top: rect.top - parent.rect.top, follow: nesting.follow, tolerance: .02 });
            nestedReason = geometry.nested?.reason;
          } catch { nestedReason = "invalid-geometry"; }
        }
      }
      const layers = shadows(css.boxShadow);
      if (!layers) { mark(node, "fallback", "inset-or-unsupported-shadow"); continue; }
      const hasImage = css.backgroundImage !== "none";
      const hasBackdrop = css.backdropFilter !== "none";
      const backgroundChild = hasImage || hasBackdrop;
      const media = ["IMG", "VIDEO", "CANVAS"].includes(node.tagName);
      // Native/replaced controls cannot receive a background child safely.
      if (backgroundChild && ["INPUT", "TEXTAREA", "SELECT", "IMG", "VIDEO", "CANVAS"].includes(node.tagName) && !media) { mark(node, "fallback", "native-background-image-or-backdrop"); continue; }
      let painted: ReturnType<typeof decoration>;
      try { painted = decoration(geometry, css, layers, backgroundChild && !media); }
      catch { mark(node, "fallback", "invalid-paint-geometry"); continue; }
      if (!painted) { mark(node, "fallback", "unsupported-border-or-shadow-inset"); continue; }
      const record = state(node);
      const paintedUrl = imageUrl(painted.image);
      const borderWidths = ["top", "right", "bottom", "left"].map(side => css.getPropertyValue(`border-${side}-width`));
      if (backgroundChild && !media) {
        let child = record.decoration;
        if (!child) { child = document.createElement("div"); child.setAttribute("data-xcss-server-corner-decoration", ""); child.setAttribute("aria-hidden", "true"); record.decoration = child; }
        if (child.parentNode !== node) node.prepend(child);
        child.style.cssText = "position:absolute;pointer-events:none;z-index:-1;margin:0;padding:0;border:0;display:block;";
        child.style.inset = ["top", "right", "bottom", "left"].map(side => `${-number(css.getPropertyValue(`border-${side}-width`))}px`).join(" ");
        child.style.boxSizing = "border-box";
        // Preserve the author's padding/content background positioning areas.
        // This absolute decoration still occupies only the original border box.
        for (const side of ["top", "right", "bottom", "left"]) {
          child.style.setProperty(`border-${side}`, `${css.getPropertyValue(`border-${side}-width`)} solid transparent`);
          child.style.setProperty(`padding-${side}`, css.getPropertyValue(`padding-${side}`));
        }
        for (const name of ["background-color", "background-image", "background-position", "background-size", "background-repeat", "background-attachment", "background-origin", "background-clip", "background-blend-mode"]) child.style.setProperty(name, css.getPropertyValue(name));
        // Negative stacking backgrounds otherwise cover the host's border.
        // Repeat the transparent SVG border layer above the original CSS
        // background layers; external images remain ordinary CSS, never SVG.
        child.style.backgroundImage = `${paintedUrl}, ${css.backgroundImage}`;
        child.style.backgroundPosition = `${-painted.margin}px ${-painted.margin}px, ${css.backgroundPosition}`;
        child.style.backgroundSize = `${fmt(width + painted.margin * 2)}px ${fmt(height + painted.margin * 2)}px, ${css.backgroundSize}`;
        child.style.backgroundRepeat = `no-repeat, ${css.backgroundRepeat}`;
        child.style.backgroundOrigin = `border-box, ${css.backgroundOrigin}`;
        child.style.backgroundClip = `border-box, ${css.backgroundClip}`;
        child.style.backgroundBlendMode = `normal, ${css.backgroundBlendMode}`;
        child.style.backdropFilter = css.backdropFilter;
        child.style.clipPath = `path("${geometry.path}")`;
        if (css.position === "static") put(node, "position", "relative");
        put(node, "isolation", "isolate");
      }
      put(node, "background-color", "transparent");
      if (!media) put(node, "background-image", "none");
      if (hasBackdrop) put(node, "backdrop-filter", "none");
      put(node, "box-shadow", "none");
      put(node, "border-radius", "0px");
      for (const [i, side] of ["top", "right", "bottom", "left"].entries()) {
        put(node, `border-${side}-width`, borderWidths[i]);
        put(node, `border-${side}-style`, "solid");
        put(node, `border-${side}-color`, "transparent");
      }
      put(node, "border-image-source", paintedUrl);
      put(node, "border-image-slice", `${painted.slice ?? painted.margin} fill`);
      put(node, "border-image-width", `${painted.slice ?? painted.margin}px`);
      put(node, "border-image-outset", `${painted.margin}px`);
      put(node, "border-image-repeat", "stretch");
      const clipping = mode === "clip" || css.overflowX === "hidden" || css.overflowX === "clip" || css.overflowY === "hidden" || css.overflowY === "clip";
      if (clipping) {
        if (!view.CSS.supports("mask-clip", "no-clip")) { restore(node, record, false); mark(node, "fallback", "mask-no-clip-unavailable"); continue; }
        const margin = Math.max(painted.margin, Math.ceil(number(css.outlineWidth) + Math.abs(number(css.outlineOffset)) + 4));
        put(node, "mask-image", imageUrl(mask(geometry, margin)));
        put(node, "mask-clip", "no-clip"); put(node, "mask-origin", "border-box");
        put(node, "mask-size", `${fmt(width + margin * 2)}px ${fmt(height + margin * 2)}px`);
        put(node, "mask-position", `${-margin}px ${-margin}px`); put(node, "mask-repeat", "no-repeat");
      }
      geometryByNode.set(node, geometry);
      mark(node, clipping ? "clip" : "paint", nestedReason ? `nested-${nestedReason}` : undefined);
    }
    for (const [element, record] of records) {
      if (selected.has(element)) continue;
      restore(element, record, true); resize.unobserve(element);
    }
    // Parse off-DOM, then commit once per element. Repeated setProperty calls
    // on attached nodes create needless style invalidations in large galleries.
    for (const [element, record] of records) {
      if (!record.pending.size) continue;
      draftStyle.cssText = element.style.cssText;
      for (const [name, value] of record.pending) draftStyle.setProperty(name, value, "important");
      element.style.cssText = draftStyle.cssText;
      // Gecko may serialize colours differently after cssText is assigned to
      // the real node. Compare author edits with this actual applied value.
      for (const name of record.pending.keys()) record.saved.get(name)!.applied = element.style.getPropertyValue(name);
      record.pending.clear();
    }
    // Styles have been restored/replaced before unused URLs are revoked.
    // Keep at most 96 inactive SVGs for hover/theme reuse, plus live images.
    let inactive = [...imageUrls.keys()].filter(source => !usedImages.has(source));
    for (const source of inactive.slice(0, Math.max(0, inactive.length - 96))) {
      view.URL.revokeObjectURL(imageUrls.get(source)!); imageUrls.delete(source);
    }
    observe(); if (animating > 0) schedule();
  }
  function schedule() { if (!stopped && !frame) frame = view.requestAnimationFrame(update); }
  const events = ["pointerover", "pointerout", "pointerdown", "pointerup", "focusin", "focusout", "keydown", "keyup", "change", "input", "load", "DOMContentLoaded", "scroll"];
  const interaction = (event: Event) => {
    for (let element = event.target instanceof view.Element ? event.target : null; element; element = element.parentElement) { const record = records.get(element as HTMLElement); if (record) record.transitionDirty = true; }
    schedule();
  };
  for (const event of events) document.addEventListener(event, interaction, true);
  const animationStart = (event: Event) => {
    // Size changes are already observed. Only an animated opt-in extent needs
    // a frame loop; spinners and self-written paint properties never start one.
    if (event instanceof view.TransitionEvent && ownedPaintProperty(event.propertyName) && records.has(event.target as HTMLElement)) return;
    if (event instanceof view.TransitionEvent && event.propertyName === "--xcss-server-corner-extent") animating++;
    schedule();
  };
  const animationEnd = (event: Event) => {
    if (event instanceof view.TransitionEvent && ownedPaintProperty(event.propertyName) && records.has(event.target as HTMLElement)) return;
    if (event instanceof view.TransitionEvent && event.propertyName === "--xcss-server-corner-extent") animating = Math.max(0, animating - 1);
    schedule();
  };
  for (const name of ["transitionrun", "animationstart"]) document.addEventListener(name, animationStart, true);
  for (const name of ["transitionend", "transitioncancel", "animationend", "animationcancel"]) document.addEventListener(name, animationEnd, true);
  forced.addEventListener("change", schedule); colorScheme.addEventListener("change", schedule);
  document.fonts?.addEventListener("loadingdone", schedule);
  observe(); schedule();
  const controller: ServerCornersController = {
    refresh: schedule,
    stop() {
      if (stopped) return;
      stopped = true; if (frame) view.cancelAnimationFrame(frame);
      controllers.delete(document);
      observer.disconnect(); resize.disconnect();
      for (const event of events) document.removeEventListener(event, interaction, true);
      for (const name of ["transitionrun", "animationstart"]) document.removeEventListener(name, animationStart, true);
      for (const name of ["transitionend", "transitioncancel", "animationend", "animationcancel"]) document.removeEventListener(name, animationEnd, true);
      forced.removeEventListener("change", schedule); colorScheme.removeEventListener("change", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
      for (const [element, record] of records) restore(element, record, true);
      for (const url of imageUrls.values()) view.URL.revokeObjectURL(url);
      imageUrls.clear(); view.removeEventListener("pagehide", pagehide);
    },
  };
  controllers.set(document, controller);
  const pagehide = (event: PageTransitionEvent) => { if (!event.persisted) controller.stop(); };
  view.addEventListener("pagehide", pagehide);
  return controller;
}
