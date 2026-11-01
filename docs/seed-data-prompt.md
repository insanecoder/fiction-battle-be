# Prompt used to generate the seed data

Kept for reference: this is the prompt that produced `src/data-seed.json`.

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
