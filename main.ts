import { type HTMLImageElement, Window } from "happy-dom";
import { assert, assertExists, assertInstanceOf } from "@std/assert";
import { type Category, Feed } from "feed";
import * as path from "@std/path";

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
        const filename = new URL(img.src).pathname.split("/").at(-1)!;
        return filenameToCategory[filename] ??
            (console.warn("Unknown asset filename:", filename), []);
    }));
}

interface Source {
    path: string;
    url: string;
}

const window = new Window();
const domParser = new window.DOMParser();

async function emitNewsFeed(source: Source) {
    const feedFileDir = path.join("./docs", source.path);
    const feedFile = path.join(feedFileDir, "feed.xml");

    const prevEtag = await Deno.readTextFile(feedFile).then((content) => {
        const link = domParser
            .parseFromString(content, "text/xml")
            .querySelector("rss > channel > link");
        assertExists(link);
        return decodeURIComponent(stripPrefix(new URL(link.textContent).hash, "#"));
    }).catch((e) => {
        if (e instanceof Deno.errors.NotFound) return undefined;
        else throw e;
    });

    const newsRes = await fetch(source.url, {
        headers: prevEtag !== undefined ? { "If-None-Match": `W/${prevEtag}` } : undefined,
    });
    if (newsRes.status === 304) {
        console.log(`${source.path}: No changes detected`);
        return;
    }
    assert(newsRes.ok);

    const etag = newsRes.headers.get("ETag");
    const document = domParser.parseFromString(await newsRes.text(), "text/html");

    const link = new URL(source.url);
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

    await Deno.mkdir(feedFileDir, { recursive: true });
    await Deno.writeTextFile(feedFile, feed.rss2());
}

const SOURCES: readonly Source[] = [
    {
        path: "news",
        url: "https://www.c.u-tokyo.ac.jp/zenki/news/index.html",
    },
    {
        path: "news/kyoumu",
        url: "https://www.c.u-tokyo.ac.jp/zenki/news/kyoumu/index.html",
    },
    {
        path: "news/kyoumu/firstyear",
        url: "https://www.c.u-tokyo.ac.jp/zenki/news/kyoumu/firstyear/index.html",
    },
    {
        path: "news/kyoumu/secondyear",
        url: "https://www.c.u-tokyo.ac.jp/zenki/news/kyoumu/secondyear/index.html",
    },
    {
        path: "news/others",
        url: "https://www.c.u-tokyo.ac.jp/zenki/news/others/index.html",
    },
    {
        path: "news/others/firstyear",
        url: "https://www.c.u-tokyo.ac.jp/zenki/news/others/firstyear/index.html",
    },
    {
        path: "news/others/secondyear",
        url: "https://www.c.u-tokyo.ac.jp/zenki/news/others/secondyear/index.html",
    },
];

await Promise.all(SOURCES.map(emitNewsFeed));
