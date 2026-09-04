import { describe, it, expect } from 'vitest';
import {
	acrossHeadPx,
	alongFeedPx,
	clampDensity,
	fitsHead,
	nativeDpi,
	resolveDirection,
	DEFAULT_NIIMBOT
} from './options';
import { DEFAULT_LAYOUT } from '../types';

const label = { w: 50, h: 25 };

describe('nativeDpi', () => {
	it('maps the nominal 203 to the real 8 dots/mm', () => {
		expect(nativeDpi(203)).toBe(203.2);
		expect(nativeDpi(300)).toBe(300);
	});
});

describe('acrossHeadPx / alongFeedPx', () => {
	it('puts the width across the head for top and the height for left', () => {
		expect(acrossHeadPx(label, 'top', 203.2)).toBe(400);
		expect(alongFeedPx(label, 'top', 203.2)).toBe(200);
		expect(acrossHeadPx(label, 'left', 203.2)).toBe(200);
		expect(alongFeedPx(label, 'left', 203.2)).toBe(400);
	});
});

describe('fitsHead', () => {
	it('accepts exactly the head width and rejects one dot more', () => {
		expect(fitsHead({ w: 48, h: 30 }, 'top', 203.2, 384)).toBe(true);
		expect(fitsHead({ w: 48.1, h: 30 }, 'top', 203.2, 384)).toBe(false);
		expect(fitsHead(label, 'left', 203.2, 384)).toBe(true);
	});
});

describe('resolveDirection', () => {
	it('follows the printer when auto and falls back to top', () => {
		expect(resolveDirection({ direction: 'auto' }, { printDirection: 'left' })).toBe('left');
		expect(resolveDirection({ direction: 'auto' }, null)).toBe('top');
		expect(resolveDirection({ direction: 'left' }, { printDirection: 'top' })).toBe('left');
	});
});

describe('clampDensity', () => {
	it('rounds and clamps into the model range, defaulting to 1..5', () => {
		expect(clampDensity(7, { min: 1, max: 5 })).toBe(5);
		expect(clampDensity(0, { min: 1, max: 5 })).toBe(1);
		expect(clampDensity(3.6)).toBe(4);
		expect(clampDensity(Number.NaN)).toBe(1);
	});
});

describe('layout defaults', () => {
	it('carry the niimbot options', () => {
		expect(DEFAULT_LAYOUT.niimbot).toEqual(DEFAULT_NIIMBOT);
		expect(DEFAULT_NIIMBOT).toEqual({
			density: 3,
			labelType: 1,
			direction: 'auto',
			mono: 'threshold',
			threshold: 140,
			fullRows: true
		});
	});
});
