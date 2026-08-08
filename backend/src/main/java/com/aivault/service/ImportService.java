package com.aivault.service;

import com.aivault.dto.ImportResultDto;
import com.aivault.dto.archive.Archive;
import com.aivault.entity.Folder;
import com.aivault.entity.Note;
import com.aivault.entity.NoteSegment;
import com.aivault.entity.QuestionImage;
import com.aivault.entity.Tag;
import com.aivault.exception.NotFoundException;
import com.aivault.repository.FolderRepository;
import com.aivault.repository.NoteRepository;
import com.aivault.repository.NoteSegmentRepository;
import com.aivault.repository.QuestionImageRepository;
import com.aivault.repository.TagRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Re-imports a {@code .aivault} bundle produced by {@link ArchiveExportService}.
 *
 * <p>The bundle is untrusted input, so this guards against zip-slip, zip bombs
 * and stored XSS: entry names are validated, sizes are capped, only real image
 * files are written, and every answer's HTML is sanitized before it is stored.
 * Content is always created as fresh copies under the chosen target folder —
 * nothing existing is overwritten.</p>
 */
@Service
public class ImportService {

    /** Whole-bundle and per-file limits guarding against zip bombs. */
    private static final long MAX_TOTAL_BYTES = 200L * 1024 * 1024;
    private static final long MAX_ENTRY_BYTES = 25L * 1024 * 1024;
    private static final int MAX_ENTRIES = 10_000;
    private static final long MAX_JSON_BYTES = 32L * 1024 * 1024;

    /** Image content types accepted for an imported attachment. */
    private static final Map<String, String> IMAGE_TYPES = Map.of(
            "image/png", ".png",
            "image/jpeg", ".jpg",
            "image/gif", ".gif",
            "image/webp", ".webp"
    );

    private final FolderRepository folderRepository;
    private final NoteRepository noteRepository;
    private final NoteSegmentRepository segmentRepository;
    private final QuestionImageRepository questionImageRepository;
    private final TagRepository tagRepository;
    private final HtmlSanitizer htmlSanitizer;
    private final Path uploadDir;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ImportService(FolderRepository folderRepository, NoteRepository noteRepository,
                         NoteSegmentRepository segmentRepository,
                         QuestionImageRepository questionImageRepository,
                         TagRepository tagRepository, HtmlSanitizer htmlSanitizer,
                         @Value("${app.uploads.dir:./data/uploads}") String uploadDir) {
        this.folderRepository = folderRepository;
        this.noteRepository = noteRepository;
        this.segmentRepository = segmentRepository;
        this.questionImageRepository = questionImageRepository;
        this.tagRepository = tagRepository;
        this.htmlSanitizer = htmlSanitizer;
        this.uploadDir = Paths.get(uploadDir).toAbsolutePath().normalize();
    }

    @PostConstruct
    void ensureDirectory() {
        try {
            Files.createDirectories(uploadDir);
        } catch (IOException e) {
            throw new UncheckedIOException("Could not create uploads directory: " + uploadDir, e);
        }
    }

    @Transactional
    public ImportResultDto importArchive(MultipartFile file, Long targetFolderId) {
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No file provided");
        }
        Long resolvedTarget = resolveTargetFolder(targetFolderId);
        Map<String, byte[]> entries = readEntries(file);

        Archive.Manifest manifest = parseJson(entries.get("manifest.json"), Archive.Manifest.class, "manifest.json");
        validateManifest(manifest);
        Archive.Content content = parseJson(entries.get("content.json"), Archive.Content.class, "content.json");
        if (content == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Bundle is missing content.json");
        }

