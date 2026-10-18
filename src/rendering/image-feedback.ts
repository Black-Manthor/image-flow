import { pressedImages, imageFeedbackRefresh } from './image-gesture';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { Component, editorLivePreviewField } from 'obsidian';
import { parseDocument } from '../markdown/model';
import { imageAtElement } from './drag-target';
import { eventElement, windowOf } from './preview-dom';
import { wrapModelField } from './wrap-state';

// Refresh after native embeds or region widgets finish rendering. Only child
// changes are observed: our own class changes never trigger another refresh.
export const imageFeedback = ViewPlugin.fromClass(class {
	private observer: MutationObserver;
	private frame: number | undefined;
	private win: Window;
	// The drawn region whose image is under the pointer: its own outline gives
	// way to the image's (styles.css). Tracked from the pointer's events on this
	// editor's content, so in the window that shows it. Native listeners, not
	// CodeMirror's handlers: those never receive the events a widget ignores
	// (its bar and resize handles), and leaving an image for them must clear
	// the mark.
	private hovered: HTMLElement | undefined;
	private lifecycle = new Component();
	constructor(private view: EditorView) {
		this.win = view.dom.win;
		this.lifecycle.load();
		this.lifecycle.registerDomEvent(view.contentDOM, 'mouseover', event => this.hover(eventElement(event)));
		this.lifecycle.registerDomEvent(view.contentDOM, 'mouseout', event => this.leave(event.relatedTarget));
		imageFeedbackRefresh.set(view, () => this.schedule());
		this.observer = new (windowOf(view.dom).MutationObserver)(() => this.schedule());
		this.observer.observe(view.contentDOM, { childList: true, subtree: true });
		this.schedule();
	}
	private schedule() {
		if (this.frame !== undefined) return;
		this.frame = this.win.requestAnimationFrame(() => {
			this.frame = undefined;
			const live = Boolean(this.view.state.field(editorLivePreviewField, false));
			// The model is maintained per document change by wrapModelField.
			const model = this.view.state.field(wrapModelField, false) ?? parseDocument(this.view.state.doc.toString());
			const selection = this.view.state.selection.main;
			const pressed = pressedImages.get(this.view);
			for (const embed of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>('.image-embed'))) {
				const image = live ? imageAtElement(this.view, embed, model) : undefined;
				embed.classList.toggle('iw-image-feedback', Boolean(image));
				embed.classList.toggle('iw-image-active', Boolean(image && (pressed !== undefined ? image.from === pressed : selection.from >= image.from && selection.to <= image.to)));
			}
		});
	}
	// Only what changes the marks: the text, the selection, source vs Live
	// Preview. Images coming on screen are seen by the observer, the pressed
	// image calls imageFeedbackRefresh; scrolling alone needs nothing.
	update(update: ViewUpdate) {
		if (update.docChanged || update.selectionSet ||
			update.state.field(editorLivePreviewField, false) !== update.startState.field(editorLivePreviewField, false)) this.schedule();
	}
	hover(element: HTMLElement | null) {
		const region = element?.tagName === 'IMG' ? element.closest<HTMLElement>('.iw-preview') : null;
		if (region === this.hovered) return;
		this.hovered?.classList.remove('iw-image-hover');
		region?.classList.add('iw-image-hover');
		this.hovered = region ?? undefined;
	}
	// Leaving the content: none of its elements is under the pointer any more.
	// A mouse event's related target is an element or null, of any window.
	leave(next: EventTarget | null) {
		if (!this.view.contentDOM.contains(next as Node | null)) this.hover(null);
	}
	destroy() {
		this.lifecycle.unload();
		this.hover(null);
		imageFeedbackRefresh.delete(this.view);
		this.observer.disconnect();
		if (this.frame !== undefined) this.win.cancelAnimationFrame(this.frame);
		for (const embed of Array.from(this.view.contentDOM.querySelectorAll('.iw-image-feedback'))) {
			embed.classList.remove('iw-image-feedback', 'iw-image-active');
		}
	}
});
