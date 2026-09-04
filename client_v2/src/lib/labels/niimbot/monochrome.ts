import type { MonoMode } from './options';

// RGBA → 1-bit for a thermal head. Pure functions over an ImageData-compatible
// object so they run, and are tested, without a DOM. Output pixels are exactly
// #000000 or #ffffff with alpha 255: niimbluelib's ImageEncoder prints anything
// that is not #ffffff, so a stray 254 would come out as a black dot.

export interface RgbaImage {
	data: Uint8ClampedArray;
	width: number;
	height: number;
}

/** Rec. 601 luma, 0..255, rounded to an integer. */
export function luminance(r: number, g: number, b: number): number {
	return Math.floor((r * 299 + g * 587 + b * 114 + 500) / 1000);
}

/** Luma of every pixel after compositing its alpha onto white paper. */
function grayscale(img: RgbaImage): Float32Array {
	const { data, width, height } = img;
	const out = new Float32Array(width * height);
	for (let i = 0, p = 0; i < data.length; i += 4, p++) {
		const a = data[i + 3];
		const white = 255 * (255 - a);
		out[p] = luminance(
			(data[i] * a + white) / 255,
			(data[i + 1] * a + white) / 255,
			(data[i + 2] * a + white) / 255
		);
	}
	return out;
}

function writeBits(img: RgbaImage, gray: ArrayLike<number>, cutoff: number): RgbaImage {
	const { data } = img;
	for (let i = 0, p = 0; i < data.length; i += 4, p++) {
		const v = gray[p] < cutoff ? 0 : 255;
		data[i] = v;
		data[i + 1] = v;
		data[i + 2] = v;
		data[i + 3] = 255;
	}
	return img;
}

/** Plain cut at `cutoff`: crisp text and QR modules, light tints vanish. */
export function threshold(img: RgbaImage, cutoff: number): RgbaImage {
	return writeBits(img, grayscale(img), cutoff);
}

type Kernel = { dx: number; dy: number; w: number }[];

const FLOYD_STEINBERG: Kernel = [
	{ dx: 1, dy: 0, w: 7 / 16 },
	{ dx: -1, dy: 1, w: 3 / 16 },
	{ dx: 0, dy: 1, w: 5 / 16 },
	{ dx: 1, dy: 1, w: 1 / 16 }
];

// Atkinson pushes only 6/8 of the error on and drops the rest, which keeps text
// edges crisp and stops a light swatch from becoming a full gray field.
const ATKINSON: Kernel = [
	{ dx: 1, dy: 0, w: 1 / 8 },
	{ dx: 2, dy: 0, w: 1 / 8 },
	{ dx: -1, dy: 1, w: 1 / 8 },
	{ dx: 0, dy: 1, w: 1 / 8 },
	{ dx: 1, dy: 1, w: 1 / 8 },
	{ dx: 0, dy: 2, w: 1 / 8 }
];

function diffuse(img: RgbaImage, cutoff: number, kernel: Kernel): RgbaImage {
	const { width, height } = img;
	const gray = grayscale(img);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			const old = gray[i];
			const v = old < cutoff ? 0 : 255;
			gray[i] = v;
			const err = old - v;
			if (err === 0) continue;
			for (const k of kernel) {
				const nx = x + k.dx;
				const ny = y + k.dy;
				if (nx < 0 || nx >= width || ny >= height) continue;
				gray[ny * width + nx] += err * k.w;
			}
		}
	}
	return writeBits(img, gray, cutoff);
}

/** Error-diffusion dither; renders swatches and gradients as dot patterns. */
export function floydSteinberg(img: RgbaImage, cutoff: number): RgbaImage {
	return diffuse(img, cutoff, FLOYD_STEINBERG);
}

export function atkinson(img: RgbaImage, cutoff: number): RgbaImage {
	return diffuse(img, cutoff, ATKINSON);
}

export function toMonochrome(img: RgbaImage, opt: { mono: MonoMode; threshold: number }): RgbaImage {
	const cutoff = Math.min(255, Math.max(0, Math.round(opt.threshold)));
	switch (opt.mono) {
		case 'floyd-steinberg':
			return floydSteinberg(img, cutoff);
		case 'atkinson':
			return atkinson(img, cutoff);
		default:
			return threshold(img, cutoff);
	}
}
