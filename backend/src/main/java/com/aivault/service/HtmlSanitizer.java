package com.aivault.service;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.safety.Safelist;
import org.springframework.stereotype.Component;

/**
 * Cleans rich-text answer HTML that arrives from an imported (untrusted) bundle.
 *
 * <p>Notes authored in this app are trusted, but a {@code .aivault} bundle can
 * come from anyone, so its stored HTML is a stored-XSS vector. This strips
 * scripts, event handlers and dangerous URLs while keeping the tags/attributes
 * the editor actually produces — formatting, links, images (incl. base64 data
 * URIs), tables, task lists and TipTap math nodes ({@code data-latex}).</p>
 */
@Component
public class HtmlSanitizer {

    private final Safelist safelist = buildSafelist();

    /** Returns cleaned HTML; {@code null}/blank input yields an empty string. */
    public String sanitize(String html) {
        if (html == null || html.isBlank()) {
            return "";
        }
        Document.OutputSettings settings = new Document.OutputSettings().prettyPrint(false);
        return Jsoup.clean(html, "", safelist, settings);
    }

    private Safelist buildSafelist() {
        return Safelist.relaxed()
                .addTags("span", "hr", "input", "label")
                // Attributes shared across the editor's nodes.
                .addAttributes(":all", "class", "style",
                        "data-latex", "data-type", "data-checked", "data-inline")
                .addAttributes("a", "href", "title", "target", "rel")
                .addAttributes("img", "src", "alt", "title", "width", "height", "style")
                .addAttributes("td", "colspan", "rowspan", "colwidth")
                .addAttributes("th", "colspan", "rowspan", "colwidth")
                .addAttributes("input", "type", "checked", "disabled")
                // Allow inline base64 images and ordinary web/mail links only.
                .addProtocols("img", "src", "http", "https", "data")
                .addProtocols("a", "href", "http", "https", "mailto");
    }
}
