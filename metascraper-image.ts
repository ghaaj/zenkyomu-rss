import { $jsonld, $meta, image, toRule } from "@metascraper/helpers";
import type { Rules } from "metascraper";
import type { CheerioAPI } from "cheerio";
import probe from "probe-image-size";

const toImage = toRule(image);

export function metascraperImage({
    minSize = 200,
    maxCandidates = 10,
    minAspectRatio = 1 / 2,
    maxAspectRatio = 16 / 9,
    exclude = /\.gif$/,
}: {
    minSize?: number;
    /** height / width */
    minAspectRatio?: number;
    maxAspectRatio?: number;
    maxCandidates?: number;
    exclude?: RegExp;
} = {}): Rules {
    return {
        pkgName: "metascraper-image-custom",
        image: [
            toImage($meta("og:image:secure_url")),
            toImage($meta("og:image:url")),
            toImage($meta("og:image")),
            toImage($meta("twitter:image:src")),
            toImage($meta("twitter:image")),
            toImage(($: CheerioAPI) => $('meta[itemprop="image"]').attr("content")),
            toImage($jsonld("image.0.url")),
            toImage($jsonld("image.url")),
            toImage($jsonld("image")),
            toImage(async ($: CheerioAPI, pageUrl: string | URL) => {
                const base = new URL(pageUrl);
                const baseHref = $("base[href]").attr("href");
                const resolveBase = baseHref ? new URL(baseHref, base) : base;
                const candidates = await Promise.all(
                    new Set(
                        $(':is(article, main, #main) img[src]:not([aria-hidden="true"])')
                            .map(function () {
                                const src = $(this).attr("data-src") ?? $(this).attr("src");
                                // RegExp#test だと lastIndex がややこしいので String#search
                                if (src === undefined || src.search(exclude) !== -1) return null;
                                return new URL(src, resolveBase).href;
                            }),
                    ).values().take(maxCandidates).map((url) =>
                        probe(url, {
                            timeout: 3000,
                            headers: { referer: base.href },
                        }).then(({ width, height }) => ({
                            width,
                            height,
                            url,
                        })).catch(() => null)
                    ),
                );
                return candidates.find((img) => {
                    if (!img) return false;
                    if (Math.min(img.width, img.height) < minSize) return false;
                    const aspectRatio = img.height / img.width;
                    return minAspectRatio <= aspectRatio && aspectRatio <= maxAspectRatio;
                })?.url;
            }),
        ],
    };
}
