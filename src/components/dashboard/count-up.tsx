"use client";

import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "motion/react";

interface CountUpProps {
  value: number;
  duration?: number;
  delay?: number;
  format?: (value: number) => string;
  className?: string;
}

const defaultFormat = (v: number) => Math.round(v).toLocaleString();

export function CountUp({
  value,
  duration = 1.4,
  delay = 0,
  format = defaultFormat,
  className,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (reducedMotion) {
      node.textContent = format(value);
      return;
    }

    const controls = animate(0, value, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        node.textContent = format(v);
      },
    });
    return () => controls.stop();
  }, [value, duration, delay, format, reducedMotion]);

  return (
    <span ref={ref} className={className}>
      {format(0)}
    </span>
  );
}
