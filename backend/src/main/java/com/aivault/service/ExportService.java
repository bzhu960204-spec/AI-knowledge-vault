package com.aivault.service;

import com.aivault.dto.ExportRequest;
import com.aivault.entity.Note;
import com.aivault.entity.Tag;
import com.aivault.repository.FolderRepository;
import com.aivault.repository.NoteRepository;
import com.vladsch.flexmark.ext.gfm.strikethrough.StrikethroughExtension;
import com.vladsch.flexmark.ext.gfm.tasklist.TaskListExtension;
import com.vladsch.flexmark.ext.tables.TablesExtension;
import com.vladsch.flexmark.html.HtmlRenderer;
import com.vladsch.flexmark.parser.Parser;
import com.vladsch.flexmark.util.data.MutableDataSet;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Renders one or more notes into a single, self-contained HTML document.
 *
 * <p>PDF export is handled on the client by printing this HTML, which keeps the
 * output consistent and lets the browser supply CJK fonts.</p>
 */
@Service
public class ExportService {

    private final NoteRepository noteRepository;
    private final FolderRepository folderRepository;
    private final Parser parser;
    private final HtmlRenderer renderer;

    public ExportService(NoteRepository noteRepository, FolderRepository folderRepository) {
        this.noteRepository = noteRepository;
        this.folderRepository = folderRepository;
        MutableDataSet options = new MutableDataSet();
        options.set(Parser.EXTENSIONS, List.of(
                TablesExtension.create(),
                StrikethroughExtension.create(),
                TaskListExtension.create()
        ));
        this.parser = Parser.builder(options).build();
        this.renderer = HtmlRenderer.builder(options).build();
    }

    @Transactional(readOnly = true)
    public String exportHtml(ExportRequest request) {
        List<Note> notes = resolveOrderedNotes(request);
        return buildDocument(notes, request);
    }

    /** Resolve the notes to export, preserving the requested order. */
    private List<Note> resolveOrderedNotes(ExportRequest request) {
        List<Long> ids = request.noteIds();
        if (ids != null && !ids.isEmpty()) {
            Map<Long, Note> byId = noteRepository.findAllById(ids).stream()
                    .collect(Collectors.toMap(Note::getId, note -> note));
            return ids.stream()
                    .map(byId::get)
                    .filter(Objects::nonNull)
                    .toList();
        }
        if (request.folderId() != null) {
            if (request.includeSubfolders()) {
                List<Long> folderIds = collectFolderAndDescendants(request.folderId());
                return noteRepository.findByFolderIdInOrderByFolderIdAscSortOrderAscCreatedAtDesc(folderIds);
            }
            return noteRepository.findByFolderIdOrderBySortOrderAscCreatedAtDesc(request.folderId());
        }
        if (request.includeSubfolders()) {
            return noteRepository.findAllByOrderByFolderIdAscSortOrderAscCreatedAtDesc();
        }
        return noteRepository.findByFolderIdIsNullOrderBySortOrderAscCreatedAtDesc();
    }

    private List<Long> collectFolderAndDescendants(Long rootId) {
        List<Long> result = new ArrayList<>();
        Deque<Long> queue = new ArrayDeque<>();
        queue.add(rootId);
        while (!queue.isEmpty()) {
            Long current = queue.poll();
            result.add(current);
            folderRepository.findByParentIdOrderBySortOrderAscNameAsc(current)
                    .forEach(child -> queue.add(child.getId()));
        }
        return result;
    }

    private String buildDocument(List<Note> notes, ExportRequest request) {
        String docTitle = request.title() != null && !request.title().isBlank()
                ? request.title().trim()
                : "Exported Notes";

        StringBuilder body = new StringBuilder();
        for (int i = 0; i < notes.size(); i++) {
            Note note = notes.get(i);
            body.append("<article class=\"note\">");
            body.append("<h1 class=\"note-title\">").append(escape(note.getTitle())).append("</h1>");

            String meta = buildMeta(note);
            if (!meta.isEmpty()) {
                body.append("<p class=\"note-meta\">").append(meta).append("</p>");
            }

            if (request.includeQuestion() && note.getQuestion() != null && !note.getQuestion().isBlank()) {
                body.append("<div class=\"note-question\"><div class=\"note-question-label\">Question</div>");
                body.append(renderMarkdown(note.getQuestion()));
                body.append("</div>");
            }

            body.append("<div class=\"note-body\">");
            body.append(renderMarkdown(note.getContentMarkdown()));
            body.append("</div>");
            body.append("</article>");
        }

        return HTML_TEMPLATE
                .replace("{{title}}", escape(docTitle))
                .replace("{{style}}", STYLE)
                .replace("{{body}}", body.toString());
    }

