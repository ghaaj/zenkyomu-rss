import { type HTMLImageElement, Window } from "happy-dom";
import { assert, assertExists, assertInstanceOf } from "@std/assert";
import { type Category, Feed } from "feed";

function* take<T>(iterator: Iterator<T>, n: number) {
    for (let i = 0; i < n; i++) {
        const result = iterator.next();
        if (result.done) break;
        yield result.value;
    }
}

function* chunks<T>(iterable: Iterable<T>, n: number) {
    assert(n > 0);
    const it = Iterator.from(iterable);
    for (let chunk; (chunk = [...take(it, n)], chunk.length);) yield chunk;
}

function stripPrefix(str: string, prefix: string) {
    assert(str.startsWith(prefix));
    return str.slice(prefix.length);
}

const filenameToCategory: Record<string, string | string[]> = {
    "news_z_1.gif": "学籍",
    "news_z_2.gif": "履修",
    "news_z_3.gif": "授業",
    "news_z_4.gif": "試験",
    "news_z_5.gif": "成績",
    "news_z_6.gif": "進学",
    "news_z_7.gif": "教職",
    "news_z_8.gif": "留学",
    "news_z_9.gif": "システム",
    "news_z_10.gif": "窓口",
    "news_z_11.gif": "その他",
    "news_z_firstyear.gif": "1年生",
    "news_z_secondyear.gif": "2年生",
    "news_z_all.gif": ["1年生", "2年生"],
    "news_important2.gif": "重要",
    "icon_pdf.gif": "PDF",
    "new_icon.gif": "NEW",
};

function extractCategoryNames(...imgs: HTMLImageElement[]): ReadonlySet<string> {
    return new Set(imgs.flatMap((img) => {
        const filename = stripPrefix(
            new URL(img.src).pathname,
            "/zenki/news/kyoumu/images/common/",
        );
        return filenameToCategory[filename] ??
            (console.warn("Unknown asset filename:", filename), []);
    }));
}

const FEED_PATH = "./docs/feed.xml";

const ZENKYOMU_NEWS_URL = "https://www.c.u-tokyo.ac.jp/zenki/news/kyoumu/index.html";

async function main() {
    const window = new Window();
    const domParser = new window.DOMParser();

    const prevEtag = await Deno.readTextFile(FEED_PATH).then((content) => {
        const link = domParser
            .parseFromString(content, "text/xml")
            .querySelector("rss > channel > link");
        assertExists(link);
        return decodeURIComponent(stripPrefix(new URL(link.textContent).hash, "#"));
    }).catch((e) => {
        if (e instanceof Deno.errors.NotFound) return undefined;
        else throw e;
    });

    const zenkyomu_news = await fetch(ZENKYOMU_NEWS_URL, {
        headers: prevEtag !== undefined ? { "If-None-Match": `W/${prevEtag}` } : undefined,
    });
    if (zenkyomu_news.status === 304) {
        console.log("No changes detected");
        return;
    }
    assert(zenkyomu_news.ok);

    const etag = zenkyomu_news.headers.get("ETag");
    const document = domParser.parseFromString(await zenkyomu_news.text(), "text/html");

    const link = new URL(ZENKYOMU_NEWS_URL);
    if (etag !== null) link.hash = encodeURIComponent(etag.replace(/-gzip(?="$)/, ""));

    const feed = new Feed({
        title: document.title,
        link: link.href,
    });

    for (
        const [descTerm, descDesc] of chunks(document.querySelectorAll("#newslist2 > dl > *"), 2)
    ) {
        assertExists(descTerm);
        assertExists(descDesc);

        const [dateText, newsKindImg, targetGradesImg] = [...descTerm.childNodes];
        assertInstanceOf(dateText, window.Text);
        assertInstanceOf(newsKindImg, window.HTMLImageElement);
        assertInstanceOf(targetGradesImg, window.HTMLImageElement);

        const [yyyy, mm, dd] = dateText.data.trim().split(".");
        const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000+09:00`);

        const [anchor, ...tags] = [...descDesc.children];
        assertInstanceOf(anchor, window.HTMLAnchorElement);

        const categories = extractCategoryNames(
            newsKindImg,
            targetGradesImg,
            ...tags.map((t) => (assertInstanceOf(t, window.HTMLImageElement), t)),
        ).values().map((name): Category => ({ name })).toArray();

        feed.addItem({
            title: anchor.textContent,
            id: anchor.href,
            link: anchor.href,
            date,
            category: categories,
        });
    }

    await Deno.writeTextFile(FEED_PATH, feed.rss2());
}

await main();
