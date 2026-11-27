package com.socialtask.common;

import org.junit.jupiter.api.Test;

import java.sql.Timestamp;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

class DbBindingTest {

    @Test void replacesPlaceholdersWithEscapedLiterals() {
        assertEquals("SELECT * FROM people WHERE id=1 AND name='O''Reilly'",
            Db.bind("SELECT * FROM people WHERE id=? AND name=?", 1L, "O'Reilly"));
    }

    @Test void leavesQuestionMarksInsideStringLiteralsAlone() {
        assertEquals("SELECT '?' AS q FROM tasks WHERE id=7",
            Db.bind("SELECT '?' AS q FROM tasks WHERE id=?", 7));
    }

    @Test void rendersNullBooleanAndTimestamps() {
        Instant at = Instant.parse("2026-11-27T10:00:00Z");
        assertEquals("UPDATE t SET a=NULL,b=TRUE,c=FALSE,d='2026-11-27T10:00:00Z'::timestamptz WHERE id=9",
            Db.bind("UPDATE t SET a=?,b=?,c=?,d=? WHERE id=?",
                null, true, false, Timestamp.from(at), 9));
    }

    @Test void rejectsArgumentCountMismatch() {
        assertThrows(IllegalArgumentException.class, () -> Db.bind("SELECT ?", 1, 2));
        assertThrows(IllegalArgumentException.class, () -> Db.bind("SELECT ?"));
    }
}
