package com.aivault.service;

import com.aivault.dto.NoteDto;
import com.aivault.dto.NoteRequest;
import com.aivault.dto.NoteSegmentDto;
import com.aivault.dto.NoteSegmentRequest;
import com.aivault.dto.NoteSummaryDto;
import com.aivault.dto.SearchResultDto;
import com.aivault.entity.Folder;
import com.aivault.entity.Note;
import com.aivault.entity.NoteSegment;
import com.aivault.entity.Tag;
import com.aivault.exception.NotFoundException;
import com.aivault.repository.FolderRepository;
import com.aivault.repository.NoteRepository;
import com.aivault.repository.NoteSegmentRepository;
import com.aivault.repository.TagRepository;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class NoteService {

    private static final int EXCERPT_LENGTH = 160;

    private final NoteRepository noteRepository;
    private final FolderRepository folderRepository;
    private final TagRepository tagRepository;
    private final NoteSegmentRepository segmentRepository;
    private final QuestionImageService questionImageService;

    public NoteService(NoteRepository noteRepository, FolderRepository folderRepository,
                       TagRepository tagRepository, NoteSegmentRepository segmentRepository,
                       QuestionImageService questionImageService) {
        this.noteRepository = noteRepository;
        this.folderRepository = folderRepository;
        this.tagRepository = tagRepository;
        this.segmentRepository = segmentRepository;
        this.questionImageService = questionImageService;
    }

    @Transactional(readOnly = true)
    public List<NoteSummaryDto> list(Long folderId, String tag, boolean includeSubfolders) {
        List<Note> notes;
        if (tag != null && !tag.isBlank()) {
            notes = noteRepository.findByTagName(tag.trim());
        } else if (folderId != null) {
            if (includeSubfolders) {
                List<Long> folderIds = collectFolderAndDescendants(folderId);
                notes = noteRepository.findByFolderIdInOrderByFolderIdAscSortOrderAscCreatedAtDesc(folderIds);
            } else {
                notes = noteRepository.findByFolderIdOrderBySortOrderAscCreatedAtDesc(folderId);
            }
        } else {
            if (includeSubfolders) {
                notes = noteRepository.findAllByOrderByFolderIdAscSortOrderAscCreatedAtDesc();
            } else {
                notes = noteRepository.findByFolderIdIsNullOrderBySortOrderAscCreatedAtDesc();
            }
        }
        return toSummaries(notes);
    }

    private List<Long> collectFolderAndDescendants(Long rootId) {
        List<Long> result = new java.util.ArrayList<>();
        java.util.Deque<Long> queue = new java.util.ArrayDeque<>();
        queue.add(rootId);
        while (!queue.isEmpty()) {
            Long current = queue.poll();
            result.add(current);
            folderRepository.findByParentIdOrderBySortOrderAscNameAsc(current)
                    .forEach(child -> queue.add(child.getId()));
        }
        return result;
    }

    @Transactional(readOnly = true)
    public List<SearchResultDto> search(String query, Long folderId, boolean includeSubfolders,
                                        String tagFilter, String field, String sort) {
        List<String> terms = tokenize(query);
        if (terms.isEmpty()) {
            return List.of();
        }

        List<Note> candidates = noteRepository.findAll(searchSpec(terms));
        if (candidates.isEmpty()) {
            return List.of();
        }

        Set<Long> folderScope = null;
        if (folderId != null) {
            folderScope = includeSubfolders
                    ? new HashSet<>(collectFolderAndDescendants(folderId))
                    : Set.of(folderId);
        }
        String scope = (field == null || field.isBlank()) ? "all" : field.trim().toLowerCase();
        String normalizedTag = (tagFilter == null || tagFilter.isBlank()) ? null : tagFilter.trim();

        List<Long> ids = candidates.stream().map(Note::getId).toList();
        Map<Long, List<NoteSegment>> segsByNote = new HashMap<>();
        for (NoteSegment s : segmentRepository.findByNoteIdInOrderByNoteIdAscPositionAsc(ids)) {
            segsByNote.computeIfAbsent(s.getNoteId(), k -> new ArrayList<>()).add(s);
        }
        Map<Long, String> folderPaths = buildFolderPaths();

        List<Scored> scored = new ArrayList<>();
        for (Note note : candidates) {
            if (folderScope != null
                    && (note.getFolderId() == null || !folderScope.contains(note.getFolderId()))) {
                continue;
            }
            if (normalizedTag != null
                    && note.getTags().stream().noneMatch(t -> t.getName().equalsIgnoreCase(normalizedTag))) {
                continue;
            }
            Scored hit = evaluate(note, segsByNote.getOrDefault(note.getId(), List.of()),
                    terms, scope, folderPaths);
            if (hit != null) {
                scored.add(hit);
            }
        }

        Comparator<Scored> byRelevance = Comparator
                .comparingDouble((Scored s) -> s.score).reversed()
                .thenComparing(s -> s.result.updatedAt(), Comparator.reverseOrder());
        Comparator<Scored> byUpdated = Comparator
                .comparing((Scored s) -> s.result.updatedAt(), Comparator.reverseOrder());
        scored.sort("updated".equalsIgnoreCase(sort) ? byUpdated : byRelevance);

        return scored.stream().map(s -> s.result).toList();
    }

    /** A search hit paired with its relevance score, used only for sorting. */
    private record Scored(SearchResultDto result, double score) {
    }

    /**
     * Split a raw query into lowercase terms. Whitespace separates terms and a
     * {@code "quoted phrase"} is kept as a single term. Duplicates are dropped.
     */
    private List<String> tokenize(String query) {
        if (query == null || query.isBlank()) {
            return List.of();
        }
        List<String> terms = new ArrayList<>();
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"([^\"]+)\"|(\\S+)")
                .matcher(query.trim());
        while (m.find()) {
            String token = (m.group(1) != null ? m.group(1) : m.group(2)).trim().toLowerCase();
            if (!token.isBlank() && !terms.contains(token)) {
                terms.add(token);
            }
        }
        return terms;
    }

    /**
     * Broad DB pre-filter: every term must appear somewhere (title, a tag, or a
     * segment's question/answer). Ranking, plain-text re-verification and field
     * scoping happen afterwards in Java.
     */
    private Specification<Note> searchSpec(List<String> terms) {
        return (root, query, cb) -> {
            List<Predicate> perTerm = new ArrayList<>();
            for (String term : terms) {
                String pattern = "%" + escapeLike(term) + "%";

                Predicate titleMatch = cb.like(cb.lower(root.get("title")), pattern, '\\');

                Subquery<Integer> tagSub = query.subquery(Integer.class);
                Root<Note> tagRoot = tagSub.from(Note.class);
                var tagJoin = tagRoot.join("tags");
                tagSub.select(cb.literal(1)).where(
                        cb.equal(tagRoot.get("id"), root.get("id")),
                        cb.like(cb.lower(tagJoin.get("name")), pattern, '\\'));

                Subquery<Integer> segSub = query.subquery(Integer.class);
                Root<NoteSegment> segRoot = segSub.from(NoteSegment.class);
                segSub.select(cb.literal(1)).where(
                        cb.equal(segRoot.get("noteId"), root.get("id")),
                        cb.or(
                                cb.like(cb.lower(segRoot.get("question")), pattern, '\\'),
                                cb.like(cb.lower(segRoot.get("answerHtml")), pattern, '\\')));

                perTerm.add(cb.or(titleMatch, cb.exists(tagSub), cb.exists(segSub)));
            }
            return cb.and(perTerm.toArray(new Predicate[0]));
        };
    }

    private String escapeLike(String term) {
        return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    /**
     * Score a candidate against the query using plain text (HTML stripped), and
     * build its {@link SearchResultDto}. Returns {@code null} when the note does
     * not truly satisfy the query under the requested {@code scope} — this also
     * drops false positives where a term only matched HTML markup.
     */
    private Scored evaluate(Note note, List<NoteSegment> segments, List<String> terms,
                            String scope, Map<Long, String> folderPaths) {
        String title = note.getTitle() == null ? "" : note.getTitle();
        String titleLc = title.toLowerCase();
        List<String> tagNames = note.getTags().stream().map(Tag::getName).toList();
        String tagLc = String.join("\n", tagNames).toLowerCase();

        List<String> questionTexts = new ArrayList<>();
        List<String> answerTexts = new ArrayList<>();
        for (NoteSegment s : segments) {
            questionTexts.add(plainText(s.getQuestion()));
            answerTexts.add(plainText(s.getAnswerHtml()));
        }
        String questionLc = String.join("\n", questionTexts).toLowerCase();
        String answerLc = String.join("\n", answerTexts).toLowerCase();

        boolean qualifies = switch (scope) {
            case "title" -> allTermsIn(titleLc, terms);
            case "question" -> allTermsIn(questionLc, terms);
            case "answer" -> allTermsIn(answerLc, terms);
            default -> terms.stream().allMatch(t ->
                    titleLc.contains(t) || tagLc.contains(t)
                            || questionLc.contains(t) || answerLc.contains(t));
        };
        if (!qualifies) {
            return null;
        }

        List<String> matchFields = new ArrayList<>();
        if (anyTermIn(titleLc, terms)) matchFields.add("title");
        if (anyTermIn(tagLc, terms)) matchFields.add("tag");
        if (anyTermIn(questionLc, terms)) matchFields.add("question");
        if (anyTermIn(answerLc, terms)) matchFields.add("answer");

        Integer matchSegment = null;
        for (int i = 0; i < segments.size(); i++) {
            if (anyTermIn(questionTexts.get(i).toLowerCase(), terms)
                    || anyTermIn(answerTexts.get(i).toLowerCase(), terms)) {
                matchSegment = i + 1;
                break;
            }
        }

        String snippet = buildSnippet(scope, terms, title, questionTexts, answerTexts);
        double score = score(terms, titleLc, tagLc, questionLc, answerLc);

        SearchResultDto dto = new SearchResultDto(
                note.getId(),
                title,
                note.getFolderId(),
                folderPaths.get(note.getFolderId()),
                note.getSourceModel(),
                tagNames,
                snippet,
                terms,
                matchFields,
                matchSegment,
                note.getUpdatedAt());
        return new Scored(dto, score);
    }

    private boolean allTermsIn(String text, List<String> terms) {
        return terms.stream().allMatch(text::contains);
    }

    private boolean anyTermIn(String text, List<String> terms) {
        return terms.stream().anyMatch(text::contains);
    }

    private double score(List<String> terms, String titleLc, String tagLc,
                         String questionLc, String answerLc) {
        double score = 0;
        for (String term : terms) {
            if (titleLc.contains(term)) score += 10;
            if (tagLc.contains(term)) score += 6;
            if (questionLc.contains(term)) score += 4;
            if (answerLc.contains(term)) score += 2;
        }
        String joined = String.join(" ", terms);
        if (titleLc.equals(joined)) {
            score += 25;
        } else if (titleLc.startsWith(joined)) {
            score += 15;
        }
        return score;
    }

    /**
     * Build a context snippet: pick the most relevant field text for the scope,
     * find the earliest matching term and return a window of text around it so
     * the user can see the match in context (not just the note's opening line).
     */
    private String buildSnippet(String scope, List<String> terms, String title,
                                List<String> questionTexts, List<String> answerTexts) {
        String answers = String.join(" \u00b7 ", answerTexts).replaceAll("\\s+", " ").trim();
        String questions = String.join(" \u00b7 ", questionTexts).replaceAll("\\s+", " ").trim();

        List<String> ordered = switch (scope) {
            case "title" -> List.of(title);
            case "question" -> List.of(questions, answers);
            case "answer" -> List.of(answers, questions);
            default -> List.of(answers, questions, title);
        };
        for (String source : ordered) {
            if (source != null && !source.isBlank() && anyTermIn(source.toLowerCase(), terms)) {
                return window(source, terms);
            }
        }
        String fallback = ordered.stream()
                .filter(s -> s != null && !s.isBlank())
                .findFirst()
                .orElse("");
        return fallback.length() <= EXCERPT_LENGTH
                ? fallback
                : fallback.substring(0, EXCERPT_LENGTH) + "\u2026";
    }

    private String window(String text, List<String> terms) {
        String lower = text.toLowerCase();
        int idx = -1;
        for (String term : terms) {
            int found = lower.indexOf(term);
            if (found >= 0 && (idx < 0 || found < idx)) {
                idx = found;
            }
        }
        if (idx < 0) {
            return text.length() <= EXCERPT_LENGTH ? text : text.substring(0, EXCERPT_LENGTH) + "\u2026";
        }
        int start = Math.max(0, idx - EXCERPT_LENGTH / 3);
        int end = Math.min(text.length(), start + EXCERPT_LENGTH);
        String slice = text.substring(start, end).trim();
        if (start > 0) slice = "\u2026" + slice;
        if (end < text.length()) slice = slice + "\u2026";
        return slice;
    }

    private Map<Long, String> buildFolderPaths() {
        Map<Long, Folder> byId = new HashMap<>();
        for (Folder folder : folderRepository.findAll()) {
            byId.put(folder.getId(), folder);
        }
        Map<Long, String> paths = new HashMap<>();
        for (Folder folder : byId.values()) {
            List<String> parts = new ArrayList<>();
            Folder current = folder;
            Set<Long> guard = new HashSet<>();
            while (current != null && guard.add(current.getId())) {
                parts.add(0, current.getName());
                current = current.getParentId() == null ? null : byId.get(current.getParentId());
            }
            paths.put(folder.getId(), String.join(" / ", parts));
        }
        return paths;
    }

    @Transactional(readOnly = true)
    public NoteDto get(Long id) {
        return toDto(findNote(id));
    }

    @Transactional
    public NoteDto create(NoteRequest request) {
        Note note = new Note();
        applyMetadata(note, request);
        note.setSortOrder(nextSortOrder(note.getFolderId()));
        Note saved = noteRepository.save(note);
        applySegments(saved.getId(), request.segments());
        return toDto(saved);
    }

    /** Next sort order to place a new note at the bottom of its folder. */
    private int nextSortOrder(Long folderId) {
        List<Note> siblings = (folderId == null)
                ? noteRepository.findByFolderIdIsNullOrderBySortOrderAscCreatedAtDesc()
                : noteRepository.findByFolderIdOrderBySortOrderAscCreatedAtDesc(folderId);
        return siblings.stream()
                .mapToInt(Note::getSortOrder)
                .max()
                .orElse(-1) + 1;
    }

    @Transactional
    public NoteDto update(Long id, NoteRequest request) {
        Note note = findNote(id);
        applyMetadata(note, request);
        Note saved = noteRepository.saveAndFlush(note);
        applySegments(saved.getId(), request.segments());
        cleanupOrphanTags();
        return toDto(saved);
    }

    @Transactional
    public NoteDto move(Long id, Long folderId) {
        Note note = findNote(id);
        note.setFolderId(resolveFolder(folderId));
        return toDto(noteRepository.save(note));
    }

    @Transactional
    public void reorder(List<Long> orderedIds) {
        if (orderedIds == null || orderedIds.isEmpty()) {
            return;
        }
        List<Note> notes = noteRepository.findAllById(orderedIds);
        java.util.Map<Long, Note> byId = new java.util.HashMap<>();
        for (Note note : notes) {
            byId.put(note.getId(), note);
        }
        int index = 0;
        for (Long id : orderedIds) {
            Note note = byId.get(id);
            if (note != null) {
                note.setSortOrder(index++);
            }
        }
        noteRepository.saveAll(byId.values());
    }

    @Transactional
    public void delete(Long id) {
        Note note = findNote(id);
        List<NoteSegment> segments = segmentRepository.findByNoteIdOrderByPositionAsc(id);
        for (NoteSegment segment : segments) {
            questionImageService.deleteAllForSegment(segment.getId());
        }
        // Catch any legacy images that were never linked to a segment.
        questionImageService.deleteAllForNote(id);
        segmentRepository.deleteByNoteId(id);
        noteRepository.delete(note);
        noteRepository.flush();
        cleanupOrphanTags();
    }

    private void cleanupOrphanTags() {
        List<Tag> orphans = tagRepository.findOrphans();
        if (!orphans.isEmpty()) {
            tagRepository.deleteAll(orphans);
        }
    }

    private Note findNote(Long id) {
        return noteRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Note not found: " + id));
    }

    private void applyMetadata(Note note, NoteRequest request) {
        String title = request.title();
        note.setTitle(title.isBlank() ? "Untitled" : title.trim());
        note.setSourceModel(request.sourceModel());
        note.setFolderId(resolveFolder(request.folderId()));
        note.setTags(resolveTags(request.tags()));
    }

    /**
     * Reconcile a note's segments with the requested list: update existing ones
     * (matched by id), create new ones (null id), and delete any that are no
     * longer present (removing their images too). Position follows list order.
     * A note always keeps at least one segment.
     */
    private void applySegments(Long noteId, List<NoteSegmentRequest> requests) {
        List<NoteSegmentRequest> incoming = requests != null ? requests : List.of();

        Map<Long, NoteSegment> existing = new HashMap<>();
        for (NoteSegment segment : segmentRepository.findByNoteIdOrderByPositionAsc(noteId)) {
            existing.put(segment.getId(), segment);
        }

        deleteRemovedSegments(existing, incoming);
        segmentRepository.saveAll(buildSegments(noteId, existing, incoming));
    }

    private void deleteRemovedSegments(Map<Long, NoteSegment> existing, List<NoteSegmentRequest> incoming) {
        Set<Long> keepIds = new HashSet<>();
        for (NoteSegmentRequest req : incoming) {
            if (req.id() != null) {
                keepIds.add(req.id());
            }
        }
        for (NoteSegment segment : existing.values()) {
            if (!keepIds.contains(segment.getId())) {
                questionImageService.deleteAllForSegment(segment.getId());
                segmentRepository.delete(segment);
            }
        }
    }

    private List<NoteSegment> buildSegments(Long noteId, Map<Long, NoteSegment> existing,
                                            List<NoteSegmentRequest> incoming) {
        List<NoteSegment> result = new ArrayList<>();
        int position = 0;
        for (NoteSegmentRequest req : incoming) {
            NoteSegment segment = req.id() != null ? existing.get(req.id()) : null;
            if (segment == null) {
                segment = new NoteSegment();
                segment.setNoteId(noteId);
            }
            segment.setPosition(position++);
            segment.setQuestion(req.question());
            segment.setAnswerHtml(req.answerHtml() != null ? req.answerHtml() : "");
            segment.setContentFormat("html");
            result.add(segment);
        }
        // A note must always have at least one segment for the editor to render.
        if (result.isEmpty()) {
            NoteSegment segment = new NoteSegment();
            segment.setNoteId(noteId);
            segment.setPosition(0);
            segment.setAnswerHtml("");
            segment.setContentFormat("html");
            result.add(segment);
        }
        return result;
    }

    private Long resolveFolder(Long folderId) {
        if (folderId == null) {
            return null;
        }
        if (!folderRepository.existsById(folderId)) {
            throw new NotFoundException("Folder not found: " + folderId);
        }
        return folderId;
    }

    private Set<Tag> resolveTags(List<String> tagNames) {
        Set<Tag> tags = new LinkedHashSet<>();
        if (tagNames == null) {
            return tags;
        }
        for (String raw : tagNames) {
            if (raw == null || raw.isBlank()) {
                continue;
            }
            String name = raw.trim();
            Tag tag = tagRepository.findByNameIgnoreCase(name)
                    .orElseGet(() -> tagRepository.save(new Tag(name)));
            tags.add(tag);
        }
        return tags;
    }

    private NoteDto toDto(Note note) {
        List<NoteSegmentDto> segments = segmentRepository.findByNoteIdOrderByPositionAsc(note.getId())
                .stream()
                .map(segment -> new NoteSegmentDto(
                        segment.getId(),
                        segment.getPosition(),
                        segment.getQuestion(),
                        segment.getAnswerHtml(),
                        questionImageService.listForSegment(segment.getId())
                ))
                .toList();
        return new NoteDto(
                note.getId(),
                note.getTitle(),
                note.getFolderId(),
                note.getSourceModel(),
                note.getTags().stream().map(Tag::getName).toList(),
                note.getCreatedAt(),
                note.getUpdatedAt(),
                segments
        );
    }

    private List<NoteSummaryDto> toSummaries(List<Note> notes) {
        if (notes.isEmpty()) {
            return List.of();
        }
        List<Long> ids = notes.stream().map(Note::getId).toList();
        Map<Long, List<NoteSegment>> byNote = new HashMap<>();
        for (NoteSegment segment : segmentRepository.findByNoteIdInOrderByNoteIdAscPositionAsc(ids)) {
            byNote.computeIfAbsent(segment.getNoteId(), k -> new ArrayList<>()).add(segment);
        }
        return notes.stream()
                .map(note -> {
                    String joined = byNote.getOrDefault(note.getId(), List.of()).stream()
                            .map(NoteSegment::getAnswerHtml)
                            .filter(Objects::nonNull)
                            .collect(Collectors.joining("\n"));
                    return new NoteSummaryDto(
                            note.getId(),
                            note.getTitle(),
                            note.getFolderId(),
                            note.getSourceModel(),
                            note.getTags().stream().map(Tag::getName).toList(),
                            buildExcerpt(joined),
                            note.getUpdatedAt(),
                            note.getSortOrder()
                    );
                })
                .toList();
    }

    private String buildExcerpt(String content) {
        String plain = plainText(content);
        if (plain.isBlank()) {
            return "";
        }
        // Drop leftover Markdown punctuation so list previews read as clean prose.
        plain = plain.replaceAll("[#>*`_\\-\\[\\]!]", " ").replaceAll("\\s+", " ").trim();
        return plain.length() <= EXCERPT_LENGTH ? plain : plain.substring(0, EXCERPT_LENGTH) + "\u2026";
    }

    /**
     * Strip HTML tags/entities from rich-text content, leaving clean plain text.
     * Used for search matching and snippet building (unlike {@link #buildExcerpt}
     * this keeps Markdown punctuation so matches and highlighting stay accurate).
     */
    private String plainText(String content) {
        if (content == null || content.isBlank()) {
            return "";
        }
        return content
                .replaceAll("(?is)<(script|style)[^>]*>.*?</\\1>", " ")
                .replaceAll("<[^>]+>", " ")
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replaceAll("\\s+", " ")
                .trim();
    }
}
