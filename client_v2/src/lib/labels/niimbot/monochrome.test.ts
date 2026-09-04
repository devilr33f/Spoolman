import { describe, it, expect } from 'vitest';
import { atkinson, floydSteinberg, luminance, threshold, toMonochrome, type RgbaImage } from './monochrome';

function rgba(width: number, height: number, px: number[][]): RgbaImage {
	return { width, height, data: new Uint8ClampedArray(px.flat()) };
}
const bytes = (img: RgbaImage) => Array.from(img.data);

describe('luminance', () => {
	it('is Rec. 601 rounded to an integer', () => {
		expect(luminance(0, 0, 0)).toBe(0);
		expect(luminance(255, 255, 255)).toBe(255);
		expect(luminance(255, 0, 0)).toBe(76);
	});
});

describe('threshold', () => {
	it('splits a gradient at the cutoff into pure black and white', () => {
		const img = rgba(2, 2, [
			[0, 0, 0, 255],
			[85, 85, 85, 255],
			[170, 170, 170, 255],
			[255, 255, 255, 255]
		]);
		threshold(img, 140);
		expect(bytes(img)).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
	});

	it('composites alpha onto white first', () => {
		expect(bytes(threshold(rgba(1, 1, [[0, 0, 0, 0]]), 140))).toEqual([255, 255, 255, 255]);
		// black at 50 % alpha is luma 127: below 140, so it prints
		expect(bytes(threshold(rgba(1, 1, [[0, 0, 0, 128]]), 140))).toEqual([0, 0, 0, 255]);
	});
});

describe('floydSteinberg', () => {
	it('turns flat mid-gray into an alternating row', () => {
		const img = rgba(4, 1, [
			[128, 128, 128, 255],
			[128, 128, 128, 255],
			[128, 128, 128, 255],
			[128, 128, 128, 255]
		]);
		floydSteinberg(img, 128);
		expect(bytes(img)).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
	});
});

describe('atkinson', () => {
	it('leaves pure black and white untouched', () => {
		const img = rgba(2, 1, [
			[0, 0, 0, 255],
			[255, 255, 255, 255]
		]);
		atkinson(img, 128);
		expect(bytes(img)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
	});
});

describe('toMonochrome', () => {
	it('clamps the cutoff to 0..255', () => {
		expect(
			bytes(toMonochrome(rgba(1, 1, [[200, 200, 200, 255]]), { mono: 'threshold', threshold: 300 }))
		).toEqual([0, 0, 0, 255]);
		expect(
			bytes(toMonochrome(rgba(1, 1, [[10, 10, 10, 255]]), { mono: 'threshold', threshold: -5 }))
		).toEqual([255, 255, 255, 255]);
	});

	it('dispatches on mode', () => {
		const gray = () =>
			rgba(2, 1, [
				[128, 128, 128, 255],
				[128, 128, 128, 255]
			]);
		expect(bytes(toMonochrome(gray(), { mono: 'threshold', threshold: 128 }))).toEqual([
			255, 255, 255, 255, 255, 255, 255, 255
		]);
		expect(bytes(toMonochrome(gray(), { mono: 'floyd-steinberg', threshold: 128 }))).toEqual([
			255, 255, 255, 255, 0, 0, 0, 255
		]);
	});
});
