import { registerPlugin } from "@capacitor/core";
import { isNativePlatform, getNativePlatform } from "./platform";

interface SpeechPlugin {
  speak(options: { text: string }): Promise<void>;
}

/**
 * Backed by ios/App/App/SpeechPlugin.swift — same local-plugin pattern as
 * step-cadence.ts (registered explicitly in MainViewController's
 * capacitorDidLoad(), not relying on Capacitor's auto-discovery).
 *
 * Native rather than the WebView's own `speechSynthesis` because of where a
 * running phone is: locked, in a pocket or an armband. The WebView's
 * synthesiser is silenced the moment the app leaves the foreground, so the
 * kilometre callouts it exists for would only ever be heard by someone
 * staring at the screen. AVSpeechSynthesizer on an active playback audio
 * session keeps speaking through the lock screen (with the `audio`
 * background mode declared in Info.plist), ducks whatever music or podcast is
 * playing while it talks, and hands the volume back when it finishes.
 */
const Speech = registerPlugin<SpeechPlugin>("Speech");

/**
 * Reads `text` aloud. Never throws and never blocks: a callout that cannot
 * be spoken (no native plugin on this build, a browser without a
 * synthesiser) is simply not spoken, because nothing about the run depends
 * on it being heard.
 */
export async function speak(text: string): Promise<void> {
  if (isNativePlatform() && getNativePlatform() === "ios") {
    try {
      await Speech.speak({ text });
      return;
    } catch {
      // An older native build without the plugin registered — fall through
      // to the WebView synthesiser, which at least works in the foreground.
    }
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch {
      // Not supported here; nothing to do.
    }
  }
}
