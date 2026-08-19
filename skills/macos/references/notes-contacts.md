# Notes and Contacts: JXA recipes

Run as `osascript -l JavaScript -e '<script>'`. Scripts return `JSON.stringify(...)`. Replace `{{...}}` placeholders with values that have been **escaped for JXA** (escape `\ ' " backtick $`, newlines `\n`, tabs; strip NUL). `{{...}}` = a literal value; `%%...%%` markers below = optional blocks of pre-built JXA you splice in or leave empty.

Always use `whose()` predicates for search. Never iterate all objects in JS.

---

## NOTES

### List notes (paginated; bodies omitted; skips "Recently Deleted")
```javascript
(() => {
  const Notes = Application("Notes");
  const folders = Notes.folders();
  const result = []; const offset = 0; const limit = 50; let skipped = 0;
  for (let fi = 0; fi < folders.length && result.length < limit; fi++) {
    const f = folders[fi];
    if (f.name() === "Recently Deleted") continue;
    const notes = f.notes();
    for (let ni = 0; ni < notes.length && result.length < limit; ni++) {
      if (skipped < offset) { skipped++; continue; }
      const n = notes[ni];
      result.push({ id: n.id(), name: n.name(), body: "", folder: f.name(),
        creationDate: n.creationDate().toISOString(), modificationDate: n.modificationDate().toISOString() });
    }
  }
  return JSON.stringify(result);
})()
```

### Search notes by title (matches title, returns first 500 chars of body)
```javascript
(() => {
  const Notes = Application("Notes");
  const titleMatches = Notes.notes.whose({name: {_contains: "{{search}}"}})();
  const result = []; const limit = 50;
  for (let i = 0; i < titleMatches.length && result.length < limit; i++) {
    const n = titleMatches[i];
    if (n.container().name() === "Recently Deleted") continue;
    result.push({ id: n.id(), name: n.name(), body: n.plaintext().substring(0, 500),
      folder: n.container().name(),
      creationDate: n.creationDate().toISOString(), modificationDate: n.modificationDate().toISOString() });
  }
  return JSON.stringify(result);
})()
```

### Get one note by id (full body)
```javascript
(() => {
  const Notes = Application("Notes");
  const notes = Notes.notes.whose({id: "{{id}}"})();
  if (notes.length === 0) return JSON.stringify(null);
  const n = notes[0];
  return JSON.stringify({ id: n.id(), name: n.name(), body: n.plaintext(), folder: n.container().name(),
    creationDate: n.creationDate().toISOString(), modificationDate: n.modificationDate().toISOString() });
})()
```

### Create note (body is HTML; plain text also works; falls back to default folder if name missing)
```javascript
(() => {
  const Notes = Application("Notes");
  const folder = Notes.folders.whose({name: "{{folder}}"})();
  const target = folder.length > 0 ? folder[0] : Notes.defaultAccount().defaultFolder();
  const note = Notes.Note({name: "{{title}}", body: "{{body}}"});
  target.notes.push(note);
  return JSON.stringify({id: note.id(), name: note.name()});
})()
```

### Delete note (moves to Recently Deleted)
```javascript
(() => {
  const Notes = Application("Notes");
  const notes = Notes.notes.whose({id: "{{id}}"})();
  if (notes.length === 0) throw new Error("Note not found");
  Notes.delete(notes[0]);
  return JSON.stringify({deleted: true});
})()
```

### Folders: list (with counts) / create
```javascript
(() => { const Notes = Application("Notes"); const fs = Notes.folders(); const r = [];
  for (let i=0;i<fs.length;i++) r.push({name: fs[i].name(), noteCount: fs[i].notes().length});
  return JSON.stringify(r); })()
```
```javascript
(() => { const Notes = Application("Notes"); const f = Notes.Folder({name: "{{name}}"});
  Notes.folders.push(f); return JSON.stringify({name: f.name()}); })()
```
(No JXA rename or delete of folders. Apple limitation.)

For update/append-to-note: re-set the title after assigning body (`n.body = ...` makes Apple re-derive the name), then `n.name = titleToSet`. To move folders, splice in `const tf = Notes.folders.whose({name:"<f>"})()[0]; if(!tf) throw new Error("Folder not found"); n.move({to: tf});`.

---

## CONTACTS

`emails`/`phones` are gathered defensively (try/catch each). Edits require `Contacts.save()` to commit.

