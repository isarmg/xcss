import type { Plugin } from "vite";

export function assetBudget(maximum: number, maximumFontBytes = maximum): Plugin {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64 * 1024 * 1024) throw new TypeError("maxAssetBytes must be an integer in 1..67108864");
  if (!Number.isSafeInteger(maximumFontBytes) || maximumFontBytes < 1 || maximumFontBytes > 64 * 1024 * 1024) throw new TypeError("maxFontBytes must be an integer in 1..67108864");
  return {
    name: "xcss-asset-budget", enforce: "post",
    generateBundle(_options, bundle) {
      for (const [name, asset] of Object.entries(bundle)) {
        const source = asset.type === "chunk" ? asset.code : asset.source;
        const size = typeof source === "string" ? new TextEncoder().encode(source).byteLength : source.byteLength;
        const limit = asset.type === "asset" && /\.woff2?$/i.test(name) ? maximumFontBytes : maximum;
        if (size > limit) this.error(`Asset ${name} exceeds the ${limit}-byte xcss budget (${size} bytes)`);
        if (name.endsWith(".map")) this.error("xcss web builds must not publish source maps");
      }
    },
  };
}
