import readline from "readline";
import { MongooseAdapter } from "./db/mongo-client";
import { PostsRepository } from "./features/posts/posts.repository";
import { TagRepository } from "./features/tags/tag.repository";
import { TagMappingRepository } from "./features/tags/tag-mapping.repository";
import { TagCandidateRepository } from "./features/tags/tag-candidate.repository";
import { tagEmbeddingText, type TagName } from "./features/tags/tag.service";
import { createEmbedder } from "./ai/embeddings/embedder";
import { REVIEW_REASON_TEXT, type TagCandidateDocument } from "./models/tag-candidate.model";
import type { TagType, Universe } from "./types/custom-types";

// npm run review-tags
// Goes through the names waiting in the review queue, one at a time. For each one you choose:
//   n    a new tag: added to the vocabulary (with its vector) and to the posts that mentioned it
//   1-5  the same as one of the closest tags shown: the posts get that tag, and the name maps to it from now on
//   f    the same as another tag: find it by name, then as above
//   x    not a real tag: ignored from now on
//   s    skip for now / q quit
// Nothing changes unless you type y to confirm.

const UNIVERSE_NAMES: Record<Universe, string> = { HP: "Harry Potter", GOT: "Game of Thrones" };

// Reads answers line by line, so it works when typed and when answers are piped in.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
const lines = rl[Symbol.asyncIterator]();
async function ask(question: string): Promise<string> {
  process.stdout.write(question);
  const next = await lines.next();
  if (next.done) throw new QuitSignal(); // input ended (Ctrl+D, or the end of piped answers)
  const answer = String(next.value).trim();
  if (!process.stdin.isTTY) process.stdout.write(answer + "\n"); // echo piped answers so the transcript reads naturally
  return answer;
}
async function confirm(question: string): Promise<boolean> {
  const yes = (await ask(`${question} Type y to confirm: `)).toLowerCase() === "y";
  if (!yes) console.log("Cancelled. Nothing changed.");
  return yes;
}
class QuitSignal extends Error {}

async function main() {
  const mObj = new MongooseAdapter();
  const dbConn = await mObj.connect("primary");
  const postRepo = new PostsRepository(dbConn);
  const tagRepo = new TagRepository(dbConn);
  const mappingRepo = new TagMappingRepository(dbConn);
  const candidateRepo = new TagCandidateRepository(dbConn);
  const embedder = createEmbedder();

  // Adds the tag to every post that mentioned the name (no duplicates).
  async function addToPosts(c: TagCandidateDocument, tagId: string): Promise<void> {
    const group: Record<TagType, string[]> = { person: [], place: [], artifact: [], event: [] };
    group[c.type as TagType].push(tagId);
    for (const postId of c.postIds) await postRepo.addAutoTags(String(postId), group);
  }

  const pending = await candidateRepo.listPending();
  if (!pending.length) {
    console.log("Nothing is waiting for review.");
    return;
  }
  console.log(`${pending.length} name(s) waiting for review.`);

  for (const [i, c] of pending.entries()) {
    const name: TagName = { type: c.type as TagType, universe: c.universe as Universe, label: c.label };
    const closest = c.answers.map((a) => ({ tagId: String(a.tagId), label: a.label as string }));
    const posts = c.postIds.length;

    console.log("\n────────────────────────────────────────────");
    console.log(`Name ${i + 1} of ${pending.length}:  "${c.label}"`);
    console.log(`  Kind:      ${c.type}`);
    console.log(`  Universe:  ${UNIVERSE_NAMES[name.universe]}`);
    console.log(`  Seen in:   ${posts} post(s)`);
    if (c.sampleText) console.log(`  Example:   "${c.sampleText.replace(/\s+/g, " ")}"`);
    console.log(`  Why here:  ${c.reasonText ?? REVIEW_REASON_TEXT[c.reason ?? ""] ?? "Not recorded."}`);
    console.log(closest.length ? "\n  Closest existing tags:" : "\n  Closest existing tags: none");
    closest.forEach((t, k) => console.log(`    ${k + 1}) ${t.label}`));

    const numbers = closest.length ? `1-${closest.length}` : "";
    const menu = [
      `\nWhat is "${c.label}"?`,
      `  n    = a NEW tag (add it)`,
      ...(closest.length ? [`  ${numbers.padEnd(4)} = the SAME as one of the tags above`] : []),
      `  f    = the same as some other tag (find it by name)`,
      `  x    = NOT a real tag (ignore it from now on)`,
      `  s    = skip for now`,
      `  q    = quit`,
    ].join("\n");
    const valid = ["n", "f", "x", "s", "q", ...closest.map((_, k) => String(k + 1))];

    // Ask until something is done or skipped; a cancelled confirmation comes back to the same name.
    let done = false;
    console.log(menu);
    while (!done) {
      const choice = (await ask("Your choice: ")).toLowerCase();
      if (!valid.includes(choice)) {
        console.log(`Please type one of: ${valid.filter((v) => !/^\d$/.test(v)).join(", ")}${numbers ? `, ${numbers}` : ""}`);
        continue;
      }
      if (choice === "q") throw new QuitSignal();
      if (choice === "s") break;

      if (choice === "n") {
        if (!embedder) {
          console.log("Can't add tags: LLM_API_KEY is not set (new tags need an embedding).");
          continue;
        }
        if (!(await confirm(`Add "${c.label}" as a new tag and add it to ${posts} post(s)?`))) continue;
        const [vector] = await embedder.embed([tagEmbeddingText(name)]);
        const tag = await tagRepo.createWithEmbedding(name, vector, embedder.model);
        await addToPosts(c, String(tag._id));
        await candidateRepo.decide(String(c._id), "approved", String(tag._id));
        console.log(`✅ Done. "${tag.label}" is now a tag.`);
        done = true;
      } else if (choice === "x") {
        if (!(await confirm(`Ignore "${c.label}" from now on? It will never be tagged.`))) continue;
        await candidateRepo.decide(String(c._id), "rejected");
        console.log(`✅ Done. "${c.label}" will be ignored.`);
        done = true;
      } else {
        // The same as an existing tag: one of the closest ones, or one found by name.
        let target = closest[Number(choice) - 1];
        if (choice === "f") {
          const query = await ask("Type part of the tag's name: ");
          const found = query ? (await tagRepo.searchByLabel(query, c.type, c.universe)).slice(0, 10) : [];
          if (!found.length) {
            console.log("No tags found.");
            continue;
          }
          found.forEach((t, k) => console.log(`  ${k + 1}) ${t.label}`));
          const pick = found[Number(await ask("Which one? ")) - 1];
          if (!pick) {
            console.log("Cancelled. Nothing changed.");
            continue;
          }
          target = { tagId: String(pick._id), label: pick.label };
        }
        if (!(await confirm(`"${c.label}" means "${target.label}"? Posts will get "${target.label}".`))) continue;
        await mappingRepo.save(name, target.tagId, "review");
        await addToPosts(c, target.tagId);
        await candidateRepo.decide(String(c._id), "merged", target.tagId);
        console.log(`✅ Done. From now on "${c.label}" becomes "${target.label}" automatically.`);
        done = true;
      }
    }
  }
  console.log("\nAll done.");
}

main()
  .catch((err) => {
    if (err instanceof QuitSignal) return console.log("\nStopped. Everything you confirmed is saved.");
    console.error("❌ Review failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    process.exit();
  });
