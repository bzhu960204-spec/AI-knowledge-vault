package com.aivault.service;

import com.aivault.dto.FolderDto;
import com.aivault.dto.FolderRequest;
import com.aivault.entity.Folder;
import com.aivault.entity.Note;
import com.aivault.exception.NotFoundException;
import com.aivault.repository.FolderRepository;
import com.aivault.repository.NoteRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;

@Service
public class FolderService {

    private final FolderRepository folderRepository;
    private final NoteRepository noteRepository;

    public FolderService(FolderRepository folderRepository, NoteRepository noteRepository) {
        this.folderRepository = folderRepository;
        this.noteRepository = noteRepository;
    }

    @Transactional(readOnly = true)
    public List<FolderDto> findAll() {
        return folderRepository.findAllByOrderBySortOrderAscNameAsc().stream()
                .map(this::toDto)
                .toList();
    }

    @Transactional
    public FolderDto create(FolderRequest request) {
        Folder folder = new Folder();
        folder.setName(request.name().trim());
        folder.setParentId(resolveParent(request.parentId(), null));
        folder.setSortOrder(request.sortOrder() != null ? request.sortOrder() : 0);
        return toDto(folderRepository.save(folder));
    }

    @Transactional
    public FolderDto update(Long id, FolderRequest request) {
        Folder folder = folderRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Folder not found: " + id));
        if (request.name() != null && !request.name().isBlank()) {
            folder.setName(request.name().trim());
        }
        folder.setParentId(resolveParent(request.parentId(), id));
        if (request.sortOrder() != null) {
            folder.setSortOrder(request.sortOrder());
        }
        return toDto(folderRepository.save(folder));
    }

    @Transactional
    public void delete(Long id) {
        Folder folder = folderRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Folder not found: " + id));
        // Collect the folder and all descendants, then detach notes and remove folders.
        List<Long> idsToDelete = collectSubtreeIds(folder.getId());
        for (Long folderId : idsToDelete) {
            List<Note> notes = noteRepository.findByFolderIdOrderBySortOrderAscCreatedAtDesc(folderId);
            for (Note note : notes) {
                note.setFolderId(null);
            }
            noteRepository.saveAll(notes);
        }
        idsToDelete.forEach(folderRepository::deleteById);
    }

    private List<Long> collectSubtreeIds(Long rootId) {
        List<Long> result = new java.util.ArrayList<>();
        Deque<Long> stack = new ArrayDeque<>();
        stack.push(rootId);
        while (!stack.isEmpty()) {
            Long current = stack.pop();
            result.add(current);
            folderRepository.findByParentIdOrderBySortOrderAscNameAsc(current)
                    .forEach(child -> stack.push(child.getId()));
        }
        return result;
    }

    private Long resolveParent(Long parentId, Long selfId) {
        if (parentId == null) {
            return null;
        }
        if (parentId.equals(selfId)) {
            throw new IllegalArgumentException("A folder cannot be its own parent");
        }
        if (selfId != null && collectSubtreeIds(selfId).contains(parentId)) {
            throw new IllegalArgumentException("Cannot move a folder into its own descendant");
        }
        if (!folderRepository.existsById(parentId)) {
            throw new NotFoundException("Parent folder not found: " + parentId);
        }
        return parentId;
    }

    private FolderDto toDto(Folder folder) {
        return new FolderDto(
                folder.getId(),
                folder.getName(),
                folder.getParentId(),
                folder.getSortOrder(),
                folder.getCreatedAt(),
                folder.getUpdatedAt()
        );
    }
}
