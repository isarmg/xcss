import test from "node:test";
import assert from "node:assert/strict";
import { createServerCornerGeometry, serverCornerProfile, offsetServerCornerPath,
  SERVER_CORNER_PROFILE, SERVER_CORNER_CONTROL_POINTS, SERVER_CORNER_PROFILE_BOUNDS, SERVER_CORNER_PHOTO_EXTENT } from "../../../dist/admin-ui/server-corner-geometry.js";

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const choose = (n, k) => { let v = 1; for (let i = 1; i <= k; i++) v = v * (n - i + 1) / i; return v; };
// Independent Bernstein summation, instead of production de Casteljau.
function polynomial(controls, t) {
  const n = controls.length - 1;
  return controls.reduce((result, [x, y], i) => {
    const weight = choose(n, i) * t ** i * (1 - t) ** (n - i);
    return { x: result.x + x * weight, y: result.y + y * weight };
  }, { x: 0, y: 0 });
}
const derivativeControls = SERVER_CORNER_CONTROL_POINTS.slice(1).map(([x, y], i) => [7 * (x - SERVER_CORNER_CONTROL_POINTS[i][0]), 7 * (y - SERVER_CORNER_CONTROL_POINTS[i][1])]);
function reference(t, source) {
  const q = polynomial(SERVER_CORNER_CONTROL_POINTS, t), v = polynomial(derivativeControls, t), speed = Math.hypot(v.x, v.y);
  return { x: q.x * source.extent - source.offset * v.y / speed,
    y: q.y * source.extent + source.offset * (v.x / speed - 1) };
}
function local(point, corner, geometry, index) {
  const { width: w, height: h } = geometry, e = corner.extent;
  if (index === 0) return { x: point.x - (w - e), y: point.y };
  if (index === 1) return { x: point.y - (h - e), y: w - point.x };
  if (index === 2) return { x: e - point.x, y: h - point.y };
  return { x: e - point.y, y: point.x };
}
function assertConvex(g) {
  const distinct = g.points.filter((q, i, all) => !i || Math.hypot(q.x - all[i - 1].x, q.y - all[i - 1].y) > 1e-8);
  if (Math.hypot(distinct[0].x - distinct.at(-1).x, distinct[0].y - distinct.at(-1).y) < 1e-8) distinct.pop();
  for (let i = 0; i < distinct.length; i++) {
    const a = distinct[i], b = distinct[(i + 1) % distinct.length], c = distinct[(i + 2) % distinct.length];
    assert.ok((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) >= -1e-7, "convex, nonoverlapping contour");
  }
  for (const q of g.points) assert.ok(q.x >= -1e-8 && q.x <= g.width + 1e-8 && q.y >= -1e-8 && q.y <= g.height + 1e-8);
}
function checkError(g) {
  let observed = 0;
  for (const [index, corner] of g.corners.entries()) {
    if (corner.extent === 0) continue;
    for (let i = 1; i < corner.points.length; i++) {
      const a = corner.points[i - 1], b = corner.points[i];
      // Include actual six-decimal SVG endpoint rounding in the comparison.
      const al = local({ x: +a.x.toFixed(6), y: +a.y.toFixed(6) }, corner, g, index);
      const bl = local({ x: +b.x.toFixed(6), y: +b.y.toFixed(6) }, corner, g, index);
      for (let j = 1; j < 16; j++) {
        const fraction = j / 16, t = a.parameter + (b.parameter - a.parameter) * fraction;
        const q = reference(t, corner.source);
        observed = Math.max(observed, Math.hypot(q.x - al.x * (1 - fraction) - bl.x * fraction, q.y - al.y * (1 - fraction) - bl.y * fraction));
      }
    }
  }
  assert.ok(observed <= g.errorBound, `observed ${observed} exceeds conservative ${g.errorBound}`);
  return observed;
}

