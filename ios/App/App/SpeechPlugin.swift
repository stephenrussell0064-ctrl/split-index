import Foundation
import Capacitor
import AVFoundation

/**
 * Reads short cues aloud during a GPS session — the per-kilometre split
 * callouts (see lib/native/speech.ts and lib/scoring/km-splits.ts).
 *
 * Native AVSpeechSynthesizer rather than the WebView's own speechSynthesis
 * because of where the phone is during a run: locked, in a pocket. The
 * WebView's synthesiser goes silent the moment the app leaves the
 * foreground. This one speaks on a playback audio session, which — with the
 * `audio` background mode declared in Info.plist — keeps working through the
 * lock screen.
 *
 * The session is configured to DUCK other audio rather than stop it: a
 * runner's podcast or music dips for the two seconds of the callout and
 * comes back up when it ends (the deactivation with
 * notifyOthersOnDeactivation is what hands the volume back). Stopping their
 * music every kilometre would get this feature switched off within a run.
 */
@objc(SpeechPlugin)
public class SpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "SpeechPlugin"
    public let jsName = "Speech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
    ]

    private let synthesizer = AVSpeechSynthesizer()

    public override func load() {
        synthesizer.delegate = self
    }

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("text is required")
            return
        }

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playback,
                mode: .spokenAudio,
                options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers]
            )
            try session.setActive(true)
        } catch {
            // Still try to speak — in the foreground the default session is
            // enough, and a callout that plays without ducking beats silence.
        }

        let utterance = AVSpeechUtterance(string: text)
        // The device's own language voice, so "kilometre" is pronounced the
        // way the athlete's phone already talks to them.
        utterance.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
        synthesizer.speak(utterance)
        call.resolve()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        releaseAudioSessionIfIdle()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        releaseAudioSessionIfIdle()
    }

    /// Hands the audio route back to whatever was playing. Only once nothing
    /// else is queued, so two callouts back to back don't un-duck between them.
    private func releaseAudioSessionIfIdle() {
        guard !synthesizer.isSpeaking else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
