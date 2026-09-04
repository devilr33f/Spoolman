// Why talking to a Niimbot printer failed, in terms a message can be written for.
//
// Same shape as utils/nfc.ts: the browser reports through DOMException names and
// niimbluelib through error subclasses and message text, and neither wording is
// something a user can act on. Components map a reason to a translated string;
// nothing here is ever shown directly.

export type NiimbotErrorReason =
	/** No Web Bluetooth and no Web Serial in this browser. */
	| 'unsupported'
	/** The APIs exist but the page is not a secure context (plain HTTP over the LAN). */
	| 'insecureContext'
	/** The user closed the device chooser, or aborted between labels. */
	| 'cancelled'
	/** The permission prompt was declined or the site is blocked. */
	| 'notAllowed'
	/** The chosen device has no Niimbot-style characteristic / port. */
	| 'notFound'
	/** The link dropped, or a command was sent while not connected. */
	| 'disconnected'
	/** The printer stopped answering. */
	| 'timeout'
	/** The printer reported an error (lid open, no paper, low battery, ...). */
	| 'printerError'
	/** The label needs more dots across the head than the printer has. */
	| 'tooWide'
	| 'unknown';

export class NiimbotError extends Error {
	constructor(
		readonly reason: NiimbotErrorReason,
		options?: { cause?: unknown }
	) {
		super(`Niimbot: ${reason}`, options);
		this.name = 'NiimbotError';
	}
}

/**
 * Turn a browser or niimbluelib exception into a reason. Names come from Web
 * Bluetooth / Web Serial DOMExceptions; the rest is matched on the library's
 * message text because it throws plain `Error`s for timeouts and channel state.
 */
export function reasonFor(err: unknown): NiimbotErrorReason {
	if (err instanceof NiimbotError) return err.reason;
	const e = (err ?? {}) as { name?: string; message?: string; reasonId?: unknown };
	const name = e.name ?? '';
	const message = e.message ?? '';
	// Chooser dismissed (Bluetooth: NotFoundError, Serial: NotFoundError / AbortError).
	if (name === 'NotFoundError' || name === 'AbortError') return 'cancelled';
	if (name === 'NotAllowedError' || name === 'SecurityError') return 'notAllowed';
	if (name === 'NetworkError') return 'disconnected';
	// niimbluelib's PrintError carries the printer's reason id.
	if (typeof e.reasonId === 'number') return 'printerError';
	if (/timeout/i.test(message)) return 'timeout';
	if (/characteristic not found|not readable|not writable/i.test(message)) return 'notFound';
	if (/channel is closed|not connected|disconnect/i.test(message)) return 'disconnected';
	return 'unknown';
}
