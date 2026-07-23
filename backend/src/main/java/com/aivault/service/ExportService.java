package com.aivault.service;

import com.aivault.dto.ExportRequest;
import com.aivault.entity.Note;
import com.aivault.entity.NoteSegment;
import com.aivault.entity.QuestionImage;
import com.aivault.entity.Tag;
import com.aivault.repository.FolderRepository;
import com.aivault.repository.NoteRepository;
import com.aivault.repository.NoteSegmentRepository;
import com.aivault.repository.QuestionImageRepository;
import com.vladsch.flexmark.ext.gfm.strikethrough.StrikethroughExtension;
import com.vladsch.flexmark.ext.gfm.tasklist.TaskListExtension;
import com.vladsch.flexmark.ext.tables.TablesExtension;
import com.vladsch.flexmark.html.HtmlRenderer;
import com.vladsch.flexmark.parser.Parser;
import com.vladsch.flexmark.util.data.MutableDataSet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
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
    private final NoteSegmentRepository segmentRepository;
    private final QuestionImageRepository questionImageRepository;
    private final Path uploadDir;
    private final Parser parser;
    private final HtmlRenderer renderer;

    public ExportService(NoteRepository noteRepository, FolderRepository folderRepository,
                         NoteSegmentRepository segmentRepository,
                         QuestionImageRepository questionImageRepository,
                         @Value("${app.uploads.dir:./data/uploads}") String uploadDir) {
        this.noteRepository = noteRepository;
        this.folderRepository = folderRepository;
        this.segmentRepository = segmentRepository;
        this.questionImageRepository = questionImageRepository;
        this.uploadDir = Paths.get(uploadDir).toAbsolutePath().normalize();
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
        List<TocEntry> tocEntries = new ArrayList<>();
        int[] anchorSeq = {0};              // global counter keeps every anchor id unique
        boolean multi = notes.size() > 1;

        for (Note note : notes) {
            String noteAnchor = "sec-" + (++anchorSeq[0]);
            body.append("<article class=\"note\" id=\"").append(noteAnchor).append("\">");
            body.append("<h1 class=\"note-title\">").append(escape(note.getTitle())).append("</h1>");

            // Multi-note export: the note title is the top level of the tree TOC.
            // Single-note export skips it so the TOC is just that note's headings.
            if (multi) {
                tocEntries.add(new TocEntry(0, noteAnchor, note.getTitle()));
            }

            String meta = buildMeta(note);
            if (!meta.isEmpty()) {
                body.append("<p class=\"note-meta\">").append(meta).append("</p>");
            }

            for (NoteSegment segment : segmentRepository.findByNoteIdOrderByPositionAsc(note.getId())) {
                if (request.includeQuestion()) {
                    body.append(renderQuestionBlock(segment));
                }
                body.append("<div class=\"note-body\">");
                body.append(indexHeadings(
                        renderAnswer(segment.getAnswerHtml(), request.stripLinks()), tocEntries, anchorSeq));
                body.append(CLOSE_DIV);
            }
            body.append("</article>");
        }

        String tocMarkup = tocEntries.isEmpty() ? "" :
                "<input type=\"checkbox\" id=\"toc-toggle\" class=\"toc-toggle\" hidden />"
              + "<label for=\"toc-toggle\" class=\"toc-fab\" title=\"目录\" aria-label=\"打开目录\">"
              +   "<span class=\"toc-fab-icon\">\u2630</span></label>"
              + "<label for=\"toc-toggle\" class=\"toc-backdrop\"></label>"
              + "<aside class=\"toc-drawer\" aria-label=\"目录\">"
              +   "<div class=\"toc-drawer-head\"><span class=\"toc-title\">目录</span>"
              +     "<label for=\"toc-toggle\" class=\"toc-close\" title=\"关闭\" aria-label=\"关闭目录\">\u00d7</label></div>"
              +   "<nav class=\"toc\">"
              +   renderTocTree(tocEntries, new int[]{0}, -1, new int[]{0})
              +   "</nav></aside>";

        return HTML_TEMPLATE
                .replace("{{title}}", escape(docTitle))
                .replace("{{style}}", STYLE)
                .replace("{{toc}}", tocMarkup)
                .replace("{{body}}", body.toString());
    }

    /**
     * Injects a unique anchor {@code id} into every {@code <h1>–<h3>} in an
     * answer body and records each heading in the shared table of contents.
     * Empty headings are skipped so they don't create dead TOC entries.
     */
    private String indexHeadings(String html, List<TocEntry> tocEntries, int[] anchorSeq) {
        Matcher m = HEADING.matcher(html);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            int level = Integer.parseInt(m.group(1));
            String attrs = m.group(2);
            String inner = m.group(3);
            String text = INNER_TAGS.matcher(inner).replaceAll("").trim();
            if (text.isEmpty()) {
                m.appendReplacement(out, Matcher.quoteReplacement(m.group()));
                continue;
            }
            String anchor = "sec-" + (++anchorSeq[0]);
            tocEntries.add(new TocEntry(level, anchor, text));
            String replaced = "<h" + level + " id=\"" + anchor + "\"" + attrs + ">"
                    + inner + "</h" + level + ">";
            m.appendReplacement(out, Matcher.quoteReplacement(replaced));
        }
        m.appendTail(out);
        return out.toString();
    }

    /**
     * Renders the collected {@link TocEntry} list as a nested, collapsible tree.
     * Any entry followed by deeper-level entries becomes a branch whose caret
     * toggles its children (pure CSS, via a hidden checkbox).
     */
    private String renderTocTree(List<TocEntry> entries, int[] pos, int parentLevel, int[] branchSeq) {
        StringBuilder sb = new StringBuilder("<ul>");
        while (pos[0] < entries.size() && entries.get(pos[0]).level() > parentLevel) {
            TocEntry e = entries.get(pos[0]);
            int level = e.level();
            pos[0]++;
            boolean hasChildren = pos[0] < entries.size() && entries.get(pos[0]).level() > level;
            sb.append("<li class=\"toc-l").append(level).append("\">");
            if (hasChildren) {
                String branchId = "br-" + (++branchSeq[0]);
                sb.append("<input type=\"checkbox\" class=\"toc-branch\" id=\"").append(branchId)
                  .append("\" checked hidden/>")
                  .append("<div class=\"toc-row\">")
                  .append("<label class=\"toc-caret\" for=\"").append(branchId).append("\"></label>")
                  .append("<a href=\"#").append(e.anchor()).append("\">").append(escape(e.text())).append("</a>")
                  .append("</div>");
                sb.append(renderTocTree(entries, pos, level, branchSeq));
            } else {
                sb.append("<div class=\"toc-row\">")
                  .append("<span class=\"toc-caret toc-caret-empty\"></span>")
                  .append("<a href=\"#").append(e.anchor()).append("\">").append(escape(e.text())).append("</a>")
                  .append("</div>");
            }
            sb.append("</li>");
        }
        sb.append("</ul>");
        return sb.toString();
    }

    /** A single table-of-contents entry: its depth, anchor target and label. */
    private record TocEntry(int level, String anchor, String text) {
    }

    /** The "Question" block: optional question text plus any inlined images. */
    private String renderQuestionBlock(NoteSegment segment) {
        boolean hasText = segment.getQuestion() != null && !segment.getQuestion().isBlank();
        String images = renderQuestionImages(segment.getId());
        if (!hasText && images.isEmpty()) {
            return "";
        }
        StringBuilder block = new StringBuilder(
                "<div class=\"note-question\"><div class=\"note-question-label\">Question</div>");
        if (hasText) {
            block.append(renderMarkdown(segment.getQuestion()));
        }
        block.append(images);
        block.append(CLOSE_DIV);
        return block.toString();
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

    /** Render every question image inline as a self-contained base64 data URI. */
    private String renderQuestionImages(Long segmentId) {
        List<QuestionImage> images = questionImageRepository.findBySegmentIdOrderByCreatedAtAsc(segmentId);
        if (images.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder("<div class=\"note-question-images\">");
        for (QuestionImage image : images) {
            String dataUri = toDataUri(image);
            if (dataUri == null) {
                continue;
            }
            String alt = image.getOriginalName() != null ? escape(image.getOriginalName()) : "";
            sb.append("<img src=\"").append(dataUri).append("\" alt=\"").append(alt).append("\"/>");
        }
        sb.append(CLOSE_DIV);
        return sb.toString();
    }

    private String toDataUri(QuestionImage image) {
        try {
            Path target = uploadDir.resolve(image.getFilename()).normalize();
            if (!target.startsWith(uploadDir) || !Files.exists(target)) {
                return null;
            }
            byte[] bytes = Files.readAllBytes(target);
            String contentType = image.getContentType() != null ? image.getContentType() : "image/png";
            return "data:" + contentType + ";base64," + Base64.getEncoder().encodeToString(bytes);
        } catch (IOException e) {
            return null;
        }
    }

    /**
     * Answers are stored as rich-text HTML by the editor, so they are embedded
     * directly. Math arrives either as TipTap {@code data-latex} nodes or as
     * legacy {@code $…$} text; both are rendered client-side by KaTeX (see the
     * document template's {@code __renderMath}).
     *
     * <p>When {@code stripLinks} is set, citation-style anchors pasted from AI
     * chat (e.g. {@code [[DEV] Mand…| Txt]}) are removed entirely so they don't
     * clutter the exported document. Ordinary hyperlinks are left untouched.</p>
     */
    private String renderAnswer(String html, boolean stripLinks) {
        if (html == null) {
            return "";
        }
        return stripLinks ? CITATION_LINK.matcher(html).replaceAll("") : html;
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
    private static final String CLOSE_DIV = "</div>";
    /**
     * Matches citation-style anchors whose visible text looks like an AI-chat
     * reference chip: wrapped in {@code [...]} and containing a {@code |}
     * separator (e.g. {@code [$$ITX Mappin…9814676666 | PDF$$]}). Ordinary
     * hyperlinks don't match, so they survive the strip.
     */
    private static final Pattern CITATION_LINK = Pattern.compile(
            "<a\\b[^>]*>\\s*\\[[^<]*\\|[^<]*\\]\\s*</a>",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern BLOCK_MATH = Pattern.compile("\\$\\$(.+?)\\$\\$", Pattern.DOTALL);
    private static final Pattern INLINE_MATH = Pattern.compile("\\$([^$\\n]+?)\\$");
    /** Answer-body headings that feed the table of contents. */
    private static final Pattern HEADING = Pattern.compile(
            "<h([1-3])\\b([^>]*)>(.*?)</h\\1>",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    /** Strips inline markup so a heading yields plain text for the TOC. */
    private static final Pattern INNER_TAGS = Pattern.compile("<[^>]+>");

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
                  // TipTap math nodes carry their LaTeX in data-latex.
                  if (window.katex) {
                    document.querySelectorAll('[data-latex]').forEach(function (el) {
                      var display = el.getAttribute('data-type') === 'block-math';
                      try {
                        window.katex.render(el.getAttribute('data-latex'), el, {
                          displayMode: display,
                          throwOnError: false
                        });
                      } catch (e) { /* leave raw TeX on failure */ }
                    });
                  }
                  // Legacy notes keep inline $…$ / $$…$$ delimiters.
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
            {{toc}}
            <main class="export-root">
            {{body}}
            </main>
            <script>
              (function () {
                var toggle = document.getElementById('toc-toggle');
                if (!toggle) return;
                document.querySelectorAll('.toc a').forEach(function (a) {
                  a.addEventListener('click', function () { toggle.checked = false; });
                });
              })();
            </script>
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
            .toc-toggle { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
            .toc-fab {
              position: fixed; top: 20px; left: 20px; z-index: 50;
              width: 46px; height: 46px; border-radius: 12px;
              display: flex; align-items: center; justify-content: center;
              background: #1f2328; color: #fff; cursor: pointer;
              box-shadow: 0 6px 18px rgba(16, 24, 40, 0.22);
              transition: opacity .2s ease, transform .2s ease, background .2s ease;
            }
            .toc-fab:hover { transform: translateY(-1px); background: #2d333b; }
            .toc-fab-icon { font-size: 19px; line-height: 1; }
            .toc-backdrop {
              position: fixed; inset: 0; z-index: 60;
              background: rgba(16, 24, 40, 0.38);
              opacity: 0; visibility: hidden;
              transition: opacity .25s ease, visibility .25s ease; cursor: pointer;
            }
            .toc-drawer {
              position: fixed; top: 0; left: 0; bottom: 0; z-index: 70;
              width: 308px; max-width: 84vw;
              display: flex; flex-direction: column;
              background: #fff; border-right: 1px solid #e2e6ea;
              box-shadow: 0 0 48px rgba(16, 24, 40, 0.20);
              transform: translateX(-100%);
              transition: transform .28s cubic-bezier(.4, 0, .2, 1);
            }
            .toc-drawer-head {
              flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
              padding: 18px 20px; border-bottom: 1px solid #eef0f2;
            }
            .toc-close {
              width: 30px; height: 30px; border-radius: 8px;
              display: flex; align-items: center; justify-content: center;
              font-size: 22px; line-height: 1; color: #6b7280; cursor: pointer;
              transition: background .15s ease, color .15s ease;
            }
            .toc-close:hover { background: #f1f3f5; color: #1f2328; }
            .toc-toggle:checked ~ .toc-drawer { transform: translateX(0); }
            .toc-toggle:checked ~ .toc-backdrop { opacity: 1; visibility: visible; }
            .toc-toggle:checked ~ .toc-fab { opacity: 0; pointer-events: none; transform: scale(.9); }
            .toc { flex: 1 1 auto; overflow-y: auto; padding: 14px 12px 28px; }
            .toc-title { font-size: 1rem; font-weight: 700; margin: 0; color: #1f2328; }
            .toc ul { list-style: none; margin: 0; padding: 0; }
            .toc li > ul { padding-left: 14px; }
            .toc li { margin: 1px 0; line-height: 1.5; }
            .toc-row { display: flex; align-items: flex-start; }
            .toc-caret {
              flex: 0 0 auto; width: 18px; height: 26px;
              display: inline-flex; align-items: center; justify-content: center;
              cursor: pointer; user-select: none;
            }
            .toc-caret::before {
              content: ''; width: 0; height: 0;
              border-left: 5px solid #8a94a6;
              border-top: 4px solid transparent; border-bottom: 4px solid transparent;
              transform: rotate(90deg); transition: transform .15s ease;
            }
            .toc-caret:hover::before { border-left-color: #1f2328; }
            .toc-caret-empty { cursor: default; }
            .toc-caret-empty::before { display: none; }
            .toc-branch:not(:checked) ~ .toc-row .toc-caret::before { transform: rotate(0deg); }
            .toc-branch:not(:checked) ~ ul { display: none; }
            .toc a {
              flex: 1 1 auto; display: block; padding: 3px 8px; border-radius: 6px;
              color: #1d4ed8; text-decoration: none; font-size: 0.9rem;
              transition: background .15s ease; word-break: break-word;
            }
            .toc a:hover { background: #f1f5ff; }
            .toc-l0 > .toc-row > a { font-weight: 700; }
            .toc-l1 > .toc-row > a { font-weight: 600; }
            .toc-l2 > .toc-row > a { font-size: 0.85rem; color: #2a4bb8; }
            .toc-l3 > .toc-row > a { font-size: 0.82rem; color: #4a5a8a; }
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
            .note-question-images {
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
              margin-top: 10px;
            }
            .note-question-images img {
              max-width: 320px;
              max-height: 240px;
              border: 1px solid #d7d9ff;
              border-radius: 6px;
            }
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
              .toc-toggle, .toc-fab, .toc-backdrop, .toc-drawer { display: none !important; }
              .note { page-break-inside: auto; }
              .note + .note { page-break-before: always; border-top: none; margin-top: 0; padding-top: 0; }
              pre, blockquote, table { page-break-inside: avoid; }
            }
            """;
}
