// grader/render.cjs
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

function readPngSize(pngPath) {
  const header = fs.readFileSync(pngPath);
  if (header.length < 24) {
    throw new Error(`[Renderer] Invalid PNG file (too small): ${pngPath}`);
  }

  const signatureOk =
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a;

  if (!signatureOk) {
    throw new Error(`[Renderer] Not a PNG file: ${pngPath}`);
  }

  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`[Renderer] Invalid PNG dimensions in: ${pngPath}`);
  }

  return { width, height };
}

async function getVisibleContentBottom(page) {
  return page.evaluate(() => {
    let maxBottom = 0;
    const elements = document.body.querySelectorAll("*");

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const absoluteBottom = rect.bottom + window.scrollY;
      if (absoluteBottom > maxBottom) maxBottom = absoluteBottom;
    }

    return Math.ceil(maxBottom);
  });
}

(async () => {
  const inputPath = process.argv[2] ?? "index.html";
  const outPng = process.argv[3] ?? "student.png";
  const referencePngArg = process.argv[4] ?? "reference/reference.png";

  let htmlPath = path.resolve(inputPath);
  if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isDirectory()) {
    htmlPath = path.join(htmlPath, "index.html");
  }

  if (!fs.existsSync(htmlPath) || !fs.statSync(htmlPath).isFile()) {
    throw new Error(`[Renderer] HTML file not found: ${htmlPath}`);
  }

  const referencePngPath = path.resolve(referencePngArg);
  if (!fs.existsSync(referencePngPath) || !fs.statSync(referencePngPath).isFile()) {
    throw new Error(`[Renderer] Reference PNG not found: ${referencePngPath}`);
  }

  const { width, height } = readPngSize(referencePngPath);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });

  console.log(`[Renderer] Viewport set from reference (${referencePngPath}): ${width}x${height}`);
  console.log(`[Renderer] Navigating to ${htmlPath} and rendering screenshot...`);

  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.addStyleTag({
    content: "*,*::before,*::after{animation:none!important;transition:none!important;}",
  });

  // đợi font nếu có
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.status !== "loaded") await document.fonts.ready;
  });

  await page.waitForTimeout(150);

  let contentBottom = await getVisibleContentBottom(page);
  if (contentBottom !== height) {
    let zoom = 1;

    // Iteratively converge content bottom to reference height.
    for (let i = 0; i < 3; i += 1) {
      if (contentBottom <= 0) break;

      const correction = height / contentBottom;
      if (!Number.isFinite(correction) || correction <= 0) break;

      zoom = Math.min(2, Math.max(0.5, zoom * correction));

      await page.evaluate((z) => {
        document.documentElement.style.zoom = String(z);
      }, zoom);

      await page.waitForTimeout(120);
      contentBottom = await getVisibleContentBottom(page);

      if (Math.abs(contentBottom - height) <= 2) break;
    }

    console.log(`[Renderer] Applied zoom factor: ${zoom.toFixed(4)}`);
  }

  if (contentBottom < height) {
    console.log(
      `[Renderer] Page visible content is shorter than reference viewport: contentBottom=${contentBottom}px, reference=${height}px, blankBottom=${height - contentBottom}px`
    );
  } else if (contentBottom > height) {
    console.log(
      `[Renderer] Page visible content is taller than reference viewport: contentBottom=${contentBottom}px, reference=${height}px, clippedBottom=${contentBottom - height}px`
    );
  } else {
    console.log(`[Renderer] Page visible content height matches reference viewport: ${height}px`);
  }

  await page.screenshot({ path: outPng, fullPage: false });

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});