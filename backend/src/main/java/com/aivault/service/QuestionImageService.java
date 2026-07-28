package com.aivault.service;

import com.aivault.dto.QuestionImageDto;
import com.aivault.entity.NoteSegment;
import com.aivault.entity.QuestionImage;
import com.aivault.exception.NotFoundException;
import com.aivault.repository.NoteSegmentRepository;
import com.aivault.repository.QuestionImageRepository;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Stores images attached to a note's question on disk and tracks them in the
 * {@code question_images} table. Files are served statically from
 * {@code /uploads/**} (see {@code WebConfig}).
 */
@Service
public class QuestionImageService {

    /** Image content types mapped to the extension used on disk. */
    private static final Map<String, String> IMAGE_TYPES = Map.of(
            "image/png", ".png",
            "image/jpeg", ".jpg",
            "image/gif", ".gif",
            "image/webp", ".webp"
    );

    /** Upper bound for any single attachment (25 MB). */
    private static final long MAX_UPLOAD_BYTES = 25L * 1024 * 1024;

    /** Extension characters we allow to survive from an original file name. */
    private static final java.util.regex.Pattern SAFE_EXTENSION =
            java.util.regex.Pattern.compile("\\.[A-Za-z0-9]{1,10}$");

    private final QuestionImageRepository imageRepository;
    private final NoteSegmentRepository segmentRepository;
    private final Path uploadDir;

    public QuestionImageService(
            QuestionImageRepository imageRepository,
            NoteSegmentRepository segmentRepository,
            @Value("${app.uploads.dir:./data/uploads}") String uploadDir
    ) {
        this.imageRepository = imageRepository;
        this.segmentRepository = segmentRepository;
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

    @Transactional(readOnly = true)
    public List<QuestionImageDto> listForSegment(Long segmentId) {
        return imageRepository.findBySegmentIdOrderByCreatedAtAsc(segmentId).stream()
                .map(this::toDto)
                .toList();
    }

    @Transactional
    public QuestionImageDto upload(Long noteId, Long segmentId, MultipartFile file) {
        NoteSegment segment = segmentRepository.findById(segmentId)
                .orElseThrow(() -> new NotFoundException("Segment not found: " + segmentId));
        if (!segment.getNoteId().equals(noteId)) {
            throw new NotFoundException("Segment not found in note: " + segmentId);
        }
        String filename = storeToDisk(file);

        QuestionImage image = new QuestionImage();
        image.setNoteId(noteId);
        image.setSegmentId(segmentId);
        image.setFilename(filename);
        image.setOriginalName(file.getOriginalFilename());
        image.setContentType(file.getContentType());
        return toDto(imageRepository.save(image));
    }

    /** Validate an uploaded file and write it to the uploads dir; returns the filename. */
    private String storeToDisk(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No file provided");
        }
        if (file.getSize() > MAX_UPLOAD_BYTES) {
            throw new ResponseStatusException(
                    HttpStatus.PAYLOAD_TOO_LARGE,
                    "Attachment exceeds the 25 MB limit");
        }
        String extension = resolveExtension(file);

        String filename = UUID.randomUUID().toString().replace("-", "") + extension;
        Path target = uploadDir.resolve(filename).normalize();
        // Defence in depth: never let a resolved path escape the uploads dir.
        if (!target.startsWith(uploadDir)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid target path");
        }
        try {
            file.transferTo(target);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to store upload", e);
        }
        return filename;
    }

    /**
     * Pick a safe on-disk extension. Images use their known type; any other
     * attachment keeps the (sanitized) extension from its original file name so
     * it downloads with a sensible type. Files with no usable extension are
     * stored without one.
     */
    private String resolveExtension(MultipartFile file) {
        String imageExt = IMAGE_TYPES.get(file.getContentType());
        if (imageExt != null) {
            return imageExt;
        }
        String original = file.getOriginalFilename();
        if (original != null) {
            var matcher = SAFE_EXTENSION.matcher(original);
            if (matcher.find()) {
                return matcher.group().toLowerCase();
            }
        }
        return "";
    }

    @Transactional
    public void delete(Long segmentId, Long imageId) {
        QuestionImage image = imageRepository.findByIdAndSegmentId(imageId, segmentId)
                .orElseThrow(() -> new NotFoundException("Image not found: " + imageId));
        deleteFileQuietly(image.getFilename());
        imageRepository.delete(image);
    }

    /** Remove every image (rows + files) belonging to a segment. */
    @Transactional
    public void deleteAllForSegment(Long segmentId) {
        List<QuestionImage> images = imageRepository.findBySegmentIdOrderByCreatedAtAsc(segmentId);
        for (QuestionImage image : images) {
            deleteFileQuietly(image.getFilename());
        }
        imageRepository.deleteAll(images);
    }

    /** Remove every image (rows + files) belonging to a note. */
    @Transactional
    public void deleteAllForNote(Long noteId) {
        List<QuestionImage> images = imageRepository.findByNoteIdOrderByCreatedAtAsc(noteId);
        for (QuestionImage image : images) {
            deleteFileQuietly(image.getFilename());
        }
        imageRepository.deleteAll(images);
    }

    private void deleteFileQuietly(String filename) {
        try {
            Path target = uploadDir.resolve(filename).normalize();
            if (target.startsWith(uploadDir)) {
                Files.deleteIfExists(target);
            }
        } catch (IOException ignored) {
            // A missing/locked file must not block deleting the DB record.
        }
    }

    private QuestionImageDto toDto(QuestionImage image) {
        return new QuestionImageDto(
                image.getId(),
                "/uploads/" + image.getFilename(),
                image.getOriginalName(),
                image.getContentType()
        );
    }
}
