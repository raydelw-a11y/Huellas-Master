// Viral Clips — where the faces are in the opening seconds of a clip, so the big title can start below them.
// Faces are found with the Mac's own detector (Vision framework) through a tiny Swift program that is
// compiled once and kept next to the viral clips' data. If Swift or the detector is not available, no faces
// are reported and the title simply stays where it always is.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import type { ViralFaceBox } from '../src/utils/viralTitle';

const FACEBOXES_SWIFT = `import Foundation
import Vision
import ImageIO
import CoreGraphics

// Prints, for every image path given, the faces found in it: boxes as fractions of the image,
// measured from the top-left corner.
var out: [[String: Any]] = []
for path in CommandLine.arguments.dropFirst() {
  var faces: [[String: Double]] = []
  let url = URL(fileURLWithPath: path)
  if let src = CGImageSourceCreateWithURL(url as CFURL, nil),
     let img = CGImageSourceCreateImageAtIndex(src, 0, nil) {
    let req = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cgImage: img, options: [:])
    try? handler.perform([req])
    for f in (req.results ?? []) {
      let b = f.boundingBox
      faces.append([
        "x": Double(b.minX), "y": Double(1 - b.maxY),
        "w": Double(b.width), "h": Double(b.height),
        "c": Double(f.confidence),
      ])
    }
  }
  out.append(["path": path, "faces": faces])
}
if let data = try? JSONSerialization.data(withJSONObject: out),
   let text = String(data: data, encoding: .utf8) {
  print(text)
}
`;

const run = (bin: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });

let detectorPromise: Promise<string | null> | null = null;

/** Path of the compiled detector (compiles it the first time, about half a minute); null if it cannot be built. */
export function ensureViralFaceDetector(binDir: string): Promise<string | null> {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    try {
      if (process.platform !== 'darwin') return null;
      const hash = crypto.createHash('sha1').update(FACEBOXES_SWIFT).digest('hex').slice(0, 10);
      const binPath = path.join(binDir, `faceboxes-${hash}`);
      if (fs.existsSync(binPath)) return binPath;
      fs.mkdirSync(binDir, { recursive: true });
      const srcPath = path.join(binDir, `faceboxes-${hash}.swift`);
      fs.writeFileSync(srcPath, FACEBOXES_SWIFT, 'utf8');
      const tmpOut = `${binPath}.building`;
      const built = await run('/usr/bin/swiftc', ['-O', '-o', tmpOut, srcPath], 240000);
      if (!built.ok || !fs.existsSync(tmpOut)) {
        console.warn('[ViralClips] No se pudo preparar el detector de caras:', built.stderr.slice(-300));
        return null;
      }
      fs.renameSync(tmpOut, binPath);
      return binPath;
    } catch (e) {
      console.warn('[ViralClips] No se pudo preparar el detector de caras:', e);
      return null;
    }
  })();
  // A failed build is tried again on the next request instead of being remembered forever
  detectorPromise.then((p) => {
    if (!p) detectorPromise = null;
  });
  return detectorPromise;
}

/**
 * Faces found in a few frames of the video. `samples` gives, for each frame, the second to read from the
 * source file and the filter that turns it into the clip's vertical picture (small, 360×640 is plenty).
 * Never throws: any failure means "no faces".
 */
export async function detectViralFaces(opts: {
  ffmpegBin: string;
  binDir: string;
  sourceVideoPath: string;
  samples: Array<{ sourceSec: number; vf: string }>;
}): Promise<ViralFaceBox[]> {
  const frames: string[] = [];
  try {
    const detector = await ensureViralFaceDetector(opts.binDir);
    if (!detector || opts.samples.length === 0) return [];
    const stamp = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    const results = await Promise.all(
      opts.samples.map(async (s, i) => {
        const out = path.join(os.tmpdir(), `viral_face_${stamp}_${i}.jpg`);
        frames.push(out);
        const r = await run(
          opts.ffmpegBin,
          ['-hide_banner', '-v', 'error', '-y', '-ss', Math.max(0, s.sourceSec).toFixed(3), '-i', opts.sourceVideoPath, '-frames:v', '1', '-vf', s.vf, '-q:v', '4', out],
          45000
        );
        return r.ok && fs.existsSync(out) ? out : '';
      })
    );
    const ready = results.filter(Boolean);
    if (ready.length === 0) return [];
    const det = await run(detector, ready, 60000);
    if (!det.ok) return [];
    const parsed = JSON.parse(det.stdout.trim() || '[]');
    const faces: ViralFaceBox[] = [];
    for (const item of Array.isArray(parsed) ? parsed : []) {
      for (const f of Array.isArray(item?.faces) ? item.faces : []) {
        const box = { x: Number(f.x), y: Number(f.y), w: Number(f.w), h: Number(f.h) };
        if ([box.x, box.y, box.w, box.h].every((n) => Number.isFinite(n)) && Number(f.c) >= 0.5 && box.w > 0 && box.h > 0) {
          faces.push({
            x: Number(box.x.toFixed(4)),
            y: Number(box.y.toFixed(4)),
            w: Number(box.w.toFixed(4)),
            h: Number(box.h.toFixed(4)),
          });
        }
      }
    }
    return faces;
  } catch (e) {
    console.warn('[ViralClips] Detección de caras no disponible:', e);
    return [];
  } finally {
    for (const f of frames) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
  }
}
