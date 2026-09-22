// Builds the captioned App Store screenshots from the captures in ./source.
//
//   node docs/pre-launch/app-store-screenshots/make-shots.mjs
//
// Writes 1-index.png, 2-interference.png and 3-lab.png next to this file. The
// numbers in the output names are the slot each one is meant to occupy in App
// Store Connect — see README.md for why the order matters more than the art.
import sharp from "sharp";
import path from "node:path";

// Output at 1284x2778 — the exact size of the five assets App Store Connect has
// already accepted for this app. Anything else means upscaling a 1284-wide
// source, or re-picking a display size, and neither buys anything.
const W = 1284;
const H = 2778;

const BG = "#000000";
const GREEN = "#3AF07B";
const DIR = path.resolve(import.meta.dirname, "source");
const OUT = import.meta.dirname;

const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";

// Every crop ends on a content boundary rather than at a fixed height: the tab
// bar and any half-cut card below it are what make a screenshot look scraped
// instead of designed. The interference crop also starts low, because the top
// of that capture has a card scrolled under the status bar.
const SHOTS = [
  {
    out: "1-index.png",
    src: "01dashboard.png",
    // Opens on the score card, not the greeting row above it: that row reads
    // "Hi, demo_masters_hybrid" with a truncated subtitle, which advertises the
    // demo account rather than the product.
    crop: { top: 400, height: 1425 }, // score card through the 1RM block
    eyebrow: "SPLIT INDEX",
    lines: ["Your lifting and your running", "in one number"],
  },
  {
    out: "2-interference.png",
    src: "02interference.png",
    crop: { top: 405, height: 1595 }, // ends after the "11 qualifying sessions" note
    eyebrow: "INTERFERENCE RADAR",
    lines: ["See what leg day does", "to your running"],
  },
  {
    out: "3-lab.png",
    src: "04lab.png",
    crop: { top: 850, height: 1625 }, // opens on the index, ends after the deadlift bar
    eyebrow: "THE LAB",
    lines: ["Every lift scored,", "bodyweight-adjusted"],
  },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The caption block is at a fixed position in all three, so the headline does
// not jump as the reader swipes the carousel. The crops differ in height, so
// each panel is centred in the space underneath and the leftover black splits
// evenly above and below it.
const PANEL_W = 1170;
const BOX_TOP = 530;
const BOX_BOTTOM = H - 110;
const RADIUS = 46;

function captionSvg({ eyebrow, lines }) {
  const headline = lines
    // 82px, not 94: the longest headline set 1202px wide at 94 and all but
    // touched both edges of a 1284px canvas.
    .map((l, i) => `<text x="${W / 2}" y="${322 + i * 104}" text-anchor="middle"
        font-family="${FONT}" font-size="82" font-weight="700"
        fill="#FFFFFF" letter-spacing="-2">${esc(l)}</text>`)
    .join("\n");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <text x="${W / 2}" y="205" text-anchor="middle"
      font-family="${FONT}" font-size="40" font-weight="700"
      fill="${GREEN}" letter-spacing="7">${esc(eyebrow)}</text>
    ${headline}
  </svg>`);
}

function roundedMask(w, h) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/>
    </svg>`,
  );
}

function hairline(w, h) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${RADIUS}" ry="${RADIUS}"
        fill="none" stroke="${GREEN}" stroke-opacity="0.32" stroke-width="2.5"/>
    </svg>`,
  );
}

for (const shot of SHOTS) {
  const cropped = sharp(path.join(DIR, shot.src)).extract({
    left: 0,
    top: shot.crop.top,
    width: W,
    height: shot.crop.height,
  });

  const panelW = PANEL_W;
  const panelH = Math.round(shot.crop.height * (PANEL_W / W));

  const panel = await cropped
    .resize(panelW, panelH)
    // One call: sharp applies these in order, and a second .composite() would
    // replace the first rather than stack on it.
    .composite([
      { input: roundedMask(panelW, panelH), blend: "dest-in" },
      { input: hairline(panelW, panelH), blend: "over" },
    ])
    .png()
    .toBuffer();

  await sharp({
    create: { width: W, height: H, channels: 4, background: BG },
  })
    .composite([
      {
        input: panel,
        left: Math.round((W - panelW) / 2),
        top: Math.round(BOX_TOP + (BOX_BOTTOM - BOX_TOP - panelH) / 2),
      },
      { input: captionSvg(shot), left: 0, top: 0 },
    ])
    .png()
    .toFile(path.join(OUT, shot.out));

  console.log(shot.out, `${panelW}x${panelH} panel`);
}
