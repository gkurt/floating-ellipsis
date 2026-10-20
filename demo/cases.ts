import { elide } from '#src/index.ts';

// Claude Code's "Background tasks" panel, with the commands one session ran.
// Every command starts in the session's folder, so the panel cuts each one
// to the same `cd "S:/Work/Personal/lab/floating-e…`.

const folder = 'S:/Work/Personal/lab/floating-ellipsis';
const cd = `cd "${folder}" && `;

interface Task {
  command: string;
  meta: string;
}

const running: Task = {
  command: `${cd}rm -rf out/video/stills out/video/sheets && node scripts/video.ts > /dev/null && node scripts/video.ts --video advanced > /dev/null && for f in out/video/floating-ellipsis.mp4 out/video/floating-ellipsis-advanced.mp4; do ffprobe -v error -show_entries format=duration -of csv=p=0 $f; done`,
  meta: '2h 39m 19s',
};

const finished: Task[] = [
  {
    command: `${cd}sed -i "s#const clipboard = el('p', 'clipboard', '<span class=\\"label\\">Copied</span><span class=\\"text\\"></span>');#const clipboard = el('p', 'clipboard', '<span class=\\"label\\">Copied</span><span class=\\"text\\">\\&nbsp;</span>');#" demo/video-advanced.ts && grep -n "class=\\"clipboard\\|'clipboard'" demo/video-advanced.ts && node scripts/video.ts --video advanced --scene 2 --stills 250 --until 7500 > /dev/null 2>&1; ls out/video/stills | head -1`,
    meta: '6s',
  },
  {
    command: `${cd}node scripts/video.ts --video advanced --scene 2 --stills 500 --until 11000 > /dev/null 2>&1; cd out/video && rm -rf sheets && mkdir sheets && i=0; for f in stills/*.png; do printf -v n "%04d" $i; cp "$f" "seq_$n.png"; i=$((i+1)); done; ffmpeg -loglevel error -i 'seq_%04d.png' -vf "scale=640:360,tile=4x3:padding=4" sheets/s%02d.png && rm seq_*.png && ls sheets`,
    meta: '9s',
  },
  {
    command: `${cd}cat >> demo/video.css <<'EOF' /* What the clipboard got from a selection across short forms and an ellipsis. */ .clipboard { display: flex; align-items: baseline; gap: 16px; } EOF bun run fix 2>&1 | grep -E "demo/video" ; bun typecheck 2>&1 | tail -2`,
    meta: '5s',
  },
  {
    command: `${cd}node scripts/video.ts --video advanced > /dev/null 2>&1 && echo second-ok && cd out/video && ffmpeg -loglevel error -y -ss 20 -t 12 -i floating-ellipsis.mp4 -vf "fps=1,scale=640:360,tile=4x3:padding=4" -frames:v 1 c1.png && echo ok`,
    meta: 'Stopped',
  },
];

const svg = (body: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const icons = {
  trash: svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>'),
  expand: svg('<path d="M9.5 3H13v3.5M13 3 9 7M6.5 13H3V9.5M3 13l4-4"/>'),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  stop: svg('<rect x="4.5" y="4.5" width="7" height="7" rx="1"/>', 12),
  chevron: svg('<path d="m6 4 4 4-4 4"/>', 14),
  down: svg('<path d="m4 6 4 4 4-4"/>', 12),
};

function panel(root: HTMLElement): HTMLElement[] {
  const row = (task: Task, end: string) =>
    `<li><span class="label">${escape(task.command)}</span><span class="meta">${task.meta}</span><span class="end">${end}</span></li>`;
  root.innerHTML = `
    <div class="head"><h2>Background tasks</h2>
      <span class="icon">${icons.trash}</span><span class="icon">${icons.expand}</span><span class="icon">${icons.close}</span>
    </div>
    <h3 class="section">Running</h3>
    <ul class="rows">${row(running, icons.stop)}</ul>
    <h3 class="section">Finished ${finished.length} ${icons.down}</h3>
    <ul class="rows">${finished.map((task) => row(task, icons.chevron)).join('')}</ul>`;
  return [...root.querySelectorAll<HTMLElement>('.label')];
}

function escape(text: string): string {
  const span = document.createElement('span');
  span.textContent = text;
  return span.innerHTML;
}

panel(document.querySelector<HTMLElement>('#before')!);

// The folder is the same in every command, the session's project, so it shows
// short, as a chip, before the command after it is truncated.
const quoted = `"${folder}"`;
for (const label of panel(document.querySelector<HTMLElement>('#after')!)) {
  elide(label, {
    keep: { match: quoted, class: 'folder' },
    shorten: { match: quoted, to: '\u{1F5C0} Project' },
    title: true,
  });
}
