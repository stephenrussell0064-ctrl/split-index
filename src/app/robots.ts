import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/app-url";

export default function robots(): MetadataRoute.Robots {
  const appUrl = getAppUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/dashboard",
        "/onboarding",
        "/activities",
        "/analytics",
        "/cardio",
        "/gym",
        "/settings",
        "/profile",
        "/social",
        "/reset-password",
        "/api/",
      ],
    },
    sitemap: `${appUrl}/sitemap.xml`,
  };
}
