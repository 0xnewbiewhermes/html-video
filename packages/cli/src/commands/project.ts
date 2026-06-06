/**
 * Project-centric CLI commands per RFC-05.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CliContext } from '../context.js';
import { fail, ok, progress } from '../output.js';

export async function projectCreate(
  ctx: CliContext,
  opts: { name: string; intent?: string; aspect?: string; commercial?: boolean },
): Promise<void> {
  if (!opts.name) fail('invalid-input', '--name required');
  const project = await ctx.orchestrator.create({
    name: opts.name,
    ...(opts.intent !== undefined && { intent: opts.intent }),
    preferences: {
      ...(opts.aspect !== undefined && { aspect: opts.aspect }),
      ...(opts.commercial !== undefined && { commercial: opts.commercial }),
    },
  });
  ok({ project_id: project.id, name: project.name, status: project.status });
}

export async function projectList(ctx: CliContext): Promise<void> {
  const projects = await ctx.orchestrator.list();
  ok({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      template_id: p.templateId,
      asset_count: p.assets.length,
      status: p.status,
      updated_at: p.updatedAt,
    })),
  });
}

export async function projectShow(ctx: CliContext, id: string): Promise<void> {
  const project = await ctx.orchestrator.load(id);
  ok({ project });
}

export async function projectDelete(ctx: CliContext, id: string): Promise<void> {
  await ctx.orchestrator.remove(id);
  ok({ project_id: id, deleted: true });
}

export async function projectAddAsset(
  ctx: CliContext,
  id: string,
  opts: {
    file?: string;
    inlineText?: string;
    inlineDataFile?: string;
    caption?: string;
  },
): Promise<void> {
  let project;
  if (opts.file) {
    const f = resolve(opts.file);
    if (!existsSync(f)) fail('asset-not-found', `File not found: ${f}`);
    project = await ctx.orchestrator.addFileAsset(id, f, opts.caption);
  } else if (opts.inlineText) {
    project = await ctx.orchestrator.addInlineAsset(id, opts.inlineText, 'text', opts.caption);
  } else if (opts.inlineDataFile) {
    const f = resolve(opts.inlineDataFile);
    if (!existsSync(f)) fail('asset-not-found', `Data file not found: ${f}`);
    const content = await readFile(f, 'utf8');
    project = await ctx.orchestrator.addInlineAsset(id, content, 'data', opts.caption);
  } else {
    fail('invalid-input', 'Provide one of --file, --inline-text, --inline-data-file');
  }
  ok({
    project_id: project!.id,
    asset_count: project!.assets.length,
    last_added: project!.assets[project!.assets.length - 1],
  });
}

export async function projectRemoveAsset(
  ctx: CliContext,
  id: string,
  assetId: string,
): Promise<void> {
  const project = await ctx.orchestrator.removeAsset(id, assetId);
  ok({ project_id: project.id, asset_count: project.assets.length });
}

export async function projectSetTemplate(
  ctx: CliContext,
  id: string,
  templateId: string,
): Promise<void> {
  const project = await ctx.orchestrator.setTemplate(id, templateId);
  ok({
    project_id: project.id,
    template_id: project.templateId,
    variables: project.variables,
  });
}

export async function projectSetVar(
  ctx: CliContext,
  id: string,
  key: string,
  valueJson: string,
): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(valueJson);
  } catch {
    // not JSON → keep raw string
    value = valueJson;
  }
  const project = await ctx.orchestrator.setVariable(id, key, value);
  ok({ project_id: project.id, variables: project.variables });
}

export async function projectSetVars(
  ctx: CliContext,
  id: string,
  varsFile: string,
): Promise<void> {
  const f = resolve(varsFile);
  if (!existsSync(f)) fail('invalid-input', `vars file not found: ${f}`);
  const vars = JSON.parse(await readFile(f, 'utf8')) as Record<string, unknown>;
  const project = await ctx.orchestrator.setVariables(id, vars);
  ok({ project_id: project.id, variables: project.variables });
}

export async function projectPreview(ctx: CliContext, id: string): Promise<void> {
  const { project, htmlPath } = await ctx.orchestrator.renderPreviewHtml(id);
  ok({
    project_id: project.id,
    html_path: htmlPath,
    poster_path: project.lastPreviewPosterPath,
    note: 'Open html_path in a browser to preview, or use `html-video studio` for full UI.',
  });
}

export async function projectRenderOverlay(ctx: CliContext, id: string, output?: string): Promise<void> {
  process.stderr.write('▸ Checking background cache...\n');
  const project = await ctx.orchestrator.load(id);
  if (!project.backgroundVideoPath) {
    process.stderr.write('▸ No cached background — rendering background (Chromium, ~15s)...\n');
    const { bgPath } = await ctx.orchestrator.renderBackground(id);
    process.stderr.write(`▸ Background cached at ${bgPath}\n`);
  }
  process.stderr.write('▸ Applying text overlay (ffmpeg, fast)...\n');
  const { outPath } = await ctx.orchestrator.renderWithOverlay(id, output);
  ok({ project_id: id, output_path: outPath, note: 'overlay render (no Chromium)' });
}

export async function projectPreviewGif(ctx: CliContext, id: string, output?: string): Promise<void> {
  const { project, gifPath } = await ctx.orchestrator.renderPreviewGif(id, output);
  ok({
    project_id: project.id,
    gif_path: gifPath,
    duration_sec: project.frames?.[0]?.durationSec ?? '?',
    note: 'Quick GIF preview (max 4s, 480p). Use `project-render` for full MP4.',
  });
}

export async function projectRender(
  ctx: CliContext,
  id: string,
  opts: { output?: string; streamProgress?: boolean },
): Promise<void> {
  const { project, outputPath } = await ctx.orchestrator.exportMp4({
    projectId: id,
    ...(opts.output !== undefined && { outputPath: resolve(opts.output) }),
    onProgress: opts.streamProgress ? (pct, stage) => progress(stage, pct) : undefined,
  });
  ok({ project_id: project.id, output_path: outputPath, status: project.status });
}

export interface GenerateFromTemplateOpts {
  frames?: Record<string, unknown>[];
  framesFile?: string;
  perFrame: number;
  output?: string;
}

export async function generateFromTemplateCli(
  ctx: CliContext,
  projectId: string,
  templateId: string,
  opts: GenerateFromTemplateOpts,
): Promise<void> {
  let frames = opts.frames;
  if (!frames && opts.framesFile) {
    const { readFile } = await import('node:fs/promises');
    frames = JSON.parse(await readFile(resolve(opts.framesFile), 'utf8'));
  }
  if (!frames || !Array.isArray(frames) || frames.length === 0) {
    fail('invalid-input', 'Provide --frames JSON or --frames-file path with a non-empty array');
  }

  process.stderr.write(`▸ ${frames.length} frames from "${templateId}"...\n`);

  const { project } = await ctx.orchestrator.generateFramesFromTemplate(
    projectId, templateId, frames, { perFrameDuration: opts.perFrame },
  );

  process.stderr.write(`▸ Exporting MP4 (${project.frames?.length ?? '?'} frames)...\n`);
  const result = await ctx.orchestrator.exportMp4({
    projectId,
    ...(opts.output !== undefined && { outputPath: resolve(opts.output) }),
    onProgress: (pct, stage) => {
      if (pct % 20 === 0 || pct === 100) progress(stage, pct);
    },
  });

  ok({
    project_id: projectId,
    output_path: result.outputPath,
    frames: project.frames?.length,
    duration_sec: result.project.frames?.reduce((s, f) => s + (f.durationSec || 0), 0) ?? 0,
    status: result.project.status,
  });
}
