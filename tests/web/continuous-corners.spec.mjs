import { test, expect } from "@playwright/test";
import { pngPixels } from "./png-pixels.mjs";
// DOM snapshot tracing records every paint mutation and distorts the gallery
// benchmark. Pixel evidence is retained explicitly by the tests below.
test.use({ trace: "off" });

const ready = async page => {
  await page.goto("/continuous-corners.html");
  await expect(page.locator("#panel")).toHaveAttribute("data-xcss-server-corner-state", "paint");
};
const state = (page, id) => page.locator(`#${id}`).getAttribute("data-xcss-server-corner-state");
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

const fractionalControl = async (page, tag = "input") => {
  await ready(page);
  await page.evaluate(tag => {
    const underlay = document.createElement("div");
    underlay.style.cssText = "position:fixed;inset:0;background:rgb(240,240,240);z-index:999";
    document.body.append(underlay);
    const node = document.createElement(tag); node.id = "fractional-control";
    if (tag === "input") node.value = "Choice";
    else { node.textContent = "Choice"; node.setAttribute("role", "combobox"); }
    node.style.cssText = "position:fixed;left:48.25px;top:48.5px;z-index:1000;width:113.375px;height:44.375px;min-height:0;box-sizing:border-box;padding:4px 16px;border:1px solid rgb(100,100,100);background:rgb(210,210,210);color:rgb(70,70,70);font-size:16px;box-shadow:none;outline-style:none;outline-width:3px;--xcss-server-corner-extent:27px;--xcss-server-corner-mode:clip";
    document.body.append(node);
  }, tag);
  const control = page.locator("#fractional-control");
  await expect(control).toHaveAttribute("data-xcss-server-corner-state", "clip");
  await frame(page);
  return control;
};

test("fractional native inputs and combobox triggers keep the complete curve without a detached right tail", async ({ browser }, info) => {
  for (const dpr of [1,2]) {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, deviceScaleFactor: dpr });
    const page = await context.newPage();
    try {
      for (const tag of ["input", "button"]) {
        const control = await fractionalControl(page, tag);
        for (const zoom of [1,1.25]) for (const [width, height] of [[113.375,44.375], [180.225,37.475]]) {
          await page.evaluate(({zoom, width, height}) => {
            document.body.style.zoom = String(zoom);
            const node = document.querySelector("#fractional-control");
            node.style.width = `${width}px`; node.style.height = `${height}px`;
          }, {zoom, width, height});
          await control.focus(); await frame(page);
          const samples = await control.evaluate(node => {
            const css = getComputedStyle(node), width = Number.parseFloat(css.width), height = Number.parseFloat(css.height);
            const geometry = window.createServerCornerGeometry({ width, height, extent: 27, tolerance: .02 });
            // Sample the certified curve itself, so clipping away the normal
            // grey border cannot masquerade as removing the stray paint.
            const points = geometry.corners.flatMap(corner => [.3,.5,.7].map(parameter => {
              const q = corner.points.reduce((best, q) => Math.abs(q.parameter - parameter) < Math.abs(best.parameter - parameter) ? q : best);
              return { x: q.x, y: q.y, nx: -Math.sin(q.heading), ny: Math.cos(q.heading) };
            }));
            points.push({x: width / 2, y: 0, nx: 0, ny: 1}, {x: width, y: height / 2, nx: -1, ny: 0},
              {x: width / 2, y: height, nx: 0, ny: -1}, {x: 0, y: height / 2, nx: 1, ny: 0});
            return points;
          });
          const box = await control.boundingBox(), clip = { x: Math.floor(box.x) - 16, y: Math.floor(box.y) - 16,
            width: Math.ceil(box.x + box.width) + 16 - (Math.floor(box.x) - 16), height: Math.ceil(box.y + box.height) + 16 - (Math.floor(box.y) - 16) };
          const png = await page.screenshot({ path: info.outputPath(`native-curve-${tag}-dpr${dpr}-zoom${zoom}-${width}.png`), clip });
          const point = (x, y) => [Math.floor((box.x - clip.x + x * zoom) * dpr), Math.floor((box.y - clip.y + y * zoom) * dpr)];
          // At DPR1 a diagonal 1px stroke may fall between the two pixels
          // crossed by its exact normal. Include neighbouring tangent samples
          // without moving the strip away from the certified curve.
          const borderPoints = samples.flatMap(q => [-.5,0,.5].flatMap(tangent => Array.from({length: 17}, (_, n) => {
            const distance = -1 + n / 8;
            return point(q.x + q.nx * distance + q.ny * tangent, q.y + q.ny * distance - q.nx * tangent);
          })));
          // Across every central/corner row the painted shape must remain
          // connected. The old nine-slice paint leaves a second dark pixel
          // after a fully background-coloured gap on the right-hand curve.
          const edge = (box.x + box.width - clip.x) * dpr, scanlines = [];
          for (let y = Math.ceil((box.y - clip.y + box.height * .15) * dpr); y < (box.y - clip.y + box.height * .85) * dpr; y++) {
            scanlines.push({ y, points: Array.from({length: Math.ceil((31 * zoom + 8) * dpr)}, (_, n) => [Math.floor(edge - 31 * zoom * dpr) + n, y]) });
          }
          const colors = pngPixels(png, [...borderPoints, ...scanlines.flatMap(row => row.points)]).map(color => color[0]);
          const border = samples.map((_, index) => Math.min(...colors.slice(index * 51, (index + 1) * 51)));
          let offset = borderPoints.length;
          const rows = scanlines.map(row => {
            const pixels = colors.slice(offset, offset + row.points.length); offset += row.points.length;
            const gap = pixels.findIndex(color => color >= 238);
            return {y: row.y, detached: gap >= 0 && pixels.slice(gap + 1).some(color => color < 230)};
          });
          await info.attach(`native-border-${tag}-dpr${dpr}-zoom${zoom}-${width}`, { body: JSON.stringify({box, border, detachedRows: rows.filter(row => row.detached)}), contentType: "application/json" });
          for (const color of border) expect(color, `visible grey curve ${tag}, DPR${dpr}, zoom${zoom}`).toBeLessThan(185);
          expect(rows.filter(row => row.detached), `no separated right edge ${tag}, DPR${dpr}, zoom${zoom}`).toEqual([]);
          await expect(control).toHaveCSS("border-image-source", "none");
          await expect(control).toHaveCSS("mask-clip", "border-box");
        }
      }
    } finally { await context.close(); }
  }
});

