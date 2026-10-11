import { inflateSync } from "node:zlib";

// Read 8-bit RGB/RGBA browser screenshots without an extra package dependency.
export function pngPixels(png, points) {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Expected a PNG screenshot");
  let width, height, channels;
  const compressed = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[12] !== 0) throw new Error("Expected a non-interlaced 8-bit RGB/RGBA screenshot");
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") compressed.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) throw new Error("Invalid PNG pixel data");
  const rows = [];
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1), filter = raw[offset];
    if (filter > 4) throw new Error("Invalid PNG row filter");
    const row = Buffer.from(raw.subarray(offset + 1, offset + 1 + stride));
    const previous = rows.at(-1);
    for (let index = 0; index < stride; index++) {
      const left = index >= channels ? row[index - channels] : 0;
      const up = previous?.[index] ?? 0, diagonal = index >= channels ? previous?.[index - channels] ?? 0 : 0;
      const prediction = left + up - diagonal;
      const distances = [Math.abs(prediction - left), Math.abs(prediction - up), Math.abs(prediction - diagonal)];
      const paeth = [left, up, diagonal][distances.indexOf(Math.min(...distances))];
      row[index] = (row[index] + [0, left, up, Math.floor((left + up) / 2), paeth][filter]) & 255;
    }
    rows.push(row);
  }
  return points.map(([x, y]) => {
    if (x < 0 || x >= width || y < 0 || y >= height) throw new Error("Pixel lies outside screenshot");
    const pixel = [...rows[y].subarray(x * channels, (x + 1) * channels)];
    return channels === 3 ? [...pixel, 255] : pixel;
  });
}
