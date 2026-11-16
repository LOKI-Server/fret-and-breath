CREATE TABLE IF NOT EXISTS arrangements (
    id TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    instrument TEXT NOT NULL CHECK(instrument IN ('guitar','ocarina')),
    tuning TEXT NOT NULL,
    tempo INTEGER NOT NULL,
    stage TEXT NOT NULL CHECK(stage IN ('draft','practicing','learned')),
    notes TEXT NOT NULL,
    sections TEXT NOT NULL,
    section_count INTEGER NOT NULL,
    done_count INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated INTEGER NOT NULL
)
