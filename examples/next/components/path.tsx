'use client';

import { separators } from 'floating-ellipsis';
import { type ElidedProps, Elided } from 'floating-ellipsis/react';

// Made once: a new one each render would re-truncate.
const snap = separators('/');

/**
 * A path cut in the middle, at slashes. Options that are functions (`snap`,
 * `onChange`, `glyphs`, `suffix`) can't go from a Server Component to a Client
 * Component, so they're set in one.
 */
export function Path(props: ElidedProps) {
  return <Elided position="middle" snap={snap} {...props} />;
}
