## Feed Architecture

### 1. Hybrid `createdAt` for seeded vs real documents

Seeded posts and comments do not store a computed timestamp. Instead they store two fields:
- `offsetDays: number` — how many days ago the document was "created", relative to today
- `fixedTime: string` — wall-clock time of day, e.g. `"14:07"`

Real user-created posts store a standard `createdAt: Date` set at write time.

A `resolveCreatedAt(doc)` helper in the service layer reconciles both:
- If `offsetDays` is present → compute `today - offsetDays` at `fixedTime` on the fly
- Otherwise → return `createdAt` as-is

This means seeded data always appears naturally aged relative to the current date, with no stale hardcoded timestamps, and no computed dates are ever written back to the DB.

### 2. Feed sorting at the service layer

The DB returns documents unordered. All sorting happens in-memory in `PostService.filterPosts` after `resolveCreatedAt` is applied to every document. Sort order:

1. The requesting user's own posts bubble to the top
2. All other posts sorted by `resolvedCreatedAt` descending (newest first)

DB-level `sort()` is intentionally omitted — it would produce wrong order for seeded documents whose stored fields are not dates.

---

Need to generate 100 posts (for HP and GOT 50 each). Make the posts mix (as if casual viewers have wriiten a post, or a superfan/nerd, or a new viewer or a critic etc...). Also randomly make 2-3 comments for the post(Also add nesting for any one of those comments). Also the tone of post can be satirical, critical, empathatetic etc.. Use real User posts to generate emotions and viewer type (like casual/nerd) and generate the posts.

Each post must cover 2-3 tags (of any person/place/artifact/event). These tags should be of good mix (like 30% persons, 20% place, 20% artificat, 30% events). Obviously we can talk about person and event/place together (like Rob in Red Wedding, Harry at Azkaban etc.)

Each post should be 100-200 (max) words of length and should have at least 1 reply and 2-3 comments.

People names must be diverse (mix of Indians, Whites, Blacks, etc...)

Construct JSON in the format which suffice this structure (generate user, comments and posts) - 

  export type User = {
  userId: string;
  name: string;
  email: string;
  photo: string;
  userName : string;
};

export type TagType = "person"|"place"|"spell"|"house";

export type Tag = {
    tagId : number,
    type : TagType,
    label: string
}

// A single reply or comment on a post
export type PostComment = {
  id: number
  comment: string
  user: User
  time: number
  replies: PostComment[] | null
}

// The main post payload rendered by CardComponent
export type PostType = {
  id: number
  user: User
  time: number
  post: string
  tags: Tag[]
  comments: PostComment[] | null | undefined
  universe : 'HP' | 'GOT'
}

export type ModalProps = {
    isOpen : boolean
    closeModal : ()=>void
}

This will be my dummy data which I will showcase to EM and Recruiter and should be generated in a way that feels realistic and not AI generated.

generate only 10 posts first. And then we will continue further till we reach 100. Also please store the generated posts in your memory(not to use them as input for next 10) but to accumulate all those posts at the final call which can be easily used.