test("Mac mini source controls, original proportion and key points are retained", () => {
  assert.equal(SERVER_CORNER_PROFILE, "mac-mini-bezier7");
  assert.equal(SERVER_CORNER_PHOTO_EXTENT, .31056899327095955);
  assert.equal(SERVER_CORNER_CONTROL_POINTS.length, 8);
  assert.deepEqual(SERVER_CORNER_CONTROL_POINTS[3], [.7281206143651912, 0]);
  const diagonal = serverCornerProfile(.5);
  close(diagonal.x, .8141975551596445); close(diagonal.y, .1858024448403555);
  close(diagonal.heading, Math.PI / 4); close(diagonal.curvature, 1.7600990604903817);
  for (let i = 0; i <= 100; i++) {
    const q = serverCornerProfile(i / 100), independently = polynomial(SERVER_CORNER_CONTROL_POINTS, i / 100);
    close(q.x, independently.x); close(q.y, independently.y);
  }
  const g = createServerCornerGeometry({ width: 127, height: 127, extent: 127 * SERVER_CORNER_PHOTO_EXTENT });
  close(g.extent, 39.44226214541186); close(g.width - 2 * g.extent, 48.11547570917629);
  assert.ok(!("arcRatio" in g), "removed circular-arc model has no remaining knob");
});

test("analytic degree-seven endpoints join lines at G3, not G4", () => {
  const start = serverCornerProfile(0), end = serverCornerProfile(1);
  close(start.x, 0); close(start.y, 0); close(end.x, 1); close(end.y, 1);
  close(start.heading, 0); close(end.heading, Math.PI / 2);
  for (const q of [start, end]) {
    close(q.curvature, 0); close(q.curvatureDerivative, 0);
    assert.ok(q.curvatureSecondDerivative > 5.4 && q.curvatureSecondDerivative < 5.5);
    assert.ok(q.speed > 0);
  }
  assert.ok(start.fourth.y > 0 && end.fourth.x < 0, "fourth normal derivative does not match a straight line");
});

test("conservative polynomial hulls bound speed/curvature and regular offset radius", () => {
  const bounds = SERVER_CORNER_PROFILE_BOUNDS;
  assert.equal(bounds.intervals, 512); assert.equal(bounds.convex, true);
  assert.ok(bounds.minimumRadius > .563 && bounds.minimumRadius < .565);
  let maximum = 0;
  for (let i = 0; i <= 5000; i++) {
    const q = serverCornerProfile(i / 5000);
    assert.ok(q.speed >= bounds.minimumSpeed); assert.ok(q.curvature >= -1e-12);
    assert.ok(q.curvature <= bounds.maximumCurvature);
    maximum = Math.max(maximum, q.curvature);
  }
  assert.ok(bounds.maximumCurvature / maximum < 1.01, "safe bound does not unnecessarily reject normal shadow offsets");
});

test("physical corner boxes remain convex across rectangular sizes and small extents", () => {
  for (const [width, height] of [[12, 48], [48, 12], [320, 216], [216, 144], [1024, 1024]]) {
    for (const requested of [0, 1e-12, .01, 27, 42, 1000]) {
      const g = createServerCornerGeometry({ width, height, extent: requested });
      assert.equal(g.extent, Math.min(requested, width / 2, height / 2));
      assert.ok(g.errorBound <= .05); assertConvex(g);
      for (const corner of g.corners) close(corner.extent, g.extent);
    }
  }
  const fractional = createServerCornerGeometry({ width: 10.123456789, height: 20.987654321, extent: 0 });
  const serializedError = Math.hypot(fractional.width - +fractional.width.toFixed(6), fractional.height - +fractional.height.toFixed(6));
  assert.ok(serializedError > 0 && serializedError <= fractional.errorBound);
});

test("adaptive interpolation budget bounds independently evaluated source curves", () => {
  for (const [width, height, extent] of [[600, 400, 150], [536, 336, 118], [100, 80, 27], [72, 56, 56 * SERVER_CORNER_PHOTO_EXTENT]]) {
    const g = createServerCornerGeometry({ width, height, extent, tolerance: .02 });
    assert.ok(g.errorBound <= .02); assert.ok(g.corners.every(c => c.points.length < 500));
    checkError(g); assertConvex(g);
  }
});

