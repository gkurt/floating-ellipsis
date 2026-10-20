import { type ElideOptions, elide, separators } from '#src/index.ts';
import { tooltip } from '#src/tooltip.ts';

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

panel(document.querySelector<HTMLElement>('#claude-before')!);

// The folder is the same in every command, the session's project, so it shows
// short, as a chip, before the command after it is truncated.
const quoted = `"${folder}"`;
for (const label of panel(document.querySelector<HTMLElement>('#claude-after')!)) {
  elide(label, {
    keep: { match: quoted, class: 'folder' },
    shorten: { match: quoted, to: '\u{1F5C0} Project' },
    title: true,
  });
}

// ---------------------------------------------------------------------------
// GitHub's file tree in a pull request (spring-projects/spring-boot#52249).
// Folders with one folder in them merge into one row, so the rows that tell
// the main code from its tests, and one class from another, are cut alike:
// `main/java/org/springframework/b…`, `ReactiveOAuth2ResourceSe…`.

interface Entry {
  name: string;
  status?: 'modified' | 'added';
  children?: Entry[];
}

const changed: Entry[] = [
  {
    name: 'module/spring-boot-security-oauth2-resource-server/src',
    children: ['main', 'test'].map((set) => ({
      name: `${set}/java/org/springframework/boot/security/oauth2/server/resource/autoconfigure`,
      children: [
        {
          name: 'reactive',
          children: [
            {
              name:
                set === 'main'
                  ? 'ReactiveOAuth2ResourceServerJwtConfiguration.java'
                  : 'ReactiveOAuth2ResourceServerAutoConfigurationTests.java',
              status: 'modified' as const,
            },
          ],
        },
        {
          name: 'servlet',
          children: [
            {
              name: set === 'main' ? 'OAuth2ResourceServerJwtConfiguration.java' : 'OAuth2ResourceServerAutoConfigurationTests.java',
              status: 'modified' as const,
            },
          ],
        },
      ],
    })),
  },
];

// Octicons (MIT), as GitHub draws them.
const octicon = (name: string, d: string) =>
  `<svg class="${name}" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
const octicons = {
  chevron: octicon(
    'chevron',
    'M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z',
  ),
  dir: octicon(
    'dir',
    'M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z',
  ),
  file: octicon(
    'file',
    'M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z',
  ),
  modified: octicon(
    'modified',
    'M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z',
  ),
  added: octicon(
    'added',
    'M2.75 1h10.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1Zm10.5 1.5H2.75a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM8 4a.75.75 0 0 1 .75.75v2.5h2.5a.75.75 0 0 1 0 1.5h-2.5v2.5a.75.75 0 0 1-1.5 0v-2.5h-2.5a.75.75 0 0 1 0-1.5h2.5v-2.5A.75.75 0 0 1 8 4Z',
  ),
};

/** Fills `root` with the tree's rows; returns each row's name and whether it's a folder. */
function fileTree(root: HTMLElement): { row: HTMLElement; name: HTMLElement; folder: boolean }[] {
  const rows: string[] = [];
  const walk = (entries: Entry[], depth: number) => {
    for (const entry of entries) {
      const guides = Array.from({ length: depth - 1 }, (_, k) => `<span class="guide" style="left:${(k + 1) * 8 + 8}px"></span>`).join('');
      const folder = !!entry.children;
      const lead = folder ? octicons.chevron + octicons.dir : `<span class="spacer"></span>${octicons.file}`;
      const trail = entry.status ? octicons[entry.status] : '';
      rows.push(
        `<li role="treeitem" data-folder="${folder}" style="--depth:${depth}">${guides}${lead}<span class="name">${entry.name}</span>${trail}</li>`,
      );
      if (entry.children) walk(entry.children, depth + 1);
    }
  };
  walk(changed, 1);
  root.innerHTML = rows.join('');
  return [...root.querySelectorAll<HTMLElement>('li')].map((row) => ({
    row,
    name: row.querySelector<HTMLElement>('.name')!,
    folder: row.dataset.folder === 'true',
  }));
}

// As shipped, a cut name shows whole in Primer's tooltip: under the name, on
// a dark bubble at most 250px wide, wrapping wherever it has to.
for (const { row, name } of fileTree(document.querySelector<HTMLElement>('#github-before')!)) {
  let tip: HTMLElement | null = null;
  row.addEventListener('pointerenter', () => {
    if (name.scrollWidth <= name.clientWidth) return;
    tip = document.createElement('span');
    tip.className = 'gh-tip';
    tip.textContent = name.textContent;
    document.body.append(tip);
    const at = name.getBoundingClientRect();
    const left = at.left + at.width / 2 - tip.offsetWidth / 2;
    tip.style.left = `${Math.max(8, Math.min(left, innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${at.bottom + 6}px`;
  });
  row.addEventListener('pointerleave', () => {
    tip?.remove();
    tip = null;
  });
}

// A merged folder keeps the folder it starts in and the ones its files are
// in, cut between folders or words; a file keeps its extension. One ellipsis
// and no more: a tree's rows needn't end flush. Hovering a cut row grows the
// full path out of it, in place.
const plain: ElideOptions = { justify: false };
const github: { folder: ElideOptions; file: ElideOptions } = {
  folder: { ...plain, position: 'middle', snap: separators('/-', { fragment: false }) },
  file: { ...plain, position: 'middle', keep: /(\.\w+)+$/ },
};
const tips = tooltip({ reveal: 'grow', breaks: '/', delay: 150, maxWidth: 0.9 });
for (const { row, name, folder } of fileTree(document.querySelector<HTMLElement>('#github-after')!))
  tips.attach(elide(name, folder ? github.folder : github.file), row);
