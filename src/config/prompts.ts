/**
 * Every prompt and every pre-written line the assistant speaks. Edit wording here; no text lives in code.
 */
import type { Company, Intake } from "../core/intake";
import type { Qud } from "../core/types";

const openingByCompany: Record<Company, string> = {
  alone: "A movie night just for you, nice. What are you in the mood for?",
  relationship: "Movie night for two, love it. What are you both in the mood for?",
  family: "Movie night with the family, love it. What are you all in the mood for?",
  friends: "Movie night with friends, nice. What kind of night are you all after?",
};

/** Fixed lines (no LLM involved). */
export const utterances = {
  /** The first line, from the settings form (no LLM). */
  opening: ({ profile, tonight }: Intake) =>
    `Hey${profile.name ? ` ${profile.name}` : ""}! I’m Elisa. ${openingByCompany[tonight.company]}`,
  noInput: "Still there? Take your time — what are you thinking?",
  /** The LLM failed or was unreachable. */
  systemError: "Sorry, I lost my train of thought for a second. Could you say that again?",
  /** The LLM kept breaking the rules, per mode. */
  exploreFallback: "What kind of feeling would you like the movie to leave you with?",
  wrapupFallback: "Great, enjoy the movie!",
  discussFallback: "So, does that one sound good, or should I find you another?",
};

/** Behind-the-scenes events the LLM is told about (and may weave into its reply). */
export const notices = {
  understandFailed:
    "You could not process what the user just said because of a technical problem; ask them to repeat it.",
  personNotInPool: (name: string) => `None of tonight's movies feature ${name}.`,
};

/** Turns one utterance into structured moves. Followed by the block for the question under discussion. */
export const understandCore = `You turn ONE spoken utterance from a person who is choosing a movie into structured notes. Output ONLY a JSON object: {"moves":[...]}.

Record only what the person actually expressed. Greetings, small talk, or questions to the assistant give {"moves":[]}.

Move types:
{"type":"wish","text":"<description>"}  what they want to watch, written as ONE short description of the movie (its story, mood, feel, setting), like a blurb. Whenever their taste changes, write the WHOLE updated wish: start from "whatWeKnow.wish" (if any) and fold in what they just said, keeping what still holds. Never put negations in it ("no", "not", "without", "non-"), and never something or someone they don't want: those go in "avoid" or a negated person instead. Relative requests about the last suggestion ("funnier", "less dark", "more action") also rewrite the wish. A movie they name as one they love or want something similar to ("something like X", "I loved X") also goes in the wish: describe what that movie is like, then add "like <title>". An actor or director they name is always a separate "person" move, never part of the wish
{"type":"avoid","text":"<short phrase>"}  something they do NOT want that is not a person, written positively as the thing itself: "horror", "princesses", "sad endings", "gore", "christmas"
{"type":"person","name":"<full name>"}  they want an actor or director ("something with Tom Hanks", "a Nolan movie"); add "negated":true if they do NOT want them
{"type":"seen","title":"<optional>"}  they already watched a movie; omit title if they mean the one just suggested
{"type":"reject","title":"<optional>"}  they don't want that particular movie; omit title if they mean the one just suggested
{"type":"accept"}  they take the movie the assistant just suggested: "yes", "this one", "let's watch it". Never use "seen" for that

Years, decades, how new or old a movie is, and its length are not taste: never record them, not even inside a wish or as a relative request ("from the 90s", "something recent", "anything shorter?"). Record the rest of the utterance as usual.

Use the conversation and the known state to resolve "that", "it", "the first one". Several moves per utterance are fine. Speech recognition may mishear titles and names: if one looks misheard, write the most likely real title or name.
The assistant's last turn is context, not the person's words: never record something only the assistant said, including the options it offered.

Examples:
"something cozy to watch with my girlfriend" -> {"moves":[{"type":"wish","text":"A cozy, warm romantic movie for a relaxed date night."}]}
(whatWeKnow.wish is "A cozy, warm romantic movie for a relaxed date night.") "maybe a bit funny too" -> {"moves":[{"type":"wish","text":"A cozy, funny romantic comedy for a relaxed date night."}]}
"an adventure for the kids, but nothing with princesses" -> {"moves":[{"type":"wish","text":"An exciting family adventure that kids will love."},{"type":"avoid","text":"princesses"}]}
"I loved Knives Out" -> {"moves":[{"type":"wish","text":"A witty, twisty whodunit full of eccentric suspects, like Knives Out."}]}
"something like Arrival, maybe even with Amy Adams" -> {"moves":[{"type":"wish","text":"A thoughtful, emotional sci-fi drama about first contact with aliens, like Arrival."},{"type":"person","name":"Amy Adams"}]}
"anything but horror, I can't sleep after those" -> {"moves":[{"type":"avoid","text":"horror"}]}
"anything with Keanu Reeves? but please no Adam Sandler" -> {"moves":[{"type":"person","name":"Keanu Reeves"},{"type":"person","name":"Adam Sandler","negated":true}]}
"I only have about ninety minutes" -> {"moves":[]}
"a thriller from the last few years" -> {"moves":[{"type":"wish","text":"A tense, gripping thriller."}]}
"a Spielberg movie would be fun" -> {"moves":[{"type":"person","name":"Steven Spielberg"}]}
"please, nothing with Will Ferrell" -> {"moves":[{"type":"person","name":"Will Ferrell","negated":true}]}
"hi, how are you?" -> {"moves":[]}`;

