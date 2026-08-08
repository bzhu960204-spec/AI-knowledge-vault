package com.aivault.controller;

import com.aivault.dto.ExportRequest;
import com.aivault.dto.ImportResultDto;
import com.aivault.dto.MoveNoteRequest;
import com.aivault.dto.NoteDto;
import com.aivault.dto.NoteRequest;
import com.aivault.dto.NoteSummaryDto;
import com.aivault.dto.QuestionImageDto;
import com.aivault.dto.ReorderNotesRequest;
import com.aivault.dto.SearchResultDto;
import com.aivault.service.ArchiveExportService;
import com.aivault.service.ExportService;
import com.aivault.service.ImportService;
import com.aivault.service.NoteService;
import com.aivault.service.QuestionImageService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@RestController
@RequestMapping("/api/notes")
public class NoteController {

    private final NoteService noteService;
    private final ExportService exportService;
    private final ArchiveExportService archiveExportService;
    private final ImportService importService;
    private final QuestionImageService questionImageService;

    public NoteController(NoteService noteService, ExportService exportService,
                         ArchiveExportService archiveExportService, ImportService importService,
                         QuestionImageService questionImageService) {
        this.noteService = noteService;
        this.exportService = exportService;
        this.archiveExportService = archiveExportService;
        this.importService = importService;
        this.questionImageService = questionImageService;
    }

    @GetMapping
    public List<NoteSummaryDto> list(
            @RequestParam(required = false) Long folderId,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false, defaultValue = "false") boolean includeSubfolders
    ) {
        return noteService.list(folderId, tag, includeSubfolders);
    }

    @GetMapping("/search")
    public List<SearchResultDto> search(
            @RequestParam("q") String query,
            @RequestParam(required = false) Long folderId,
            @RequestParam(required = false, defaultValue = "false") boolean includeSubfolders,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false, defaultValue = "all") String field,
            @RequestParam(required = false, defaultValue = "relevance") String sort
    ) {
        return noteService.search(query, folderId, includeSubfolders, tag, field, sort);
    }

    @GetMapping("/{id}")
    public NoteDto get(@PathVariable Long id) {
        return noteService.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public NoteDto create(@Valid @RequestBody NoteRequest request) {
        return noteService.create(request);
    }

    @PutMapping("/{id}")
    public NoteDto update(@PathVariable Long id, @Valid @RequestBody NoteRequest request) {
        return noteService.update(id, request);
    }

    @PatchMapping("/{id}/folder")
    public NoteDto move(@PathVariable Long id, @RequestBody MoveNoteRequest request) {
        return noteService.move(id, request.folderId());
    }

    @PatchMapping("/reorder")
    public ResponseEntity<Void> reorder(@RequestBody ReorderNotesRequest request) {
        noteService.reorder(request.ids());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        noteService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping(value = "/{id}/segments/{segmentId}/images", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public QuestionImageDto uploadQuestionImage(
            @PathVariable Long id,
            @PathVariable Long segmentId,
            @RequestPart("file") MultipartFile file
    ) {
        return questionImageService.upload(id, segmentId, file);
    }

    @DeleteMapping("/{id}/segments/{segmentId}/images/{imageId}")
    public ResponseEntity<Void> deleteQuestionImage(
            @PathVariable Long id,
            @PathVariable Long segmentId,
            @PathVariable Long imageId
    ) {
        questionImageService.delete(segmentId, imageId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping(value = "/export", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> export(@RequestBody ExportRequest request) {
        String html = exportService.exportHtml(request);
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .body(html);
    }

    @PostMapping(value = "/export/archive", produces = "application/zip")
    public ResponseEntity<byte[]> exportArchive(@RequestBody ExportRequest request) {
        byte[] bundle = archiveExportService.exportArchive(request);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/zip"))
                .header("Content-Disposition", "attachment; filename=\"export.aivault\"")
                .body(bundle);
    }

    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ImportResultDto importArchive(
            @RequestPart("file") MultipartFile file,
            @RequestParam(required = false) Long folderId
    ) {
        return importService.importArchive(file, folderId);
    }
}
