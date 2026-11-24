// Viral Clips — what is in a few frames of a clip: where the faces are (so the big title and the YouTube
// notice can keep off them) and how sharp and bright each frame is (to pick the clip's cover frame).
// Faces are found with the Mac's own detector (Vision framework) through a tiny Swift program that is
// compiled once and kept next to the viral clips' data. If Swift or the detector is not available, nothing is
// reported and the title simply stays where it always is.
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

// Prints, for every image path given: the faces found in it (boxes as fractions of the image, measured
// from the top-left corner), how sharp it is (variance of its edges) and how bright (0 black - 1 white).
func sharpnessAndLuma(_ img: CGImage) -> (Double, Double) {
  let w = 180, h = 320
  var px = [UInt8](repeating: 0, count: w * h)
  let ok = px.withUnsafeMutableBytes { buf -> Bool in
    guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                              space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
    ctx.interpolationQuality = .medium
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return true
  }
  if !ok { return (0, 0) }
  var lumaSum = 0.0
  for v in px { lumaSum += Double(v) }
  var sum = 0.0, sumSq = 0.0, n = 0.0
  for y in 1..<(h - 1) {
    for x in 1..<(w - 1) {
      let i = y * w + x
      let lap = 4.0 * Double(px[i]) - Double(px[i - 1]) - Double(px[i + 1]) - Double(px[i - w]) - Double(px[i + w])
      sum += lap; sumSq += lap * lap; n += 1
    }
  }
  let mean = sum / n
  return (sumSq / n - mean * mean, lumaSum / Double(w * h) / 255.0)
}

var out: [[String: Any]] = []
for path in CommandLine.arguments.dropFirst() {
  var faces: [[String: Double]] = []
  var sharp = 0.0, luma = 0.0
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
    (sharp, luma) = sharpnessAndLuma(img)
  }
  out.append(["path": path, "faces": faces, "sharp": sharp, "luma": luma])
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

export interface ViralFrameInfo {
  faces: ViralFaceBox[];
  /** Edge variance of the frame: higher is sharper (only comparable between frames of the same clip) */
  sharp: number;
  /** Average brightness, 0 (black) to 1 (white) */
  luma: number;
  /** The frame itself as a small JPEG data URL (only when asked for) */
  thumb?: string;
}

/**
 * Looks at a few frames of the video. `samples` gives, for each frame, the second to read from the source
 * file and the filter that turns it into the clip's vertical picture (small, 360×640 is plenty).
 * The result has one entry per sample, in order (null where the frame could not be read).
 * Never throws: any failure means "nothing known".
 */
export async function analyzeViralFrames(opts: {
  ffmpegBin: string;
  binDir: string;
  sourceVideoPath: string;
  samples: Array<{ sourceSec: number; vf: string }>;
  withThumbs?: boolean;
}): Promise<Array<ViralFrameInfo | null>> {
  const frames: string[] = [];
  const empty = opts.samples.map(() => null);
  try {
    const detector = await ensureViralFaceDetector(opts.binDir);
    if (!detector || opts.samples.length === 0) return empty;
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
    if (ready.length === 0) return empty;
    const det = await run(detector, ready, 60000);
    if (!det.ok) return empty;
    const parsed = JSON.parse(det.stdout.trim() || '[]');
    const byPath = new Map<string, any>();
    for (const item of Array.isArray(parsed) ? parsed : []) byPath.set(String(item?.path || ''), item);
    return results.map((framePath) => {
      const item = framePath ? byPath.get(framePath) : null;
      if (!item) return null;
      const faces: ViralFaceBox[] = [];
      for (const f of Array.isArray(item.faces) ? item.faces : []) {
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
      const info: ViralFrameInfo = {
        faces,
        sharp: Number(item.sharp) || 0,
        luma: Number(item.luma) || 0,
      };
      if (opts.withThumbs) {
        try {
          info.thumb = `data:image/jpeg;base64,${fs.readFileSync(framePath).toString('base64')}`;
        } catch {}
      }
      return info;
    });
  } catch (e) {
    console.warn('[ViralClips] Análisis de fotogramas no disponible:', e);
    return empty;
  } finally {
    for (const f of frames) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
  }
}

/** Every face found in the sampled frames, together. */
export async function detectViralFaces(opts: {
  ffmpegBin: string;
  binDir: string;
  sourceVideoPath: string;
  samples: Array<{ sourceSec: number; vf: string }>;
}): Promise<ViralFaceBox[]> {
  const infos = await analyzeViralFrames(opts);
  return infos.flatMap((i) => (i ? i.faces : []));
}