test("native control exact paint preserves outside shadows, visible outlines and released author styles", async ({ page }, info) => {
  const control = await fractionalControl(page);
  await expect(control).toHaveCSS("outline-style", "none");
  await expect(control).toHaveCSS("mask-clip", "border-box");
  await control.evaluate(node => {
    // These are valid latent background declarations even without an image.
    node.style.backgroundSize = "31px 23px"; node.style.backgroundPosition = "13px 17px";
    node.style.backgroundRepeat = "repeat-x"; node.style.backgroundAttachment = "fixed";
    node.style.backgroundOrigin = "padding-box"; node.style.backgroundClip = "content-box"; node.style.backgroundBlendMode = "multiply";
  });
  await frame(page);
  const outsidePixel = async name => {
    const box = await control.boundingBox(), clip = {x: Math.floor(box.x) - 16, y: Math.floor(box.y) - 16, width: Math.ceil(box.width) + 34, height: Math.ceil(box.height) + 34};
    const png = await page.screenshot({path: info.outputPath(`native-outside-${name}.png`), clip});
    return pngPixels(png, [[Math.floor(box.x + box.width + 4 - clip.x), Math.floor(box.y + box.height / 2 - clip.y)]])[0];
  };
  await control.evaluate(node => { node.style.boxShadow = "0 0 6px rgb(255,0,0)"; }); await frame(page);
  await expect(control).toHaveCSS("mask-clip", "no-clip");
  await expect(control).not.toHaveCSS("border-image-source", "none");
  const shadow = await outsidePixel("shadow");
  expect(shadow[0]).toBeGreaterThan(shadow[1]); expect(shadow[1]).toBeLessThan(235);
  await control.evaluate(node => { node.style.boxShadow = "none"; node.style.outline = "3px solid rgb(0,0,255)"; node.style.outlineOffset = "3px"; }); await frame(page);
  await expect(control).toHaveCSS("mask-clip", "no-clip");
  expect(await outsidePixel("outline")).toEqual([0,0,255,255]);
  await control.evaluate(node => { node.style.outlineStyle = "none"; node.style.backgroundImage = "linear-gradient(white,black)"; }); await frame(page);
  await expect(control).toHaveAttribute("data-xcss-server-corner-reason", "native-background-image-or-backdrop");
  await expect(control).toHaveCSS("mask-image", "none");
  await control.evaluate(node => { node.style.backgroundImage = "none"; }); await frame(page);
  await expect(control).toHaveAttribute("data-xcss-server-corner-state", "clip");
  await expect(control).toHaveCSS("mask-clip", "border-box");
  const box = await control.boundingBox();
  await page.evaluate(() => window.serverCorners.stop());
  expect(await control.boundingBox()).toEqual(box);
  await expect(control).not.toHaveAttribute("data-xcss-server-corner-state");
  for (const [name, value] of Object.entries({"background-image": "none", "background-color": "rgb(210, 210, 210)", "border-image-source": "none", "mask-image": "none", "border-top-color": "rgb(100, 100, 100)", "background-size": "31px 23px", "background-position": "13px 17px", "background-repeat": "repeat-x", "background-attachment": "fixed", "background-origin": "padding-box", "background-clip": "content-box", "background-blend-mode": "multiply"})) {
    await expect(control).toHaveCSS(name, value);
  }
});

const dropdownFrame = async page => {
  await ready(page);
  await page.evaluate(() => {
    // Contrast integration needs a known white underlay, independent of the
    // gallery cards that happen to sit underneath this fixed test popup.
    const underlay = document.createElement("div");
    underlay.style.cssText = "position:fixed;inset:0;background:white;z-index:999";
    document.body.append(underlay);
    const node = document.createElement("div"); node.id = "dropdown-frame";
    node.style.cssText = "position:fixed;left:80px;top:80px;width:242px;height:134px;z-index:1000;box-sizing:border-box;overflow:auto;padding:0;border:1px solid rgb(100,100,100);background:white;--xcss-server-corner-extent:42px;--xcss-server-corner-mode:clip;--xcss-server-corner-foreground:1";
    for (let index = 0; index < 3; index++) {
      const row = document.createElement("div"); row.id = `dropdown-row-${index}`; row.setAttribute("role", "option");
      row.style.cssText = "height:44px;background:white";
      row.addEventListener("pointerenter", () => row.style.background = "red");
      row.addEventListener("pointerleave", () => row.style.background = "white");
      node.append(row);
    }
    document.body.append(node);
  });
  const panel = page.locator("#dropdown-frame");
  await expect(panel).toHaveAttribute("data-xcss-server-corner-state", "clip");
  await expect(panel.locator('svg[data-xcss-server-corner-decoration="foreground"]')).toHaveCount(1);
  await frame(page);
  return panel;
};

test("dropdown foreground keeps the whole grey border above first/last selected and hovered rows", async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    const panel = await dropdownFrame(page), original = await panel.boundingBox();
    const points = await panel.evaluate(node => {
      const geometry = window.createServerCornerGeometry({ width: node.offsetWidth, height: node.offsetHeight, extent: 42, tolerance: .02 });
      return geometry.corners.map(corner => {
        const q = corner.points.reduce((best, q) => Math.abs(q.parameter - .5) < Math.abs(best.parameter - .5) ? q : best);
        return [Math.floor((q.x - Math.sin(q.heading) * .55) * 2), Math.floor((q.y + Math.cos(q.heading) * .55) * 2)];
      });
    });
    for (const state of ["idle", "first", "last", "selected"]) {
      if (state === "first") await page.locator("#dropdown-row-0").hover();
      if (state === "last") await page.locator("#dropdown-row-2").hover();
      if (state === "selected") await panel.getByRole("option").evaluateAll(rows => rows.forEach(row => { row.setAttribute("aria-selected", "true"); row.style.background = "red"; }));
      await frame(page);
      const pixels = await panel.screenshot({ path: info.outputPath(`grey-border-${state}.png`) });
      expect(pngPixels(pixels, points)).toEqual(Array(4).fill([100,100,100,255]));
      expect(pngPixels(pixels, [[242,1], [483,134], [242,267], [1,134]])).toEqual(Array(4).fill([100,100,100,255]));
    }
    expect(await panel.boundingBox()).toEqual(original);
    const foreground = panel.locator('svg[data-xcss-server-corner-decoration="foreground"]');
    await expect(foreground).toHaveAttribute("aria-hidden", "true");
    await expect(foreground).toHaveCSS("pointer-events", "none");
    await expect(foreground).toHaveCSS("visibility", "visible");
    expect(await panel.evaluate(node => { const box = node.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + 22)?.getAttribute("role"); })).toBe("option");
  } finally { await context.close(); }
});

