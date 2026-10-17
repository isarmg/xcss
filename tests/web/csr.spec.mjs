import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const session = (username = "admin") => ({ authenticated: true, user_id: "123e4567-e89b-12d3-a456-426614174000", username, role: "admin", csrf_token: "A".repeat(43) });
const failure = (code = "auth.session_required", request_id) => ({ code, message: "<img src=x onerror=alert(1)> private backend detail", retryable: false, ...(request_id ? { request_id } : {}) });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const ready = page => expect(page.locator("html")).toHaveAttribute("data-xcss-startup", "ready", { timeout: 30_000 });
const field = (page, name) => page.locator(`[name="${name}"]`);
async function authenticated(page, path = "/?lang=en") {
  await page.route("**/api/v1/auth/session", route => json(route, session()));
  await page.goto(path); await ready(page);
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}
async function credentials(page) {
  await field(page, "username").fill("admin");
  await field(page, "password").fill("valid password 123");
}
function gate() {
  let release;
  return { pending: new Promise(resolve => { release = resolve; }), release: () => release() };
}

test.beforeEach(async ({ page }) => {
  page.wasmEvidence = []; page.runtimeErrors = [];
  page.on("pageerror", error => page.runtimeErrors.push(error.message));
  page.on("response", response => {
    if (new URL(response.url()).pathname.endsWith(".wasm")) page.wasmEvidence.push({ ok: response.ok(), mime: response.headers()["content-type"] });
  });
});
test.afterEach(async ({ page }) => {
  const artifacts = page.wasmEvidence;
  expect(artifacts.length).toBeGreaterThan(0);
  expect(artifacts.every(artifact => artifact.ok && artifact.mime === "application/wasm")).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("data-xcss-runtime", "xcss-web");
  expect(page.runtimeErrors).toEqual([]);
});

test("fonts gate actual WASM mounting until both complete font faces load", async ({ page }) => {
  const regular = gate(), bold = gate();
  const requested = [];
  await page.route("**/*.woff2", async route => {
    const name = new URL(route.request().url()).pathname;
    requested.push(name); await (name.includes("Regular") ? regular.pending : bold.pending); await route.continue();
  });
  await page.goto("/?lang=en", { waitUntil: "domcontentloaded" });
  await expect.poll(() => requested.length).toBe(2);
  await expect(page.locator("html")).toHaveAttribute("data-xcss-fonts", "pending");
  await expect(page.locator("body")).toHaveCSS("visibility", "hidden");
  await expect(page.locator("#root")).toBeEmpty();
  regular.release();
  await expect.poll(() => page.evaluate(() => [...document.fonts].filter(face => face.status === "loaded").length)).toBe(1);
  await expect(page.locator("body")).toHaveCSS("visibility", "hidden");
  await expect(page.locator("#root")).toBeEmpty();
  bold.release(); await ready(page);
  await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
  expect(await page.evaluate(() => [...document.fonts].filter(face => face.status === "loaded").map(face => face.weight).sort())).toEqual(["400", "700"]);
  expect(requested).toHaveLength(2);
});

