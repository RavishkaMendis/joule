// ═══════════════════════════════════════════════════════════════════════
// MEDIA → BASE64 HELPERS
//
// `expo-camera`'s takePictureAsync({ base64: true }) and
// `expo-image-picker`'s launch*Async({ base64: true }) both hand back
// base64 directly, so no file read is needed for those. The one place we
// still need to read bytes off disk is the `expo-audio` recording, which
// only exposes a file `uri` — `expo-file-system`'s new `File` class
// (`File.base64()`) covers that without reaching for the deprecated
// `readAsStringAsync` free function, which throws at runtime in this
// expo-file-system version when imported from the non-legacy entrypoint.
// ═══════════════════════════════════════════════════════════════════════

import { File } from 'expo-file-system';

/** Reads a local file URI (e.g. an expo-audio recording) and returns its base64-encoded bytes. */
export async function readFileAsBase64(uri: string): Promise<string> {
  const file = new File(uri);
  return file.base64();
}
