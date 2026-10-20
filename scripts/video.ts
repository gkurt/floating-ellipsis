/**
 * Records one of the demo's videos (`demo/video.html`, or
 * `demo/video-<name>.html`) frame by frame into an MP4 for sharing (H.264,
 * 1920×1080, 60fps). The page's clock is driven from here, one frame at a
 * time, so every frame is complete however long it takes to capture.
 *
 *   node scripts/video.ts                     → out/video/floating-ellipsis.mp4
 *   node scripts/video.ts --video advanced    → out/video/floating-ellipsis-advanced.mp4
 *   node scripts/video.ts --scene 7           start at scene 7
 *   node scripts/video.ts --stills 250        PNGs every 250ms in out/video/stills, no video
 *   node scripts/video.ts --until 4000        stop after 4s
 *
 * Needs ffmpeg on the PATH, and Chromium for Playwright.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const { values } = parseArgs({
  options: {
    video: { type: 'string' },
    scene: { type: 'string', default: '0' },
    stills: { type: 'string' },
    until: { type: 'string' },
    fps: { type: 'string', default: '60' },
    out: { type: 'string' },
  },
});
const name = values.video ? `-${values.video}` : '';
const out = values.out ?? `out/video/floating-ellipsis${name}.mp4`;
const fps = Number(values.fps);
const until = values.until ? Number(values.until) : Infinity;
const stills = values.stills ? Number(values.stills) : null;

const server = await createServer({ root: 'demo', logLevel: 'warn', server: { port: 4190 } });
await server.listen();
// A real device scale, not `deviceScaleFactor`: emulation paints boxes on
// whole CSS pixels, so drawn dots a pixel and a half wide come out uneven.
const browser = await chromium.launch({ args: ['--force-device-scale-factor=1.5', '--window-size=1280,720'] });
const page = await browser.newPage({ viewport: null });
page.on('pageerror', (e) => console.error('page error:', e));
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
await page.clock.install();
await page.goto(`http://localhost:4190/video${name}.html?record&scene=${values.scene}`);
await page.waitForFunction(() => 'videoReady' in window);
const cdp = await page.context().newCDPSession(page);
await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
// Not awaited: it plays as the clock runs.
await page.evaluate(() => void (window as unknown as { videoPlay: () => Promise<void> }).videoPlay());

const dir = 'out/video/stills';
if (stills !== null) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}
await mkdir('out/video', { recursive: true });
const ffmpeg =
  stills === null
    ? spawn(
        'ffmpeg',
        // PNG frames in, H.264 out as X/Twitter takes it.
        `-y -loglevel error -f image2pipe -framerate ${fps} -c:v png -i - -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -profile:v high -movflags +faststart`
          .split(' ')
          .concat(out),
        { stdio: ['pipe', 'inherit', 'inherit'] },
      )
    : null;

const started = performance.now();
let elapsed = 0;
for (let i = 0; ; i++) {
  const time = (i * 1000) / fps;
  if (time > until) break;
  const ticks = Math.round(time) - Math.round(elapsed);
  elapsed = time;
  if (ticks > 0) await page.clock.runFor(ticks);
  const done = await page.evaluate(async () => {
    const w = window as unknown as { videoFrame: () => Promise<void>; videoDone?: boolean };
    await w.videoFrame();
    return w.videoDone === true;
  });
  if (done) break;
  const keep = stills === null || i % Math.max(1, Math.round((stills * fps) / 1000)) === 0;
  if (!keep) continue;
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 } });
  const png = Buffer.from(data, 'base64');
  if (ffmpeg) {
    if (!ffmpeg.stdin.write(png)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
  } else {
    await writeFile(`${dir}/${String(Math.round(time)).padStart(6, '0')}.png`, png);
  }
  if (i % fps === 0)
    process.stdout.write(`\r${(time / 1000).toFixed(0)}s of video in ${((performance.now() - started) / 1000).toFixed(0)}s`);
}

if (ffmpeg) {
  ffmpeg.stdin.end();
  await new Promise((resolve) => ffmpeg.on('close', resolve));
}
console.log(`\n${stills === null ? out : dir}`);
await browser.close();
await server.close();