        // Files written to disk must be cleaned up if the transaction later fails.
        List<Path> writtenFiles = new ArrayList<>();
        try {
            Map<String, Long> folderRefToId = createFolders(content.folders(), resolvedTarget);
            int[] imageCount = {0};
            int noteCount = createNotes(content.notes(), folderRefToId, resolvedTarget, entries,
                    writtenFiles, imageCount);
            return new ImportResultDto(folderRefToId.size(), noteCount, imageCount[0]);
        } catch (RuntimeException e) {
            writtenFiles.forEach(this::deleteQuietly);
            throw e;
        }
    }

    private Long resolveTargetFolder(Long targetFolderId) {
        if (targetFolderId == null) {
            return null;
        }
        if (!folderRepository.existsById(targetFolderId)) {
            throw new NotFoundException("Folder not found: " + targetFolderId);
        }
        return targetFolderId;
    }

    private void validateManifest(Archive.Manifest manifest) {
        if (manifest == null || !Archive.FORMAT.equals(manifest.format())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Not a valid .aivault bundle");
        }
        if (manifest.schemaVersion() > Archive.SCHEMA_VERSION) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Bundle was created by a newer version and cannot be imported");
        }
    }

    // ── Folders ──────────────────────────────────────────────────────────────

    private Map<String, Long> createFolders(List<Archive.FolderNode> nodes, Long targetFolderId) {
        Map<String, Long> refToId = new HashMap<>();
        if (nodes == null || nodes.isEmpty()) {
            return refToId;
        }
        Map<String, Archive.FolderNode> byRef = new HashMap<>();
        for (Archive.FolderNode node : nodes) {
            if (node.ref() != null) {
                byRef.put(node.ref(), node);
            }
        }
        int rootBase = nextFolderSortOrder(targetFolderId);
        int rootOffset = 0;

        // Resolve in dependency order: a node is ready once its parent exists
        // (or it is a bundle-root). Guards against cycles/dangling parent refs.
        Set<String> pending = new LinkedHashSet<>(byRef.keySet());
        boolean progress = true;
        while (progress && !pending.isEmpty()) {
            progress = false;
            for (String ref : new ArrayList<>(pending)) {
                Archive.FolderNode node = byRef.get(ref);
                String parentRef = node.parentRef();
                boolean isRoot = parentRef == null || !byRef.containsKey(parentRef);
                if (!isRoot && !refToId.containsKey(parentRef)) {
                    continue;
                }
                Folder folder = new Folder();
                folder.setName(node.name() == null || node.name().isBlank() ? "Untitled" : node.name().trim());
                folder.setParentId(isRoot ? targetFolderId : refToId.get(parentRef));
                folder.setSortOrder(isRoot ? rootBase + rootOffset++ : node.sortOrder());
                refToId.put(ref, folderRepository.save(folder).getId());
                pending.remove(ref);
                progress = true;
            }
        }
        return refToId;
    }

    private int nextFolderSortOrder(Long parentId) {
        List<Folder> siblings = (parentId == null)
                ? folderRepository.findByParentIdIsNullOrderBySortOrderAscNameAsc()
                : folderRepository.findByParentIdOrderBySortOrderAscNameAsc(parentId);
        return siblings.stream().mapToInt(Folder::getSortOrder).max().orElse(-1) + 1;
    }

    // ── Notes ────────────────────────────────────────────────────────────────

    private int createNotes(List<Archive.NoteNode> nodes, Map<String, Long> folderRefToId,
                            Long targetFolderId, Map<String, byte[]> entries,
                            List<Path> writtenFiles, int[] imageCount) {
        if (nodes == null || nodes.isEmpty()) {
            return 0;
        }
        Map<Long, Integer> nextSortByFolder = new HashMap<>();
        int count = 0;
        for (Archive.NoteNode node : nodes) {
            Long folderId = node.folderRef() != null
                    ? folderRefToId.getOrDefault(node.folderRef(), targetFolderId)
                    : targetFolderId;

            Note note = new Note();
            note.setTitle(node.title() == null || node.title().isBlank() ? "Untitled" : node.title().trim());
            note.setSourceModel(node.sourceModel());
            note.setFolderId(folderId);
            note.setTags(resolveTags(node.tags()));
            note.setSortOrder(nextSortByFolder.compute(folderKey(folderId),
                    (k, v) -> v == null ? nextNoteSortOrder(folderId) : v + 1));
            Note saved = noteRepository.save(note);

            createSegments(saved.getId(), node.segments(), entries, writtenFiles, imageCount);
            count++;
        }
        return count;
    }

    private Long folderKey(Long folderId) {
        // A sentinel key so the "root" bucket (null) fits in the map.
        return folderId == null ? -1L : folderId;
    }

    private int nextNoteSortOrder(Long folderId) {
        List<Note> siblings = (folderId == null)
                ? noteRepository.findByFolderIdIsNullOrderBySortOrderAscCreatedAtDesc()
                : noteRepository.findByFolderIdOrderBySortOrderAscCreatedAtDesc(folderId);
        return siblings.stream().mapToInt(Note::getSortOrder).max().orElse(-1) + 1;
    }

    private void createSegments(Long noteId, List<Archive.SegmentNode> nodes,
                                Map<String, byte[]> entries, List<Path> writtenFiles, int[] imageCount) {
        List<Archive.SegmentNode> incoming = nodes != null ? nodes : List.of();
        int position = 0;
        for (Archive.SegmentNode node : incoming) {
            NoteSegment segment = new NoteSegment();
            segment.setNoteId(noteId);
            segment.setPosition(position++);
            segment.setQuestion(node.question());
            segment.setAnswerHtml(htmlSanitizer.sanitize(node.answerHtml()));
            segment.setContentFormat("html");
            NoteSegment savedSegment = segmentRepository.save(segment);
            createImages(noteId, savedSegment.getId(), node.images(), entries, writtenFiles, imageCount);
        }
        // A note must always have at least one segment for the editor to render.
        if (incoming.isEmpty()) {
            NoteSegment segment = new NoteSegment();
            segment.setNoteId(noteId);
            segment.setPosition(0);
            segment.setAnswerHtml("");
            segment.setContentFormat("html");
            segmentRepository.save(segment);
        }
    }

    private void createImages(Long noteId, Long segmentId, List<Archive.ImageNode> nodes,
                              Map<String, byte[]> entries, List<Path> writtenFiles, int[] imageCount) {
        if (nodes == null) {
            return;
        }
        for (Archive.ImageNode node : nodes) {
            String extension = IMAGE_TYPES.get(node.contentType());
            if (extension == null) {
                // Only genuine image attachments are imported; skip anything else.
                continue;
            }
            byte[] bytes = entries.get(node.file());
            if (bytes == null || bytes.length == 0) {
                continue;
            }
            String filename = UUID.randomUUID().toString().replace("-", "") + extension;
            Path target = uploadDir.resolve(filename).normalize();
            if (!target.startsWith(uploadDir)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid target path");
            }
            try {
                Files.write(target, bytes);
            } catch (IOException e) {
                throw new UncheckedIOException("Failed to store imported image", e);
            }
            writtenFiles.add(target);

            QuestionImage image = new QuestionImage();
            image.setNoteId(noteId);
            image.setSegmentId(segmentId);
            image.setFilename(filename);
            image.setOriginalName(node.originalName());
            image.setContentType(node.contentType());
            questionImageRepository.save(image);
            imageCount[0]++;
        }
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

    // ── ZIP reading (guarded against zip-slip and zip bombs) ─────────────────

    private Map<String, byte[]> readEntries(MultipartFile file) {
        Map<String, byte[]> entries = new HashMap<>();
        long totalBytes = 0;
        int entryCount = 0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(file.getBytes()))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++entryCount > MAX_ENTRIES) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Bundle has too many entries");
                }
                if (entry.isDirectory()) {
                    continue;
                }
                String name = entry.getName();
                if (!isAllowedEntry(name)) {
                    continue;
                }
                long limit = name.endsWith(".json") ? MAX_JSON_BYTES : MAX_ENTRY_BYTES;
                byte[] data = readCapped(zip, limit);
                totalBytes += data.length;
                if (totalBytes > MAX_TOTAL_BYTES) {
                    throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Bundle is too large");
                }
                entries.put(name, data);
            }
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Could not read the bundle (not a valid ZIP)");
        }
        if (!entries.containsKey("manifest.json")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Bundle is missing manifest.json");
        }
        return entries;
    }

    /**
     * Accept only the fixed top-level JSON files and flat {@code assets/} images.
     * Rejects path traversal, absolute paths and nested asset directories.
     */
    private boolean isAllowedEntry(String name) {
        if (name == null || name.contains("..") || name.startsWith("/") || name.contains("\\")) {
            return false;
        }
        if (name.equals("manifest.json") || name.equals("content.json")) {
            return true;
        }
        return name.startsWith("assets/") && name.indexOf('/', "assets/".length()) < 0;
    }

    private byte[] readCapped(ZipInputStream zip, long limit) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        long total = 0;
        while ((read = zip.read(chunk)) != -1) {
            total += read;
            if (total > limit) {
                throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "A bundle entry is too large");
            }
            out.write(chunk, 0, read);
        }
        return out.toByteArray();
    }

    private <T> T parseJson(byte[] data, Class<T> type, String label) {
        if (data == null) {
            return null;
        }
        try {
            return objectMapper.readValue(data, type);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Malformed " + label + " in bundle");
        }
    }

    private void deleteQuietly(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
            // Best-effort cleanup; a leftover file must not mask the real error.
        }
    }
}