    private String buildMeta(Note note) {
        List<String> parts = new ArrayList<>();
        if (note.getSourceModel() != null && !note.getSourceModel().isBlank()) {
            parts.add(escape(note.getSourceModel()));
        }
        if (note.getTags() != null && !note.getTags().isEmpty()) {
            String tags = note.getTags().stream()
                    .map(Tag::getName)
                    .map(name -> "#" + escape(name))
                    .collect(Collectors.joining(" "));
            parts.add(tags);
        }
        return String.join(" · ", parts);
    }

    private String renderMarkdown(String markdown) {
        if (markdown == null || markdown.isBlank()) {
            return "";
        }
        // Pull math out before Markdown parsing so blank lines / emphasis can't
        // mangle the LaTeX, then re-insert clean spans for KaTeX to render.
        List<String> blocks = new ArrayList<>();
        List<String> inlines = new ArrayList<>();
        String protectedMd = protectMath(markdown, blocks, inlines);
        String html = renderer.render(parser.parse(protectedMd));
        return restoreMath(html, blocks, inlines);
    }

    private static final String MATH_MARK = "\uE000";
    private static final Pattern BLOCK_MATH = Pattern.compile("\\$\\$(.+?)\\$\\$", Pattern.DOTALL);
    private static final Pattern INLINE_MATH = Pattern.compile("\\$([^$\\n]+?)\\$");

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
            String replacement = "<span class=\"math-display\">$$" + escape(blocks.get(i)) + "$$</span>";
            result = result.replace(token, replacement);
        }
        for (int i = 0; i < inlines.size(); i++) {
            String token = MATH_MARK + "MI" + i + MATH_MARK;
            String replacement = "<span class=\"math-inline\">$" + escape(inlines.get(i)) + "$</span>";
            result = result.replace(token, replacement);
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
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }

    private static final String HTML_TEMPLATE = """
            <!DOCTYPE html>
            <html lang="zh">
            <head>
            <meta charset="UTF-8"/>
            <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
            <title>{{title}}</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"/>
            <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
            <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
            <script>
              window.__mathReady = false;
              function __renderMath() {
                try {
                  if (window.renderMathInElement) {
                    window.renderMathInElement(document.body, {
                      delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '$', right: '$', display: false }
                      ],
                      throwOnError: false
                    });
                  }
                } catch (e) { /* leave raw TeX on failure */ }
                window.__mathReady = true;
              }
              window.addEventListener('load', __renderMath);
            </script>
            <style>{{style}}</style>
            </head>
            <body>
            <main class="export-root">
            {{body}}
            </main>
            </body>
            </html>
            """;

    private static final String STYLE = """
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei",
                           "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif;
              color: #1a1a1a;
              line-height: 1.7;
              background: #fff;
            }
            .export-root { max-width: 820px; margin: 0 auto; padding: 40px 32px; }
            .note { padding-bottom: 8px; }
            .note + .note { border-top: 1px solid #e5e5e5; margin-top: 40px; padding-top: 32px; }
            .note-title { font-size: 1.8rem; font-weight: 700; margin: 0 0 8px; }
            .note-meta { font-size: 0.85rem; color: #888; margin: 0 0 20px; }
            .note-question {
              border-left: 3px solid #6b7cff;
              background: #f5f6ff;
              padding: 12px 16px;
              margin: 0 0 20px;
              border-radius: 4px;
            }
            .note-question-label {
              font-size: 0.72rem;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: #6b7cff;
              font-weight: 600;
              margin-bottom: 4px;
            }
            .note-question > *:last-child { margin-bottom: 0; }
            .note-body h1, .note-body h2, .note-body h3 { line-height: 1.3; margin: 1.4em 0 0.6em; }
            .note-body p { margin: 0.8em 0; }
            .note-body pre {
              background: #f4f4f5;
              padding: 14px 16px;
              border-radius: 6px;
              overflow-x: auto;
              font-size: 0.88rem;
            }
            .note-body code {
              font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
              background: #f0f0f1;
              padding: 0.15em 0.35em;
              border-radius: 3px;
              font-size: 0.9em;
            }
            .note-body pre code { background: none; padding: 0; }
            .note-body blockquote {
              border-left: 3px solid #ddd;
              margin: 0.8em 0;
              padding: 0.2em 1em;
              color: #666;
            }
            .note-body table { border-collapse: collapse; width: 100%; margin: 1em 0; }
            .note-body th, .note-body td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
            .note-body th { background: #f7f7f8; }
            .note-body img { max-width: 100%; }
            .note-body a { color: #4b5cd6; }
            .note-body .math-display { display: block; margin: 1em 0; text-align: center; overflow-x: auto; }
            .note-body .math-inline { white-space: nowrap; }
            .katex-display { margin: 0.8em 0; overflow-x: auto; overflow-y: hidden; }
            @media print {
              .export-root { max-width: none; padding: 0; }
              .note { page-break-inside: auto; }
              .note + .note { page-break-before: always; border-top: none; margin-top: 0; padding-top: 0; }
              pre, blockquote, table { page-break-inside: avoid; }
            }
            """;
}
