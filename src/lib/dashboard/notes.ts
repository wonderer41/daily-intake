import type { Note, Prisma } from "@/generated/prisma/client";
import { HttpError } from "@/lib/api/http";
import { prisma } from "@/lib/db/prisma";
import type { RowRef } from "@/lib/hermes/keys";
import type { NoteInput } from "@/lib/hermes/parse";
import { publishLiveEvent } from "@/lib/live/publish";
import type { HermesWriteResult, NoteDto } from "@/types/dashboard-contracts";
import { retryOnUniqueViolation } from "./concurrency";
import type { CreateNoteInput, UpdateNoteInput } from "./user-parse";

// The Notes panel. Gerardo's notes are written on the page (no key); Hermes upserts its own by key,
// so the latest push wins and repeating one changes nothing. There is no version: each note has one
// writer, and deleting is for good (a Hermes job that sends the note again brings it back).

const NEWEST_FIRST = [{ createdAt: "desc" }, { id: "desc" }] satisfies Prisma.NoteOrderByWithRelationInput[];

export function toNoteDto(row: Note): NoteDto {
  return {
    id: row.id,
    author: row.author === "user" ? "user" : "hermes",
    key: row.key,
    text: row.text,
    detail: row.detail,
    url: row.url,
    count: row.count,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What the page shows: newest first, without notes whose count is 0. */
export async function listVisibleNotes(): Promise<Note[]> {
  return prisma.note.findMany({ where: { OR: [{ count: null }, { count: { gt: 0 } }] }, orderBy: NEWEST_FIRST });
}

/** Every note, zero counts included (GET /api/hermes/state). */
export async function listAllNotes(): Promise<Note[]> {
  return prisma.note.findMany({ orderBy: NEWEST_FIRST });
}

function noteChanges(row: Note, input: NoteInput): Prisma.NoteUpdateInput | null {
  const data: Prisma.NoteUpdateInput = {};
  if (input.text !== row.text) data.text = input.text;
  if (input.detail !== undefined && input.detail !== row.detail) data.detail = input.detail;
  if (input.url !== undefined && input.url !== row.url) data.url = input.url;
  if (input.count !== undefined && input.count !== row.count) data.count = input.count;
  return Object.keys(data).length > 0 ? data : null;
}

/** Creates or updates Hermes's note with this key (PUT /api/hermes/notes/:key). */
export async function upsertHermesNote(key: string, input: NoteInput): Promise<HermesWriteResult<NoteDto>> {
  const outcome = await retryOnUniqueViolation(() =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.note.findUnique({ where: { key } });
      if (!existing) {
        const row = await tx.note.create({
          data: { key, author: "hermes", text: input.text, detail: input.detail ?? null, url: input.url ?? null, count: input.count ?? null },
        });
        return { row, created: true, changed: true };
      }
      const data = noteChanges(existing, input);
      const row = data ? await tx.note.update({ where: { id: existing.id }, data }) : existing;
      return { row, created: false, changed: data !== null };
    }),
  );
  if (outcome.changed) await publishLiveEvent({ type: "notes.changed" });
  return { data: toNoteDto(outcome.row), created: outcome.created };
}

/**
 * DELETE /api/hermes/notes/:key. A key removes Hermes's own note; "id:<uuid>" removes any note,
 * which is how Hermes clears one of Gerardo's notes after turning it into a card. 404 when missing.
 */
export async function deleteNoteByRef(ref: RowRef): Promise<{ deleted: true }> {
  const where = ref.kind === "id" ? { id: ref.id } : { key: ref.key };
  const { count } = await prisma.note.deleteMany({ where });
  if (count === 0) throw new HttpError("NOT_FOUND", ref.kind === "id" ? `No note has id ${ref.id}` : `No note has key ${ref.key}`);
  await publishLiveEvent({ type: "notes.changed" });
  return { deleted: true };
}

/** POST /api/notes. */
export async function createUserNote(input: CreateNoteInput): Promise<NoteDto> {
  const row = await prisma.note.create({ data: { author: "user", text: input.text, url: input.url } });
  await publishLiveEvent({ type: "notes.changed" });
  return toNoteDto(row);
}

/** PATCH /api/notes/:id. Only Gerardo's own notes; Hermes's are rewritten by Hermes. */
export async function updateUserNote(id: string, input: UpdateNoteInput): Promise<NoteDto> {
  const existing = await prisma.note.findUnique({ where: { id } });
  if (!existing) throw new HttpError("NOT_FOUND", `No note has id ${id}`);
  if (existing.author !== "user") throw new HttpError("FORBIDDEN", "Hermes keeps this note up to date; you can delete it but not edit it");
  const data: Prisma.NoteUpdateManyMutationInput = {};
  if (input.text !== undefined && input.text !== existing.text) data.text = input.text;
  if (input.url !== undefined && input.url !== existing.url) data.url = input.url;
  if (Object.keys(data).length === 0) return toNoteDto(existing);
  // updateMany: a delete from another tab in between is a 404, not a crash.
  const { count } = await prisma.note.updateMany({ where: { id, author: "user" }, data });
  const row = count > 0 ? await prisma.note.findUnique({ where: { id } }) : null;
  if (!row) throw new HttpError("NOT_FOUND", `No note has id ${id}`);
  await publishLiveEvent({ type: "notes.changed" });
  return toNoteDto(row);
}

/** DELETE /api/notes/:id: any note, for good. */
export async function deleteNote(id: string): Promise<{ deleted: true }> {
  return deleteNoteByRef({ kind: "id", id });
}