test("fractional dropdown borders have equal measured width at DPR1 and DPR2", async ({ browser }, info) => {
  for (const dpr of [1,2]) {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, deviceScaleFactor: dpr });
    const page = await context.newPage();
    try {
      const panel = await dropdownFrame(page);
      await panel.evaluate(node => {
        node.style.left = "80.25px"; node.style.top = "80.5px"; node.style.width = "242.375px"; node.style.height = "134.625px";
        for (const row of node.querySelectorAll('[role="option"]')) row.style.height = "calc(132.625px / 3)";
      });
      await frame(page);
      const box = await panel.boundingBox(), clip = { x: 40, y: 40, width: 350, height: 230 };
      const pixels = await page.screenshot({ path: info.outputPath(`fractional-border-dpr${dpr}.png`), clip });
      const centerX = Math.floor((box.x + box.width / 2 - clip.x) * dpr), centerY = Math.floor((box.y + box.height / 2 - clip.y) * dpr);
      const strips = [box.y, box.x + box.width, box.y + box.height, box.x].map((edge, index) => Array.from({ length: Math.ceil(8 * dpr) }, (_, n) => index % 2
        ? [Math.floor((edge - clip.x - 4) * dpr) + n, centerY] : [centerX, Math.floor((edge - clip.y - 4) * dpr) + n]));
      const widths = strips.map(points => pngPixels(pixels, points).reduce((total, color) => total + (255 - color[0]) / 155, 0) / dpr);
      await info.attach(`measured-border-widths-dpr${dpr}`, { body: JSON.stringify({ dpr, box, widths }), contentType: "application/json" });
      // Fractional raster coverage, especially a second SVG mask in Gecko,
      // may lose part of one device pixel. Integrate colour instead of
      // comparing the count of solid black pixels at differently aligned edges.
      for (const width of widths) expect(Math.abs(width - 1)).toBeLessThan(.16);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(.16);
    } finally { await context.close(); }
  }
});

test("dropdown foreground stays on its viewport through native scroll, transforms, popovers and cleanup", async ({ page }, info) => {
  const panel = await dropdownFrame(page);
  await page.evaluate(() => {
    window.serverCorners.stop();
    window.cornerURLs = {created: [], revoked: []};
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); window.cornerURLs.created.push(url); return url; };
    URL.revokeObjectURL = url => { window.cornerURLs.revoked.push(url); revoke(url); };
    window.serverCorners = window.startServerCorners(document);
  });
  await frame(page);
  await panel.evaluate(node => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "position:fixed;left:100px;top:80px;width:360px;height:280px;z-index:1000;transform:rotate(7deg) scale(1.125);transform-origin:0 0";
    node.before(wrapper); wrapper.append(node); node.style.position = "relative"; node.style.left = "20px"; node.style.top = "20px";
    for (let index = 3; index < 30; index++) { const row = document.createElement("div"); row.setAttribute("role", "option"); row.style.cssText = "height:44px;background:red"; node.append(row); }
  });
  await frame(page);
  const foreground = panel.locator('svg[data-xcss-server-corner-decoration="foreground"]');
  const alignment = () => panel.evaluate(node => {
    const svg = node.querySelector('svg[data-xcss-server-corner-decoration="foreground"]');
    const host = node.getBoundingClientRect(), border = svg.getBoundingClientRect();
    return [Math.abs(host.x - border.x), Math.abs(host.y - border.y), Math.abs(host.width - border.width), Math.abs(host.height - border.height)];
  });
  for (const error of await alignment()) expect(error).toBeLessThan(.03);
  const size = await panel.evaluate(node => [node.clientWidth, node.clientHeight, node.scrollWidth, node.scrollHeight]);
  await panel.hover(); await page.mouse.wheel(0, 220);
  await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await frame(page);
  for (const error of await alignment()) expect(error).toBeLessThan(.03);
  expect(await panel.evaluate(node => [node.clientWidth, node.clientHeight, node.scrollWidth, node.scrollHeight])).toEqual(size);
  await page.screenshot({ path: info.outputPath("fixed-grey-border-native-scroll-transform.png") });
  // A transformed scrolling host is its own fixed containing block. The
  // synchronous scroll handler must also preserve this less usual case.
  await panel.evaluate(node => { node.style.transform = "scale(.9)"; node.style.transformOrigin = "0 0"; });
  await frame(page); await panel.hover(); await page.mouse.wheel(0, 120); await frame(page);
  for (const error of await alignment()) expect(error).toBeLessThan(.03);
  await panel.evaluate(node => { node.style.transform = "none"; node.setAttribute("popover", "manual"); node.style.position = "fixed"; node.style.left = "80px"; node.style.top = "80px"; node.showPopover(); });
  await frame(page);
  for (const error of await alignment()) expect(error).toBeLessThan(.03);
  await expect(foreground).toBeVisible();
  await panel.evaluate(node => node.hidePopover()); await frame(page);
  await expect(panel).toHaveAttribute("data-xcss-server-corner-reason", "not-visible");
  await expect(foreground).toHaveCSS("display", "none");
  await panel.evaluate(node => node.showPopover()); await frame(page);
  await expect(foreground).toBeVisible();
  await page.emulateMedia({ forcedColors: "active" });
  await expect(panel).toHaveAttribute("data-xcss-server-corner-reason", "forced-colors");
  await expect(foreground).toHaveCSS("display", "none");
  await page.emulateMedia({ forcedColors: "none" }); await frame(page);
  await expect(foreground).toBeVisible();
  await panel.evaluate(node => { node.style.visibility = "hidden"; }); await frame(page);
  await expect(foreground).toHaveCSS("visibility", "hidden");
  await panel.evaluate(node => { node.style.visibility = "visible"; }); await frame(page);
  await panel.evaluate(node => { window.removedDropdownFrame = node; node.remove(); }); await frame(page);
  expect(await page.evaluate(() => window.removedDropdownFrame.querySelector('[data-xcss-server-corner-decoration="foreground"]'))).toBeNull();
  await page.evaluate(() => window.serverCorners.stop());
  expect(await page.locator('[data-xcss-server-corner-decoration="foreground"]').count()).toBe(0);
  expect(await page.evaluate(() => {
    const {created, revoked} = window.cornerURLs;
    return created.length > 0 && created.every(url => revoked.includes(url));
  })).toBe(true);
});

