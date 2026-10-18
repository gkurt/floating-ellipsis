'use client';

import { separators } from 'floating-ellipsis';
import { type ElidedProps, Elided } from 'floating-ellipsis/react';
import { type Tip, TIPS } from '@/components/tips';

type TippedProps = ElidedProps & {
  /** How the full text shows on hover and focus, if at all. */
  tip?: Tip;
};

/**
 * `Elided` with floating-ellipsis's own tooltip. Options that are functions
 * (`snap`, `instanceRef`, `onChange`, `glyphs`, `suffix`) can't go from a
 * Server Component to a Client Component, so they're set here, and Server
 * Components pick a tip by name.
 */
export function Tipped({ tip, ...props }: TippedProps) {
  return <Elided instanceRef={tip && TIPS[tip]} {...props} />;
}

// Made once: a new one each render would re-truncate.
const slashes = separators('/');

/** A path cut in the middle at slashes, its file name kept. */
export function Path(props: TippedProps) {
  return <Tipped position="middle" snap={slashes} keep={/[^/]+$/} {...props} />;
}
