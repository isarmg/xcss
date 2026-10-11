/** User-selected Mac mini enclosure fit: a non-rational degree-seven Bézier
 * corner, rotated four times and joined by straight sides. This is not an
 * identification of Apple's SwiftUI continuous or App Icon mask. */
export const SERVER_CORNER_PROFILE = "mac-mini-bezier7";
export const SERVER_CORNER_PHOTO_EXTENT = 0.31056899327095955;
/** Unit box, clockwise screen coordinates: (0,0) to (1,1). The source uses
 * y-up; only its y coordinate has been inverted. */
export const SERVER_CORNER_CONTROL_POINTS: readonly (readonly [number, number])[] = Object.freeze([
  [0, 0], [0.3633595684909532, 0], [0.5804546942007682, 0], [0.7281206143651912, 0],
  [1, 0.27187938563480885], [1, 0.41954530579923177], [1, 0.6366404315090468], [1, 1],
].map(point => Object.freeze(point as [number, number])));

export interface ServerCornerOptions { width: number; height: number; extent: number; /** CSS px; default .05. */ tolerance?: number }
export interface ServerCornerPoint { readonly x: number; readonly y: number; readonly heading: number; /** Original curve parameter; absent on independent edges. */ readonly parameter?: number }
export type ServerCornerName = "top-right" | "bottom-right" | "bottom-left" | "top-left";
export interface ServerCornerSource {
  /** Original physical extent and certified minimum curvature radius. */
  readonly extent: number; readonly radius: number;
  /** Accumulated inward offset before applying the uniform physical scale. */
  readonly offset: number; readonly scale: number;
}
export interface ServerCornerCurve { readonly extent: number; readonly radius: number; readonly points: readonly ServerCornerPoint[]; readonly source: ServerCornerSource }
export interface NestedServerCornerOptions extends ServerCornerOptions {
  parent: ServerCornerGeometry; /** Child border-box origin in untransformed parent coordinates. */ left: number; top: number;
  matchTolerance?: number; /** Default all repeats the aligned source at every vertex. */ follow?: "all" | "nearest";
}
export interface ServerCornerNested {
  readonly follow: "all" | "nearest"; readonly anchor?: ServerCornerName;
  readonly followed: readonly ServerCornerName[];
  /** Physical alignment within matchTolerance; empty after fit scaling. */
  readonly aligned: readonly ServerCornerName[]; readonly linked: readonly ServerCornerName[];
  readonly skipped: readonly { readonly corner: ServerCornerName; readonly reason: string }[];
  readonly alignmentError: number; readonly profileScale: number; readonly reason?: string;
}
export interface ServerCornerGeometry {
  readonly width: number; readonly height: number; readonly extent: number; readonly radius: number;
  readonly path: string; readonly points: readonly ServerCornerPoint[];
  /** Clockwise: top-right, bottom-right, bottom-left, top-left. */
  readonly corners: readonly ServerCornerCurve[]; readonly canonical: boolean; readonly nested?: ServerCornerNested;
  /** Interpolation, arithmetic and SVG serialization allowance, in CSS px. */ readonly errorBound: number;
}

