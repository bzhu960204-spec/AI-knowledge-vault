package com.aivault.dto;

/**
 * A single conversation turn in a note-save request. {@code id} is null for a
 * newly added segment and set for an existing one being updated. Ordering is
 * taken from the segment's position in {@link NoteRequest#segments()}.
 */
public record NoteSegmentRequest(
        Long id,
        String question,
        String answerHtml
) {
}
