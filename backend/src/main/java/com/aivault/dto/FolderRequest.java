package com.aivault.dto;

import jakarta.validation.constraints.NotBlank;

public record FolderRequest(
        @NotBlank String name,
        Long parentId,
        Integer sortOrder
) {
}
