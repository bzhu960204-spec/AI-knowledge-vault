package com.aivault.service;

import com.aivault.dto.NoteDto;
import com.aivault.dto.NoteRequest;
import com.aivault.dto.NoteSegmentDto;
import com.aivault.dto.NoteSegmentRequest;
import com.aivault.dto.NoteSummaryDto;
import com.aivault.entity.Note;
import com.aivault.entity.NoteSegment;
import com.aivault.entity.Tag;
import com.aivault.exception.NotFoundException;
import com.aivault.repository.FolderRepository;
import com.aivault.repository.NoteRepository;
import com.aivault.repository.NoteSegmentRepository;
import com.aivault.repository.TagRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
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
    public List<NoteSummaryDto> search(String query) {
        if (query == null || query.isBlank()) {
            return List.of();
        }
        return toSummaries(noteRepository.search(query.trim()));
    }

    @Transactional(readOnly = true)
    public NoteDto get(Long id) {
        return toDto(findNote(id));
    }

    @Transactional
    public NoteDto create(NoteRequest request) {
        Note note = new Note();
        applyMetadata(note, request);
        Note saved = noteRepository.save(note);
        applySegments(saved.getId(), request.segments());
        return toDto(saved);
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
        if (content == null || content.isBlank()) {
            return "";
        }
        // Content is rich-text HTML (with occasional leftover Markdown/TeX from
        // legacy notes): drop tags/entities and Markdown punctuation so the
        // preview reads as clean prose.
        String plain = content
                .replaceAll("(?is)<(script|style)[^>]*>.*?</\\1>", " ")
                .replaceAll("<[^>]+>", " ")
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replaceAll("[#>*`_\\-\\[\\]!]", " ")
                .replaceAll("\\s+", " ")
                .trim();
        return plain.length() <= EXCERPT_LENGTH ? plain : plain.substring(0, EXCERPT_LENGTH) + "\u2026";
    }
}
