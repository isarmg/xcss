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
  await page.evaluate(() => window.serverCorners = window.startServerCorners(document));
  await expect(page.locator(".xcss-button").filter({ hasText: "Open modal" })).toHaveAttribute("data-xcss-server-corner-state", "paint");
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

const inspectIndependent = (page, id) => page.evaluate(async id => {
  const node = document.getElementById(id), css = getComputedStyle(node);
  const box = node.getBoundingClientRect();
  const expected = window.createServerCornerGeometry({ width:box.width, height:box.height, extent:parseFloat(css.getPropertyValue("--xcss-server-corner-extent")), tolerance:.02 });
  const url = node.style.borderImageSource.match(/url\(["']?(.*?)["']?\)/)[1];
  const svg = new DOMParser().parseFromString(await (await fetch(url)).text(), "image/svg+xml");
  return { actualPath:svg.querySelector("clipPath#inside path").getAttribute("d"), expectedPath:expected.path, extents:expected.corners.map(corner => corner.extent) };
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
