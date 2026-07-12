package com.aivault.dto;

import java.util.List;

/**
 * Request to export one or more notes as a single document.
 *
 * <p>The notes are concatenated in the exact order given by {@link #noteIds()}.
 * When {@code noteIds} is empty, every note in {@link #folderId()} is exported
 * (optionally including subfolders), ordered by their manual sort order.</p>
 */
public record ExportRequest(
        List<Long> noteIds,
        Long folderId,
        boolean includeSubfolders,
        boolean includeQuestion,
        String title
) {
}
