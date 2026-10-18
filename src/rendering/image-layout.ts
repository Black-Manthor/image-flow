import { isImagePath, parseDocument } from '../markdown/model';

export type AddClass = (element: HTMLElement, className: string) => void;

// Obsidian may invoke postprocessors before an internal embed becomes image-embed.
// Include the section itself, as well as placeholders and completed descendants.
export function imageEmbeds(root: HTMLElement): HTMLElement[] {
	const candidates = Array.from(root.querySelectorAll<HTMLElement>('.internal-embed, .image-embed'));
	if (root.matches('.internal-embed, .image-embed')) candidates.unshift(root);
	return candidates.filter(element => element.classList.contains('image-embed') || isImagePath(element.getAttribute('src') ?? ''));
}

const originalParagraphs = new WeakMap<HTMLElement, HTMLElement>();

// Native Reading sections can be reused after our render child is unloaded.
// Put back the same paragraph and its live embed, not a clone.
export function restoreImageParagraphs(root: HTMLElement): void {
	const carriers = Array.from(root.querySelectorAll<HTMLElement>('.iw-image-carrier'));
	if (root.matches('.iw-image-carrier')) carriers.unshift(root);
	for (const carrier of carriers.reverse()) {
		const paragraph = originalParagraphs.get(carrier);
		if (!paragraph) continue;
		if (carrier.parentNode) carrier.replaceWith(paragraph);
		paragraph.append(...Array.from(carrier.childNodes));
		originalParagraphs.delete(carrier);
	}
}

// Replace an image-only paragraph with a carrier; repeated calls reuse it.
export function ensureImageCarrier(embed: HTMLElement, add: AddClass): HTMLElement | undefined {
	const paragraph = embed.parentElement;
	if (paragraph?.classList.contains('iw-image-carrier')) {
		add(paragraph, 'iw-image-paragraph');
		return paragraph;
	}
	if (!paragraph || paragraph.tagName !== 'P' || paragraph.children.length !== 1 ||
		Array.from(paragraph.childNodes).some(node => node.nodeType === 3 && node.textContent?.trim())) return undefined;
	const carrier = paragraph.ownerDocument.createElement('div');
	for (const attribute of Array.from(paragraph.attributes)) carrier.setAttribute(attribute.name, attribute.value);
	carrier.classList.add('iw-image-carrier');
	originalParagraphs.set(carrier, paragraph);
	paragraph.before(carrier);
	carrier.append(...Array.from(paragraph.childNodes));
	paragraph.remove();
	add(carrier, 'iw-image-paragraph');
	return carrier;
}

export function firstParagraph(root: HTMLElement): HTMLElement | null {
	return root.matches('p') ? root : root.querySelector<HTMLElement>('p');
}

export function alignPreviewParagraphs(root: HTMLElement, embed: HTMLElement, add: AddClass): void {
	const imageParagraph = ensureImageCarrier(embed, add);
	if (!imageParagraph) return;
	const paragraphs = Array.from(root.querySelectorAll<HTMLElement>('p, .iw-image-carrier'));
	const next = paragraphs[paragraphs.indexOf(imageParagraph) + 1];
	if (next && next !== imageParagraph) add(next, 'iw-first-paragraph');
}

// Classes of a wrap's own container, known before rendering, so the float
// applies as soon as the image appears: the side, and whether the first
// block is the image alone. Shared by Live Preview and Reading view.
export function wrapContainerClasses(markdown: string, side: string): string[] {
	const first = parseDocument(markdown).images[0];
	if (!first || !markdown.trimStart().startsWith(first.raw)) return [];
	const classes = [`iw-layout-${side}`];
	if (markdown.trim().split(/\n\s*\n/)[0]?.trim() === first.raw) classes.push('iw-leading-image-only');
	return classes;
}

// The rendered image floats inside a reversible DIV carrier and the next
// paragraph loses its top margin. Idempotent: safe from a class observer.
export function layoutWrapContent(content: HTMLElement, side: string): void {
	const firstEmbed = content.querySelector<HTMLElement>('.internal-embed, .image-embed');
	if (!firstEmbed) return;
	if (firstEmbed.classList.contains('image-embed') && !firstEmbed.classList.contains(side)) firstEmbed.classList.add(side);
	alignPreviewParagraphs(content, firstEmbed, (element, cls) => {
		if (!element.classList.contains(cls)) element.classList.add(cls);
	});
}
