package com.aivault.controller;

import com.aivault.dto.FolderDto;
import com.aivault.dto.FolderRequest;
import com.aivault.dto.ReorderFoldersRequest;
import com.aivault.service.FolderService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/folders")
public class FolderController {

    private final FolderService folderService;

    public FolderController(FolderService folderService) {
        this.folderService = folderService;
    }

    @GetMapping
    public List<FolderDto> list() {
        return folderService.findAll();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public FolderDto create(@Valid @RequestBody FolderRequest request) {
        return folderService.create(request);
    }

    @PutMapping("/{id}")
    public FolderDto update(@PathVariable Long id, @RequestBody FolderRequest request) {
        return folderService.update(id, request);
    }

    @PatchMapping("/reorder")
    public ResponseEntity<Void> reorder(@RequestBody ReorderFoldersRequest request) {
        folderService.reorder(request.ids());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        folderService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
