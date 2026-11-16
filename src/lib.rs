use loki_sdk::{Database, Error, Method, Request, Response, Result, Router, params};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BODY: usize = 96 * 1024;
const MAX_ARRANGEMENTS: u32 = 200;
const COLUMNS: &str =
    "id,title,artist,instrument,tuning,tempo,stage,section_count,done_count,revision,updated";

#[derive(askama::Template)]
#[template(path = "home.html")]
struct Home<'a> {
    username: &'a str,
    csrf: &'a str,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Section {
    name: String,
    source: String,
    done: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Arrangement {
    title: String,
    artist: String,
    instrument: String,
    tuning: String,
    tempo: u16,
    stage: String,
    notes: String,
    sections: Vec<Section>,
    revision: Option<i64>,
}

impl Arrangement {
    fn validate(&mut self) -> Result<()> {
        self.title = self.title.trim().to_owned();
        self.artist = self.artist.trim().to_owned();
        if self.title.is_empty()
            || self.title.chars().count() > 100
            || self.artist.chars().count() > 100
        {
            return Err(Error::bad(
                "Enter a title and limit the title and artist to 100 characters each.",
            ));
        }
        if !matches!(self.stage.as_str(), "draft" | "practicing" | "learned")
            || !(30..=300).contains(&self.tempo)
        {
            return Err(Error::bad(
                "Choose a practice status and a tempo from 30 to 300 BPM.",
            ));
        }
        let pitches: Vec<_> = self.tuning.split_whitespace().collect();
        let count = match self.instrument.as_str() {
            "guitar" => 6,
            "ocarina" => 1,
            _ => return Err(Error::bad("Choose guitar or ocarina.")),
        };
        if pitches.len() != count || !pitches.iter().all(|pitch| valid_pitch(pitch)) {
            return Err(Error::bad(if count == 6 {
                "Enter six pitches from the lowest to highest string, such as E2 A2 D3 G3 B3 E4."
            } else {
                "Choose the ocarina's sounding tonic, such as C5."
            }));
        }
        self.tuning = pitches.join(" ");
        if !(1..=16).contains(&self.sections.len()) || self.notes.len() > 4096 {
            return Err(Error::bad(
                "Keep one to 16 sections and at most 4 KiB of practice notes.",
            ));
        }
        let mut total = 0;
        for section in &mut self.sections {
            section.name = section.name.trim().to_owned();
            if section.name.is_empty()
                || section.name.chars().count() > 60
                || section.source.len() > 12 * 1024
            {
                return Err(Error::bad(
                    "Give each section a name of up to 60 characters and at most 12 KiB of notation.",
                ));
            }
            total += section.source.len();
        }
        if total > 48 * 1024 {
            return Err(Error::bad("Keep the combined notation under 48 KiB."));
        }
        Ok(())
    }
}

fn valid_pitch(pitch: &str) -> bool {
    match pitch.as_bytes() {
        [b'A'..=b'G' | b'a'..=b'g', b'0'..=b'8'] => true,
        [b'A'..=b'G' | b'a'..=b'g', b'#' | b'b', b'0'..=b'8'] => true,
        _ => false,
    }
}

fn health(_: Request) -> Result<Response> {
    Database.execute(include_str!("schema.sql"), params![])?;
    Database.execute(
        "CREATE INDEX IF NOT EXISTS arrangements_account ON arrangements(account,updated DESC)",
        params![],
    )?;
    Ok(Response::text("ready"))
}

fn home(request: Request) -> Result<Response> {
    let context = request.context();
    let Some(user) = &context.user else {
        return Response::redirect("/_loki/start?next=%2F");
    };
    Response::render(Home { username: &user.username, csrf: context.csrf_token() })?
        .header("content-security-policy", "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")?
        .header("referrer-policy", "no-referrer")
}

fn list(request: Request) -> Result<Response> {
    let user = request.context().require_user()?;
    let rows = Database.query(
        &format!("SELECT {COLUMNS} FROM arrangements WHERE account=? ORDER BY updated DESC,rowid DESC LIMIT {MAX_ARRANGEMENTS}"),
        params![user.id],
    )?;
    Response::json(&rows.rows)
}

fn read(id: &str, account: &str) -> Result<serde_json::Value> {
    let mut row: serde_json::Value = Database
        .fetch_optional(
            &format!("SELECT {COLUMNS},notes,sections FROM arrangements WHERE account=? AND id=?"),
            params![account, id],
        )?
        .ok_or_else(|| Error::not_found("Arrangement not found."))?;
    let sections = row["sections"]
        .as_str()
        .ok_or_else(|| Error::internal("Section data is missing."))?;
    row["sections"] = serde_json::from_str(sections)?;
    Ok(row)
}