test("dropdown foreground positions after backdrop fixed containing block is removed", async ({ page }) => {
  const panel = await dropdownFrame(page);
  await panel.evaluate(node => { node.style.backdropFilter = "blur(3px)"; node.style.background = "rgba(255,255,255,.9)"; });
  await expect(panel).toHaveCSS("backdrop-filter", "none"); await frame(page);
  await expect(panel.locator('div[data-xcss-server-corner-decoration]')).toHaveCSS("backdrop-filter", "blur(3px)");
  const error = await panel.evaluate(node => {
    const host = node.getBoundingClientRect(), border = node.querySelector('svg[data-xcss-server-corner-decoration="foreground"]').getBoundingClientRect();
    return [Math.abs(host.x - border.x), Math.abs(host.y - border.y), Math.abs(host.width - border.width), Math.abs(host.height - border.height)];
  });
  for (const value of error) expect(value).toBeLessThan(.03);
});

test("native definite-size popover toggles restore dropdown readiness without refresh or resize delivery", async ({ page }) => {
  // Delay the real ResizeObserver notifications so this test exercises the
  // native toggle event path itself, rather than an incidental size callback.
  await page.addInitScript(() => {
    const Original = window.ResizeObserver;
    window.ResizeObserver = class extends Original {
      constructor(callback) { super((entries, observer) => { if (!window.delayCornerResize) callback(entries, observer); }); }
    };
  });
  const panel = await dropdownFrame(page);
  await panel.evaluate(node => node.setAttribute("popover", "manual"));
  await expect(panel).toHaveAttribute("data-xcss-server-corner-reason", "not-visible");
  await page.evaluate(async () => { await document.fonts.ready; window.delayCornerResize = true; });
  for (let cycle = 0; cycle < 2; cycle++) {
    await panel.evaluate(node => node.showPopover());
    await expect(panel).toHaveAttribute("data-xcss-server-corner-state", "clip");
    await expect(panel.locator('svg[data-xcss-server-corner-decoration="foreground"]')).toBeVisible();
    await panel.evaluate(node => node.hidePopover());
    await expect(panel).toHaveAttribute("data-xcss-server-corner-reason", "not-visible");
    await expect(panel.locator('svg[data-xcss-server-corner-decoration="foreground"]')).toHaveCSS("display", "none");
  }
});

test("Mac mini surfaces preserve layout, zero regions, circles, pills and grid rows", async ({ page }) => {
  await ready(page);
  for (const id of ["panel", "notification", "control", "textarea", "grid-row", "auth"]) await expect(page.locator(`#${id}`)).toHaveAttribute("data-xcss-server-corner-state", "paint");
  for (const id of ["card", "input", "select", "clipped", "media"]) await expect(page.locator(`#${id}`)).toHaveAttribute("data-xcss-server-corner-state", "clip");
  for (const id of ["unselected", "date", "pill", "circle", "login-input", "login-submit", "nested-table"]) expect(await state(page, id)).toBeNull();
  expect(await page.locator("#circle").evaluate(el => getComputedStyle(el).borderRadius)).toBe("50%");
  const before = await page.locator("#panel").boundingBox();
  await page.evaluate(() => window.serverCorners.stop());
  expect(await page.locator("#panel").boundingBox()).toEqual(before);
  await expect(page.locator("#panel")).toHaveCSS("border-top-left-radius", "0px");
  await expect(page.locator("#control")).toHaveCSS("border-top-left-radius", "0px");
  expect(await state(page, "panel")).toBeNull();
  await page.evaluate(() => { const old=window.serverCorners; window.serverCorners=window.startServerCorners(document); old.stop(); });
  await expect(page.locator("#panel")).toHaveAttribute("data-xcss-server-corner-state", "paint");
  expect(await page.evaluate(() => window.startServerCorners(document) === window.serverCorners)).toBe(true);
});

test("fixed host Mac mini mask clips scaled media while focus and outside shadows remain painted", async ({ page }, info) => {
  await ready(page);
  const target = page.locator("#clipped"); await target.focus(); await frame(page);
  const box = await target.boundingBox();
  const pixels = await page.screenshot({ path: info.outputPath("macmini-focus-clip.png"), clip: { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 } });
  expect(pngPixels(pixels, [[17,17], [Math.floor(box.width / 2) + 16, Math.floor(box.height / 2) + 16], [8, Math.floor(box.height / 2) + 16]])).toEqual([[255,255,255,255], [0,180,0,255], [250,204,21,255]]);
  expect(pngPixels(pixels, [[12, Math.floor(box.height / 2) + 16]])[0][0]).toBeLessThan(245);
  await expect(target).toHaveCSS("mask-clip", "no-clip");
  await expect(target).toHaveCSS("outline-style", "solid");
  await page.locator("#media").evaluate(el => { el.style.transform = "scale(1.1)"; }); await frame(page);
  expect(pngPixels(await page.locator("#media").screenshot(), [[1,1]])[0]).toEqual([255,255,255,255]);
});

