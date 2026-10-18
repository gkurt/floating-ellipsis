import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A focusable value that shows a tooltip: as tall as its line, with a focus ring. */
export const TRIGGER = 'block rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
