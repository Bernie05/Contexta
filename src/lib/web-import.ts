import "server-only";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { stripExtension } from "./formats/catalog";
import { extractorFor } from "./formats/registry";
import type { DocKind } from "./formats/types";
import { createDocument, createWrittenDocument } from "./library";
import { fetchUrl, UrlError } from "./url-fetch";
import type { Document } from "./types";

const MIN_TEXT_CHARS = 100; // less than this is usually a "please enable JavaScript" message
const MAX_TITLE_CHARS = 120;
const CONTENT = "h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,tr";

const singleLine = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").replaceAll("**", "").trim();

/** Turns one element of the article into a line of Markdown. */
function toLine(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (tag === "tr") return [...element.children].map((cell) => singleLine(cell.textContent)).join(" | ");
  const text = singleLine(element.textContent);
  if (!text) return "";
  if (tag === "li") return `- ${text}`;
  return /^h[1-6]$/.test(tag) ? `## ${text}` : text;
}

/** Pulls the article out of a page, leaving out menus, ads and footers. */
function readArticle(bytes: Uint8Array, url: string, contentType: string): { title: string; markdown: string } {
  const charset = contentType.match(/charset=[^;]+/i)?.[0];
  const dom = new JSDOM(Buffer.from(bytes), {
    url,
    contentType: charset ? `text/html; ${charset}` : "text/html",
    virtualConsole: new VirtualConsole(), // pages' CSS errors aren't worth logging
  });
  const article = new Readability(dom.window.document).parse();
  dom.window.close();

  const text = singleLine(article?.textContent);
  if (!article?.content || text.length < MIN_TEXT_CHARS) {
    throw new UrlError("This page has no readable text. It may need JavaScript or a login.");
  }

  const body = new JSDOM(article.content).window.document.body;
  const lines = [...body.querySelectorAll(CONTENT)]
    .filter((element) => !element.parentElement?.closest("li,blockquote,pre,tr"))
    .map(toLine)
    .filter(Boolean);
  // Some sites put their text in plain <div>s, which the list above misses.
  const markdown = lines.join("\n\n");
  const usable = singleLine(markdown).length >= text.length / 2;
  return { title: singleLine(article.title), markdown: usable ? markdown : text };
}

/** The last part of a link's path, e.g. "report.pdf", or the site's name if there isn't one. */
function nameInLink(url: string): string {
  const { hostname, pathname } = new URL(url);
  const last = pathname.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last).slice(0, MAX_TITLE_CHARS) || hostname;
  } catch {
    return last.slice(0, MAX_TITLE_CHARS) || hostname; // badly encoded link
  }
}

/** Saves the file behind a link as it is, keeping the name in the link. */
function saveOriginal(url: string, bytes: Uint8Array, folderId: string | null): Promise<Document> {
  if (!extractorFor("pdf").sniff(bytes)) throw new UrlError("That link doesn't lead to a valid PDF.");
  const file = nameInLink(url);
  return createDocument({ name: /\.pdf$/i.test(file) ? file : `${file}.pdf`, kind: "pdf", folderId, bytes });
}

/** Saves a link into the library as a new document of the chosen type. */
export async function importUrl(link: string, kind: DocKind, folderId: string | null): Promise<Document> {
  const { url, contentType, bytes } = await fetchUrl(link);
  const type = contentType.split(";")[0].trim().toLowerCase();

  if (type === "application/pdf" || extractorFor("pdf").sniff(bytes)) return saveOriginal(url, bytes, folderId);

  let page: { title: string; markdown: string };
  if (type === "text/plain" || type === "text/markdown") {
    page = { title: stripExtension(nameInLink(url)), markdown: new TextDecoder().decode(bytes) };
  } else if (type === "text/html" || type === "application/xhtml+xml" || !type) {
    page = readArticle(bytes, url, contentType);
  } else {
    throw new UrlError("Only web pages and PDF links can be saved.");
  }

  const title = (page.title || new URL(url).hostname).slice(0, MAX_TITLE_CHARS);
  return createWrittenDocument({ title, subtitle: `Saved from ${url}`, markdown: page.markdown }, kind, folderId);
}
