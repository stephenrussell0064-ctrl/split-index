/** Cover still for the real-footage film: the real dashboard at 75.9 with the hook over it. */
import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { z } from "zod";
import { RevealReal, REVEAL_REAL } from "./RealAd";
import { KineticText } from "../components/KineticText";
import { AberrationDefs, Grain, Vignette } from "../fx";
import { REAL_HOOKS } from "./hooks";
import { C } from "../theme";

export const realCoverSchema = z.object({ hook: z.enum(["A", "B", "C", "D", "E"]) });

export const RealCover: React.FC<z.infer<typeof realCoverSchema>> = ({ hook }) => {
  const h = REAL_HOOKS[hook];
  const words = h.lines.reduce((n, l) => n + l.length, 0);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AberrationDefs />
      <Sequence from={-(REVEAL_REAL.dashboard + 30)}>
        <RevealReal coverMode captions={false} />
      </Sequence>
      <Sequence from={-60}>
        <KineticText lines={h.lines} size={words > 9 ? 78 : words > 7 ? 86 : 96} vAlign="top" inset={20} />
      </Sequence>
      <Vignette strength={0.5} />
      <Grain opacity={0.07} />
    </AbsoluteFill>
  );
};