test("menus and speech bubbles use the same Mac mini size at all four corners", async ({ page }, info) => {
  await ready(page);
  await page.evaluate(() => {
    for (const id of ["uniform-menu", "uniform-bubble", "uniform-shadow"]) {
      const node = document.createElement("div"); node.id = id;
      node.style.cssText = "width:240px;height:120px;background:rgb(0,0,255);border-radius:0;--xcss-server-corner-extent:42px";
      if (id === "uniform-shadow") node.style.boxShadow = "0 2px 4px -1px rgb(0 0 0 / .2)";
      document.querySelector("main").append(node);
    }
  });
  for (const id of ["uniform-menu", "uniform-bubble", "uniform-shadow"]) {
    const node = page.locator(`#${id}`);
    await expect(node).toHaveAttribute("data-xcss-server-corner-state", "paint");
    expect(await node.getAttribute("data-xcss-server-corner-reason")).toBeNull();
    await expect(node).toHaveCSS("border-radius", "0px");
  }
  for (const id of ["uniform-menu", "uniform-bubble"]) {
    const pixels = await page.locator(`#${id}`).screenshot({ path: info.outputPath(`${id}.png`) });
    expect(pngPixels(pixels, [[1,1], [238,1], [1,118], [238,118], [120,60]])).toEqual([
      [255,255,255,255], [255,255,255,255], [255,255,255,255], [255,255,255,255], [0,0,255,255],
    ]);
  }
});

test("the actual shared account entry retains its circular shape under the server renderer", async ({ page }) => {
  const session = { authenticated: true, user_id: "A".repeat(43), username: "admin", role: "admin", csrf_token: "A".repeat(43) };
  await page.route("**/api/v1/**", route => route.fulfill({ status: 200, json: session }));
  await page.goto("/");
  const account = page.locator(".xcss-account-entry");
  await expect(account).toBeVisible();
  await page.evaluate(async () => { const { startServerCorners } = await import("/corner-test-api.js"); window.serverCorners = startServerCorners(document); });
  await expect(page.locator(".xcss-button").filter({ hasText: "Create" })).toHaveAttribute("data-xcss-server-corner-state", "paint");
  expect(await account.getAttribute("data-xcss-server-corner-state")).toBeNull();
  await expect(account).toHaveCSS("border-radius", "50%");
  await expect(account).toHaveCSS("border-image-source", "none");
  await account.click();
  await expect(page.getByRole("region", { name: "Account settings", exact: true })).toBeVisible();
  await expect(page.locator(".xcss-content-panel")).toHaveAttribute("data-xcss-server-corner-state", "paint");
  expect(await account.getAttribute("data-xcss-server-corner-state")).toBeNull();
});

test("complex borders, backgrounds, shadows, backdrop blur and state changes survive", async ({ page }, info) => {
  await ready(page);
  for (const id of ["gradient", "blur", "unequal", "dashed", "spread"]) expect(await state(page, id)).toBe("paint");
  const background = await page.locator("#gradient > [data-xcss-server-corner-decoration]").evaluate(el => ({ image:el.style.backgroundImage, size:el.style.backgroundSize }));
  expect(background.image).toContain("linear-gradient"); expect(background.image).toContain("radial-gradient"); expect(background.size).toContain("20px 20px");
  await expect(page.locator("#blur > [data-xcss-server-corner-decoration]")).toHaveCSS("backdrop-filter", "blur(4px)");
  await expect(page.locator("#blur")).toHaveCSS("backdrop-filter", "none");
  const b = await page.locator("#unequal").screenshot({ path: info.outputPath("unequal-border.png") });
  expect(pngPixels(b, [[0,40], [80,1], [80,40]])).toEqual([[0,0,255,255], [255,0,0,255], [255,255,0,255]]);
  const control = page.locator("#state-control"); await control.hover(); await frame(page);
  expect(pngPixels(await control.screenshot(), [[60,20]])[0]).toEqual([255,0,0,255]);
  await control.evaluate(el => { el.disabled = true; }); await frame(page);
  expect(pngPixels(await control.screenshot(), [[60,20]])[0]).toEqual([128,128,128,255]);
  await page.evaluate(() => document.documentElement.dataset.theme = "dark"); await frame(page);
  expect(pngPixels(await page.locator("#dark-surface").screenshot(), [[60,30]])[0]).toEqual([20,30,40,255]);
});

test("dynamic content, resizing, dialogs, RTL, forced colors and stop preserve author styles", async ({ page }) => {
  await ready(page);
  await page.locator("#gradient").evaluate(el => { el.innerHTML = "Replacement"; });
  await expect(page.locator("#gradient > [data-xcss-server-corner-decoration]")).toHaveCount(1);
  await page.evaluate(() => { const el = document.createElement("div"); el.id="added"; el.className="test-surface"; el.dataset.xcssServerCorner="clip"; el.style.width="170px"; document.querySelector("main").append(el); });
  await expect(page.locator("#added")).toHaveAttribute("data-xcss-server-corner-state", "clip");
  const source = await page.locator("#added").evaluate(el => el.style.maskImage);
  await page.locator("#added").evaluate(el => { el.style.width="220px"; }); await frame(page);
  expect(await page.locator("#added").evaluate(el => el.style.maskImage)).not.toBe(source);
  await page.locator("#dialog").evaluate(el => el.showModal());
  await expect(page.locator("#dialog")).toHaveAttribute("data-xcss-server-corner-state", "paint");
  await page.locator("#dialog").evaluate(el => el.close());
  await expect(page.locator("#dialog")).toHaveAttribute("data-xcss-server-corner-reason", "not-visible");
  await page.evaluate(() => document.documentElement.dir="rtl"); await frame(page);
  await expect(page.locator("#unequal")).toHaveAttribute("data-xcss-server-corner-state", "paint");
  await page.emulateMedia({ forcedColors:"active" });
  await expect(page.locator("#panel")).toHaveAttribute("data-xcss-server-corner-reason", "forced-colors");
  await expect(page.locator("#panel")).toHaveCSS("border-top-left-radius", "0px");
  await page.emulateMedia({ forcedColors:"none" });
  await expect(page.locator("#panel")).toHaveAttribute("data-xcss-server-corner-state", "paint");
  await page.locator("#panel").evaluate(el => { el.style.backgroundColor="rgb(1, 2, 3)"; }); await frame(page);
  await page.evaluate(() => window.serverCorners.stop());
  await expect(page.locator("#panel")).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(page.locator("[data-xcss-server-corner-decoration]")).toHaveCount(0);
});

