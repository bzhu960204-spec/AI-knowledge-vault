package com.aivault.dto;

/** Summary returned after importing a {@code .aivault} bundle. */
public record ImportResultDto(int folders, int notes, int images) {
}
