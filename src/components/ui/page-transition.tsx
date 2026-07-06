"use client";

import { motion, useReducedMotion } from "framer-motion";

const spring = { type: "spring" as const, stiffness: 400, damping: 30 };

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
  stagger?: boolean;
}

export function PageTransition({
  children,
  className,
  stagger = false,
}: PageTransitionProps) {
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className={className}
    >
      {stagger ? (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.05 } },
          }}
        >
          {children}
        </motion.div>
      ) : (
        children
      )}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0, transition: spring },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
