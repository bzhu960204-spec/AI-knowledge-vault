package com.aivault.dto;

import java.time.Instant;

public record FolderDto(
        Long id,
        String name,
        Long parentId,
        int sortOrder,
        Instant createdAt,
        Instant updatedAt
) {
}
