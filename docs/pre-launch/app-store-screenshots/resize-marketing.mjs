// Conforms the designed marketing screenshots to App Store pixel sizes.
//
//   node docs/pre-launch/app-store-screenshots/resize-marketing.mjs
//
// The source renders are 1152x2048 — 9:16, which is a perfectly normal size for
// a design tool and not a size App Store Connect accepts. iPhone screenshots
// are 19.5:9, so the target is TALLER relative to its width and the conversion
// is pure vertical padding: every pixel of the original survives, nothing is
// cropped, and the only question is what to put in the new space.
//
// Flat bars would be wrong. Two of the five sit on near-white gradients and
// three on near-black ones, so a black bar would be a visible seam on some and
// invisible on others.
//
// Stretching the single outermost row does not work either — tried it, and the
// dashboard render banded top and bottom, because its last row is lighter than
// the rows just above it and a flat smear of it therefore sits at the wrong
// level. So each edge is MIRRORED into the new space and faded out into the
// average colour of that edge. Mirroring guarantees there is no step at the
// join (the first mirrored row is the edge row), and the fade stops the
// reversed gradient from becoming noticeable further out.
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const SRC_DIR = "/Users/stephenrussell/Downloads";
const OUT_ROOT = import.meta.dirname;

const SOURCES = [
  ["App Store Screenshot 1 - Dashboard.png", "1-fitness-score.png"],
  ["App Store Screenshot 2 - Endurance HQ.png", "2-every-run.png"],
  ["App Store Screenshot 3 - Log Workout.png", "3-log-any-workout.png"],
  ["App Store Screenshot 4 - Gym Session.png", "4-master-your-lifts.png"],
  ["App Store Screenshot 5 - Adaptive 1RM.png", "5-predict-potential.png"],
];

// Both sizes App Store Connect takes for iPhone. The 6.7" pair is what this
// app's listing already has accepted; 6.9" is what a new submission is asked
// for. Producing both costs one extra resize and removes the guess.
const TARGETS = [
  { dir: "marketing-6.7-1284x2778", w: 1284, h: 2778 },
  { dir: "marketing-6.9-1320x2868", w: 1320, h: 2868 },
];

for (const t of TARGETS) {
  const outDir = path.join(OUT_ROOT, t.dir);
  fs.mkdirSync(outDir, { recursive: true });

  for (const [srcName, outName] of SOURCES) {
    const src = path.join(SRC_DIR, srcName);
    const meta = await sharp(src).metadata();

    // Scale to the target width first, then work out how much height is short.
    const scaledH = Math.round(meta.height * (t.w / meta.width));
    const body = await sharp(src).resize(t.w, scaledH).png().toBuffer();

    const padTotal = t.h - scaledH;
    if (padTotal < 0) throw new Error(`${srcName}: source is too tall to pad`);
    const padTop = Math.floor(padTotal / 2);
    const padBottom = padTotal - padTop;

    /** Average colour of an edge strip — what the mirrored band settles into. */
    async function edgeColour(top, height) {
      const s = await sharp(body).extract({ left: 0, top, width: t.w, height }).stats();
      const [r, g, b] = s.channels.slice(0, 3).map((c) => Math.round(c.mean));
      return { r, g, b, alpha: 1 };
    }

    /**
     * Vertical alpha ramp, fully opaque at `opaqueEnd` and clear at the other.
     * The opaque end is the one touching the artwork, so the mirrored band is
     * an exact continuation there and has faded to the flat backing colour by
     * the time it reaches the edge of the canvas.
     */
    function fade(height, opaqueEnd) {
      const [y1, y2] = opaqueEnd === "bottom" ? [1, 0] : [0, 1];
      return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${t.w}" height="${height}">
          <defs><linearGradient id="g" x1="0" y1="${y1}" x2="0" y2="${y2}">
            <stop offset="0" stop-color="#fff" stop-opacity="1"/>
            <stop offset="1" stop-color="#fff" stop-opacity="0"/>
          </linearGradient></defs>
          <rect width="${t.w}" height="${height}" fill="url(#g)"/>
        </svg>`,
      );
    }

    /**
     * A mirrored, faded continuation of one edge, over a flat backing colour.
     *
     * The mirror is deliberately a thin sample. Mirroring the full pad height
     * reached far enough into the dashboard render to catch the top of its
     * headline and print it upside down at the top of the canvas. 96px is
     * plenty to make the seam continuous and stays inside the margin on all
     * five of these compositions.
     */
    async function band(height, edge) {
      const stripH = Math.min(height, 96);
      const from = edge === "top" ? 0 : scaledH - stripH;
      // Sample thin, then stretch across the whole band. Fading the mirror out
      // partway instead left a faint line at the point where it met the flat
      // backing; stretched, the band is one continuous ramp with no interior
      // boundary to show.
      const mirrored = await sharp(body)
        .extract({ left: 0, top: from, width: t.w, height: stripH })
        .flip()
        .resize(t.w, height)
        .composite([{ input: fade(height, edge === "top" ? "bottom" : "top"), blend: "dest-in" }])
        .png()
        .toBuffer();

      return sharp({
        create: {
          width: t.w,
          height,
          channels: 4,
          background: await edgeColour(edge === "top" ? 0 : scaledH - 24, 24),
        },
      })
        .composite([{ input: mirrored, left: 0, top: 0 }])
        .png()
        .toBuffer();
    }

    const layers = [];
    if (padTop > 0) layers.push({ input: await band(padTop, "top"), left: 0, top: 0 });
    if (padBottom > 0) {
      layers.push({ input: await band(padBottom, "bottom"), left: 0, top: padTop + scaledH });
    }

    await sharp({ create: { width: t.w, height: t.h, channels: 4, background: "#000" } })
      .composite([...layers, { input: body, left: 0, top: padTop }])
      .png()
      .toFile(path.join(outDir, outName));

    console.log(`${t.dir}/${outName}  ${meta.width}x${meta.height} -> ${t.w}x${t.h} (+${padTop}/${padBottom})`);
  }
}
