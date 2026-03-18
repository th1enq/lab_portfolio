const fs = require("fs");
const { PNG } = require("pngjs");
const pixelmatchModule = require("pixelmatch");
/** @type {any} */
const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;

/** @typedef {ReturnType<typeof PNG.sync.read>} PNGImage */

/** @param {string} p */
function readPNG(p) {
  return PNG.sync.read(fs.readFileSync(p));
}

/** @param {PNGImage} png @param {number} w @param {number} h @param {number[]} [bg] */
function padTo(png, w, h, bg = [255, 255, 255, 255]) {
  if (png.width === w && png.height === h) return png;
  const out = new PNG({ width: w, height: h });

  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = bg[0];
    out.data[i + 1] = bg[1];
    out.data[i + 2] = bg[2];
    out.data[i + 3] = bg[3];
  }
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
  return /** @type {PNGImage} */ (out);
}

/** @param {number} r @param {number} g @param {number} b @param {number} a */
function isWhite(r, g, b, a) {
  return r > 240 && g > 240 && b > 240 && a === 255;
}

/** @param {PNGImage} left @param {PNGImage} right */
function countContentPixels(left, right) {
  let count = 0;

  for (let y = 0; y < left.height; y++) {
    for (let x = 0; x < left.width; x++) {
      const idx = (left.width * y + x) << 2;
      const leftHasContent = !isWhite(
        left.data[idx],
        left.data[idx + 1],
        left.data[idx + 2],
        left.data[idx + 3],
      );
      const rightHasContent = !isWhite(
        right.data[idx],
        right.data[idx + 1],
        right.data[idx + 2],
        right.data[idx + 3],
      );

      if (leftHasContent || rightHasContent) {
        count += 1;
      }
    }
  }

  return count;
}

/** @param {PNGImage[]} images @param {number} [margin] */
function findSharedContentBounds(images, margin = 10) {
  const first = images[0];
  let minX = first.width;
  let minY = first.height;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (const image of images) {
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const idx = (image.width * y + x) << 2;
        if (!isWhite(image.data[idx], image.data[idx + 1], image.data[idx + 2], image.data[idx + 3])) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          found = true;
        }
      }
    }
  }

  if (!found) {
    return { x: 0, y: 0, width: first.width, height: first.height };
  }

  minX = Math.max(0, minX - margin);
  minY = Math.max(0, minY - margin);
  maxX = Math.min(first.width - 1, maxX + margin);
  maxY = Math.min(first.height - 1, maxY + margin);

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/** @param {PNGImage} png @param {{ x: number, y: number, width: number, height: number }} bounds */
function cropToBounds(png, bounds) {
  if (
    bounds.x === 0 &&
    bounds.y === 0 &&
    bounds.width === png.width &&
    bounds.height === png.height
  ) {
    return png;
  }

  const cropped = new PNG({ width: bounds.width, height: bounds.height });

  PNG.bitblt(png, cropped, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0);
  return /** @type {PNGImage} */ (cropped);
}

async function main() {
  const ref = process.argv[2];
  const stu = process.argv[3];
  const outJson = process.argv[4] ?? "pixel_result.json";
  const outDiff = process.argv[5] ?? "pixel_diff.png";
  const pmThreshold = Number(process.argv[6] ?? "0.05");
  const autoCrop = (process.argv[7] ?? "true").toLowerCase() === "true";

  if (!ref || !stu) {
    console.error("Usage: node compare_pixel.mjs <ref.png> <student.png> [outJson] [outDiff] [pmThreshold]");
    process.exit(2);
  }

  let refP = readPNG(ref);
  let stuP = readPNG(stu);

  if (autoCrop) {
    const baseW = Math.max(refP.width, stuP.width);
    const baseH = Math.max(refP.height, stuP.height);
    const refBase = padTo(refP, baseW, baseH);
    const stuBase = padTo(stuP, baseW, baseH);
    const bounds = findSharedContentBounds([refBase, stuBase], 5);

    refP = cropToBounds(refBase, bounds);
    stuP = cropToBounds(stuBase, bounds);
  }

  const w = Math.max(refP.width, stuP.width);
  const h = Math.max(refP.height, stuP.height);

  const refPad = padTo(refP, w, h);
  const stuPad = padTo(stuP, w, h);

  const diff = new PNG({ width: w, height: h });
  const diffPixels = pixelmatch(refPad.data, stuPad.data, diff.data, w, h, { threshold: pmThreshold });

  fs.writeFileSync(outDiff, PNG.sync.write(diff));

  const totalPixels = w * h;
  const canvasDiffRatio = diffPixels / totalPixels;
  const canvasSimilarity = 1 - canvasDiffRatio;
  const contentPixels = countContentPixels(refPad, stuPad);
  const scoringPixels = contentPixels > 0 ? contentPixels : totalPixels;
  const diffRatio = Math.min(1, diffPixels / scoringPixels);
  const similarity = 1 - diffRatio;

  const result = {
    similarity,
    percent: similarity * 100,
    diffPixels,
    totalPixels,
    contentPixels,
    scoringPixels,
    diffRatio,
    canvasSimilarity,
    canvasDiffRatio,
    comparedWidth: w,
    comparedHeight: h,
    pmThreshold,
    autoCrop,
    ref,
    stu,
    diff: outDiff,
  };

  fs.writeFileSync(outJson, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});