package com.aivault.controller;

import com.aivault.dto.NoteDto;
import com.aivault.dto.NoteRequest;
import com.aivault.dto.NoteSummaryDto;
import com.aivault.service.NoteService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/notes")
public class NoteController {

    private final NoteService noteService;

    public NoteController(NoteService noteService) {
        this.noteService = noteService;
    }

    @GetMapping
    public List<NoteSummaryDto> list(
            @RequestParam(required = false) Long folderId,
            @RequestParam(required = false) String tag
    ) {
        return noteService.list(folderId, tag);
    }

    @GetMapping("/search")
    public List<NoteSummaryDto> search(@RequestParam("q") String query) {
        return noteService.search(query);
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

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        noteService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