test("repeated refreshes preserve theme changes, inline edits and clip mode changes", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const rules = document.createElement("style");
    rules.textContent = "#refresh-cache.changed { background-color:rgb(9, 8, 7); border-color:rgb(5, 6, 7) }";
    document.head.append(rules);
    const node = document.createElement("div");
    node.id = "refresh-cache"; node.className = "test-surface";
    node.style.cssText = "width:170px;height:90px;border:3px solid rgb(1, 2, 3)";
    node.dataset.xcssServerCorner = "clip";
    document.querySelector("main").append(node);
  });
  const node = page.locator("#refresh-cache");
  await expect(node).toHaveAttribute("data-xcss-server-corner-state", "clip");
  const firstPaint = await node.evaluate(node => node.style.borderImageSource);
  for (let i = 0; i < 4; i++) { await page.evaluate(() => window.serverCorners.refresh()); await frame(page); }
  expect(await node.evaluate(node => node.style.borderImageSource)).toBe(firstPaint);
  await node.evaluate(node => node.classList.add("changed")); await frame(page);
  expect(await node.evaluate(node => node.style.borderImageSource)).not.toBe(firstPaint);
  await node.evaluate(node => { node.dataset.xcssServerCorner = "paint"; node.style.backgroundColor = "rgb(11, 12, 13)"; }); await frame(page);
  await expect(node).toHaveAttribute("data-xcss-server-corner-state", "paint");
  await expect(node).toHaveCSS("mask-image", "none");
  for (let i = 0; i < 4; i++) { await page.evaluate(() => window.serverCorners.refresh()); await frame(page); }
  await page.evaluate(() => window.serverCorners.stop());
  await expect(node).toHaveCSS("background-color", "rgb(11, 12, 13)");
  await expect(node).toHaveCSS("border-top-color", "rgb(1, 2, 3)");
  await expect(node).not.toHaveAttribute("data-xcss-server-corner-state");
});

test("large corners retain narrow six-row text and mobile login text", async ({ page }, info) => {
  await ready(page);
  const safe = (id, ids) => page.evaluate(({ id, ids }) => {
    const el=document.getElementById(id), rect=el.getBoundingClientRect();
    const geometry=window.createServerCornerGeometry({ width:rect.width, height:rect.height, extent:48, tolerance:.02 });
    const path=new Path2D(geometry.path), ctx=document.createElement("canvas").getContext("2d");
    return ids.map(id => { const range=document.createRange(); range.selectNodeContents(document.getElementById(id)); const r=range.getBoundingClientRect(); return [[r.left,r.top],[r.right,r.top],[r.left,r.bottom],[r.right,r.bottom]].every(([x,y]) => ctx.isPointInPath(path,x-rect.left,y-rect.top)); });
  }, { id, ids });
  for (const width of [320,216]) {
    await page.locator("#text-card").evaluate((el,w) => { el.style.width=`${w}px`; },width); await frame(page);
    expect((await safe("text-card",["first-row","last-row"])).every(Boolean)).toBe(true);
    await page.locator("#text-card").screenshot({ path:info.outputPath(`text-${width}.png`) });
  }
  for (const width of [360,320]) {
    await page.setViewportSize({ width,height:900 }); await frame(page);
    expect((await safe("auth",["login-label","login-submit"])).every(Boolean)).toBe(true);
    await page.locator("#login-input").fill("administrator-with-a-long-name");
    await page.locator("#login-input").focus(); await page.keyboard.press("Tab");
    await expect(page.locator("#login-password")).toBeFocused();
  }
});

test("large galleries batch updates and observers settle after transitions", async ({ page }, info) => {
  await ready(page);
  const report = await page.evaluate(async () => {
    const gallery=document.createElement("section"); gallery.id="performance"; gallery.style.cssText="display:grid;grid-template-columns:repeat(10,80px);gap:4px";
    for (let i=0;i<600;i++) { const el=document.createElement("div"); el.className="test-surface"; el.style.cssText=`width:${i<500?80:80+i%100}px;height:50px`; gallery.append(el); }
    const start=performance.now(); document.body.append(gallery);
    while (!gallery.lastElementChild.hasAttribute("data-xcss-server-corner-state")) await new Promise(requestAnimationFrame);
    const duration=performance.now()-start;
    let writes=0,phase="settling"; const timeline=[],events=[];
    const eventSample=event=>events.push({ time:performance.now()-start,type:event.type,id:event.target.id,property:event.propertyName });
    for(const name of ["transitionrun","transitionend","scroll"])document.addEventListener(name,eventSample,true);
    const observer=new MutationObserver(list => { writes+=list.length; if(timeline.length<40)timeline.push({ time:performance.now()-start,phase,count:list.length,sample:list.slice(0,3).map(m=>({ id:m.target.id,attribute:m.attributeName })) }); }); observer.observe(document,{ subtree:true,attributes:true,childList:true });
    const button=document.getElementById("state-control"); button.classList.add("animated"); button.disabled=false;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const widthEnded=new Promise(resolve=>button.addEventListener("transitionend",function ended(event){ if(event.propertyName==="width"){button.removeEventListener("transitionend",ended);resolve();} }));
    button.style.width="145px";
    await widthEnded;
    // A fixed delay can expire before ResizeObserver's final paint frame under
    // parallel browser load. Await the real native animation and three quiet
    // frames; a persistent observer loop never satisfies this condition.
    let quietFrames=0,previousWrites=writes,settleFrames=0;
    while(quietFrames<3&&settleFrames<40){
      await new Promise(requestAnimationFrame); settleFrames++;
      quietFrames=writes===previousWrites?quietFrames+1:0; previousWrites=writes;
    }
    const settled=quietFrames===3; writes=0; phase="idle";
    await new Promise(resolve=>setTimeout(resolve,160)); observer.disconnect();
    for(const name of ["transitionrun","transitionend","scroll"])document.removeEventListener(name,eventSample,true);
    return { duration,idleWrites:writes,selected:gallery.querySelectorAll('[data-xcss-server-corner-state="paint"]').length,settled,settleFrames,timeline,events };
  });
  await info.attach("performance",{ body:JSON.stringify(report),contentType:"application/json" });
  expect(report.selected).toBe(600); expect(report.duration).toBeLessThan(1000); expect(report.settled).toBe(true); expect(report.idleWrites).toBe(0);
});

