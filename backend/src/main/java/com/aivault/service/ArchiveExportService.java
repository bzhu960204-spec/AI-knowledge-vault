package com.aivault.service;

import com.aivault.dto.ExportRequest;
import com.aivault.dto.archive.Archive;
import com.aivault.entity.Folder;
import com.aivault.entity.Note;
import com.aivault.entity.NoteSegment;
import com.aivault.entity.QuestionImage;
import com.aivault.entity.Tag;
import com.aivault.repository.FolderRepository;
import com.aivault.repository.NoteRepository;
import com.aivault.repository.NoteSegmentRepository;
import com.aivault.repository.QuestionImageRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Packs one or more notes into a portable {@code .aivault} bundle (a ZIP of
 * {@code manifest.json}, {@code content.json} and an {@code assets/} image dir)
 * that another instance can re-import via {@link ArchiveImportService}.
 *
 * <p>Unlike the HTML/PDF export, this keeps the structured data (folder tree,
 * segments, tags, image bytes) intact so the content round-trips.</p>
 */
@Service
public class ArchiveExportService {

    private final NoteRepository noteRepository;
    private final FolderRepository folderRepository;
    private final NoteSegmentRepository segmentRepository;
    private final QuestionImageRepository questionImageRepository;
    private final Path uploadDir;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ArchiveExportService(NoteRepository noteRepository, FolderRepository folderRepository,
                                NoteSegmentRepository segmentRepository,
                                QuestionImageRepository questionImageRepository,
                                @Value("${app.uploads.dir:./data/uploads}") String uploadDir) {
        this.noteRepository = noteRepository;
        this.folderRepository = folderRepository;
        this.segmentRepository = segmentRepository;
        this.questionImageRepository = questionImageRepository;
        this.uploadDir = Paths.get(uploadDir).toAbsolutePath().normalize();
    }

    @Transactional(readOnly = true)
    public byte[] exportArchive(ExportRequest request) {
        List<Note> notes = resolveOrderedNotes(request);

        Map<Long, Folder> folders = collectAncestorFolders(notes);
        Set<String> assetFiles = new LinkedHashSet<>();
        int[] imageCount = {0};

        List<Archive.FolderNode> folderNodes = folders.values().stream()
                .map(f -> new Archive.FolderNode(
                        folderRef(f.getId()),
                        f.getName(),
                        f.getParentId() != null && folders.containsKey(f.getParentId())
                                ? folderRef(f.getParentId()) : null,
                        f.getSortOrder()))
                .toList();

        List<Archive.NoteNode> noteNodes = new ArrayList<>();
        for (Note note : notes) {
            noteNodes.add(buildNoteNode(note, folders, assetFiles, imageCount));
        }

        Archive.Content content = new Archive.Content(folderNodes, noteNodes);
        Archive.Manifest manifest = new Archive.Manifest(
                Archive.FORMAT,
                Archive.SCHEMA_VERSION,
                "ai-answer-vault",
                Instant.now().toString(),
                new Archive.Counts(folderNodes.size(), noteNodes.size(), imageCount[0]));

        return writeZip(manifest, content, assetFiles);
    }

    private Archive.NoteNode buildNoteNode(Note note, Map<Long, Folder> folders,
                                           Set<String> assetFiles, int[] imageCount) {
        List<Archive.SegmentNode> segmentNodes = new ArrayList<>();
        for (NoteSegment segment : segmentRepository.findByNoteIdOrderByPositionAsc(note.getId())) {
            List<Archive.ImageNode> imageNodes = new ArrayList<>();
            for (QuestionImage image : questionImageRepository
                    .findBySegmentIdOrderByCreatedAtAsc(segment.getId())) {
                if (!isReadableAsset(image.getFilename())) {
                    continue;
                }
                assetFiles.add(image.getFilename());
                imageCount[0]++;
                imageNodes.add(new Archive.ImageNode(
                        "assets/" + image.getFilename(),
                        image.getOriginalName(),
                        image.getContentType()));
            }
            segmentNodes.add(new Archive.SegmentNode(
                    segment.getPosition(),
                    segment.getQuestion(),
                    segment.getAnswerHtml(),
                    imageNodes));
        }

        List<String> tags = note.getTags().stream().map(Tag::getName).toList();
        String folderRef = note.getFolderId() != null && folders.containsKey(note.getFolderId())
                ? folderRef(note.getFolderId()) : null;
        return new Archive.NoteNode(
                noteRef(note.getId()),
                note.getTitle(),
                folderRef,
                note.getSourceModel(),
                note.getSortOrder(),
                tags,
                segmentNodes);
    }

    /** Collect every folder that holds an exported note, plus all its ancestors. */
    private Map<Long, Folder> collectAncestorFolders(List<Note> notes) {
        Map<Long, Folder> result = new LinkedHashMap<>();
        for (Note note : notes) {
            Long folderId = note.getFolderId();
            while (folderId != null && !result.containsKey(folderId)) {
                Folder folder = folderRepository.findById(folderId).orElse(null);
                if (folder == null) {
                    break;
                }
                result.put(folder.getId(), folder);
                folderId = folder.getParentId();
            }
        }
        return result;
    }

    private byte[] writeZip(Archive.Manifest manifest, Archive.Content content, Set<String> assetFiles) {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(buffer)) {
            writeJsonEntry(zip, "manifest.json", manifest);
            writeJsonEntry(zip, "content.json", content);
            for (String filename : assetFiles) {
                Path source = uploadDir.resolve(filename).normalize();
                if (!source.startsWith(uploadDir) || !Files.exists(source)) {
                    continue;
                }
                zip.putNextEntry(new ZipEntry("assets/" + filename));
                zip.write(Files.readAllBytes(source));
                zip.closeEntry();
            }
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to build archive", e);
        }
        return buffer.toByteArray();
    }

    private void writeJsonEntry(ZipOutputStream zip, String name, Object value) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(objectMapper.writeValueAsString(value).getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    private boolean isReadableAsset(String filename) {
        if (filename == null || filename.isBlank()) {
            return false;
        }
        Path target = uploadDir.resolve(filename).normalize();
        return target.startsWith(uploadDir) && Files.exists(target);
    }

    private String folderRef(Long id) {
        return "f" + id;
    }

    private String noteRef(Long id) {
        return "n" + id;
    }

    // ── Note resolution (mirrors ExportService's selection rules) ────────────

    private List<Note> resolveOrderedNotes(ExportRequest request) {
        List<Long> ids = request.noteIds();
        if (ids != null && !ids.isEmpty()) {
            Map<Long, Note> byId = noteRepository.findAllById(ids).stream()
                    .collect(Collectors.toMap(Note::getId, note -> note));
            return ids.stream().map(byId::get).filter(Objects::nonNull).toList();
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
}