test("session restore presents an opaque boot state and preserves deep links", async ({ page }) => {
  const pending = gate(); let requests = 0;
  await page.route("**/api/v1/auth/session", async route => { requests++; await pending.pending; await json(route, session()); });
  await page.goto("/?lang=en#workspace"); await ready(page);
  await expect(page.getByRole("status", { name: "Preparing application…" })).toBeVisible();
  await expect(page.locator("form, main, header")).toHaveCount(0);
  expect(requests).toBe(1);
  pending.release();
  await expect(page.getByRole("heading", { name: "Full-width workspace" })).toBeVisible();
  await expect(page).toHaveURL(/#workspace$/);
});

test("login validates locally, hides backend details, clears secrets and preserves landing context", async ({ page }) => {
  let requests = 0; let accept = false;
  await page.route("**/api/v1/auth/login", route => { requests++; return accept ? json(route, session()) : json(route, failure("auth.invalid_credentials", "login.request-1"), 401); });
  await page.goto("/?lang=en&landing=hash#overview"); await ready(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect(requests).toBe(0);
  await credentials(page); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".xcss-error")).toContainText("login.request-1");
  await expect(page.locator("body")).not.toContainText("private backend detail");
  await expect(page.locator(".xcss-error img")).toHaveCount(0);
  await expect(field(page, "password")).toHaveValue("");
  accept = true; await credentials(page); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Full-width workspace" })).toBeVisible();
  await expect(page).toHaveURL(/lang=en.*#workspace$/); expect(requests).toBe(2);
});

test("path login landing preserves language when browser storage is denied", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Denied", "SecurityError"); } }); });
  await page.route("**/api/v1/auth/login", route => json(route, session()));
  await page.goto("/?lang=en&landing=path#overview"); await ready(page);
  await credentials(page); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Full-width workspace" })).toBeVisible();
  await expect(page).toHaveURL(/\/\?lang=en#workspace$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("public WASM transport rejects invalid paths, JSON and size violations without retrying", async ({ page }) => {
  await authenticated(page);
  const path = page.getByRole("textbox", { name: "Probe API path" });
  const result = page.locator("#probe-result"), probe = page.getByRole("button", { name: "Probe request", exact: true });
  let requests = 0;
  await page.route("**/api/v1/probe", route => { requests++; return route.fallback(); });
  for (const [response, expected] of [
    [{ status: 204 }, "ok:null"],
    [{ status: 200, contentType: "application/json", body: '"' + "a".repeat(126) + '"' }, 'ok:"' + "a".repeat(126) + '"'],
    [{ status: 200, contentType: "application/json", body: '"' + "a".repeat(127) + '"' }, "error:response_too_large:200"],
    [{ status: 200, contentType: "text/html", body: "<script>private backend detail</script>" }, "error:invalid_content_type:200"],
    [{ status: 200, contentType: "application/json", body: "{" }, "error:invalid_json_response:200"],
    [{ status: 200, contentType: "application/json", body: Buffer.from([34, 255, 34]) }, "error:invalid_json_response:200"],
    [{ status: 503, json: { ...failure("server.unavailable"), extra: true } }, "error:invalid_error_response:503"],
    [{ status: 503, contentType: "application/json", body: "a".repeat(65_537) }, "error:response_too_large:503"],
  ]) {
    let attempts = 0;
    await page.route("**/api/v1/probe", route => { attempts++; return route.fulfill(response); }, { times: 1 });
    await probe.click(); await expect(result).toHaveText(expected);
    expect(attempts).toBe(1);
  }
  expect(requests).toBe(0);
  await path.fill("/api/v1/probe?stream=1"); await probe.click(); await expect(result).toHaveText("error:response_too_large:200");
  for (const candidate of ["https://foreign.invalid/api/v1/probe", "/api/v1/../private", "/api/v1/probe#secret", "/api/v1/\\private"]) {
    await path.fill(candidate); await probe.click(); await expect(result).toHaveText("error:invalid_api_path:0");
  }
  expect(requests).toBe(0);
});

test("transport timeout cancels the pending request and performs no automatic retry", async ({ page }) => {
  await authenticated(page); const pending = gate(); let requests = 0;
  await page.route("**/api/v1/probe", async route => { requests++; await pending.pending; await json(route, null).catch(() => {}); });
  await page.getByRole("button", { name: "Probe request", exact: true }).click();
  await expect(page.locator("#probe-result")).toHaveText("error:request_timeout:0"); expect(requests).toBe(1);
  pending.release();
});

test("native modal traps keyboard focus, closes with Escape and restores the trigger", async ({ page }) => {
  await authenticated(page);
  const trigger = page.getByRole("button", { name: "Create", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Confirm action" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "First action" })).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
});

test("account form blocks mismatches, serializes one CSRF mutation and clears detached secrets", async ({ page }) => {
  let requests = 0; const pending = gate(); let mutation;
  await page.route("**/api/v1/platform/administrators/self", async route => {
    requests++; mutation = route.request(); await pending.pending; await json(route, null);
  });
  await authenticated(page, "/?lang=en#account");
  await field(page, "username").fill("renamed"); await field(page, "current_password").fill("current password");
  await field(page, "new_password").fill("new password 123"); await field(page, "confirm_password").fill("different password");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".xcss-error")).toContainText("do not match"); expect(requests).toBe(0);
  await field(page, "confirm_password").fill("new password 123");
  await page.evaluate(() => { window.detachedSecrets = [...document.querySelectorAll('input[type="password"]')]; });
  await page.locator(".xcss-account-form").evaluate(form => { for (let i = 0; i < 2; i++) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await expect.poll(() => requests).toBe(1);
  expect(mutation.headers()["x-csrf-token"]).toBe("A".repeat(43));
  expect(mutation.postDataJSON()).toEqual({ username: "renamed", current_password: "current password", new_password: "new password 123" });
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  pending.release();
  await expect(page.getByRole("status")).toContainText("Account updated");
  await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
  expect(await page.evaluate(() => window.detachedSecrets.map(node => node.value))).toEqual(["", "", ""]);
});

test("account failure clears secrets and supports a successful retry", async ({ page }) => {
  let count = 0;
  await page.route("**/api/v1/platform/administrators/self", route => ++count === 1 ? json(route, failure("admin.current_password_invalid"), 400) : json(route, null));
  await authenticated(page, "/?lang=en#account");
  await field(page, "current_password").fill("wrong password"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".xcss-error")).toContainText("current password is incorrect");
  for (const name of ["current_password", "new_password", "confirm_password"]) await expect(field(page, name)).toHaveValue("");
  await field(page, "current_password").fill("correct password"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Account updated"); expect(count).toBe(2);
});

test("theme follows system until explicitly chosen and language persists across reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/?lang=en#overview"); await ready(page); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" }); await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click(); await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to Chinese" }).click(); await ready(page);
  await expect(page.getByRole("heading", { name: "管理员登录" })).toBeVisible();
  await expect(page).toHaveURL(/lang=zh-CN#overview$/);
  await page.goto("/#workspace"); await ready(page); await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("display controls and authentication survive denied browser storage", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Denied", "SecurityError"); } }); });
  await page.emulateMedia({ colorScheme: "light" }); await authenticated(page);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.emulateMedia({ colorScheme: "light" }); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "Product overview" })).toBeVisible();
});