test("all transitions keep native dimension and opacity animation without repaint loops", async ({ page }) => {
  await ready(page);
  await page.locator("#state-control").evaluate(el => { el.style.transition="all .3s linear"; }); await frame(page);
  const properties=await page.locator("#state-control").evaluate(el => getComputedStyle(el).transitionProperty.split(",").map(s=>s.trim()));
  expect(properties).toContain("width"); expect(properties).toContain("opacity"); expect(properties).toContain("transform"); expect(properties).not.toContain("background-color");
  const during=await page.locator("#state-control").evaluate(async el => {
    window.widthEnded=new Promise(resolve=>el.addEventListener("transitionend",event=>{ if(event.propertyName==="width")resolve(); }));
    el.style.width="160px"; el.style.opacity=".5";
    // Capture inside the page's frame loop; a delayed test-driver round trip
    // under parallel browser load can otherwise sample after the animation.
    let sample;
    for (let i=0;i<40;i++) {
      await new Promise(requestAnimationFrame);
      sample={ width:el.getBoundingClientRect().width,opacity:parseFloat(getComputedStyle(el).opacity) };
      if(sample.width>120&&sample.width<160&&sample.opacity>.5&&sample.opacity<1)return sample;
    }
    return sample;
  });
  expect(during.width).toBeGreaterThan(120); expect(during.width).toBeLessThan(160); expect(during.opacity).toBeGreaterThan(.5); expect(during.opacity).toBeLessThan(1);
  await page.evaluate(()=>window.widthEnded);
  await expect(page.locator("#state-control")).toHaveCSS("width","160px");
  await page.evaluate(()=>window.serverCorners.stop());
  await expect(page.locator("#state-control")).toHaveCSS("transition-property","all");
});

test("removing an extent-transition subtree stops the renderer frame loop", async ({ page }) => {
  await ready(page);
  const report = await page.evaluate(async () => {
    const group = document.createElement("section");
    const nodes = Array.from({ length: 2 }, () => {
      const node = document.createElement("div");
      node.style.cssText = "width:120px;height:80px;background:blue;--xcss-server-corner-extent:10px;transition:--xcss-server-corner-extent 10s linear";
      group.append(node); return node;
    });
    document.body.append(group);
    while (!nodes.every(node => node.hasAttribute("data-xcss-server-corner-state"))) await new Promise(requestAnimationFrame);
    const started = nodes.map(node => new Promise(resolve => node.addEventListener("transitionrun", event => {
      if (event.propertyName === "--xcss-server-corner-extent") resolve();
    }, { once: true })));
    nodes.forEach(node => node.style.setProperty("--xcss-server-corner-extent", "20px"));
    await Promise.all(started);
    group.remove();
    let writes = 0, previous = 0, quiet = 0;
    const observer = new MutationObserver(records => { writes += records.length; });
    observer.observe(document, { subtree: true, attributes: true, childList: true });
    for (let frame = 0; frame < 40 && quiet < 3; frame++) {
      await new Promise(requestAnimationFrame);
      quiet = writes === previous ? quiet + 1 : 0; previous = writes;
    }
    const settled = quiet === 3;
    writes = 0;
    for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame);
    observer.disconnect();
    return { settled, idleWrites: writes, removedStates: nodes.map(node => node.getAttribute("data-xcss-server-corner-state")) };
  });
  expect(report).toEqual({ settled: true, idleWrites: 0, removedStates: [null, null] });
});

test("Blob SVGs obey a restrictive image CSP and stop revokes controller-owned URLs", async ({ page }, info) => {
  await page.addInitScript(() => {
    window.violations=[]; window.cornerUrls=new Set();
    addEventListener("securitypolicyviolation", event => window.violations.push({ directive:event.effectiveDirective, uri:event.blockedURI }));
    const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob => { const url=create(blob); window.cornerUrls.add(url); return url; };
    URL.revokeObjectURL=url => { window.cornerUrls.delete(url); revoke(url); };
  });
  await page.route("**/continuous-corners.html", async route => {
    const response=await route.fetch();
    // Product builds already convert their static data-icon masks to same-origin
    // assets. Disable those unrelated fixture icons to test only dynamic URLs.
    const body=(await response.text()).replace("<style>","<style>#auth span::before,#auth button::before{mask:none!important}");
    await route.fulfill({ response, body, headers:{ ...response.headers(), "content-security-policy":"default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'" } });
  });
  await ready(page);
  const target=page.locator("#clipped");
  await expect(target).toHaveCSS("border-image-source", /blob:/);
  await expect(target).toHaveCSS("mask-image", /blob:/);
  expect(pngPixels(await target.screenshot({ path:info.outputPath("csp-macmini.png") }),[[1,1],[80,50]])).toEqual([[255,255,255,255],[0,180,0,255]]);
  expect(await page.evaluate(() => window.violations)).toEqual([]);
  expect(await page.evaluate(() => window.cornerUrls.size)).toBeGreaterThan(0);
  await page.evaluate(() => window.serverCorners.stop());
  expect(await page.evaluate(() => window.cornerUrls.size)).toBe(0);
});

