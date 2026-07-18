package com.aivault.migration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Widens legacy text columns that were created as fixed-width {@code VARCHAR}
 * before their entities were annotated as {@code LONGVARCHAR}.
 *
 * <p>Because {@code spring.jpa.hibernate.ddl-auto=update} never changes an
 * existing column's type, a long answer (or a pasted base64 image) overflows
 * the old {@code VARCHAR(32600)} cap and every save fails with
 * {@code "Value too long for column"}, leaving the editor stuck on
 * "Saving…". Widening the columns to a max-length {@code VARCHAR} removes the
 * limit while keeping them in the {@code CHARACTER VARYING} family, so
 * Hibernate's {@code lower()}/{@code LIKE} search keeps working (unlike CLOB).</p>
 *
 * <p>Runs before the other migration runners so back-fill/conversion writes
 * can't hit the old cap. Idempotent: only columns whose current max length is
 * below {@link #TARGET_LENGTH} are altered, so widened databases are left
 * untouched on subsequent boots.</p>
 */
@Component
@Order(0)
public class WidenTextColumnsRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(WidenTextColumnsRunner.class);

    /** H2's maximum VARCHAR length (1 GB of characters); effectively unbounded. */
    private static final long TARGET_LENGTH = 1_000_000_000L;

    /** {table, column} pairs whose content can grow past a VARCHAR limit. */
    private static final String[][] TEXT_COLUMNS = {
            {"NOTE_SEGMENTS", "ANSWER_MARKDOWN"},
            {"NOTE_SEGMENTS", "QUESTION"},
            {"NOTES", "CONTENT_MARKDOWN"},
            {"NOTES", "QUESTION"},
    };

    private final JdbcTemplate jdbc;

    public WidenTextColumnsRunner(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        for (String[] tc : TEXT_COLUMNS) {
            String table = tc[0];
            String column = tc[1];
            if (!needsWidening(table, column)) {
                continue;
            }
            jdbc.execute("ALTER TABLE " + table + " ALTER COLUMN " + column
                    + " SET DATA TYPE VARCHAR(" + TARGET_LENGTH + ")");
            log.info("Widened {}.{} to VARCHAR({}) to allow long content",
                    table, column, TARGET_LENGTH);
        }
    }

    /**
     * True when the column exists, is a bounded {@code CHARACTER VARYING}, and
     * its max length is smaller than {@link #TARGET_LENGTH}.
     */
    private boolean needsWidening(String table, String column) {
        return Boolean.TRUE.equals(jdbc.query(
                "select DATA_TYPE, CHARACTER_MAXIMUM_LENGTH "
                        + "from INFORMATION_SCHEMA.COLUMNS "
                        + "where TABLE_NAME = ? and COLUMN_NAME = ?",
                rs -> {
                    if (!rs.next()) {
                        return false;
                    }
                    String dataType = rs.getString("DATA_TYPE");
                    long maxLength = rs.getLong("CHARACTER_MAXIMUM_LENGTH");
                    return dataType != null
                            && dataType.toUpperCase().contains("CHARACTER VARYING")
                            && maxLength < TARGET_LENGTH;
                },
                table, column));
    }
}
