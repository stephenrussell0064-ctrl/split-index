"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

export function NotificationBell({ className }: { className?: string }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<
    { id: string; title: string; body: string; read: boolean; created_at: string }[]
  >([]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data } = await supabase
        .from("notifications")
        .select("id, title, body, read, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8);

      if (cancelled) return;
      setItems(data ?? []);
      setUnread((data ?? []).filter((n) => !n.read).length);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const markAllRead = async () => {
    const unreadIds = items.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;

    const supabase = createClient();
    await supabase
      .from("notifications")
      .update({ read: true })
      .in("id", unreadIds);

    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
  };

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unread > 0) void markAllRead();
        }}
        className="relative rounded-xl p-2 text-muted transition-colors hover:bg-white/5 hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-2xl border border-white/10 glass-strong p-2 shadow-xl">
            <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted">
              Notifications
            </p>
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted">
                You&apos;re all caught up
              </p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {items.map((n) => (
                  <li
                    key={n.id}
                    className={cn(
                      "rounded-xl px-3 py-2.5",
                      !n.read && "bg-accent/10"
                    )}
                  >
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/social"
              onClick={() => setOpen(false)}
              className="mt-2 block rounded-xl px-3 py-2 text-center text-xs text-accent hover:bg-white/5"
            >
              View leaderboards →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