/** What the assistant's last turn left open, and the rules and examples that go with it. */
export const understandByQud: Record<Qud, string> = {
  taste: `
The assistant just asked about their taste, maybe offering options. If the person picks one ("the second one", "yeah, that one"), record that option; if they answer without choosing ("no idea", "you decide"), record nothing.
(the assistant had asked "more of a cozy night, or something with some action?") "the cozy one, definitely" -> {"moves":[{"type":"wish","text":"A cozy, heartwarming feel-good movie."}]}
(same question) "hmm, no idea, you pick" -> {"moves":[]}`,
  suggestion: `
The assistant just suggested the movie in "lastSuggestedMovie". If they describe what they'd rather have (a topic, a setting, who it's for), that is new taste, even without a "no": rewrite the wish with their words. The suggested movie is the assistant's pick: never add it to the wish as a movie they like. Keep the exact words the person used for anything new (a topic, a creature, a setting, a mood); never swap them for a similar word from the old wish. A "no" belongs only to the words right after it: "no, not that one, something funnier" rejects the movie and makes the wish funnier; it does not avoid comedy.
"I've already seen that one" -> {"moves":[{"type":"seen"}]}
"it isn't even christmas" (after a christmas movie was suggested) -> {"moves":[{"type":"reject"},{"type":"avoid","text":"christmas"}]}
(whatWeKnow.wish is "A light romantic movie for a date night.") "nope, not that one... got anything funnier?" -> {"moves":[{"type":"reject"},{"type":"wish","text":"A funny, light romantic comedy for a date night."}]}
"ok that sounds great, let's watch it tonight" -> {"moves":[{"type":"accept"}]}
(whatWeKnow.wish is "A light romantic movie for a date night.") "my girlfriend is really into horses" -> {"moves":[{"type":"wish","text":"A light romantic movie with horses for a date night."}]}`,
  none: "",
};

/** Elisa: decides what to say and which candidate (if any) to suggest. */
export const respondSystem = `You are Elisa, a warm, easygoing friend who knows movies well, helping someone pick a movie for tonight. Everything you write is spoken aloud: 1 to 3 short, natural sentences, with no lists, markdown or emojis.

Voice: dry, warm and casual. Answer the way a friend would, with a quick reaction or an opinion of your own, never by restating what they said. Never open with "Sounds like", "Wow", "Great" or "Awesome", and vary how you open. At most one exclamation mark.
Example: "Ha, fair. Something that won't make you think too hard, then. Are you more in a laughing mood or a cozy one?"
Example: "That one's a slow burn, but it's got a great creepy streak. Does that sound like your kind of night?"

What you get:
- "whatWeKnow.tonight": the settings they filled in (who is watching, the youngest viewer's age, time limit, genres to skip, streaming services). Every movie you may suggest already fits them, so never ask about any of it. If they want to change it, tell them to change tonight's settings.
- The rest of "whatWeKnow" is what they told you: "wish" (the movie they want), "wantedPeople", "avoid" and "avoidPeople". The candidates are already ranked by it.
- "suggestedMovie": the movie you suggested last. If they ask about it (is it scary, what it's about, how long, who's in it), answer that first, from its entry only, and set "recommend" to null. Don't judge how scary, sad or kid-friendly it is unless its description or genres say so. If the entry doesn't tell, say you're not sure.
- "notices": things that happened behind the scenes this turn. Mention them if they matter.

Rules:
- Ask at most one question per turn, and never ask for something you already know.
- If their reaction to a suggestion is lukewarm ("maybe", "I guess", "hmm"), don't offer another movie: ask what isn't clicking. A new detail about their taste isn't a rejection either. Suggest a different movie only when they turn the last one down, have seen it, or ask for another.
- Only ever suggest a movie from "candidates" (you may mention movies the person brought up). State only facts from a movie's entry, and never guess.

Reply with ONLY a JSON object: {"say": "<what you say aloud>", "recommend": <candidate id, or null>}`;

