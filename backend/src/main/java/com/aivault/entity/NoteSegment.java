package com.aivault.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;

import org.hibernate.annotations.ColumnDefault;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * One question-and-answer turn within a note's conversation.
 *
 * <p>A note is an ordered sequence of these segments, each holding its own
 * question (optional text plus any attached {@link QuestionImage}s) and the
 * answer captured for it. Ordering is driven by {@link #position}.</p>
 */
@Entity
@Table(name = "note_segments")
public class NoteSegment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "note_id", nullable = false)
    private Long noteId;

    /** Position within the note; lower comes first. */
    @Column(name = "position", nullable = false)
    @ColumnDefault("0")
    private int position = 0;

    /** The question this segment's answer responds to. Optional. */
    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(name = "question")
    private String question;

    /**
     * The answer captured for this segment, stored as sanitized rich-text HTML.
     * The physical column keeps its legacy name {@code answer_markdown} so
     * existing data is preserved without a schema rename.
     */
    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(name = "answer_markdown")
    private String answerHtml = "";

    /**
     * Storage format of {@link #answerHtml}: {@code "html"} for content authored
     * by (or migrated for) the rich-text editor. A {@code null} value marks a
     * legacy row whose answer is still Markdown and awaits one-time conversion.
     */
    @Column(name = "content_format")
    private String contentFormat = "html";

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        this.updatedAt = Instant.now();
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

    public int getPosition() {
        return position;
    }

    public void setPosition(int position) {
        this.position = position;
    }

    public String getQuestion() {
        return question;
    }

    public void setQuestion(String question) {
        this.question = question;
    }

    public String getAnswerHtml() {
        return answerHtml;
    }

    public void setAnswerHtml(String answerHtml) {
        this.answerHtml = answerHtml;
    }

    public String getContentFormat() {
        return contentFormat;
    }

    public void setContentFormat(String contentFormat) {
        this.contentFormat = contentFormat;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
