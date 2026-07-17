package com.aivault.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * An image attached to a note's question (e.g. a pasted screenshot).
 *
 * <p>The bytes live on disk under the configured uploads directory; this row
 * only tracks the server-generated {@code filename} plus a little metadata.
 * Order is intentionally not modelled — creation time is enough.</p>
 */
@Entity
@Table(name = "question_images")
public class QuestionImage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "note_id", nullable = false)
    private Long noteId;

    /**
     * The conversation segment this image belongs to. Nullable during the
     * migration window; backfilled for legacy rows, required for new uploads.
     */
    @Column(name = "segment_id")
    private Long segmentId;

    /** Server-generated file name on disk, e.g. {@code 3f2a...c9.png}. */
    @Column(nullable = false)
    private String filename;

    /** The original upload name, kept for a friendlier alt text. Optional. */
    @Column(name = "original_name")
    private String originalName;

    @Column(name = "content_type")
    private String contentType;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        this.createdAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getNoteId() {
        return noteId;
    }

    public void setNoteId(Long noteId) {
        this.noteId = noteId;
    }

    public Long getSegmentId() {
        return segmentId;
    }

    public void setSegmentId(Long segmentId) {
        this.segmentId = segmentId;
    }

    public String getFilename() {
        return filename;
    }

    public void setFilename(String filename) {
        this.filename = filename;
    }

    public String getOriginalName() {
        return originalName;
    }

    public void setOriginalName(String originalName) {
        this.originalName = originalName;
    }

    public String getContentType() {
        return contentType;
    }

    public void setContentType(String contentType) {
        this.contentType = contentType;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