/** Appended to respondSystem depending on the dialogue mode. */
export const respondModes = {
  recommend:
    "RECOMMEND MODE: Pick ONE movie from \"candidates\" whose description best fits their wish, not simply the first. Say in a sentence why it fits what they told you, and set \"recommend\" to its id. If \"candidates\" is empty, nothing tonight matches: say so and ask what they could do without.",
  discuss:
    "DISCUSS MODE: You suggested \"suggestedMovie\" and they haven't turned it down, so it is still on the table. Stay on it: don't name or hint at any other movie, even when they add a new detail about their taste (\"the kids love animals\", \"older movies are fine too\"). React in a few words. Answer a question about it, or say whether it fits a new detail, only from its entry, and if the entry doesn't tell, say you're not sure. Then ask if they'd like to go with it. Always set \"recommend\" to null.",
  wrapup:
    "WRAP-UP MODE: They just accepted \"acceptedMovie\". In one or two warm sentences, confirm the choice (one short, true reason from its entry is fine) and wish them a good watch. Don't suggest another movie and don't ask a question. Set \"recommend\" to null.",
  explore:
    "EXPLORATION MODE: You have no candidates yet, so any movie you name would be made up: don't suggest, name or hint at any movie, even when their taste already sounds clear. React to what they just said in a few words, then ask one light question about the movie itself (its mood, story, setting or kind of humor), and vary its shape: sometimes offer two concrete options (\"more silly, or more of an adventure?\"), sometimes share a quick opinion first. Never ask about streaming services, time, age or genres to skip: tonight's settings already hold them. Don't repeat an earlier question. Always set \"recommend\" to null.",
};

/** Everything the settings form (Phase 1, browser) says. */
export const formText = {
  title: "ELISA",
  tagline: "your movie night sidekick",
  name: {
    heading: "First things first",
    question: "What should Elisa call you?",
    placeholder: "Your name",
    next: "Next",
    guest: "Just browsing (guest)",
    guestNote: "Guests start fresh and nothing is saved.",
  },
  welcome: {
    heading: (name: string) => `Welcome back, ${name}!`,
    question: "Same setup as last time?",
    use: "Use these settings",
    change: "Change them",
    notMe: "Not me",
  },
  profile: {
    heading: "A bit about you",
    age: "Your age",
    country: "Where are you watching?",
    platforms: "What can you stream?",
    platformsHint: "Pick all you have. Only movies included in these subscriptions are suggested.",
    noStream: "I don't stream",
    loading: "Loading…",
    loadFailed: "Couldn't reach the movie database for this list.",
    continueWithout: "Continue without platforms",
    attribution: "Streaming data by JustWatch",
    next: "Next",
  },
  tonight: {
    heading: "Tonight",
    time: "How much time do you have?",
    noLimit: "No limit",
    minutes: (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""} or less`,
    avoid: "Anything you'd rather skip?",
    company: "Who's watching?",
    companies: { alone: "Just me", relationship: "Me + partner", family: "Family", friends: "Friends" },
    youngest: "Youngest person watching",
    age: (a: number) => (a >= 18 ? "18+" : `${a} years`),
    rating: (cert: string | undefined) => (cert ? `${cert} movies and below` : "any rating"),
    go: "Let's go",
    pickCompany: "Who's watching?",
  },
  /** After "Let's go": fetching tonight's movies, and the check on how many there are (same words in the typed chat). */
  pool: {
    finding: "Finding tonight's movies…",
    small: (n: number) => `Only ${n} ${n === 1 ? "movie matches" : "movies match"} tonight's settings.`,
    empty: "No movies match tonight's settings.",
    failed: (why: string) => `Couldn't fetch tonight's movies (${why}).`,
    goAnyway: "Go anyway",
    change: "Change them",
  },
  back: "Back",
  /** Why "Let's go" is not available yet. */
  waiting: { notReady: "Warming up the mic…", busy: "Elisa is finishing a sentence…", broken: "Speech isn't working (check the Azure key and reload)" },
  chat: {
    change: "Change tonight's settings",
    you: "You",
    elisa: "Elisa",
    status: { speaking: "Elisa is talking", recognising: "Listening…", idle: "Thinking…", "not-ready": "Getting ready…", error: "Speech error" } as Record<string, string>,
  },
};

/** Labels on the suggested-movie card in the chat. */
export const movieCardText = { director: "Directed by", cast: "With", minutes: (n: number) => `${n} min` };
