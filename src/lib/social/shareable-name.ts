/**
 * The athlete's name, as it may appear on a shareable image.
 *
 * Two guards, both because this output leaves the app. `display_name` has no
 * database constraint and the only length check on it is client-side, so a row
 * written any other way reaches this card unbounded and overflows a fixed-size
 * PNG. And a name is never allowed to be an email address here: the field used
 * to be populated with one at onboarding, so rows created before that was
 * fixed still hold them, and this image is made to be posted publicly.
 */
/**
 * A stored `display_name`, or null when it must not be shown to other people.
 *
 * The one rule: it is never an email address. Onboarding used to write
 * `user.email` into this field for every email/password signup, so rows
 * created before that was fixed still hold them — and every render site treats
 * `display_name` as the athlete's public name. Returning null lets each of
 * those sites use the fallback it already has, which is the username the
 * athlete chose themselves.
 */
export function publicDisplayName(displayName: string | null | undefined): string | null {
  const name = displayName?.trim();
  if (!name || name.includes("@")) return null;
  return name;
}

export function shareableAthleteName(
  displayName: string | null | undefined,
  username: string | null | undefined
): string {
  const usable = publicDisplayName(displayName) ?? username?.trim();
  if (!usable) return "This athlete";
  return usable.length > 32 ? `${usable.slice(0, 31)}\u2026` : usable;
}
