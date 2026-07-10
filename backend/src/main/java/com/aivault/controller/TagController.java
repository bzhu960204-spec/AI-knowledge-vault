package com.aivault.controller;

import com.aivault.entity.Tag;
import com.aivault.repository.TagRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Comparator;
import java.util.List;

@RestController
@RequestMapping("/api/tags")
public class TagController {

    private final TagRepository tagRepository;

    public TagController(TagRepository tagRepository) {
        this.tagRepository = tagRepository;
    }

    @GetMapping
    public List<String> list() {
        return tagRepository.findAll().stream()
                .map(Tag::getName)
                .sorted(Comparator.comparing(String::toLowerCase))
                .toList();
    }
}
