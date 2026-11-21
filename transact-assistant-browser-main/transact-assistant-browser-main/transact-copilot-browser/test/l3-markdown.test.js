import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../public/js/l3-developer.js";
import { renderResult } from "../public/js/record-view.js";

function fakeNode(tagName, text = "") {
  return {
    tagName,
    children: [],
    className: "",
    style: {},
    _text: text,
    append(...nodes) {
      this.children.push(...nodes);
    },
    get lastElementChild() {
      return this.children[this.children.length - 1];
    },
    replaceChildren(...nodes) {
      this.children = nodes;
      this._text = "";
    },
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    },
    get textContent() {
      return this._text + this.children.map((child) => child.textContent).join("");
    },
  };
}

function withFakeDocument(run) {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => fakeNode(tagName),
    createTextNode: (text) => fakeNode("#text", text),
  };
  try {
    run();
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test("L3 Assistant replies render Markdown structure without interpreting raw HTML", () => {
  withFakeDocument(() => {
    const container = fakeNode("div");
    renderMarkdown(container, [
      "# Summary",
      "",
      "Use **clear** descriptions and `safeCode()`.",
      "",
      "| Field | Result |",
      "| :--- | ---: |",
      "| Status | Ready |",
      "",
      "- First item",
      "- Second item",
      "",
      "> Important note",
      "",
      "```java",
      "int count = 2;",
      "```",
      "",
      "<img src=x onerror=alert(1)>",
      "[unsafe](javascript:alert(1))",
    ].join("\n"));

    assert.deepEqual(container.children.map((child) => child.tagName), ["h1", "p", "table", "ul", "blockquote", "pre", "p"]);
    assert.equal(container.children[0].textContent, "Summary");
    assert.deepEqual(container.children[2].children.map((child) => child.tagName), ["thead", "tbody"]);
    assert.equal(container.children[2].children[1].children[0].children[1].textContent, "Ready");
    assert.equal(container.children[3].children.length, 2);
    assert.equal(container.children[5].children[0].className, "language-java");
    assert.equal(container.children[6].textContent, "<img src=x onerror=alert(1)>[unsafe](javascript:alert(1))");
    assert.equal(container.children.some((child) => child.tagName === "img" || child.tagName === "a"), false);
  });
});

test("JSON-backed Assistant replies preserve narrative for main-screen Markdown rendering", () => {
  withFakeDocument(() => {
    const container = fakeNode("div");
    const result = renderResult([
      "The request completed successfully.",
      "",
      "```json",
      "{\"state\":\"live\"}",
      "```",
    ].join("\n"), container);
    assert.equal(result.narrative, "The request completed successfully.");
    assert.equal(result.raw.state, "live");
  });
});
