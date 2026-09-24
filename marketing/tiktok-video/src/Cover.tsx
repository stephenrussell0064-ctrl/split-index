/**
 * Cover still: the score-reveal moment with the hook text over it.
 * 1080×1920 PNG, one per hook variant.
 */
import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { z } from "zod";
import { RevealScene } from "./scenes/Reveal";
import { KineticText } from "./components/KineticText";
import { AberrationDefs, Grain, Vignette } from "./fx";
import { HOOKS } from "./hooks";
import { REVEAL } from "./timing";
import { C } from "./theme";

export const coverSchema = z.object({ hook: z.enum(["A", "B", "C", "D", "E"]) });

export const Cover: React.FC<z.infer<typeof coverSchema>> = ({ hook }) => {
  const h = HOOKS[hook];
  const words = h.lines.reduce((n, l) => n + l.length, 0);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AberrationDefs />
      {/* a Still renders frame 0; a negative `from` shows the scene at the reveal moment */}
      <Sequence from={-(REVEAL.badgeSlam + 16)}>
        <RevealScene coverMode captions={false} />
      </Sequence>
      {/* the hook, fully landed, in the top band */}
      <Sequence from={-60}>
        <KineticText lines={h.lines} size={words > 9 ? 78 : words > 7 ? 86 : 96} vAlign="top" inset={20} />
      </Sequence>
      <Vignette strength={0.5} />
      <Grain opacity={0.07} />
    </AbsoluteFill>
  );
};
