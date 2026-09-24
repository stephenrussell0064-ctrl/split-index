/**
 * Compositions.
 *
 *   SplitIndexAd          the parametrised film — set `hook` in Studio's props panel
 *   Ad-A … Ad-E           the five hook variants (silent master)
 *   AdSfx-A … AdSfx-E     the same with the sound-design track
 *   Short-A / ShortSfx-A  the 8 s cut-down of variant A
 *   Cover-A … Cover-E     1080×1920 cover stills
 *
 * `npm run compute` regenerates src/data/demo.json first; the render scripts do that for you.
 */
import React from "react";
import { Composition, Folder, Still } from "remotion";
import "./index.css";
import { Ad, AdShort, adSchema } from "./Ad";
import { Cover, coverSchema } from "./Cover";
import { HOOK_IDS } from "./hooks";
import { DURATION, FPS, HEIGHT, SHORT, WIDTH } from "./timing";
import { z } from "zod";
import { StatCard, STATCARD_DURATION } from "./formats/StatCard";
import { Quiz, QUIZ_DURATION } from "./formats/Quiz";
import { TugOfWar, TUG_DURATION } from "./formats/TugOfWar";
import { RadarExplainer, RADAR_DURATION } from "./formats/RadarExplainer";
import { TextStory, STORY_DURATION } from "./formats/TextStory";
import { MicroLoop, MICRO_DURATION } from "./formats/MicroLoop";
import type { FormatProps } from "./formats/shared";

const formatSchema = z.object({ sfx: z.boolean(), safeZone: z.boolean() });

/** The alternative formats: same numbers, same grade, different shape. */
export const FORMATS: Array<{ id: string; slug: string; component: React.FC<FormatProps>; duration: number }> = [
  { id: "StatCard", slug: "stat-card", component: StatCard, duration: STATCARD_DURATION },
  { id: "Quiz", slug: "guess-the-tier", component: Quiz, duration: QUIZ_DURATION },
  { id: "TugOfWar", slug: "the-gap", component: TugOfWar, duration: TUG_DURATION },
  { id: "RadarExplainer", slug: "radar-explainer", component: RadarExplainer, duration: RADAR_DURATION },
  { id: "TextStory", slug: "text-story", component: TextStory, duration: STORY_DURATION },
  { id: "MicroLoop", slug: "micro-loop", component: MicroLoop, duration: MICRO_DURATION },
];

const base = { fps: FPS, width: WIDTH, height: HEIGHT } as const;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="SplitIndexAd"
      component={Ad}
      durationInFrames={DURATION}
      {...base}
      schema={adSchema}
      defaultProps={{ hook: "A", safeZone: true, sfx: true }}
    />

    <Folder name="Masters-silent">
      {HOOK_IDS.map((id) => (
        <Composition key={id} id={`Ad-${id}`} component={Ad} durationInFrames={DURATION} {...base} schema={adSchema} defaultProps={{ hook: id, safeZone: false, sfx: false }} />
      ))}
    </Folder>

    <Folder name="Masters-sfx">
      {HOOK_IDS.map((id) => (
        <Composition key={id} id={`AdSfx-${id}`} component={Ad} durationInFrames={DURATION} {...base} schema={adSchema} defaultProps={{ hook: id, safeZone: false, sfx: true }} />
      ))}
    </Folder>

    <Folder name="Short">
      <Composition id="Short-A" component={AdShort} durationInFrames={SHORT.duration} {...base} schema={adSchema} defaultProps={{ hook: "A", safeZone: false, sfx: false }} />
      <Composition id="ShortSfx-A" component={AdShort} durationInFrames={SHORT.duration} {...base} schema={adSchema} defaultProps={{ hook: "A", safeZone: false, sfx: true }} />
    </Folder>

    <Folder name="Formats">
      {FORMATS.map((f) => (
        <Composition key={f.id} id={`Fmt-${f.id}`} component={f.component as unknown as React.FC<Record<string, unknown>>} durationInFrames={f.duration} {...base} schema={formatSchema} defaultProps={{ sfx: false, safeZone: true }} />
      ))}
    </Folder>
    <Folder name="Formats-sfx">
      {FORMATS.map((f) => (
        <Composition key={f.id} id={`FmtSfx-${f.id}`} component={f.component as unknown as React.FC<Record<string, unknown>>} durationInFrames={f.duration} {...base} schema={formatSchema} defaultProps={{ sfx: true, safeZone: false }} />
      ))}
    </Folder>

    <Folder name="Covers">
      {HOOK_IDS.map((id) => (
        <Still key={id} id={`Cover-${id}`} component={Cover} width={WIDTH} height={HEIGHT} schema={coverSchema} defaultProps={{ hook: id }} />
      ))}
    </Folder>
  </>
);