type Vector = { x: number; y: number };
const controls: Vector[] = SERVER_CORNER_CONTROL_POINTS.map(([x, y]) => ({ x, y }));
const derivative = (points: readonly Vector[]) => points.slice(1).map((p, i) => ({ x: (points.length - 1) * (p.x - points[i].x), y: (points.length - 1) * (p.y - points[i].y) }));
const derivatives = [controls];
for (let order = 1; order <= 4; order++) derivatives.push(derivative(derivatives[order - 1]));
function finite(value: number, name: string) { if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`); return value; }
function evaluate(points: readonly Vector[], t: number): Vector {
  const row = points.map(p => ({ ...p }));
  for (let n = row.length - 1; n > 0; n--) for (let i = 0; i < n; i++) row[i] = { x: row[i].x * (1 - t) + row[i + 1].x * t, y: row[i].y * (1 - t) + row[i + 1].y * t };
  return row[0];
}
const cross = (a: Vector, b: Vector) => a.x * b.y - a.y * b.x;
const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y;
/** Analytic point/derivatives and arc-length curvature derivatives. Endpoint
 * κ=κ_s=0 gives G3 joins to straight lines; κ_ss is nonzero, so not G4. */
export function serverCornerProfile(t: number) {
  finite(t, "t"); if (t < 0 || t > 1) throw new RangeError("t must be in [0, 1]");
  const [point, first, second, third, fourth] = derivatives.map(c => evaluate(c, t));
  const speed = Math.hypot(first.x, first.y), va = dot(first, second);
  const n = cross(first, second), nt = cross(first, third), ntt = cross(second, third) + cross(first, fourth);
  const kt = nt / speed ** 3 - 3 * n * va / speed ** 5;
  const ktt = ntt / speed ** 3 - 6 * nt * va / speed ** 5 - 3 * n * (dot(second, second) + dot(first, third)) / speed ** 5 + 15 * n * va ** 2 / speed ** 7;
  return Object.freeze({ ...point, first: Object.freeze(first), second: Object.freeze(second), third: Object.freeze(third), fourth: Object.freeze(fourth), speed,
    heading: Math.atan2(first.y, first.x), curvature: n / speed ** 3, curvatureDerivative: kt / speed,
    curvatureSecondDerivative: ktt / speed ** 2 - kt * va / speed ** 4 });
}
function splitVectors(points: readonly Vector[]): [Vector[], Vector[]] {
  const rows = [points.map(p => ({ ...p }))];
  while (rows.at(-1)!.length > 1) { const row = rows.at(-1)!; rows.push(row.slice(1).map((p, i) => ({ x: (p.x + row[i].x) / 2, y: (p.y + row[i].y) / 2 }))); }
  return [rows.map(row => row[0]), rows.map(row => row.at(-1)!).reverse()];
}
function splitNumbers(points: readonly number[]): [number[], number[]] {
  const rows = [[...points]];
  while (rows.at(-1)!.length > 1) { const row = rows.at(-1)!; rows.push(row.slice(1).map((p, i) => (p + row[i]) / 2)); }
  return [rows.map(row => row[0]), rows.map(row => row.at(-1)!).reverse()];
}
function binomial(n: number, k: number) { let result = 1; for (let i = 1; i <= k; i++) result = result * (n - i + 1) / i; return result; }
function product(a: readonly number[], b: readonly number[]) {
  const n = a.length - 1, m = b.length - 1;
  return Array.from({ length: n + m + 1 }, (_, k) => { let result = 0; for (let i = Math.max(0, k - m); i <= Math.min(n, k); i++) result += a[i] * b[k - i] * binomial(n, i) * binomial(m, k - i) / binomial(n + m, k); return result; });
}
function minimumSpeed(points: readonly Vector[]) {
  const distance = (axis: "x" | "y") => { const lo = Math.min(...points.map(p => p[axis])), hi = Math.max(...points.map(p => p[axis])); return lo > 0 ? lo : hi < 0 ? -hi : 0; };
  return Math.hypot(distance("x"), distance("y"));
}
/** Polynomial convex-hull certificate, not a sampled curvature maximum.
 * cross(B',B'') has nonnegative degree-11 Bernstein coefficients, proving
 * convexity. 512 dyadic interval hulls bound its maximum and minimum speed.
 * A relative 1e-10 margin covers IEEE arithmetic, giving a conservative
 * minimum radius used to reject inward offsets before possible cusps. */
function certifyProfile() {
  const v = derivatives[1], a = derivatives[2], xy = product(v.map(p => p.x), a.map(p => p.y)), yx = product(v.map(p => p.y), a.map(p => p.x));
  const numerator = xy.map((value, i) => value - yx[i]);
  if (Math.min(...numerator) < -1e-12) throw new Error("Mac mini profile convexity certificate failed");
  let parts = [{ velocity: v, numerator }];
  for (let depth = 0; depth < 9; depth++) parts = parts.flatMap(part => { const [vl, vr] = splitVectors(part.velocity), [nl, nr] = splitNumbers(part.numerator); return [{ velocity: vl, numerator: nl }, { velocity: vr, numerator: nr }]; });
  let maxCurvature = 0, minSpeed = Infinity;
  for (const part of parts) { const speed = minimumSpeed(part.velocity); minSpeed = Math.min(minSpeed, speed); maxCurvature = Math.max(maxCurvature, Math.max(...part.numerator) / speed ** 3); }
  maxCurvature *= 1 + 1e-10; minSpeed *= 1 - 1e-10;
  return Object.freeze({ intervals: parts.length, minimumSpeed: minSpeed, maximumCurvature: maxCurvature, minimumRadius: 1 / maxCurvature, convex: true, arithmeticRelativeMargin: 1e-10 });
}
export const SERVER_CORNER_PROFILE_BOUNDS = certifyProfile();

const fmt = (value: number) => Number(value.toFixed(6)).toString();
const pair = (point: Vector) => `${fmt(point.x)} ${fmt(point.y)}`;
const freezePoints = (points: ServerCornerPoint[]) => Object.freeze(points.map(point => Object.freeze(point)));
const cornerNames: readonly ServerCornerName[] = ["top-right", "bottom-right", "bottom-left", "top-left"];
const geometryCache = new Map<string, ServerCornerGeometry>();
const nestedCache = new WeakMap<ServerCornerGeometry, Map<string, ServerCornerGeometry>>();
const sampleCache = new Map<string, { points: readonly ServerCornerPoint[]; bound: number }>();
const pathCache = new WeakMap<ServerCornerGeometry, Map<number, string>>();
const geometryTolerance = new WeakMap<ServerCornerGeometry, number>();
function cacheSet<K, V>(cache: Map<K, V>, key: K, value: V, limit = 96) { cache.set(key, value); if (cache.size > limit) cache.delete(cache.keys().next().value!); return value; }
function cacheGet<K, V>(cache: Map<K, V>, key: K) { const value = cache.get(key); if (value !== undefined) { cache.delete(key); cache.set(key, value); } return value; }
function profilePoint(t: number, offset: number): ServerCornerPoint {
  const q = serverCornerProfile(t);
  return { x: q.x - offset * Math.sin(q.heading), y: q.y + offset * Math.cos(q.heading) - offset, heading: q.heading, parameter: t };
}
/** Q=B+D*n, with T=B'/|B'| and inward unit normal n. Bounds:
 * |T''| <= J/v_min+3*A²/v_min²; |Q''| <= A+|D|*|T''|.
 * Parameter interval width h gives interpolation deviation <= h²*sup|Q''|/8.
 * Derivative Bézier hulls supply every interval bound; no dense-grid guess.
 * SVG uses chords, which are not themselves mathematically G3. */
function sampleProfile(offset: number, budget: number) {
  const key = `${offset},${budget}`, cached = cacheGet(sampleCache, key); if (cached) return cached;
  const points = [profilePoint(0, offset)]; let bound = 0;
  const visit = (v: readonly Vector[], a: readonly Vector[], j: readonly Vector[], start: number, end: number, depth: number) => {
    const speed = minimumSpeed(v), acceleration = Math.max(...a.map(p => Math.hypot(p.x, p.y))), jerk = Math.max(...j.map(p => Math.hypot(p.x, p.y)));
    const second = acceleration + Math.abs(offset) * (jerk / speed + 3 * acceleration ** 2 / speed ** 2);
    const error = second * (end - start) ** 2 / 8 * (1 + 1e-10);
    if (Number.isFinite(error) && error <= budget) { bound = Math.max(bound, error); points.push(profilePoint(end, offset)); return; }
    if (depth === 24) throw new RangeError("Corner sampling cannot meet the requested budget");
    const [vl, vr] = splitVectors(v), [al, ar] = splitVectors(a), [jl, jr] = splitVectors(j), middle = (start + end) / 2;
    visit(vl, al, jl, start, middle, depth + 1); visit(vr, ar, jr, middle, end, depth + 1);
  };
  visit(derivatives[1], derivatives[2], derivatives[3], 0, 1, 0);
  return cacheSet(sampleCache, key, Object.freeze({ points: freezePoints(points), bound }));
}
function sourceFor(extent: number): ServerCornerSource { return Object.freeze({ extent, radius: extent * SERVER_CORNER_PROFILE_BOUNDS.minimumRadius, offset: 0, scale: 1 }); }
function regular(source: ServerCornerSource) { return source.extent > 0 && source.scale > 0 && source.offset < source.radius - Math.max(source.extent * Number.EPSILON * 16, source.radius * 1e-10); }
function localCurve(source: ServerCornerSource, tolerance: number) {
  const extent = (source.extent - source.offset) * source.scale;
  if (source.extent === 0) return { extent: 0, radius: 0, points: [{ x: 0, y: 0, heading: 0 }, { x: 0, y: 0, heading: Math.PI / 2 }], bound: 0 };
  if (!regular(source)) throw new RangeError("Corner offset is not certified regular");
  const size = source.extent * source.scale, allowance = 2e-6 + size * 1e-10;
  if (allowance >= tolerance / 2) throw new RangeError("Tolerance is smaller than arithmetic/serialization allowance");
  const sampled = sampleProfile(source.offset / source.extent, tolerance / (2 * size));
  return { extent, radius: (source.radius - source.offset) * source.scale, points: sampled.points.map(q => ({ ...q, x: q.x * size, y: q.y * size })), bound: sampled.bound * size + allowance };
}
function transform(q: ServerCornerPoint, index: number, width: number, height: number, extent: number): ServerCornerPoint {
  if (index === 0) return { ...q, x: width - extent + q.x, y: q.y };
  if (index === 1) return { ...q, x: width - q.y, y: height - extent + q.x, heading: q.heading + Math.PI / 2 };
  if (index === 2) return { ...q, x: extent - q.x, y: height - q.y, heading: q.heading + Math.PI };
  return { ...q, x: q.y, y: extent - q.x, heading: q.heading + 3 * Math.PI / 2 };
}
function assemble(width: number, height: number, sources: readonly ServerCornerSource[], tolerance: number, canonical: boolean, nested?: ServerCornerNested): ServerCornerGeometry {
  let errorBound = 0;
  const corners = sources.map((source, index) => {
    const local = localCurve(source, tolerance); errorBound = Math.max(errorBound, local.bound);
    return Object.freeze({ extent: local.extent, radius: local.radius, source, points: freezePoints(local.points.map(q => transform(q, index, width, height, local.extent))) });
  });
  // Translation to a large border-box origin also has floating-point error;
  // sharp corners still need a decimal serialization allowance.
  errorBound += 2e-6 + Math.max(width, height) * Number.EPSILON * 16;
  if (errorBound > tolerance) throw new RangeError("Corner cannot meet the requested coordinate budget");
  const points = freezePoints([{ x: corners[3].extent, y: 0, heading: 0 }, ...corners.flatMap(corner => [...corner.points])]);
  const path = points.map((q, i) => `${i ? "L" : "M"}${pair(q)}`).join("") + "Z";
  const result = Object.freeze({ width, height, extent: Math.max(...corners.map(c => c.extent)), radius: Math.min(...corners.map(c => c.radius)), path, points,
    corners: Object.freeze(corners), canonical, ...(nested ? { nested } : {}), errorBound });
  geometryTolerance.set(result, tolerance); return result;
}
/** Equal physical corner boxes; clamping to half the short side prevents
 * overlap without anisotropically stretching the original square outline. */
export function createServerCornerGeometry(options: ServerCornerOptions): ServerCornerGeometry {
  const width = finite(options.width, "width"), height = finite(options.height, "height"), requested = finite(options.extent, "extent"), tolerance = finite(options.tolerance ?? .05, "tolerance");
  if (width <= 0 || height <= 0 || requested < 0 || tolerance <= 0) throw new RangeError("Invalid corner dimensions or tolerance");
  const extent = Math.min(requested, width / 2, height / 2), key = [width, height, extent, tolerance].join(","), cached = cacheGet(geometryCache, key);
  if (cached) return cached;
  const source = sourceFor(extent); return cacheSet(geometryCache, key, assemble(width, height, [source, source, source, source], tolerance, true));
}
function freezeNested(nested: ServerCornerNested): ServerCornerNested {
  return Object.freeze({ ...nested, followed: Object.freeze([...nested.followed]), aligned: Object.freeze([...nested.aligned]), linked: Object.freeze([...nested.linked]), skipped: Object.freeze(nested.skipped.map(item => Object.freeze({ ...item }))) });
}
const sameSource = (a: ServerCornerSource, b: ServerCornerSource) => ["extent", "offset", "scale"].every(key => Math.abs(a[key as keyof ServerCornerSource] - b[key as keyof ServerCornerSource]) <= 1e-8);
/** Regular inward parallel curves preserve G3: κ_inner=κ/(1-dκ),
 * κ_s,inner=κ_s/(1-dκ)^3. all follows an actually aligned source at every
 * vertex; copied opposite corners are not falsely labelled aligned.
 * Uniform fit scaling preserves shape/G3 but loses actual equal distance.
 * Source offset and scale survive repeated nesting. */
export function createNestedServerCornerGeometry(options: NestedServerCornerOptions): ServerCornerGeometry {
  const base = createServerCornerGeometry(options), parent = options.parent, left = finite(options.left, "left"), top = finite(options.top, "top");
  const match = finite(options.matchTolerance ?? .25, "matchTolerance"), follow = options.follow ?? "all", tolerance = options.tolerance ?? .05;
  if (match < 0 || !["all", "nearest"].includes(follow)) throw new RangeError("Invalid nested matching options");
  const key = [base.width, base.height, base.extent, tolerance, left, top, match, follow].join(",");
  let cache = nestedCache.get(parent); if (!cache) { cache = new Map(); nestedCache.set(parent, cache); }
  const cached = cacheGet(cache, key); if (cached) return cached;
  const right = parent.width - left - base.width, bottom = parent.height - top - base.height, pairs = [[right, top], [right, bottom], [left, bottom], [left, top]];
  const reasons = ["", "", "", ""], distances = pairs.map(([a, b]) => (a + b) / 2);
  const candidates = parent.corners.map((corner, i) => {
    const [a, b] = pairs[i], distance = distances[i], source = Object.freeze({ ...corner.source, offset: corner.source.offset + distance / corner.source.scale });
    reasons[i] = a < -1e-9 || b < -1e-9 ? "outside-parent" : Math.abs(a - b) > match ? "unaligned-insets" : corner.extent === 0 ? "flat-region" : !regular(source) ? "offset-singularity" : "";
    return reasons[i] ? undefined : source;
  });
  let sources = base.corners.map(c => c.source), followed: ServerCornerName[] = [], aligned: ServerCornerName[] = [], anchor: ServerCornerName | undefined;
  let alignmentError = 0, profileScale = 1, reason: string | undefined;
  if (follow === "all") {
    // Stable ties prefer TL, then clockwise; use the nearest valid pair.
    const order = [3, 0, 1, 2].filter(i => candidates[i]).sort((a, b) => distances[a] - distances[b]);
    if (order.length) {
      const index = order[0], selected = candidates[index]!; anchor = cornerNames[index];
      const extent = (selected.extent - selected.offset) * selected.scale;
      profileScale = Math.min(1, base.width / (2 * extent), base.height / (2 * extent));
      const fitted = Object.freeze({ ...selected, scale: selected.scale * profileScale }); sources = [fitted, fitted, fitted, fitted]; followed = [...cornerNames];
      alignmentError = Math.abs(pairs[index][0] - pairs[index][1]) / 2;
      if (profileScale < 1 - 1e-12) reason = "profile-scaled";
      else {
        aligned = cornerNames.filter((_, i) => candidates[i] && sameSource(candidates[i]!, selected));
        alignmentError = Math.max(alignmentError, ...aligned.map(name => { const i = cornerNames.indexOf(name); return Math.abs(pairs[i][0] - pairs[i][1]) / 2; }));
      }
    } else reason = reasons.includes("offset-singularity") ? "offset-singularity" : reasons.includes("flat-region") ? "flat-region" : reasons.every(r => r === "outside-parent") ? "outside-parent" : "no-aligned-corner";
  } else {
    const linked = candidates.map(Boolean), extents = candidates.map((source, i) => source ? (source.extent - source.offset) * source.scale : base.corners[i].extent);
    const edges = [[3, 0, base.width], [0, 1, base.height], [1, 2, base.width], [2, 3, base.height]];
    for (let i = 0; i < 4; i++) if (linked[i] && extents[i] > Math.min(base.width, base.height) + 1e-8) { linked[i] = false; reasons[i] = "overlap"; extents[i] = base.extent; }
    for (const [a, b, limit] of edges) if (linked[a] && linked[b] && extents[a] + extents[b] > limit + 1e-8) for (const i of [a, b]) { linked[i] = false; reasons[i] = "overlap"; extents[i] = base.extent; }
    for (const [a, b, limit] of edges) {
      if (extents[a] + extents[b] <= limit) continue;
      if (linked[a]) extents[b] = Math.max(0, limit - extents[a]); else if (linked[b]) extents[a] = Math.max(0, limit - extents[b]);
      else { const scale = limit / (extents[a] + extents[b]); extents[a] *= scale; extents[b] *= scale; }
    }
    sources = extents.map((extent, i) => linked[i] ? candidates[i]! : sourceFor(extent)); followed = aligned = cornerNames.filter((_, i) => linked[i]);
    alignmentError = Math.max(0, ...linked.map((yes, i) => yes ? Math.abs(pairs[i][0] - pairs[i][1]) / 2 : 0));
    if (!followed.length) reason = reasons.includes("offset-singularity") ? "offset-singularity" : reasons.includes("overlap") ? "overlap" : "no-aligned-corner";
  }
  const nested = freezeNested({ follow, ...(anchor ? { anchor } : {}), followed, aligned, linked: aligned,
    skipped: cornerNames.flatMap((corner, i) => followed.includes(corner) ? [] : [{ corner, reason: reasons[i] || "independent-role" }]), alignmentError, profileScale, ...(reason ? { reason } : {}) });
  return cacheSet(cache, key, assemble(base.width, base.height, sources, tolerance, false, nested));
}
/** Outward shadow/outline spread. Resample the analytic parallel profile at
 * its own derivative bound; shifting old coarse chords would not retain the
 * original error budget. No affine stretching of the whole silhouette. */
export function offsetServerCornerPath(geometry: ServerCornerGeometry, offset: number): string {
  finite(offset, "offset"); if (offset === 0) return geometry.path;
  if (offset <= -geometry.radius) throw new RangeError("Inset exceeds certified minimum curvature radius");
  let cache = pathCache.get(geometry); if (!cache) { cache = new Map(); pathCache.set(geometry, cache); }
  const cached = cacheGet(cache, offset); if (cached) return cached;
  const tolerance = geometryTolerance.get(geometry) ?? .05;
  const expanded = assemble(geometry.width + offset * 2, geometry.height + offset * 2,
    geometry.corners.map(c => c.source.extent === 0 ? sourceFor(0) : Object.freeze({ ...c.source, offset: c.source.offset - offset / c.source.scale })), tolerance, false);
  const points = expanded.points.map(q => ({ x: q.x - offset, y: q.y - offset }));
  return cacheSet(cache, offset, points.map((q, i) => `${i ? "L" : "M"}${pair(q)}`).join("") + "Z", 16);
}
