export { elide, Elide } from './elide.js';
export type { ElideOptions, ElideState, ElideChange, ChangeReason, GapInfo, Part } from './elide.js';
export { separators, positionValue } from './cut.js';
export type { Cut, Keep, Position, Range, SeparatorOptions, Snap, SnapContext } from './cut.js';
export type { EllipsisStyle, MarkStyle, Shape, Length } from './marks.js';
export { planGap, inkGap, inkRuns, dotSpacing, measure, fontOf, clearMetrics } from './metrics.js';
export type { Font, Gap, GapPlan, GlyphMetrics } from './metrics.js';
export { graphemes } from './graphemes.js';
