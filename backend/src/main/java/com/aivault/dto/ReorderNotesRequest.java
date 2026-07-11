package com.aivault.dto;

import java.util.List;

public record ReorderNotesRequest(List<Long> ids) {
}
