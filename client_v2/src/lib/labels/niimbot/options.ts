import { MM_PER_INCH } from '../paper';

// What a design remembers about how it prints on a Niimbot. Lives on
// PrintLayout next to dpi/copies because the right density and label stock are
// a property of the label, not of the browser: a 50×30 sticker and a 12 mm cable
// flag want different settings, and both should come back the way you left them.

export type MonoMode = 'threshold' | 'floyd-steinberg' | 'atkinson';
export const MONO_MODES: MonoMode[] = ['threshold', 'floyd-steinberg', 'atkinson'];

/**
 * niimbluelib's meaning: `top` sends the raster as drawn (design width across
 * the print head); `left` rotates it 90° clockwise (design height across the head).
 */
export type PrintDirection = 'top' | 'left';

/**
 * niimbluelib LabelType values a B1 accepts. Other models are filtered against
 * their `paperTypes` at render time; the numeric value is what goes on the wire.
 */
export const LABEL_TYPES: { value: number; id: 'gaps' | 'black' | 'transparent' }[] = [
	{ value: 1, id: 'gaps' },
	{ value: 2, id: 'black' },
	{ value: 5, id: 'transparent' }
];

export interface NiimbotOptions {
	/** 1..5 on a B1; clamped to the connected model's range when printing. */
	density: number;
	/** niimbluelib LabelType: 1 with gaps, 2 black mark, 5 transparent. */
	labelType: number;
	/** `auto` follows the connected model's default direction. */
	direction: PrintDirection | 'auto';
	mono: MonoMode;
	/** 0..255 luma cut-off for `threshold`, and the quantiser for the dithers. */
	threshold: number;
	/**
	 * Send every row as an explicit bitmap packet instead of the library's compact
	 * stream (blank-run and few-pixel packets). Some B1 firmware prints random
	 * specks in blank areas with the compact stream; full rows cost ~10 ms each.
	 */
	fullRows: boolean;
}

export const DEFAULT_NIIMBOT: NiimbotOptions = {
	density: 3,
	labelType: 1,
	direction: 'auto',
	mono: 'threshold',
	threshold: 140,
	fullRows: true
};

/**
 * Nominal to real dots per inch. "203 dpi" heads are 8 dots/mm = 203.2 dpi;
 * rasterizing at 203 would make a 50 mm label 399 px and shift every element by
 * a fraction of a dot. Other nominal values are exact.
 */
export function nativeDpi(dpi: number): number {
	return dpi === 203 ? 203.2 : dpi;
}

export function resolveDirection(
	opt: Pick<NiimbotOptions, 'direction'>,
	meta?: { printDirection: PrintDirection } | null
): PrintDirection {
	if (opt.direction !== 'auto') return opt.direction;
	return meta?.printDirection ?? 'top';
}

export function mmToDots(mm: number, dpi: number): number {
	return Math.round((mm / MM_PER_INCH) * dpi);
}

export function acrossHeadPx(
	label: { w: number; h: number },
	direction: PrintDirection,
	dpi: number
): number {
	return mmToDots(direction === 'top' ? label.w : label.h, dpi);
}

export function alongFeedPx(label: { w: number; h: number }, direction: PrintDirection, dpi: number): number {
	return mmToDots(direction === 'top' ? label.h : label.w, dpi);
}

export function fitsHead(
	label: { w: number; h: number },
	direction: PrintDirection,
	dpi: number,
	printheadPixels: number
): boolean {
	return acrossHeadPx(label, direction, dpi) <= printheadPixels;
}

export function clampDensity(density: number, range?: { min: number; max: number } | null): number {
	const min = range?.min ?? 1;
	const max = range?.max ?? 5;
	return Math.min(max, Math.max(min, Math.round(density) || min));
}
