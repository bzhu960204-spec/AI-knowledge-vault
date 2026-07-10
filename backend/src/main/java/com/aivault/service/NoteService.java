package com.aivault.service;

import com.aivault.dto.NoteDto;
import com.aivault.dto.NoteRequest;
import com.aivault.dto.NoteSummaryDto;
import com.aivault.entity.Note;
import com.aivault.entity.Tag;
import com.aivault.exception.NotFoundException;
import com.aivault.repository.FolderRepository;
import com.aivault.repository.NoteRepository;
import com.aivault.repository.TagRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Service
public class NoteService {

    private static final int EXCERPT_LENGTH = 160;

    private final NoteRepository noteRepository;
    private final FolderRepository folderRepository;
    private final TagRepository tagRepository;

    public NoteService(NoteRepository noteRepository, FolderRepository folderRepository, TagRepository tagRepository) {
        this.noteRepository = noteRepository;
        this.folderRepository = folderRepository;
        this.tagRepository = tagRepository;
    }

    @Transactional(readOnly = true)
    public List<NoteSummaryDto> list(Long folderId, String tag) {
        List<Note> notes;
        if (tag != null && !tag.isBlank()) {
            notes = noteRepository.findByTagName(tag.trim());
        } else if (folderId != null) {
            notes = noteRepository.findByFolderIdOrderByUpdatedAtDesc(folderId);
        } else {
            notes = noteRepository.findByFolderIdIsNullOrderByUpdatedAtDesc();
        }
        return notes.stream().map(this::toSummary).toList();
    }

    @Transactional(readOnly = true)
    public List<NoteSummaryDto> search(String query) {
        if (query == null || query.isBlank()) {
            return List.of();
        }
        return noteRepository.search(query.trim()).stream().map(this::toSummary).toList();
    }

    @Transactional(readOnly = true)
    public NoteDto get(Long id) {
        return toDto(findNote(id));
    }

    @Transactional
    public NoteDto create(NoteRequest request) {
        Note note = new Note();
        applyRequest(note, request);
        return toDto(noteRepository.save(note));
    }

    @Transactional
    public NoteDto update(Long id, NoteRequest request) {
        Note note = findNote(id);
        applyRequest(note, request);
        return toDto(noteRepository.save(note));
    }

    @Transactional
    public void delete(Long id) {
        Note note = findNote(id);
        noteRepository.delete(note);
    }

    private Note findNote(Long id) {
        return noteRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Note not found: " + id));
    }

    private void applyRequest(Note note, NoteRequest request) {
        note.setTitle(request.title() == null || request.title().isBlank() ? "Untitled" : request.title().trim());
        note.setContentMarkdown(request.contentMarkdown() != null ? request.contentMarkdown() : "");
        note.setSourceModel(request.sourceModel());
        note.setFolderId(resolveFolder(request.folderId()));
        note.setTags(resolveTags(request.tags()));
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
        return new NoteDto(
                note.getId(),
                note.getTitle(),
                note.getContentMarkdown(),
                note.getFolderId(),
                note.getSourceModel(),
                note.getTags().stream().map(Tag::getName).toList(),
                note.getCreatedAt(),
                note.getUpdatedAt()
        );
    }

    private NoteSummaryDto toSummary(Note note) {
        return new NoteSummaryDto(
                note.getId(),
                note.getTitle(),
                note.getFolderId(),
                note.getSourceModel(),
                note.getTags().stream().map(Tag::getName).toList(),
                buildExcerpt(note.getContentMarkdown()),
                note.getUpdatedAt()
        );
    }

    private String buildExcerpt(String markdown) {
        if (markdown == null || markdown.isBlank()) {
            return "";
        }
        String plain = markdown.replaceAll("[#>*`_\\-\\[\\]!]", " ").replaceAll("\\s+", " ").trim();
        return plain.length() <= EXCERPT_LENGTH ? plain : plain.substring(0, EXCERPT_LENGTH) + "\u2026";
    }
}
