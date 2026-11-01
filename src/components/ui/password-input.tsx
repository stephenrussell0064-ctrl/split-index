"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type" | "trailing">;

/**
 * A password field with a show/hide toggle (user request: "allow a button for
 * them to see their password if they wish when typing").
 *
 * Visibility is per field and starts hidden, so a confirm field can be
 * revealed on its own. The toggle is a real button with `aria-pressed`, not a
 * decorative icon, and `tabIndex={-1}` keeps it out of the tab order: the
 * athlete tabbing from password to confirm should land on confirm, and the
 * eye is still reachable by pointer and by screen-reader browse mode.
 */
export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          tabIndex={-1}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:text-foreground"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      }
    />
  );
}