test("notifications are bounded plain text, dismissible, expire and clear on logout", async ({ page }) => {
  await authenticated(page); await page.clock.install();
  await page.evaluate(() => { for (let i = 0; i < 8; i++) window.dispatchEvent(new CustomEvent("xcss-notify", { detail: `<img src=x onerror=alert(1)>${i}` + "x".repeat(600) })); });
  await expect(page.locator(".xcss-toast")).toHaveCount(5);
  await expect(page.locator(".xcss-toast img")).toHaveCount(0);
  expect(await page.locator(".xcss-toast span").evaluateAll(nodes => nodes.every(node => node.textContent.length === 512))).toBe(true);
  await page.getByRole("button", { name: "Dismiss notification" }).first().click(); await expect(page.locator(".xcss-toast")).toHaveCount(4);
  await page.clock.fastForward(10_000); await expect(page.locator(".xcss-toast")).toHaveCount(0);
  await page.getByRole("button", { name: "Notify", exact: true }).click(); await expect(page.locator(".xcss-toast")).toHaveCount(1);
  await page.route("**/api/v1/auth/logout", route => route.fulfill({ status: 204 }));
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible(); await expect(page.locator(".xcss-toast")).toHaveCount(0);
});

test("unconfirmed logout retains its revocation token for an explicit retry", async ({ page }) => {
  const tokens = []; let count = 0;
  await page.route("**/api/v1/auth/logout", route => { tokens.push(route.request().headers()["x-csrf-token"]); return ++count === 1 ? json(route, failure("server.unavailable", "logout.request-1"), 503) : route.fulfill({ status: 204 }); });
  await authenticated(page); await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry sign out" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(0);
  await expect(page.locator(".xcss-error")).toContainText("logout.request-1");
  await page.getByRole("button", { name: "Retry sign out" }).click();
  await expect(page.getByRole("button", { name: "Retry sign out" })).toHaveCount(0);
  expect(tokens).toEqual(["A".repeat(43), "A".repeat(43)]);
});

