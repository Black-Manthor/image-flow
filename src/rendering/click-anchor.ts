import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { eventElement } from './preview-dom';

// A click that moves the caret out of a wrap or a row of images draws the block
// again, with another height than its source: below it, the clicked line and
// everything after it moved. The clicked line keeps its place on
// screen; what changes shape is above it. Clicking above a block needs nothing:
// CodeMirror keeps the top of the screen still.
// The correction rides on the click's own selection transaction (a transaction
// extender), so the first frame drawn is already the right one: a correction a
// frame later (a requestAnimationFrame scroll) was tried: it showed as a small
// jump in the lower part of the screen, and was dropped.
// The line keeps its screen pixel, not only its place to the fraction: the
// browser scrolls by whole device pixels and draws each position rounded to
// the nearest one. Aimed at the line's old fractional place, a height change
// of 11.6 px was compensated by 12 and the clicked line, with everything
// below it, came down one pixel. Aimed at that place rounded to its
// device pixel, the scroll CodeMirror asks for rounds to the change of pixel.
// Only when a line of text is a whole number of device pixels (100%, or a
// screen at 125% or 150%: 24 px are 30 or 36): then the lines below share the
// clicked line's fraction and keep their pixel with it. Zoomed (24 px are
// 26.3 at 110%) each line has a fraction of its own, keeping the clicked one
// exactly moved others, and the fractional place, the smallest scroll, moves
// fewest.
// Clicks on a preview are preview-interaction.ts's, which anchors them itself.

// The clicked line of a pointer press, by the state it was pressed in: the
// selection transaction that follows starts from that state.
const pressed = new WeakMap<EditorState, { pos: number; offset: number }>();

export const clickAnchor: Extension = [
	EditorView.domEventHandlers({
		pointerdown(event, view) {
			if (event.button !== 0 || eventElement(event)?.closest('.iw-preview')) return false;
			const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
			const top = pos === null ? undefined : view.coordsAtPos(pos)?.top;
			const scale = view.dom.ownerDocument.defaultView?.devicePixelRatio || 1;
			const line = view.defaultLineHeight * scale;
			const target = top === undefined || Math.abs(line - Math.round(line)) > 0.02 ? top : Math.round(top * scale) / scale;
			if (pos !== null && target !== undefined) pressed.set(view.state, { pos, offset: target - view.scrollDOM.getBoundingClientRect().top });
			return false;
		},
	}),
	EditorState.transactionExtender.of(tr => {
		const press = pressed.get(tr.startState);
		if (!press || !tr.selection || !tr.isUserEvent('select.pointer')) return null;
		pressed.delete(tr.startState);
		return { effects: EditorView.scrollIntoView(press.pos, { y: 'start', yMargin: Math.max(0, press.offset) }) };
	}),
];
