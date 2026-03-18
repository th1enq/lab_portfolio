const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function toDataURL(pngPath) {
  const b64 = fs.readFileSync(pngPath).toString("base64");
  return `data:image/png;base64,${b64}`;
}

function parseJsonFromModelText(text) {
  const candidates = [];
  const trimmed = String(text ?? "").trim();
  candidates.push(trimmed);

  // Common case: model wraps JSON in markdown code fences.
  candidates.push(trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim());

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) candidates.push(fencedMatch[1].trim());

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1).trim());
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // Continue trying other candidate shapes.
    }
  }

  throw new SyntaxError("Model response did not contain parseable JSON.");
}

async function main() {
  const refPath = process.argv[2];
  const stuPath = process.argv[3];
  const threshold = Number(process.argv[4] ?? "0.70");
  const outJson = process.argv[5] ?? "openai_result.json";

  if (!refPath || !stuPath) {
    console.error("Usage: node compare_openai.cjs <ref.png> <student.png> [threshold] [outJson]");
    process.exit(2);
  }

  console.log("[OpenAI Grader] Reading images and converting to data URLs...");

  const refUrl = toDataURL(refPath);
  const stuUrl = toDataURL(stuPath);

  // Responses API supports image inputs. :contentReference[oaicite:2]{index=2}
  const resp = await client.responses.create({
    model: "gpt-4.1-mini", // supports image input :contentReference[oaicite:3]{index=3}
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Compare two webpage screenshots (first=REFERENCE, second=STUDENT).
Return ONLY strict JSON:
{
  "similarity": number,   // 0..1 where 1 is identical
  "pass": boolean,        // similarity >= ${threshold}
  "notes": string         // short, mention major layout/color differences if any
}
Do not wrap JSON in markdown fences.
Be robust: ignore tiny anti-aliasing/subpixel rendering differences.`,
          },
          { type: "input_image", image_url: refUrl },
          { type: "input_image", image_url: stuUrl },
        ],
      },
    ],
  });

  console.log("[OpenAI Grader] Model response received, parsing...");

  const text = (resp.output_text ?? "").trim();
  const previewLimit = 4000;
  const outputPreview = text.length > previewLimit
    ? `${text.slice(0, previewLimit)}\n...[truncated ${text.length - previewLimit} chars]`
    : text;
  console.log("[OpenAI Grader] Raw output_text preview:");
  console.log(outputPreview || "(empty)");

  let obj;
  try {
    obj = parseJsonFromModelText(text);
  } catch (e) {
    console.error("Model did not return valid JSON:");
    console.error(e);
    process.exit(3);
  }

  fs.writeFileSync(outJson, JSON.stringify(obj, null, 2));
  console.log(JSON.stringify(obj, null, 2));
  process.exit(obj.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});