### List / Search / Get
```javascript
// LIST (paginated)
(() => { const C = Application("Contacts"); const ppl = C.people(); const r=[]; const off=0,lim=50;
  for (let i=off;i<Math.min(ppl.length,off+lim);i++){ const p=ppl[i];
    const em=[]; try{const e=p.emails();for(let j=0;j<e.length;j++)em.push({value:e[j].value(),label:e[j].label()||""});}catch(x){}
    const ph=[]; try{const f=p.phones();for(let j=0;j<f.length;j++)ph.push({value:f[j].value(),label:f[j].label()||""});}catch(x){}
    r.push({id:p.id(),firstName:p.firstName()||"",lastName:p.lastName()||"",fullName:p.name()||"",organization:p.organization()||"",emails:em,phones:ph,addresses:[]});}
  return JSON.stringify(r); })()
```
For **search**, replace `const ppl = C.people()` with `const ppl = C.people.whose({name:{_contains:"{{search}}"}})()`. For **get one**, use `C.people.whose({id:"{{id}}"})()` and add addresses/jobTitle/note/birthday fields.

### Create (splice %%addEmail%% etc., or leave empty)
```javascript
(() => {
  const C = Application("Contacts");
  const p = C.Person({firstName:"{{firstName}}", lastName:"{{lastName}}", organization:"{{organization}}", jobTitle:"{{jobTitle}}", note:"{{note}}"});
  C.people.push(p);
  %%addEmail%%   // p.emails.push(C.Email({value:"<addr>", label:"<label|work>"}));
  %%addPhone%%   // p.phones.push(C.Phone({value:"<num>", label:"<label|mobile>"}));
  %%addAddress%% // p.addresses.push(C.Address({street:"",city:"",state:"",zip:"",country:"",label:"<label|home>"}));
  C.save();
  return JSON.stringify({id: p.id(), fullName: p.name() || ""});
})()
```

### Update (set each field only when present) / Delete
```javascript
(() => { const C=Application("Contacts"); const ppl=C.people.whose({id:"{{id}}"})();
  if(ppl.length===0) throw new Error("Contact not found"); const p=ppl[0];
  if("{{hasFirstName}}"==="true") p.firstName="{{firstName}}";
  if("{{hasLastName}}"==="true") p.lastName="{{lastName}}";
  if("{{hasOrganization}}"==="true") p.organization="{{organization}}";
  if("{{hasJobTitle}}"==="true") p.jobTitle="{{jobTitle}}";
  if("{{hasNote}}"==="true") p.note="{{note}}";
  C.save(); return JSON.stringify({id:p.id(), name:p.name()||""}); })()
```
```javascript
(() => { const C=Application("Contacts"); const ppl=C.people.whose({id:"{{id}}"})();
  if(ppl.length===0) throw new Error("Contact not found"); const name=ppl[0].name()||"";
  C.delete(ppl[0]); C.save(); return JSON.stringify({deleted:true, name:name}); })()
```

---

## CONTACT ENRICHMENT: phone/email to name

Two directions. Used to turn raw `+1555…`/emails (from Messages, Mail, Calendar) into names.

### Handle to name (bulk, SQLite, no Full Disk Access needed)
DBs live under `~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb` (one per account, so query each and merge by `ZUNIQUEID`). Run two queries per DB to avoid a cartesian blow-up:
```bash
ls ~/Library/Application\ Support/AddressBook/Sources/*/AddressBook-v22.abcddb

DB="<one of those paths>"
# emails
/usr/bin/sqlite3 -json -readonly "$DB" "SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZUNIQUEID, e.ZADDRESSNORMALIZED as email FROM ZABCDRECORD r JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK WHERE r.Z_ENT IN (22, 23)"
# phones
/usr/bin/sqlite3 -json -readonly "$DB" "SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZUNIQUEID, p.ZFULLNUMBER as phone FROM ZABCDRECORD r JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK WHERE r.Z_ENT IN (22, 23)"
```
Matching: phones → strip non-digits, index by **last 10 digits** (handles country-code variants); emails → lowercase+trim. Display name = `firstName lastName`, else organization. `Z_ENT` 22 = normal contact, 23 = subscribed/Exchange.

### Name to handles (JXA fallback, capped 100)
```javascript
(() => { const C=Application("Contacts"); const m=C.people.whose({name:{_contains:"{{searchTerm}}"}})(); const r=[];
  for (let i=0;i<Math.min(m.length,100);i++){ const p=m[i];
    const ph=[]; try{const f=p.phones();for(let j=0;j<f.length;j++)ph.push(f[j].value());}catch(x){}
    const em=[]; try{const e=p.emails();for(let j=0;j<e.length;j++)em.push(e[j].value());}catch(x){}
    r.push({id:p.id(),fullName:p.name()||"",firstName:p.firstName()||"",lastName:p.lastName()||"",phones:ph,emails:em});}
  return JSON.stringify(r); })()
```
