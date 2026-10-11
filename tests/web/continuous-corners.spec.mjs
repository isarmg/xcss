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

test("Mac mini surfaces preserve layout, zero regions, circles, pills and grid rows", async ({ page }) => {
  await ready(page);
  for (const id of ["panel", "notification", "control", "textarea", "grid-row", "auth"]) await expect(page.locator(`#${id}`)).toHaveAttribute("data-xcss-server-corner-state", "paint");
  for (const id of ["card", "input", "select", "clipped", "media"]) await expect(page.locator(`#${id}`)).toHaveAttribute("data-xcss-server-corner-state", "clip");
  for (const id of ["unselected", "date", "pill", "circle", "login-input", "login-submit", "nested-table"]) expect(await state(page, id)).toBeNull();
  expect(await page.locator("#circle").evaluate(el => getComputedStyle(el).borderRadius)).toBe("50%");
  const before = await page.locator("#panel").boundingBox();
  await page.evaluate(() => window.serverCorners.stop());
  expect(await page.locator("#panel").boundingBox()).toEqual(before);
  await expect(page.locator("#panel")).toHaveCSS("border-top-left-radius", "20px");
  await expect(page.locator("#control")).toHaveCSS("border-top-left-radius", "14px");
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
  await expect(page.locator("#panel")).toHaveCSS("border-top-left-radius", "20px");
  await page.emulateMedia({ forcedColors:"none" });
  await expect(page.locator("#panel")).toHaveAttribute("data-xcss-server-corner-state", "paint");
  await page.locator("#panel").evaluate(el => { el.style.backgroundColor="rgb(1, 2, 3)"; }); await frame(page);
  await page.evaluate(() => window.serverCorners.stop());
  await expect(page.locator("#panel")).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(page.locator("[data-xcss-server-corner-decoration]")).toHaveCount(0);
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
    await route.fulfill({ response, body, headers:{ ...response.headers(), "content-security-policy":"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'" } });
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

const inspectNesting = (page, id, follow) => page.evaluate(async ({ id, follow }) => {
  const child = document.getElementById(id), parent = child.parentElement;
  const childBox = child.getBoundingClientRect(), parentBox = parent.getBoundingClientRect();
  const css = getComputedStyle(child), parentCss = getComputedStyle(parent);
  const parentGeometry = window.createServerCornerGeometry({ width:parentBox.width, height:parentBox.height, extent:parseFloat(parentCss.getPropertyValue("--xcss-server-corner-extent")), tolerance:.02 });
  const expected = window.createNestedServerCornerGeometry({ width:childBox.width, height:childBox.height, extent:parseFloat(css.getPropertyValue("--xcss-server-corner-extent")), parent:parentGeometry, left:childBox.left-parentBox.left, top:childBox.top-parentBox.top, follow, tolerance:.02 });
  const url = /url\(["']?(.*?)["']?\)/.exec(css.borderImageSource)[1];
  const svg = new DOMParser().parseFromString(await (await fetch(url)).text(), "image/svg+xml");
  const paths = [...svg.querySelectorAll("path[fill]")].filter(path => path.getAttribute("fill") !== "none" && !path.hasAttribute("filter"));
  return { actualPath:paths.at(-1).getAttribute("d"), expectedPath:expected.path, corners:expected.corners.map(corner => ({ name:corner.name, extent:corner.extent, radius:corner.radius })), nested:expected.nested };
}, { id, follow });

test("explicit nested profiles follow all four child corners and real inset frames", async ({ page }, info) => {
  await ready(page);
  const all = await inspectNesting(page,"nested-all","all");
  expect(all.actualPath).toBe(all.expectedPath);
  expect(all.nested.followed).toHaveLength(4);
  expect(all.nested.aligned).toEqual(["top-left"]);
  expect(all.corners.map(corner => corner.extent)).toEqual([52,52,52,52]);
  const full = await inspectNesting(page,"nested-full","nearest");
  expect(full.actualPath).toBe(full.expectedPath);
  expect(full.nested.aligned).toHaveLength(4);
  expect(full.corners.map(corner => corner.extent)).toEqual([52,52,52,52]);
  const scaled = await inspectNesting(page,"nested-scaled","all");
  expect(scaled.actualPath).toBe(scaled.expectedPath);
  expect(scaled.nested.followed).toHaveLength(4);
  expect(scaled.nested.aligned).toEqual([]);
  expect(scaled.corners.map(corner => corner.extent)).toEqual([22,22,22,22]);
  await expect(page.locator("#nested-scaled")).toHaveAttribute("data-xcss-server-corner-reason","nested-profile-scaled");
  expect(await state(page,"nested-unselected")).toBeNull();
  await expect(page.locator("#nested-independent")).toHaveCSS("--xcss-server-corner-nested","none");
  await expect(page.locator("#nested-independent")).toHaveAttribute("data-xcss-server-corner-state","paint");
  await expect(page.locator("#nested-row-button")).toHaveCSS("--xcss-server-corner-nested","none");
  await expect(page.locator("#nested-row-button")).toHaveAttribute("data-xcss-server-corner-state","paint");
  expect(await page.locator("#nested-row-button").getAttribute("data-xcss-server-corner-reason")).toBeNull();
  await page.locator("#nested-all-parent").screenshot({ path:info.outputPath("macmini-four-corners.png") });
  await page.locator("#nested-full-parent").screenshot({ path:info.outputPath("macmini-inset-frame.png") });
});

test("photo frames support all-four following and nearest physical corner alignment", async ({ page }, info) => {
  await ready(page);
  const photo = await inspectNesting(page,"nested-photo","nearest");
  expect(photo.actualPath).toBe(photo.expectedPath);
  expect(photo.nested.followed).toEqual(["top-right","top-left"]);
  expect(photo.nested.aligned).toEqual(["top-right","top-left"]);
  expect(photo.corners.map(corner => corner.extent)).toEqual([35,44,44,35]);
  const all = await inspectNesting(page,"nested-photo-all","all");
  expect(all.actualPath).toBe(all.expectedPath);
  expect(all.nested.followed).toHaveLength(4);
  expect(all.nested.aligned).toEqual(["top-right","top-left"]);
  expect(all.corners.map(corner => corner.extent)).toEqual([35,35,35,35]);
  await page.locator("#nested-photo-parent").screenshot({ path:info.outputPath("macmini-photo-nearest.png") });
  await page.locator("#nested-photo-all-parent").screenshot({ path:info.outputPath("macmini-photo-all.png") });
});

test("nested profiles update after parent extent, dimensions, spacing and theme changes", async ({ page }) => {
  await ready(page);
  const original = await inspectNesting(page,"nested-all","all");
  await page.locator("#nested-all-parent").evaluate(el => el.style.setProperty("--xcss-server-corner-extent","60px")); await frame(page);
  const extent = await inspectNesting(page,"nested-all","all");
  expect(extent.actualPath).toBe(extent.expectedPath); expect(extent.actualPath).not.toBe(original.actualPath);
  expect(extent.corners.map(corner => corner.extent)).toEqual([42,42,42,42]);
  await page.locator("#nested-all").evaluate(el => { el.style.left="20px"; el.style.top="20px"; }); await frame(page);
  const spacing = await inspectNesting(page,"nested-all","all");
  expect(spacing.actualPath).toBe(spacing.expectedPath); expect(spacing.actualPath).not.toBe(extent.actualPath);
  await page.evaluate(() => { document.getElementById("nested-full-parent").style.width="340px"; document.getElementById("nested-full").style.width="304px"; }); await frame(page);
  const resized = await inspectNesting(page,"nested-full","nearest");
  expect(resized.actualPath).toBe(resized.expectedPath); expect(resized.nested.aligned).toHaveLength(4);
  await page.evaluate(() => document.documentElement.dataset.theme="dark"); await frame(page);
  expect((await inspectNesting(page,"nested-all","all")).actualPath).toBe(spacing.actualPath);
  expect(pngPixels(await page.locator("#nested-all").screenshot(),[[80,64]])[0]).toEqual([20,30,40,255]);
  await page.locator("#nested-row-button").evaluate(el => el.style.width="84px"); await frame(page);
  await expect(page.locator("#nested-row-button")).toHaveCSS("--xcss-server-corner-nested","none");
  expect(await page.locator("#nested-row-button").getAttribute("data-xcss-server-corner-reason")).toBeNull();
  await page.evaluate(() => window.serverCorners.stop());
  await expect(page.locator("#nested-all")).toHaveCSS("border-top-left-radius","12px");
  await expect(page.locator("#nested-full-parent")).toHaveCSS("border-top-left-radius","20px");
  expect(await state(page,"nested-all")).toBeNull();
  await expect(page.locator("#nested-scaled")).toHaveAttribute("data-xcss-server-corner-state","authored");
  await expect(page.locator("#nested-scaled")).toHaveAttribute("data-xcss-server-corner-reason","authored-reason");
});

test("unsupported nested coordinate systems and missing matches keep independent Mac mini corners", async ({ page }) => {
  await ready(page);
  await expect(page.locator("#nested-no-match")).toHaveAttribute("data-xcss-server-corner-reason","nested-no-aligned-corner");
  await expect(page.locator("#nested-transformed")).toHaveAttribute("data-xcss-server-corner-reason","nested-transformed-coordinates");
  await expect(page.locator("#nested-no-parent")).toHaveAttribute("data-xcss-server-corner-reason","nested-no-parent");
  for (const id of ["nested-no-match","nested-transformed","nested-no-parent"]) await expect(page.locator(`#${id}`)).toHaveAttribute("data-xcss-server-corner-state","paint");
  await page.locator("#nested-all-parent").evaluate(el => el.style.scale="1.05"); await frame(page);
  await expect(page.locator("#nested-all")).toHaveAttribute("data-xcss-server-corner-reason","nested-transformed-coordinates");
  await page.locator("#nested-all-parent").evaluate(el => el.style.removeProperty("scale")); await frame(page);
  await page.locator("#nested-all").evaluate(el => { el.style.left="45px"; el.style.top="45px"; el.style.width="100px"; el.style.height="80px"; }); await frame(page);
  await expect(page.locator("#nested-all")).toHaveAttribute("data-xcss-server-corner-state","paint");
  await expect(page.locator("#nested-all")).toHaveAttribute("data-xcss-server-corner-reason","nested-offset-singularity");
  await expect(page.locator("#nested-photo-all")).toHaveAttribute("data-xcss-server-corner-state","paint");
  await page.locator("#nested-all").evaluate(el => { for (const name of ["left","top","width","height"]) el.style.removeProperty(name); }); await frame(page);
  await page.locator("#nested-all-parent").evaluate(el => el.style.setProperty("mask-image","linear-gradient(white,white)")); await frame(page);
  await expect(page.locator("#nested-all-parent")).toHaveAttribute("data-xcss-server-corner-reason","existing-mask");
  await expect(page.locator("#nested-all")).toHaveAttribute("data-xcss-server-corner-reason","nested-parent-unavailable");
  await page.locator("#nested-all-parent").evaluate(el => el.style.removeProperty("mask-image")); await frame(page);
  const recovered = await inspectNesting(page,"nested-all","all");
  expect(recovered.actualPath).toBe(recovered.expectedPath); expect(recovered.nested.followed).toHaveLength(4);
});

test("a parent hover translation retains the same following profile", async ({ page }) => {
  await ready(page);
  const before = await inspectNesting(page,"nested-photo-all","all");
  await page.locator("#nested-photo-all-parent").evaluate(el => el.style.transform="translateY(-3px)"); await frame(page);
  const after = await inspectNesting(page,"nested-photo-all","all");
  expect(after.actualPath).toBe(before.actualPath);
  expect(after.actualPath).toBe(after.expectedPath);
  expect(after.nested.followed).toHaveLength(4);
  expect(after.nested.aligned).toEqual(["top-right","top-left"]);
  expect(await page.locator("#nested-photo-all").getAttribute("data-xcss-server-corner-reason")).toBeNull();
});

test("scrolling a nested host updates offsets in its visible CSS coordinate space", async ({ page }) => {
  await ready(page);
  await page.locator("#nested-all-parent").evaluate(el => {
    el.style.overflow="auto";
    const space=document.createElement("div"); space.style.cssText="width:400px;height:400px;pointer-events:none"; el.append(space);
  }); await frame(page);
  const before = await inspectNesting(page,"nested-all","all");
  await page.locator("#nested-all-parent").evaluate(el => { el.scrollLeft=8; el.scrollTop=8; });
  await expect.poll(async () => (await inspectNesting(page,"nested-all","all")).actualPath).not.toBe(before.actualPath);
  const scrolled = await inspectNesting(page,"nested-all","all");
  expect(scrolled.actualPath).toBe(scrolled.expectedPath);
  expect(scrolled.corners.map(corner => corner.extent)).toEqual([60,60,60,60]);
});
