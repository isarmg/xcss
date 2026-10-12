import { test, expect } from "@playwright/test";
import { pngPixels } from "./png-pixels.mjs";
const ready = async page => { await page.goto("/select.html?lang=en"); await expect(page.getByRole("combobox", { name: "Controlled", exact: true })).toHaveText(/Alpha/); };
const native = (page, name) => page.locator(`select[name="${name}"]`);
const popup = page => page.locator(".xcss-select-panel:popover-open");
const choose = async (page, label, option) => { await page.getByRole("combobox", { name: label, exact: true }).click(); await popup(page).getByRole("option", { name: option, exact: true }).click(); };

test("keyboard, implicit labels, genuine native events, disabled options and fieldsets", async ({ page }) => {
  await ready(page);
  const control = page.getByRole("combobox", { name: "Controlled", exact: true });
  await control.focus(); await control.press("ArrowDown"); await control.press("ArrowDown");
  await expect(popup(page)).toHaveAccessibleName("Controlled");
  await expect(popup(page).getByRole("option", { name: "Gamma", exact: true })).toHaveAttribute("data-active", "true");
  await control.press("Escape"); await expect(control).toHaveText(/Alpha/);
  await control.press("End"); await control.press("Enter"); await expect(control).toHaveText(/Zulu/);
  await control.press("a"); await control.press("Tab"); await expect(control).toHaveText(/Alpha/);
  await expect(page.getByRole("combobox", { name: "Uncontrolled", exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.selectEvents)).toEqual([
    { value: "z", tag: "SELECT", currentTag: "SELECT", nativeType: "change", targetMatchesCurrent: true, selected: ["z"] },
    { value: "a", tag: "SELECT", currentTag: "SELECT", nativeType: "change", targetMatchesCurrent: true, selected: ["a"] },
  ]);
  await control.click(); await popup(page).getByRole("option", { name: "Beta disabled", exact: true }).click({ force: true }); await expect(control).toHaveText(/Alpha/);
  await page.getByRole("button", { name: "Toggle fieldset", exact: true }).click(); await expect(control).toBeDisabled();
  await expect(native(page, "controlled")).toBeDisabled();
  await page.getByRole("button", { name: "Toggle fieldset", exact: true }).click(); await expect(control).toBeEnabled();
  await page.getByRole("button", { name: "Rename label", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Renamed controlled", exact: true })).toBeVisible();
});

test("form validation focuses its first invalid control without stealing focus from an ordinary input", async ({ page }) => {
  await ready(page);
  await native(page, "uncontrolled").evaluate(field => { field.required = true; field.options[0].value = ""; field.selectedIndex = 0; });
  await page.getByRole("button", { name: "Submit fields", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Uncontrolled", exact: true })).toBeFocused();
  expect(await page.locator("form#controls").evaluate(form => Array.from(form.elements).filter(field => field.willValidate && !field.validity.valid).map(field => field.name))).toEqual(["uncontrolled", "required"]);

  await ready(page);
  await page.locator("form#controls").evaluate(form => {
    const input = document.createElement("input"); input.name = "first"; input.required = true; input.setAttribute("aria-label", "First text"); form.prepend(input);
  });
  await page.getByRole("button", { name: "Submit fields", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "First text", exact: true })).toBeFocused();

  await ready(page);
  await page.locator("form#controls").evaluate(form => {
    const input = document.createElement("input"); input.name = "last"; input.required = true; input.setAttribute("aria-label", "Last text"); form.append(input);
  });
  await page.getByRole("button", { name: "Submit fields", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Required", exact: true })).toBeFocused();
});

test("native required validity, form data, resets, live options and visible multiple listbox", async ({ page }) => {
  await ready(page);
  const required = page.getByRole("combobox", { name: "Required", exact: true });
  await page.getByRole("button", { name: "Submit fields", exact: true }).click();
  await expect(required).toBeFocused(); await expect(required).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toHaveText("Please fill out this field.");
  expect(await native(page, "required").evaluate(field => field.validity.customError)).toBe(true);
  await choose(page, "Required", "Ready"); await expect(page.getByRole("alert")).toHaveCount(0);
  await choose(page, "Controlled", "Gamma"); await choose(page, "Uncontrolled", "Zulu");
  await page.getByRole("button", { name: "Submit fields", exact: true }).click();
  await expect(page.getByTestId("submitted")).toHaveText('{"controlled":"g","uncontrolled":"z","required":"ok"}');
  await page.getByRole("button", { name: "Reset fields", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Controlled", exact: true })).toHaveText(/Gamma/);
  await expect(page.getByRole("combobox", { name: "Uncontrolled", exact: true })).toHaveText(/Gamma/);
  await expect(native(page, "controlled")).toHaveValue("g");
  await expect(native(page, "uncontrolled")).toHaveValue("g");
  await expect(required).toHaveText(/Choose/);
  await page.getByRole("button", { name: "Remove option", exact: true }).click(); await expect(page.getByRole("combobox", { name: "Dynamic", exact: true })).toHaveText(/Alpha/);
  const multiple = page.getByRole("listbox", { name: "Multiple", exact: true });
  await multiple.selectOption(["a", "z"]); expect(await page.evaluate(() => window.multipleValues)).toEqual(["a", "z"]);
  await expect(multiple).toHaveAttribute("multiple", "");
  await expect(multiple).toHaveCSS("--xcss-server-corner-extent", "42px");
  await expect(multiple).toHaveAttribute("data-xcss-server-corner-state", "clip");
});

test("top-layer panel escapes clipped parent and first/last hover obey all four shared corners", async ({ page }, info) => {
  await ready(page);
  const control = page.getByRole("combobox", { name: "Painted", exact: true });
  await control.click(); const popup = page.locator(".xcss-select-panel:popover-open");
  await expect(popup).toHaveAttribute("data-xcss-server-corner-state", "clip");
  const box = await popup.boundingBox(), parent = await page.locator("#clipped-parent").boundingBox();
  expect(box.y + box.height).toBeGreaterThan(parent.y + parent.height);
  const corners = [[1,1],[Math.floor(box.width)-2,1],[1,Math.floor(box.height)-2],[Math.floor(box.width)-2,Math.floor(box.height)-2]];
  for (const name of ["Alpha", "Gamma"]) {
    await popup.getByRole("option", { name, exact: true }).hover();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const pixels = await popup.screenshot({ path: info.outputPath(`panel-${name}.png`) });
    expect(pngPixels(pixels, corners)).toEqual(Array(4).fill([255,255,255,255]));
    const row = await popup.getByRole("option", { name, exact: true }).boundingBox();
    const middle = Math.floor(row.y - box.y + row.height / 2);
    expect(pngPixels(pixels, [[Math.floor(box.width/2), middle]])[0]).toEqual([255,0,0,255]);
  }
  await popup.getByRole("option", { name: "Beta", exact: true }).hover();
  await expect(popup.getByRole("option", { name: "Beta", exact: true })).toHaveAttribute("data-active", "true");
  const pixels = await popup.screenshot();
  expect(pngPixels(pixels, [[2,Math.floor(box.height/2)]])[0]).toEqual([255,0,0,255]);
  expect(await popup.getByRole("option").evaluateAll(options => options.every(option => !option.hasAttribute("data-xcss-server-corner-state") && getComputedStyle(option).getPropertyValue("--xcss-server-corner-extent").trim() === "0px"))).toBe(true);
  await popup.getByRole("option", { name: "Gamma", exact: true }).click(); await expect(control).toHaveText(/Gamma/);
});

test("popup inside modal escapes its clipped ancestor; Escape closes only the picker and Tab moves normally", async ({ page }) => {
  await ready(page); await page.getByRole("button", { name: "Open select dialog", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Select dialog", exact: true });
  const control = dialog.getByRole("combobox", { name: "Dialog choice", exact: true });
  await control.click(); await expect(page.locator(".xcss-select-panel:popover-open")).toBeVisible();
  await popup(page).getByRole("option", { name: "Zulu", exact: true }).click(); await expect(control).toHaveText(/Zulu/);
  await control.press("Enter"); await control.press("Escape"); await expect(dialog).toBeVisible();
  await expect(page.locator(".xcss-select-panel:popover-open")).toHaveCount(0);
  await control.press("Enter"); await control.press("Tab"); await expect(dialog.getByRole("button", { name: "Dialog next", exact: true })).toBeFocused();
});

test("input click removes the outline without changing any existing border or adding a replacement ring", async ({ page }) => {
  await ready(page);
  const field = page.getByRole("textbox", { name: "Text input", exact: true });
  const paint = () => field.evaluate(input => {
    const css = getComputedStyle(input);
    return { borders: ["Top", "Right", "Bottom", "Left"].map(side => [css[`border${side}Width`], css[`border${side}Color`], css[`border${side}Style`]]),
      shadow: css.boxShadow, image: css.borderImageSource, outline: css.outlineWidth };
  });
  await expect(field).toHaveAttribute("data-xcss-server-corner-state", "clip");
  const before = await paint(); await field.click(); await expect(field).toBeFocused();
  const after = await paint();
  expect(after.outline).toBe("0px"); expect(after.borders).toEqual(before.borders);
  expect(after.shadow).toBe(before.shadow); expect(after.image).toBe(before.image);
});

test("the centred right SVG arrow rotates down without moving on open", async ({ page }) => {
  await ready(page);
  const control = page.getByRole("combobox", { name: "Painted", exact: true });
  const arrow = control.locator("svg.xcss-select-arrow");
  await control.evaluate(trigger => trigger.parentElement.classList.add("searchbar"));
  await page.addStyleTag({ content: ".searchbar svg { fill: currentColor; width: 1.5rem; height: 1.5rem; }" });
  await expect(arrow.locator("path")).toHaveAttribute("d", "m9 6 6 6-6 6");
  const geometry = () => arrow.evaluate(svg => {
    const box = svg.getBoundingClientRect(), host = svg.parentElement.getBoundingClientRect(), path = svg.querySelector("path").getBBox();
    return { width: box.width, height: box.height, relativeX: box.x - host.x, relativeY: box.y - host.y,
      verticalCentreError: box.y + box.height / 2 - host.y - host.height / 2,
      internalCentre: [path.x + path.width / 2, path.y + path.height / 2],
      origin: getComputedStyle(svg).transformOrigin, transform: getComputedStyle(svg).transform };
  });
  const closed = await geometry(); expect(closed.internalCentre).toEqual([12,12]);
  await expect(arrow).toHaveCSS("fill", "none");
  expect(closed.width).toBe(16); expect(closed.height).toBe(16);
  expect(Math.abs(closed.verticalCentreError)).toBeLessThan(.5); expect(closed.transform).toBe("none");
  await control.click(); const opened = await geometry();
  expect(opened.transform).toBe("matrix(0, 1, -1, 0, 0, 0)");
  expect(opened.origin).toBe("8px 8px");
  for (const name of ["width", "height", "relativeX", "relativeY"]) expect(opened[name]).toBeCloseTo(closed[name], 4);
  expect(Math.abs(opened.verticalCentreError)).toBeLessThan(.5);
  await control.press("Escape"); await expect(arrow).toHaveCSS("transform", "none");
});

test("the first visible popup frame already has all four masked corners and the painted shadow", async ({ page }, info) => {
  await ready(page);
  const first = await page.evaluate(() => new Promise((resolve, reject) => {
    const control = document.getElementById("painted");
    const panel = document.getElementById(control.getAttribute("aria-controls"));
    panel.style.boxShadow = "0 6px 12px 0 rgb(0 0 0 / .4)";
    const samples = [];
    let completed = false, frames = 0;
    const sample = phase => {
      if (!panel.matches(":popover-open")) return;
      const css = getComputedStyle(panel), rect = panel.getBoundingClientRect();
      const visible = css.visibility === "visible" && css.display !== "none" && rect.width > 0 && rect.height > 0;
      const value = { phase, visible, state: panel.dataset.xcssServerCornerState, reason: panel.dataset.xcssServerCornerReason,
        mask: css.maskImage, shadowImage: css.borderImageSource, nativeShadow: css.boxShadow,
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      samples.push(value);
      if (visible && !completed) {
        completed = true; observer.disconnect(); window.firstPopupFrames = samples;
        resolve({ first: value, samples });
      }
    };
    const observer = new MutationObserver(() => sample("mutation-before-paint"));
    observer.observe(panel, { attributes: true });
    const frame = () => {
      sample(`raf-${++frames}`);
      if (!completed && frames < 120) requestAnimationFrame(frame);
      else if (!completed) { observer.disconnect(); reject(new Error("Popup never became visible")); }
    };
    requestAnimationFrame(frame);
    control.click(); sample("synchronous-open");
  }));
  expect(first.samples.some(sample => !sample.visible)).toBe(true);
  for (const sample of first.samples.filter(sample => sample.visible)) {
    expect(sample.state).toBe("clip"); expect(sample.mask).not.toBe("none"); expect(sample.shadowImage).not.toBe("none");
  }
  expect(first.first.nativeShadow).toBe("none");
  const box = first.first.box, margin = 12;
  const pixels = await page.screenshot({ path: info.outputPath("first-visible-popup-shadow.png"),
    clip: { x: box.x - margin, y: box.y - margin, width: box.width + margin * 2, height: box.height + margin * 2 } });
  const w = Math.floor(box.width), h = Math.floor(box.height);
  const corners = [[margin+1,margin+1],[margin+w-2,margin+1],[margin+1,margin+h-2],[margin+w-2,margin+h-2]];
  for (const pixel of pngPixels(pixels, corners)) {
    expect(pixel[0]).toBe(pixel[1]); expect(pixel[1]).toBe(pixel[2]);
  }
  expect(pngPixels(pixels, [[margin+Math.floor(w/2),margin+Math.floor(h/2)]])[0]).toEqual([0,0,255,255]);
  const shadow = pngPixels(pixels, [[margin+Math.floor(w/2),margin+h+4]])[0];
  expect(shadow[0]).toBeLessThan(250); expect(shadow[0]).toBe(shadow[1]); expect(shadow[1]).toBe(shadow[2]);
  await info.attach("first-visible-frame-observations", { body: JSON.stringify(first, null, 2), contentType: "application/json" });
});

for (const [property, value, reason] of [
  ["box-shadow", "inset 0 0 2px black", "inset-or-unsupported-shadow"],
  ["mask-image", "linear-gradient(black, black)", "existing-mask"],
]) test(`native popup fallback stays usable with ${property}`, async ({ page }) => {
  await ready(page);
  const control = page.getByRole("combobox", { name: "Controlled", exact: true });
  const panel = page.locator(`[id="${await control.getAttribute("aria-controls")}"]`);
  await panel.evaluate((node, [property, value]) => node.style.setProperty(property, value), [property, value]);
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(panel).toHaveAttribute("data-xcss-server-corner-reason", "not-visible");
    // A completed fallback from the previous opening must not reveal the
    // next opening before its current geometry and author style are checked.
    expect(await control.evaluate(trigger => {
      trigger.click();
      return getComputedStyle(document.getElementById(trigger.getAttribute("aria-controls"))).visibility;
    })).toBe("hidden");
    await expect(panel).toHaveAttribute("data-xcss-server-corner-state", "fallback");
    await expect(panel).toHaveAttribute("data-xcss-server-corner-reason", reason);
    await expect(panel).toBeVisible();
    await panel.getByRole("option", { name: attempt ? "Alpha" : "Gamma", exact: true }).click();
    await expect(control).toHaveText(attempt ? /Alpha/ : /Gamma/);
    await expect(control).toHaveAttribute("aria-expanded", "false");
  }
  await panel.evaluate((node, property) => node.style.removeProperty(property), property);
  await control.click();
  await expect(panel).toHaveAttribute("data-xcss-server-corner-state", "clip");
  await expect(panel).toBeVisible();
});