test("landscape, portrait, square and compact surfaces use four identical physical corners", () => {
  for (const [width, height, extent] of [[240, 120, 27], [120, 240, 27], [127, 127, 127 * SERVER_CORNER_PHOTO_EXTENT], [274, 144, 144 * SERVER_CORNER_PHOTO_EXTENT], [48, 44, 27]]) {
    const g = createServerCornerGeometry({ width, height, extent, tolerance: .02 });
    assert.equal(g.canonical, true);
    assert.equal(g.extent, Math.min(extent, width / 2, height / 2));
    assert.deepEqual(g.corners.map(c => c.extent), Array(4).fill(g.extent));
    for (const corner of g.corners) assert.equal(corner.source, g.corners[0].source);
    for (let i = 0; i < g.corners[0].points.length; i++) {
      const first = local(g.corners[0].points[i], g.corners[0], g, 0);
      for (let index = 1; index < 4; index++) {
        const q = local(g.corners[index].points[i], g.corners[index], g, index);
        close(q.x, first.x); close(q.y, first.y);
      }
    }
    assert.ok(!("nested" in g));
    checkError(g); assertConvex(g);
  }
});

test("parallel shadow paths resample offsets and reject curvature singularities", () => {
  const g = createServerCornerGeometry({ width: 200, height: 120, extent: 42 });
  assert.match(offsetServerCornerPath(g, 3), /^M42 -3L158 -3/);
  assert.equal(offsetServerCornerPath(g, 0), g.path);
  assert.match(offsetServerCornerPath(g, -1), /^M42 1L158 1/);
  const square = createServerCornerGeometry({ width: 200, height: 120, extent: 0 });
  assert.match(offsetServerCornerPath(square, -1), /^M1 1L199 1/);
  assert.throws(() => offsetServerCornerPath(square, -60), RangeError);
  assert.throws(() => offsetServerCornerPath(g, -g.radius), RangeError);
  const svg = offsetServerCornerPath(g, 12);
  const vertices = [...svg.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(m => ({ x: +m[1], y: +m[2] }));
  const distance = (q, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, square = dx * dx + dy * dy;
    const t = square ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / square)) : 0;
    return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
  };
  let observed = 0;
  for (let i = 0; i <= 1000; i++) {
    const q = reference(i / 1000, { ...g.corners[0].source, offset: -12 }); q.x += 200 - 42; q.y -= 12;
    observed = Math.max(observed, Math.min(...vertices.slice(1).map((b, index) => distance(q, vertices[index], b))));
  }
  assert.ok(observed <= .05);
});

test("geometry and bounded caches remain immutable; invalid geometry is rejected", () => {
  const options = { width: 200, height: 120, extent: 42 }, g = createServerCornerGeometry(options);
  assert.equal(createServerCornerGeometry(options), g);
  assert.throws(() => { g.points[0].x = 0; }, TypeError);
  assert.throws(() => { g.corners[0].source.offset = 2; }, TypeError);
  assert.throws(() => { SERVER_CORNER_CONTROL_POINTS[0][0] = 1; }, TypeError);
  for (let i = 0; i < 110; i++) createServerCornerGeometry({ width: 300 + i, height: 150, extent: 27 });
  assert.notEqual(createServerCornerGeometry(options), g, "geometry cache has a finite lifetime");
  for (const invalid of [{ width: 0 }, { extent: -1 }, { tolerance: 0 }, { height: Infinity }, { tolerance: 1e-9 }]) assert.throws(() => createServerCornerGeometry({ ...options, ...invalid }), RangeError);
  for (const t of [-.01, 1.01, NaN, Infinity]) assert.throws(() => serverCornerProfile(t), RangeError);
});
