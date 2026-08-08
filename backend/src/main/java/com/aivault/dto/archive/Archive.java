package com.aivault.dto.archive;

import java.util.List;

/**
 * The data model of a {@code .aivault} exchange bundle — a portable snapshot of
 * folders, notes and their images that can be re-imported into another instance.
 *
 * <p>The bundle is a ZIP with {@code manifest.json} (a small, quickly-validated
 * header), {@code content.json} (this {@link Content} tree) and an
 * {@code assets/} directory holding the image files referenced by segments.</p>
 *
 * <p>Entities reference each other by bundle-local string keys ({@code ref}),
 * never database ids, so the importer can freely remap them to fresh ids.</p>
 */
public final class Archive {

    /** Fixed marker written into every bundle's manifest. */
    public static final String FORMAT = "aivault-archive";

    /** Bump when the on-disk shape changes in an incompatible way. */
    public static final int SCHEMA_VERSION = 1;

    private Archive() {
    }

    public record Manifest(
            String format,
            int schemaVersion,
            String appVersion,
            String exportedAt,
            Counts counts
    ) {
    }

    public record Counts(int folders, int notes, int images) {
    }

    public record Content(
            List<FolderNode> folders,
            List<NoteNode> notes
    ) {
    }

    /** {@code parentRef} is null for a folder that sits at the bundle's root. */
    public record FolderNode(
            String ref,
            String name,
            String parentRef,
            int sortOrder
    ) {
    }

    /** {@code folderRef} is null for a note that sits at the bundle's root. */
    public record NoteNode(
            String ref,
            String title,
            String folderRef,
            String sourceModel,
            int sortOrder,
            List<String> tags,
            List<SegmentNode> segments
    ) {
    }

    public record SegmentNode(
            int position,
            String question,
            String answerHtml,
            List<ImageNode> images
    ) {
    }

    /** {@code file} is the entry name inside the bundle's {@code assets/} dir. */
    public record ImageNode(
            String file,
            String originalName,
            String contentType
    ) {
    }
}