test("a failed login cannot erase an unconfirmed logout warning or revocation token", async ({ page }) => {
  let count = 0; const tokens = [];
  await page.route("**/api/v1/auth/logout", route => { tokens.push(route.request().headers()["x-csrf-token"]); return ++count === 1 ? json(route, failure("server.unavailable"), 503) : route.fulfill({ status: 204 }); });
  await page.route("**/api/v1/auth/login", route => json(route, failure("auth.invalid_credentials", "login.retry-1"), 401));
  await authenticated(page); await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry sign out" })).toBeVisible();
  await credentials(page); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".xcss-error").filter({ hasText: "login.retry-1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry sign out" })).toBeVisible();
  await page.getByRole("button", { name: "Retry sign out" }).click();
  await expect(page.getByRole("button", { name: "Retry sign out" })).toHaveCount(0);
  expect(tokens).toEqual(["A".repeat(43), "A".repeat(43)]);
});

test("a malformed logout success remains visibly unconfirmed", async ({ page }) => {
  await page.route("**/api/v1/auth/logout", route => json(route, { unexpected: "payload" }));
  await authenticated(page); await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry sign out" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(0);
});

test("a late restore cannot reopen protected content after logout begins", async ({ page }) => {
  const pending = gate(); let restoring = false, reads = 0, logoutCalls = 0;
  await page.route("**/api/v1/auth/session", async route => { reads++; if (restoring) await pending.pending; await json(route, session()); });
  await page.route("**/api/v1/auth/logout", route => { logoutCalls++; return route.fulfill({ status: 204 }); });
  await page.goto("/?lang=en"); await ready(page); await expect(page.getByRole("heading", { name: "Product overview" })).toBeVisible();
  restoring = true; await page.getByRole("button", { name: "Restore session" }).click(); await expect.poll(() => reads).toBe(2);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible(); expect(logoutCalls).toBe(0);
  pending.release(); await expect.poll(() => logoutCalls).toBe(1);
  await expect(page.locator("main")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
});

for (const view of ["login", "workspace", "account"]) for (const colorScheme of ["light", "dark"]) test(`mobile ${colorScheme} public CSR ${view === "workspace" ? "shell" : view} meets WCAG AA`, async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 }); await page.emulateMedia({ colorScheme });
  if (view === "login") {
    await page.goto("/?lang=en"); await ready(page);
    await expect(page.getByRole("heading", { name: "Administrator sign in" })).toBeVisible();
  } else {
    await authenticated(page, view === "account" ? "/?lang=en#account" : "/?lang=en");
  }
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll("body *")].flatMap(node => {
      const rect = node.getBoundingClientRect();
      if (rect.right <= innerWidth && rect.left >= 0 && node.scrollWidth <= node.clientWidth) return [];
      const style = getComputedStyle(node);
      return [{ tag: node.tagName, id: node.id, class: node.className,
        name: node.getAttribute("name"), label: node.getAttribute("aria-label"),
        left: rect.left, right: rect.right, width: rect.width,
        clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
        display: style.display, minWidth: style.minWidth, gridColumns: style.gridTemplateColumns }];
    }),
  }));
  expect(layout.width <= layout.viewport, JSON.stringify(layout, null, 2)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
});


