/**
 * Remotion CLI config for the Split Index TikTok launch ad.
 *
 * Note: when using the Node.js APIs, this file does not apply — pass options
 * directly to the APIs instead. The render scripts in ./scripts use the CLI, so
 * this file is what governs them.
 */
import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(100);
Config.setOverwriteOutput(true);

// The grade (bloom, chromatic aberration, motion blur trails) is CSS/SVG and
// the phone is CSS 3D, so no WebGL is strictly required — but the 3D tilt
// benefits from hardware compositing and ANGLE is the renderer that behaves
// the same on macOS and Linux headless Chrome.
Config.setChromiumOpenGlRenderer("angle");

// Master encode: H.264, CRF 16 (visually lossless for a 1080x1920 30fps
// social upload — TikTok re-encodes anyway, so we hand it the best source).
Config.setCodec("h264");
Config.setCrf(16);
Config.setPixelFormat("yuv420p");
