// grader/tiered_grade.mjs
import fs from "fs";
import { execSync } from "node:child_process";
import os from "os";
import path from "path";

function loadOpenAIKeyFromRunnerFile() {
  if (process.env.OPENAI_API_KEY) return;

  const keyFile = path.join(os.homedir(), ".secrets", "openai.env");
  if (!fs.existsSync(keyFile)) return;

  const line = fs
    .readFileSync(keyFile, "utf-8")
    .split("\n")
    .find((l) => l.startsWith("OPENAI_API_KEY="));

  if (line) {
    process.env.OPENAI_API_KEY = line.slice("OPENAI_API_KEY=".length).trim();
  }
}

/** @param {string} cmd */
function run(cmd) {
  return execSync(cmd, { stdio: "pipe", encoding: "utf-8", env: process.env });
}

/** @param {string} p */
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

/** @param {string | undefined} value @param {boolean} [defaultValue=true] */
function parseBooleanFlag(value, defaultValue = true) {
  if (value === undefined) return defaultValue;

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;

  throw new Error(`[Tiered Grader] Invalid single flag: ${value}. Use true/false.`);
}

async function main() {
  const ref = process.argv[2] ?? "reference/reference.png";
  const html = process.argv[3] ?? "index.html";

  const passAt = Number(process.argv[4] ?? "0.85");

  // “review band”: chỉ gọi OpenAI nếu pixel similarity nằm dưới khoảng này
  const reviewLow = Number(process.argv[5] ?? "0.80");
  const reviewHigh = Number(process.argv[6] ?? "0.85");

  const pmThreshold = Number(process.argv[7] ?? "0.10");
  const single = parseBooleanFlag(process.argv[8], true);

  let renderTarget = html;
  if (single) {
    const rootIndex = path.resolve("index.html");
    if (!fs.existsSync(rootIndex) || !fs.statSync(rootIndex).isFile()) {
      throw new Error("[Tiered Grader] single=true requires index.html in repository root.");
    }
    renderTarget = "index.html";
  } else {
    const srcDir = path.resolve("src");
    if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
      throw new Error("[Tiered Grader] single=false requires src directory in repository root.");
    }
    renderTarget = "src";
  }

  fs.mkdirSync("results", { recursive: true });

  console.log("[Tiered Grader] Starting grading process...");
  console.log(`[Tiered Grader] single mode: ${single}, render target: ${renderTarget}`);

  // 1) Render
  run(`node grader/render.cjs "${renderTarget}" results/student.png "${ref}"`);;

  console.log("[Tiered Grader] Rendering completed, starting pixel comparison...");

  // Always create result.png from the rendered student image for debug
  fs.copyFileSync("results/student.png", "result.png");
  console.log("[Tiered Grader] Debug result.png created from rendered student.png");

  // 2) Tier 1: pixelmatch
  run(`node grader/compare_pixel.cjs ${ref} results/student.png results/pixel_result.json results/pixel_diff.png ${pmThreshold} false`);
  const px = readJson("results/pixel_result.json");

  // Pass ngay nếu đạt
  if (px.similarity >= passAt) {
    const out = { final_pass: true, final_similarity: px.similarity, used: "pixel", pixel: px };
    fs.writeFileSync("results/final.json", JSON.stringify(out, null, 2));
    console.log("[Tiered Grader] ✅ Pixel similarity ABOVE pass threshold, grading completed.");
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  // Fail ngay nếu quá thấp (khỏi tốn API)
  if (px.similarity < reviewLow) {
    const out = { final_pass: false, final_similarity: px.similarity, used: "pixel", pixel: px };
    fs.writeFileSync("results/final.json", JSON.stringify(out, null, 2));
    console.log("[Tiered Grader] ❌ Pixel similarity BELOW review threshold, grading completed with fail!");
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  // 3) Tier 2: OpenAI vision (chỉ trong review band)
  // (Nếu similarity nằm giữa reviewLow..reviewHigh)
  if (px.similarity >= reviewLow && px.similarity < reviewHigh) {
    // compare_openai.mjs sẽ exit 0/1 theo pass/fail
    console.log(`[Tiered Grader] Pixel similarity ${px.similarity} in review band [${reviewLow}..${reviewHigh}], invoking OpenAI for final grading...`);
    loadOpenAIKeyFromRunnerFile();
    console.log("[Tiered Grader] OPENAI_API_KEY available:", Boolean(process.env.OPENAI_API_KEY));
    try {
      run(`node grader/compare_openai.cjs ${ref} results/student.png ${passAt} results/openai_result.json`);
    } catch (e) {
      console.error("OpenAI grading failed or returned fail result:");
      console.error(e);
    }

    let oa = null;
    try { oa = readJson("results/openai_result.json"); } catch (e) { }

    const openaiSimilarity = typeof oa?.similarity === "number" ? oa.similarity : null;
    const averagedSimilarity = openaiSimilarity === null
      ? px.similarity
      : (openaiSimilarity + px.similarity) / 2;
    const finalPass = averagedSimilarity >= passAt;

    const out = {
      final_pass: finalPass,
      final_similarity: averagedSimilarity,
      used: "openai",
      pixel: px,
      openai: oa,
    };

    fs.writeFileSync("results/final.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    process.exit(finalPass ? 0 : 1);
  }

  // fallback
  const out = { final_pass: false, final_similarity: px.similarity, used: "pixel", pixel: px };
  fs.writeFileSync("results/final.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});