test("restore cannot reopen protected content during pending or unconfirmed logout", async ({ page }) => {
  const pending = gate(); let reads = 0, logoutCalls = 0;
  await page.route("**/api/v1/auth/session", route => { reads++; return json(route, session()); });
  await page.route("**/api/v1/auth/logout", async route => {
    logoutCalls++;
    if (logoutCalls === 1) { await pending.pending; await json(route, failure("server.unavailable"), 503); }
    else await route.fulfill({ status: 204 });
  });
  await page.goto("/?lang=en"); await ready(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(() => logoutCalls).toBe(1);
  const restore = () => page.evaluate(async () => (await import("/pkg/csr_fixture.js")).restore_session());
  expect(await restore()).toBe("auth_logout_unconfirmed");
  await expect(page.locator("main")).toHaveCount(0);
  pending.release();
  await expect(page.getByRole("button", { name: "Retry sign out" })).toBeVisible();
  expect(await restore()).toBe("auth_logout_unconfirmed");
  expect(reads).toBe(1);
  await expect(page.getByRole("button", { name: "Retry sign out" })).toBeVisible();
  await page.getByRole("button", { name: "Retry sign out" }).click();
  await expect(page.getByRole("button", { name: "Retry sign out" })).toHaveCount(0);
  await page.route("**/api/v1/auth/session", route => json(route, failure(), 401));
  expect(await restore()).toBe("auth.session_required");
  await expect(page.locator("main")).toHaveCount(0);
});

for (const logoutSucceeds of [false, true]) test(`a queued failed login preserves ${logoutSucceeds ? "confirmed" : "unconfirmed"} logout`, async ({ page }) => {
  const pending = gate(); let logoutCalls = 0, loginCalls = 0, acceptLogin = false;
  await page.route("**/api/v1/auth/logout", async route => {
    logoutCalls++; await pending.pending;
    if (logoutSucceeds) await route.fulfill({ status: 204 });
    else await json(route, failure("server.unavailable"), 503);
  });
  await page.route("**/api/v1/auth/login", route => {
    loginCalls++;
    return acceptLogin ? json(route, session("other")) : json(route, failure("auth.invalid_credentials"), 401);
  });
  await authenticated(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(() => logoutCalls).toBe(1);
  // Queue the real WASM API while logout owns the mutex, retaining its result.
  await page.evaluate(async () => {
    const api = await import("/pkg/csr_fixture.js");
    window.queuedLogin = api.login_session("admin", "valid password 123");
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(loginCalls).toBe(0);
  pending.release();
  expect(await page.evaluate(() => window.queuedLogin)).toBe("auth.invalid_credentials");
  expect(loginCalls).toBe(1);
  await expect(page.locator("main")).toHaveCount(0);
  const restore = () => page.evaluate(async () => (await import("/pkg/csr_fixture.js")).restore_session());
  if (logoutSucceeds) {
    await page.route("**/api/v1/auth/session", route => json(route, failure(), 401));
    expect(await restore()).toBe("auth.session_required");
    await expect(page.getByRole("button", { name: "Retry sign out" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Retry sign out" })).toBeVisible();
    expect(await restore()).toBe("auth_logout_unconfirmed");
  }
  // Explicit successful login must still replace either settled outcome.
  acceptLogin = true;
  expect(await page.evaluate(async () => (await import("/pkg/csr_fixture.js")).login_session("other", "valid password 123"))).toBe("authenticated");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.route("**/api/v1/auth/session", route => json(route, session("other")));
  expect(await restore()).toBe("authenticated");
});

for (const firstLogoutSucceeds of [false, true]) test(`logout/login/logout keeps the latest revocation barrier after earlier ${firstLogoutSucceeds ? "success" : "failure"}`, async ({ page }) => {
  const first = gate(), last = gate(); let logoutCalls = 0;
  const tokens = [];
  await page.route("**/api/v1/auth/logout", async route => {
    tokens.push(route.request().headers()["x-csrf-token"]);
    logoutCalls++;
    if (logoutCalls === 1) {
      await first.pending;
      if (firstLogoutSucceeds) await route.fulfill({ status: 204 });
      else await json(route, failure("server.unavailable"), 503);
    } else {
      await last.pending; await json(route, failure("server.unavailable"), 503);
    }
  });
  await page.route("**/api/v1/auth/login", route => json(route, { ...session("other"), csrf_token: "B".repeat(42) + "A" }));
  await authenticated(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(() => logoutCalls).toBe(1);
  await page.evaluate(async () => {
    const api = await import("/pkg/csr_fixture.js");
    window.queuedLogin = api.login_session("other", "valid password 123");
    // Let spawn_local record this intent before queuing the next one.
    await new Promise(resolve => setTimeout(resolve, 0));
    window.queuedLogout = api.logout_session();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  first.release(); await expect.poll(() => logoutCalls).toBe(2);
  expect(await page.evaluate(() => window.queuedLogin)).toBe("auth_operation_superseded");
  const restore = () => page.evaluate(async () => (await import("/pkg/csr_fixture.js")).restore_session());
  expect(await restore()).toBe("auth_logout_unconfirmed");
  await expect(page.locator("main")).toHaveCount(0);
  expect(tokens).toEqual(["A".repeat(43), "B".repeat(42) + "A"]);
  last.release(); expect(await page.evaluate(() => window.queuedLogout)).toBe("server.unavailable");
  await expect(page.getByRole("button", { name: "Retry sign out" })).toBeVisible();
  expect(await restore()).toBe("auth_logout_unconfirmed");
});
