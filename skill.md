# Skill: Pixel-Match Portfolio Clone (HTML/CSS)

## Goal

Clone a reference screenshot into:

- src/index.html
- src/style.css

Target: pixel similarity >= 80%.

## Core technique

1. Build semantic HTML with the same top-level section order as the reference:
	- hero/header
	- about
	- services
	- projects
	- contact
	- footer
2. Recreate visual rhythm first:
	- section heights
	- vertical spacing between blocks
	- container width and column layout
3. Match typography second:
	- serif italic for big headlines
	- sans-serif for body text
	- tune font-size/line-height/weight carefully (this affects score a lot)
4. Match component styling:
	- pill tags/buttons
	- card radius and shadows
	- icon box size
	- muted/light background sections
5. Use existing assets from src/ (images + SVG icons) whenever possible.

## Fast implementation workflow

1. Inspect assets and reference dimensions.
2. Create full HTML skeleton in one pass.
3. Write full CSS tokens + layout + responsive rules.
4. Run grader once to get baseline.
5. Iterate in this priority:
	- text scale mismatches (body text often too big/small)
	- section spacing/padding
	- card/image proportions
	- color and minor shadow differences

## Grader usage

Command:

```bash
node grader/tiered_grade.mjs reference/reference.png src/index.html 0.90 0.80 0.90 0.15 false
```

Interpretation:

- `pixel.similarity >= 0.80` means visual target is reached.
- In review band [0.8..0.9], grader may call OpenAI.
- If `OPENAI_API_KEY` is missing, command can exit code 1 even when pixel score is >80%.

## Practical checklist before final run

- Correct section order and structure
- Same major background blocks (white/muted/white/muted/white/navy footer)
- Similar headline line breaks
- Similar button/pill dimensions
- Similar card widths and gaps
- Body text size not oversized

## Notes from this lab

- Biggest score jump came from reducing paragraph font sizes in About/Services/Projects to match reference scale.
- After typography correction, pixel score moved from ~77% to ~80.66%.
