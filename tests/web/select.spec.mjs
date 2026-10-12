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
