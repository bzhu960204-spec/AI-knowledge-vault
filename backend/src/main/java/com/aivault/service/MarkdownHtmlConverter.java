package com.aivault.service;

import com.vladsch.flexmark.ext.gfm.strikethrough.StrikethroughExtension;
import com.vladsch.flexmark.ext.gfm.tasklist.TaskListExtension;
import com.vladsch.flexmark.ext.tables.TablesExtension;
import com.vladsch.flexmark.html.HtmlRenderer;
import com.vladsch.flexmark.parser.Parser;
import com.vladsch.flexmark.util.data.MutableDataSet;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Converts legacy Markdown answers into the rich-text HTML the TipTap editor
 * expects.
 *
 * <p>Math is pulled out before Markdown parsing so blank lines / emphasis can't
 * mangle the LaTeX, then re-inserted as plain {@code $…$} / {@code $$…$$} text.
 * The editor's own {@code migrateMathStrings} turns those delimiters into math
 * nodes on load, and the export view renders them with KaTeX — so no formula is
 * lost in the one-time Markdown → HTML migration.</p>
 */
@Component
public class MarkdownHtmlConverter {

    private static final String MATH_MARK = "\uE000";
    private static final Pattern BLOCK_MATH = Pattern.compile("\\$\\$(.+?)\\$\\$", Pattern.DOTALL);
    private static final Pattern INLINE_MATH = Pattern.compile("\\$([^$\\n]+?)\\$");

    private final Parser parser;
    private final HtmlRenderer renderer;

    public MarkdownHtmlConverter() {
        MutableDataSet options = new MutableDataSet();
        options.set(Parser.EXTENSIONS, List.of(
                TablesExtension.create(),
                StrikethroughExtension.create(),
                TaskListExtension.create()
        ));
        this.parser = Parser.builder(options).build();
        this.renderer = HtmlRenderer.builder(options).build();
    }

    /** Render Markdown to HTML, preserving {@code $…$} / {@code $$…$$} math. */
    public String toHtml(String markdown) {
        if (markdown == null || markdown.isBlank()) {
            return "";
        }
        List<String> blocks = new ArrayList<>();
        List<String> inlines = new ArrayList<>();
        String protectedMd = protectMath(markdown, blocks, inlines);
        String html = renderer.render(parser.parse(protectedMd));
        return restoreMath(html, blocks, inlines);
    }

    private String protectMath(String markdown, List<String> blocks, List<String> inlines) {
        Matcher blockMatcher = BLOCK_MATH.matcher(markdown);
        StringBuilder afterBlocks = new StringBuilder();
        while (blockMatcher.find()) {
            int index = blocks.size();
            blocks.add(blockMatcher.group(1).trim());
            blockMatcher.appendReplacement(afterBlocks,
                    Matcher.quoteReplacement(MATH_MARK + "MB" + index + MATH_MARK));
        }
        blockMatcher.appendTail(afterBlocks);

        Matcher inlineMatcher = INLINE_MATH.matcher(afterBlocks.toString());
        StringBuilder result = new StringBuilder();
        while (inlineMatcher.find()) {
            String tex = inlineMatcher.group(1).trim();
            if (tex.isEmpty()) {
                inlineMatcher.appendReplacement(result, Matcher.quoteReplacement(inlineMatcher.group()));
                continue;
            }
            int index = inlines.size();
            inlines.add(tex);
            inlineMatcher.appendReplacement(result,
                    Matcher.quoteReplacement(MATH_MARK + "MI" + index + MATH_MARK));
        }
        inlineMatcher.appendTail(result);
        return result.toString();
    }

    private String restoreMath(String html, List<String> blocks, List<String> inlines) {
        String result = html;
        for (int i = 0; i < blocks.size(); i++) {
            String token = MATH_MARK + "MB" + i + MATH_MARK;
            result = result.replace(token, "$$" + escape(blocks.get(i)) + "$$");
        }
        for (int i = 0; i < inlines.size(); i++) {
            String token = MATH_MARK + "MI" + i + MATH_MARK;
            result = result.replace(token, "$" + escape(inlines.get(i)) + "$");
        }
        return result;
    }

    private static String escape(String value) {
        if (value == null) {
            return "";
        }
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;");
    }
}
