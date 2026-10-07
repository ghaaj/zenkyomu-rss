import { Readability } from "@mozilla/readability";
import metascraper from "metascraper";
import { metascraperImage } from "./metascraper-image.ts";
import metascraperDescription from "metascraper-description";
import { PDFParse } from "pdf-parse";
import type { Item } from "feed";

const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const sentenceSegmenter = new Intl.Segmenter("ja", { granularity: "sentence" });

function sliceByGrapheme(text: string, maxLen: number): string {
    let slice = "";
    for (const { segment } of graphemeSegmenter.segment(text)) {
        if (slice.length + segment.length > maxLen) break;
        slice += segment;
    }
    return slice;
}

function excerptFromContent(content: string, targetLen = 300, tolerance = 5): string {
    const minLen = targetLen - tolerance;
    const maxLen = targetLen + tolerance;
    let excerpt = "";
    for (
        const { segment } of sentenceSegmenter.segment(content.trim().replaceAll(/\n{2,}/g, "\n\n"))
    ) {
        const next = excerpt + segment;
        if (next.length <= targetLen) {
            excerpt = next;
            continue;
        } else if (next.length <= maxLen) {
            return next;
        } else if (excerpt.length < minLen) {
            return sliceByGrapheme(next, targetLen) + "…";
        } else {
            return excerpt;
        }
    }
    return excerpt;
}

const scrape = metascraper([
    metascraperImage(),
    metascraperDescription(),
]);

function generateMetaDescription(url: URL, document: Document): string | undefined {
    if (url.hostname === "www.c.u-tokyo.ac.jp") {
        const newslist = document.querySelector<HTMLElement>("#newslist, #newslist2");
        if (newslist) {
            // happy-dom のセレクタ解釈にバグがあるので、これは動かない
            // newslist.querySelectorAll(
            //     ":scope > :not(h2:first-of-type ~ *)",
            // ).forEach((el) => el.remove());
            for (const el of newslist.children) {
                el.remove();
                if (el.matches("h2")) break;
            }
            return excerptFromContent(newslist.innerText);
        }
    }
    document.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    const article = new Readability(document).parse();
    if (article?.textContent) return excerptFromContent(article.textContent);
}

export interface ItemMeta extends Pick<Item, "image" | "description"> {
    image?: string;
    description?: string;
}

export async function generateMeta(url: URL, domParser: DOMParser): Promise<ItemMeta> {
    try {
        const res = await fetch(url);

        if (url.pathname.endsWith(".pdf")) {
            const stack = new AsyncDisposableStack();
            const pdfParser = new PDFParse({ data: await res.arrayBuffer() });
            stack.adopt(pdfParser, (p) => p.destroy());
            const result = await pdfParser.getText({ first: 1, pageJoiner: "" });
            const description = excerptFromContent(result.text);
            return { description };
        } else {
            const rawHTML = await res.text();
            // 一部のページ（グローバリゼーションオフィスなど）は CSR だけど対応しない
            const meta: ItemMeta = await scrape({
                url: url.href,
                html: rawHTML,
            });
            const document = domParser.parseFromString(rawHTML, "text/html");
            meta.description ||= generateMetaDescription(url, document);
            return meta;
        }
    } catch (_) {
        return {};
    }
}