fn get(request: Request) -> Result<Response> {
    let user = request.context().require_user()?;
    Response::json(&read(request.param("id")?, &user.id)?)
}

fn save(mut request: Request, existing: bool) -> Result<Response> {
    let account = request.context().require_user()?.id.clone();
    let id = if existing {
        request.param("id")?.to_owned()
    } else {
        loki_sdk::random_id()
    };
    let mut item: Arrangement = request.json(MAX_BODY)?;
    item.validate()?;
    let sections = serde_json::to_string(&item.sections)?;
    let done_count = item.sections.iter().filter(|section| section.done).count();
    let updated = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    if existing {
        let revision = item
            .revision
            .ok_or_else(|| Error::bad("Reload the arrangement before editing it."))?;
        let changed = Database.execute(
            "UPDATE arrangements SET title=?,artist=?,instrument=?,tuning=?,tempo=?,stage=?,notes=?,sections=?,section_count=?,done_count=?,updated=?,revision=revision+1 WHERE id=? AND account=? AND revision=?",
            params![item.title,item.artist,item.instrument,item.tuning,item.tempo,item.stage,item.notes,sections,item.sections.len(),done_count,updated,id,account,revision],
        )?;
        check_change(changed, &id, &account)?;
    } else {
        let changed = Database.execute(
            "INSERT INTO arrangements(id,account,title,artist,instrument,tuning,tempo,stage,notes,sections,section_count,done_count,updated) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM arrangements WHERE account=?) < ?",
            params![id,account,item.title,item.artist,item.instrument,item.tuning,item.tempo,item.stage,item.notes,sections,item.sections.len(),done_count,updated,account,MAX_ARRANGEMENTS],
        )?;
        if changed == 0 {
            return Err(Error::new(
                413,
                "Your library can hold up to 200 arrangements.",
            ));
        }
    }
    Ok(Response::json(&read(&id, &account)?)?.with_status(if existing { 200 } else { 201 }))
}

fn check_change(changed: u64, id: &str, account: &str) -> Result<()> {
    if changed == 0 {
        read(id, account)?;
        return Err(Error::new(
            409,
            "This arrangement changed in another tab. Reopen it to see the latest version.",
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
struct Deletion {
    revision: i64,
}

fn delete(mut request: Request) -> Result<Response> {
    let account = request.context().require_user()?.id.clone();
    let id = request.param("id")?.to_owned();
    let body: Deletion = request.json(1024)?;
    let changed = Database.execute(
        "DELETE FROM arrangements WHERE id=? AND account=? AND revision=?",
        params![id, account, body.revision],
    )?;
    check_change(changed, &id, &account)?;
    Ok(Response::empty(204))
}

fn css(_: Request) -> Result<Response> {
    Response::text(include_str!("../static/style.css"))
        .header("content-type", "text/css; charset=utf-8")
}
fn script(_: Request) -> Result<Response> {
    Response::text(include_str!("../static/app.mjs"))
        .header("content-type", "text/javascript; charset=utf-8")
}
fn notation(_: Request) -> Result<Response> {
    Response::text(include_str!("../static/notation.mjs"))
        .header("content-type", "text/javascript; charset=utf-8")
}
fn font(request: Request) -> Result<Response> {
    let name = request.param("name")?;
    match name {
        "bricolage-grotesque.woff2"
        | "instrument-sans.woff2"
        | "bricolage-grotesque-OFL.txt"
        | "instrument-sans-OFL.txt" => loki_sdk::asset(&format!("static/fonts/{name}")),
        _ => Err(Error::not_found("Font asset not found.")),
    }
}

fn handle(request: Request) -> Result<Response> {
    Router::new()
        .get("/health", health)
        .get("/", home)
        .get("/static/style.css", css)
        .get("/static/app.mjs", script)
        .get("/static/notation.mjs", notation)
        .get("/static/fonts/{name}", font)
        .get("/api/arrangements", list)
        .post("/api/arrangements", |request| save(request, false))
        .get("/api/arrangements/{id}", get)
        .route(Method::Put, "/api/arrangements/{id}", |request| {
            save(request, true)
        })
        .route(Method::Delete, "/api/arrangements/{id}", delete)
        .handle(request)
}

loki_sdk::export!(handle);
