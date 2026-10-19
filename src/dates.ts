/**
 * Dates from long to short (`floating-ellipsis/dates`), for `shorten`:
 * "Wednesday, October 14, 2026" down to "10/14/26", as the locale writes
 * each. Plain data, so it can be made on a server.
 */
/** A date written out in full, and the shorter forms it may take: a `shorten` entry that finds it by its text. */
export interface DateForms {
  text: string;
  shorten: { match: string; to: string[] };
}

export interface DateFormsOptions {
  /** The locale, as `Intl.DateTimeFormat` takes it. Default: the runtime's. */
  locale?: string | string[];
  /** The time zone the date is shown in. Default: the runtime's. */
  timeZone?: string;
  /** Show the year. Default true. */
  year?: boolean;
  /** Show the weekday, in the longer forms. Default true. */
  weekday?: boolean;
  /** Show the time too, in hours and minutes. Default false. */
  time?: boolean;
}

/** From the longest form to the shortest: the weekday, then the month, shortened, then the weekday gone, then numbers. */
const STYLES: Intl.DateTimeFormatOptions[] = [
  { weekday: 'long', month: 'long', year: 'numeric' },
  { weekday: 'short', month: 'long', year: 'numeric' },
  { weekday: 'short', month: 'short', year: 'numeric' },
  { month: 'short', year: 'numeric' },
  { month: 'numeric', year: '2-digit' },
];

/**
 * `date` written out in full, as `text`, and the shorter forms it may take,
 * as a `shorten` entry. Spread it into the options, or put its `text` in a
 * longer text and its `shorten` among others (it finds the date by its text):
 *
 * ```js
 * elide(el, dateForms(new Date(), { locale: 'en-GB' })); // Wednesday 14 October 2026 … 14/10/26
 * const due = dateForms(deadline);
 * elide(el, { text: `Due ${due.text}`, shorten: due.shorten });
 * ```
 *
 * A form no shorter than the one before it (the same, in some locales) is
 * left out.
 */
export function dateForms(date: Date | number, options: DateFormsOptions = {}): DateForms {
  const { locale, timeZone, year = true, weekday = true, time = false } = options;
  const forms: string[] = [];
  for (const style of STYLES) {
    const { weekday: day, year: y, ...rest } = style;
    const format = new Intl.DateTimeFormat(locale, {
      ...rest,
      day: 'numeric',
      ...(weekday && day && { weekday: day }),
      ...(year && { year: y }),
      ...(time && { hour: 'numeric', minute: '2-digit' }),
      timeZone,
    });
    const form = format.format(date);
    const last = forms.at(-1);
    if (last === undefined || form.length < last.length) forms.push(form);
  }
  const [text = '', ...to] = forms;
  return { text, shorten: { match: text, to } };
}
