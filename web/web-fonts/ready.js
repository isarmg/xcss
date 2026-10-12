// Reviewed startup runtime shared by the Server Web font snapshots.
/** @type {Promise<void> | undefined} */
let preparation;

/** Load and decode the complete Regular and Bold fonts before showing the UI.
 * @returns {Promise<void>}
 */
export function prepareApplicationFonts() {
  if (preparation) return preparation;
  document.documentElement.dataset.xcssFonts = "pending";
  preparation = (async () => {
    if (!document.fonts) throw new Error("Font Loading API is unavailable");
    const faces = Array.from(document.fonts);
    if (!faces.some(face => face.family.replaceAll('"', "") === "Sarmg Maple")) {
      throw new Error("Application font styles must load before startup");
    }
    // Both complete fonts are prepared once, including characters absent from
    // the initial page, so later menus never trigger another font download.
    await Promise.all(faces.map(face => face.load()));
    await document.fonts.ready;
    if (faces.some(face => face.status !== "loaded")) throw new Error("Application fonts are incomplete");
    document.documentElement.dataset.xcssFonts = "ready";
  })();
  return preparation;
}

/** Start the UI only after fonts are ready. A failed font keeps the plain background.
 * @param {() => void} start
 * @returns {Promise<void>}
 */
export function startAfterFonts(start) {
  return prepareApplicationFonts().then(start).catch(error => {
    console.error("Application font preparation failed", error);
  });
}
