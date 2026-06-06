/**
 * compositor.ts — v0.10 Overlay Text System
 *
 * Renders text onto a pre-recorded background video using ffmpeg drawtext,
 * eliminating the need to re-render via Chromium when only text changes.
 *
 * Flow:
 *   1. renderBackground() → render template with [data-var] hidden → .webm
 *   2. extractTextOverlays() → collect positions from rendered page → JSON
 *   3. applyTextOverlay() → ffmpeg drawtext onto background → new MP4
 *
 * Step 1 requires Chromium (one-time cost ~5-15s).
 * Steps 2 → 3 are pure ffmpeg (~0.1-0.5s per text change).
 */

// import { HtmlVideoError } from './errors.js';
// import type { Project } from './types/index.js';

export interface TextOverlayDef {
  variable: string;
  x: number;         // 0-1 relative position
  y: number;
  fontSize: number;
  fontColor: string;  // hex or named color
  fontFile: string;   // font family/source for ffmpeg drawtext
  align: 'left' | 'center' | 'right';
}

/**
 * Apply text overlays onto a background video using ffmpeg drawtext.
 * Returns the output path of the rendered video.
 *
 * Combines all text overlays into a single drawtext filter chain,
 * so ffmpeg only processes the video once regardless of text count.
 */
export async function applyTextOverlay(args: {
  backgroundPath: string;
  outputPath: string;
  variables: Record<string, unknown>;
  overlays: TextOverlayDef[];
  durationSec?: number;
  fps?: number;
}): Promise<string> {
  const { backgroundPath, outputPath, variables, overlays, durationSec, fps } = args;

  // Write overlay texts to temp files, then reference via textfile= in
  // drawtext filters. This avoids ffmpeg filter-graph injection entirely
  // (special chars like : ' \ { } in text values are never parsed).
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const textDir = await mkdtemp(join(tmpdir(), 'hv-overlay-'));
  const drawtextFilters: string[] = [];
  const textFiles: string[] = [];

  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i]!;
    const text = String(variables[o.variable] ?? '');
    if (!text) continue; // skip empty variables

    // Write text to temp file — ffmpeg textfile= reads it safely
    const textFilePath = join(textDir, `text-${i}.txt`);
    await writeFile(textFilePath, text, 'utf8');
    textFiles.push(textFilePath);

    const px = o.align === 'center'
      ? `(main_w-text_w)/2`
      : `(main_w*${o.x})`;
    const py = o.align === 'center'
      ? `(main_h*${o.y})`
      : `(main_h*${o.y})`;

    const filter = `drawtext=textfile=${textFilePath}:fontfile=${o.fontFile}:fontsize=${o.fontSize}:fontcolor=${o.fontColor}:x=${px}:y=${py}:box=1:boxcolor=black@0.3:boxborderw=6`;
    drawtextFilters.push(filter);
  }

  // Clean up text files after render completes
  const cleanupTextFiles = () => {
    import('node:fs/promises').then(m => {
      m.rm(textDir, { recursive: true, force: true }).catch(() => {});
    }).catch(() => {});
  };

  if (drawtextFilters.length === 0) {
    // No text to overlay → just copy the background as-is
    const { spawn } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      const p = spawn('ffmpeg', [
        '-y', '-i', backgroundPath,
        '-c', 'copy',
        ...(durationSec ? ['-t', String(durationSec)] : []),
        outputPath,
      ]);
      p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
      p.on('error', (e) => reject(e));
    });
    cleanupTextFiles();
  } else {
    // Apply drawtext overlays (text= is no longer used — textfile= prevents injection)
    const { spawn } = await import('node:child_process');
    try {
      await new Promise<void>((resolve, reject) => {
        const p = spawn('ffmpeg', [
          '-y', '-i', backgroundPath,
          '-vf', drawtextFilters.join(','),
          '-c:a', 'copy',
          '-r', String(fps ?? 60),
          ...(durationSec ? ['-t', String(durationSec)] : []),
          '-pix_fmt', 'yuv420p',
          outputPath,
        ]);
        p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
        p.on('error', (e) => reject(e));
      });
    } finally {
      cleanupTextFiles();
    }
  }

  return outputPath;
}

/**
 * Create a version of the HTML that hides all [data-var] elements,
 * so Chromium renders the background-only version.
 */
export function stripTextMarkers(html: string): string {
  // Add CSS to hide data-var elements before rendering
  return html.replace('</head>', `<style>
/* Overlay text system: hide all variable-driven elements
   so Chromium records the background layer without text.
   Text is re-added via ffmpeg drawtext overlay. */
[data-var] { visibility: hidden !important; }
</style>\n</head>`);
}