test("synchronous custom-element events and stop during paint preserve cleanup", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await ready(page);
  await page.evaluate(() => {
    customElements.define("synchronous-corner", class extends HTMLElement {
      static observedAttributes = ["style", "data-xcss-server-corner-state"];
      attributeChangedCallback() {
        if (!this.armed) return;
        const action = this.armed;
        this.armed = null;
        if (action === "stop") window.serverCorners.stop();
        else this.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const node = document.createElement("synchronous-corner");
    node.id = "synchronous-corner";
    node.style.cssText = "display:block;width:160px;height:100px;background:blue;--xcss-server-corner-extent:27px";
    document.body.append(node);
  });
  const node = page.locator("#synchronous-corner");
  await expect(node).toHaveAttribute("data-xcss-server-corner-state", "paint");
  await node.evaluate(node => { node.armed = "event"; window.serverCorners.refresh(); });
  await frame(page);
  await expect(node).toHaveAttribute("data-xcss-server-corner-state", "paint");
  await node.evaluate(node => { node.armed = "stop"; window.serverCorners.refresh(); });
  await frame(page);
  await expect(node).not.toHaveAttribute("data-xcss-server-corner-state");
  await expect(node).toHaveCSS("background-color", "rgb(0, 0, 255)");
  expect(errors).toEqual([]);
});

test("a controller uses the supplied iframe document and releases its styles", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await ready(page);
  const result = await page.evaluate(async () => {
    const frame = document.createElement("iframe");
    await new Promise(resolve => {
      frame.addEventListener("load", resolve, { once: true });
      frame.srcdoc = '<!doctype html><div id="surface" style="width:160px;height:100px;background:blue;--xcss-server-corner-extent:27px"></div>';
      document.body.append(frame);
    });
    const iframeDocument = frame.contentDocument, node = iframeDocument.getElementById("surface");
    const controller = window.startServerCorners(iframeDocument);
    const before = node.getAttribute("data-xcss-server-corner-state");
    const same = window.startServerCorners(iframeDocument) === controller;
    controller.stop();
    const after = node.getAttribute("data-xcss-server-corner-state");
    const color = frame.contentWindow.getComputedStyle(node).backgroundColor;
    frame.remove();
    return { before, same, after, color };
  });
  expect(result).toEqual({ before: "paint", same: true, after: null, color: "rgb(0, 0, 255)" });
  expect(errors).toEqual([]);
});

const inspectIndependent = (page, id) => page.evaluate(async id => {
  const node = document.getElementById(id), css = getComputedStyle(node);
  const box = node.getBoundingClientRect();
  const expected = window.createServerCornerGeometry({ width:box.width, height:box.height, extent:parseFloat(css.getPropertyValue("--xcss-server-corner-extent")), tolerance:.02 });
  const sourceProperty = node.style.borderImageSource === "none" ? "backgroundImage" : "borderImageSource";
  const match = node.style[sourceProperty].match(/url\(["']?(.*?)["']?\)/);
  if (!match) throw new Error(`Expected renderer SVG in ${sourceProperty} for ${id}`);
  const url = match[1];
  const svg = new DOMParser().parseFromString(await (await fetch(url)).text(), "image/svg+xml");
  return { actualPath:svg.querySelector("clipPath#inside path").getAttribute("d"), expectedPath:expected.path, extents:expected.corners.map(corner => corner.extent), sourceProperty, borderImageSource:css.borderImageSource };
}, id);

test("nested surfaces keep their own uniform corners when the parent and spacing change", async ({ page }, info) => {
  await ready(page);
  const original = await inspectIndependent(page, "independent-child");
  expect(original.actualPath).toBe(original.expectedPath);
  expect(original.extents).toEqual([22,22,22,22]);
  await page.locator("#independent-parent").evaluate(el => { el.style.setProperty("--xcss-server-corner-extent", "50px"); el.style.width="340px"; });
  await page.locator("#independent-child").evaluate(el => { el.style.left="30px"; el.style.top="24px"; });
  await frame(page);
  const moved = await inspectIndependent(page, "independent-child");
  expect(moved.actualPath).toBe(original.actualPath);
  expect(moved.actualPath).toBe(moved.expectedPath);
  const button = await inspectIndependent(page, "independent-row-button");
  expect(button.sourceProperty).toBe("backgroundImage");
  expect(button.borderImageSource).toBe("none");
  expect(button.actualPath).toBe(button.expectedPath);
  expect(button.extents).toEqual([10,10,10,10]);
  await page.locator("#independent-parent").screenshot({ path:info.outputPath("independent-uniform-corners.png") });
  await page.evaluate(() => document.documentElement.dataset.theme="dark"); await frame(page);
  expect((await inspectIndependent(page, "independent-child")).actualPath).toBe(original.actualPath);
  expect(pngPixels(await page.locator("#independent-child").screenshot(), [[120,100]])[0]).toEqual([20,30,40,255]);
  await page.evaluate(() => window.serverCorners.stop());
  await expect(page.locator("#independent-child")).toHaveCSS("border-radius", "0px");
  expect(await state(page, "independent-child")).toBeNull();
});

for (const change of ["value", "important", "remove"]) {
  for (const finish of ["stop", "refresh", "recover"]) {
    test(`author background ${change} during fallback survives ${finish}`, async ({ page }) => {
      await ready(page);
      const panel = page.locator("#panel");
      await panel.evaluate(el => el.style.setProperty("background-color", "rgb(1, 2, 3)", "important"));
      await frame(page);
      await page.emulateMedia({ forcedColors: "active" });
      await expect(panel).toHaveAttribute("data-xcss-server-corner-reason", "forced-colors");
      const value = change === "remove" ? "" : "rgb(9, 8, 7)";
      const priority = change === "important" ? "important" : "";
      await panel.evaluate((el, { value, priority, finish }) => {
        el.style.setProperty("background-color", value, priority);
        // Stop in the same task, before MutationObserver can process the edit.
        if (finish === "stop") window.serverCorners.stop();
        else window.serverCorners.refresh();
      }, { value, priority, finish });
      if (finish !== "stop") {
        await frame(page);
        expect(await panel.evaluate(el => el.style.backgroundColor)).toBe(value);
        if (finish === "recover") {
          await page.emulateMedia({ forcedColors: "none" });
          await expect(panel).toHaveAttribute("data-xcss-server-corner-state", "paint");
          await page.evaluate(() => window.serverCorners.refresh());
          await frame(page);
        }
        await page.evaluate(() => window.serverCorners.stop());
      }
      expect(await panel.evaluate(el => [el.style.backgroundColor, el.style.getPropertyPriority("background-color")])).toEqual([value, priority]);
    });
  }
}

test("released transition declarations follow subsequent author edits", async ({ page }) => {
  await ready(page);
  const panel = page.locator("#panel");
  await panel.evaluate(el => { el.style.transitionProperty = "background-color, opacity"; el.style.transitionDuration = "0.3s"; });
  await frame(page);
  expect(await panel.evaluate(el => el.style.transitionProperty)).toBe("opacity");
  await panel.evaluate(el => el.style.transitionProperty = "transform");
  await frame(page);
  await panel.evaluate(el => el.style.transitionProperty = "width");
  await frame(page);
  expect(await panel.evaluate(el => el.style.transitionProperty)).toBe("width");
  await panel.evaluate(el => el.style.transitionProperty = "background-color, height");
  await frame(page);
  expect(await panel.evaluate(el => el.style.transitionProperty)).toBe("height");
  await page.evaluate(() => window.serverCorners.stop());
  expect(await panel.evaluate(el => el.style.transitionProperty)).toBe("background-color, height");
});
