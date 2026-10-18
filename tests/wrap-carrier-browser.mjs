// Focused wrap carrier regressions using the shared page collector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { watchPage } from "./pagina-segnalazioni.mjs";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
const repo = fileURLToPath(new URL("../", import.meta.url));
const src = repo + "src", stub = repo + "tests/obsidian-stub.ts";
const r = await build({ stdin: { contents: `import '${repo}tests/browser-dom.ts';export {Plugin,Component,runtime} from '${stub}';export * from '${src}/rendering/image-layout.ts';export * from '${src}/rendering/preview-dom.ts';export {renderReadingWrap} from '${src}/rendering/reading-wrap.ts';export {registerReadingView} from '${src}/rendering/reading-view.ts';export {applyExportLayout} from '${src}/rendering/reading-export.ts';export {defaultSettings} from '${src}/settings.ts';import {setLanguage} from '${src}/i18n/index.ts';setLanguage('it');`, resolveDir: repo }, alias: { obsidian: stub }, bundle: true, format: "iife", globalName: "probe", write: false, tsconfigRaw: { compilerOptions: {} } });
const b = await chromium.launch({ headless: true }), p = await b.newPage();
let watch, results;
try {
  watch = await watchPage(p, { label: "wrap-carrier" });
  watch.test = "wrap-carrier";
  await p.addScriptTag({ content: r.outputFiles[0].text });
  // The plugin's own stylesheet, applied only by the export geometry check.
  await p.addScriptTag({ content: `window.iwStyles = ${JSON.stringify(await readFile(repo + "styles.css", "utf8"))};` });
  results = await p.evaluate(async () => {
    const out = [];
    const check = (name, ok, details) => out.push({ name, passed: !!ok, details });
    const wait = () => new Promise((r2) => setTimeout(r2, 50));
    const source = "[wrap:start] %%iw-wrap side=left%%\n\n![[a.png|180]]\n\nTesto.\n[wrap:end]\n\nFuori.";
    const plugin = new probe.Plugin();
    plugin.load();
    probe.registerReadingView(plugin, probe.defaultSettings);
    const section = document.createElement("div");
    section.className = "el-p";
    document.body.append(section);
    const paragraph = document.createElement("p");
    paragraph.setAttribute("data-owned", "native");
    section.append(paragraph);
    const embed = document.createElement("span");
    embed.className = "internal-embed image-embed";
    embed.setAttribute("src", "a.png");
    paragraph.append(embed);
    let events2 = 0;
    embed.addEventListener("probe", () => events2++);
    let child;
    const context = { sourcePath: "Compact.md", getSectionInfo: () => ({ text: source, lineStart: 2, lineEnd: 2 }), addChild: (c) => {
      child = c;
      c.load();
    } };
    await plugin.postprocessor(section, context);
    await wait();
    const carrier = embed.parentElement;
    check("native-refresh-retains-layout-class", carrier.classList.contains("iw-image-paragraph"), carrier.outerHTML);
    await plugin.postprocessor(section, context);
    await wait();
    check("section-reprocess-no-nested-carriers", embed.parentElement.tagName === "DIV" && embed.parentElement.parentElement === section && section.querySelectorAll("div").length === 1, section.innerHTML);
    child.unload();
    embed.dispatchEvent(new Event("probe"));
    check("section-unload-restores-same-paragraph-and-listener", paragraph.parentElement === section && embed.parentElement === paragraph && events2 === 1 && paragraph.getAttribute("data-owned") === "native", section.innerHTML);
    plugin.unload();
    const html = section.innerHTML;
    embed.classList.add("is-loaded");
    await wait();
    check("unloaded-observers-do-not-remutate", section.innerHTML === html.replace("image-embed", "image-embed is-loaded"), section.innerHTML);
    // DOM reference regression only: no PDF appearance or pagination claim.
    for (const wrapped of [false, true]) {
      const root = document.createElement("div");
      document.body.append(root);
      const add = (tag, txt2) => {
        const el = document.createElement(tag);
        if (txt2) el.textContent = txt2;
        root.append(el);
        return el;
      };
      add("p", "[wrap:start]");
      const image = add("p");
      const em2 = document.createElement("span");
      em2.className = "internal-embed image-embed";
      em2.setAttribute("src", "a.png");
      image.append(em2);
      const body = add("p", "Testo.");
      add("p", "[wrap:end]");
      add("p", "Fuori.");
      if (wrapped) for (const el of [...root.children]) {
        const div = document.createElement("div");
        el.before(div);
        div.append(el);
      }
      const normal = source.replace("Testo.\n[wrap:end]", "Testo.\n\n[wrap:end]");
      const mock = { app: { vault: { getFileByPath: () => ({ basename: "Example" }), cachedRead: async () => normal }, metadataCache: { getFileCache: () => null } } };
      await probe.applyExportLayout(root, mock, "Example.md", probe.defaultSettings(), () => true);
      check("export-dom-next-paragraph-" + (wrapped ? "wrapped" : "bare"), body.classList.contains("iw-first-paragraph"), root.innerHTML);
      root.remove();
    }
    // Embedded export (bare blocks): margins must not collapse through the
    // empty image carrier, or a printed page ending just inside its float
    // sends the whole embedded note to the next page; the heading after it
    // still starts beside the image, also under a rule like Obsidian's that
    // spaces a heading after a P. A direct export (blocks in their own
    // sections) keeps its carrier as it is.
    for (const wrapped of [false, true]) {
      const style = document.createElement("style");
      style.textContent = window.iwStyles + "\n.markdown-rendered :is(p, pre, table, ul, ol) + :is(h1, h2, h3, h4, h5, h6) { margin-top: 37.5px; }";
      document.head.append(style);
      const root = document.createElement("div");
      root.className = "markdown-rendered";
      document.body.append(root);
      const add = (tag, text) => {
        const el = document.createElement(tag);
        if (text) el.textContent = text;
        root.append(el);
        return el;
      };
      add("p", "Prima.");
      add("p", "[wrap:start]");
      const holder = add("p");
      const image = document.createElement("span");
      image.className = "internal-embed image-embed";
      image.setAttribute("src", "c.png");
      image.style.cssText = "display: block; width: 160px; height: 80px;";
      holder.append(image);
      const heading = add("h2", "Titolo");
      add("p", "Testo.");
      add("p", "[wrap:end]");
      if (wrapped) for (const el of [...root.children]) {
        const div = document.createElement("div");
        el.before(div);
        div.append(el);
      }
      const markdown = "Prima.\n\n[wrap:start] %%iw-wrap side=left%%\n\n![[c.png|160]]\n\n## Titolo\n\nTesto.\n\n[wrap:end]\n";
      const mock = { app: { vault: { getFileByPath: () => ({ basename: "Example" }), cachedRead: async () => markdown }, metadataCache: { getFileCache: () => null } } };
      await probe.applyExportLayout(root, mock, "Example.md", probe.defaultSettings(), () => true);
      const carrier = image.parentElement;
      const details = { carrierHeight: carrier.getBoundingClientRect().height, gap: heading.getBoundingClientRect().top - image.getBoundingClientRect().top, html: root.innerHTML };
      if (wrapped) check("export-carrier-wrapped-unchanged", root.querySelector(".iw-export-after-carrier") === null && details.carrierHeight === 0, details);
      else {
        check("export-carrier-bare-margins-not-collapsing-through", carrier.matches(".iw-image-carrier") && details.carrierHeight > 0 && heading.classList.contains("iw-export-after-carrier"), details);
        check("export-carrier-bare-heading-beside-image", Math.abs(details.gap) < 0.5, details);
      }
      root.remove();
      style.remove();
    }
    const content = document.createElement("div");
    document.body.append(content);
    const p2 = document.createElement("p"), em = document.createElement("span"), txt = document.createElement("p");
    em.className = "internal-embed image-embed";
    em.setAttribute("src", "a.png");
    p2.append(em);
    txt.textContent = "Testo";
    content.append(p2, txt);
    probe.ensureImageCarrier(em, (e, c) => e.classList.add(c));
    probe.registerPreviewSource(content, "![[a.png]]\n\nTesto", 0);
    probe.annotateBlocks(content);
    check("carrier-source-position", probe.previewPosition(em.parentElement, content, -1) === 0 && probe.previewPosition(txt, content, -1) === 12, content.innerHTML);
    content.remove();
    // The renderer fills the content before its promise settles: the drawn
    // Reading wrap has its carrier when renderReadingWrap returns, before any
    // observer runs, so nothing can measure the native image paragraph.
    const readingHost = document.createElement("div");
    document.body.append(readingHost);
    const readingParent = new probe.Component();
    readingParent.load();
    const readingCleanup = probe.renderReadingWrap(readingHost, { region: {}, markdown: "![[a.png|180]]\n\n## Titolo\n\nTesto.", side: "iw-left" }, {}, "Example.md", readingParent);
    const readingContent = readingHost.querySelector(".iw-preview-content");
    const readingFirst = readingContent.firstElementChild;
    check("reading-wrap-carrier-before-observers", readingFirst?.matches("div.iw-image-carrier") && readingFirst.querySelector(".image-embed") !== null, readingContent.innerHTML);
    readingCleanup();
    readingParent.unload();
    readingHost.remove();
    const holder = document.createElement("div");
    document.body.append(holder);
    const native = document.createElement("p");
    native.textContent = "Native";
    holder.append(native);
    const active = probe.runtime.activeComponents, parent = new probe.Component();
    parent.load();
    probe.runtime.delay = 40;
    const cleanup = probe.renderReadingWrap(holder, { region: {}, markdown: "![[a.png|180]]\n\nTesto.", side: "iw-left" }, {}, "Example.md", parent);
    cleanup();
    await new Promise((r2) => setTimeout(r2, 80));
    parent.unload();
    probe.runtime.delay = 0;
    check("late-render-after-cleanup-no-visible-dom-or-child-leak", holder.children.length === 1 && holder.firstElementChild === native && probe.runtime.activeComponents === active, { html: holder.innerHTML, active: probe.runtime.activeComponents, expected: active });
    holder.remove();
    section.remove();
    return out;
  });
  const events = watch.observations;
  console.log(JSON.stringify({ results, events }, null, 2));
} finally {
  try {
    if (watch) assert.equal(await watch.stop(), true, "page collector stopped");
  } finally {
    await b.close();
  }
}
for (const result of results) await test(result.name, () => {
  assert.ok(result.passed, JSON.stringify(result.details));
  assert.deepEqual(watch.errors, []);
});
