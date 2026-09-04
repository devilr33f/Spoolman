import { describe, it, expect } from 'vitest';
import { NiimbotError, reasonFor } from './errors';

function named(name: string, message = ''): Error {
	const e = new Error(message);
	e.name = name;
	return e;
}

describe('reasonFor', () => {
	it('passes a NiimbotError through', () => {
		expect(reasonFor(new NiimbotError('tooWide'))).toBe('tooWide');
	});

	it('treats a dismissed device chooser as cancelled', () => {
		expect(reasonFor(named('NotFoundError', 'User cancelled the requestDevice() chooser.'))).toBe(
			'cancelled'
		);
		expect(reasonFor(named('AbortError'))).toBe('cancelled');
	});

	it('maps permission and transport failures', () => {
		expect(reasonFor(named('NotAllowedError'))).toBe('notAllowed');
		expect(reasonFor(named('SecurityError'))).toBe('notAllowed');
		expect(reasonFor(named('NetworkError'))).toBe('disconnected');
	});

	it('recognises niimbluelib errors by shape and text', () => {
		expect(reasonFor(Object.assign(new Error('Print error 3: paper jam'), { reasonId: 3 }))).toBe(
			'printerError'
		);
		expect(reasonFor(new Error('Timeout waiting response (waited for 0x02)'))).toBe('timeout');
		expect(reasonFor(new Error('Suitable device characteristic not found'))).toBe('notFound');
		expect(reasonFor(new Error('Channel is closed'))).toBe('disconnected');
	});

	it('falls back to unknown', () => {
		expect(reasonFor('boom')).toBe('unknown');
		expect(reasonFor(null)).toBe('unknown');
	});
});
