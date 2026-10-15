export { elide, Elide } from './elide.ts';
export type { ElideOptions, ElideState, ChangeReason, GapInfo, GlyphMode, Part, Suffix } from './options.ts';
export { separators, words, positionValue } from './cut.ts';
export type { Cut, Keep, Position, Range, SeparatorOptions, Snap, SnapContext } from './cut.ts';
export type { EllipsisStyle, MarkStyle, Shape, Length } from './marks.ts';
export { planGap, inkGap, inkRuns, dotSpacing, measure, fontOf, clearMetrics } from './metrics.ts';
export type { Font, Gap, GapPlan, GlyphMetrics } from './metrics.ts';
export { graphemes } from './graphemes.ts';
