/** YouTube links pasted into a jv_T4p3 playlist. */

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"];
const PATHS = ["shorts", "embed", "live", "v"];

/**
 * The video id in a YouTube link (watch?v=, youtu.be/, /shorts/, /embed/, /live/, Music), or a
 * bare 11-character id; null for anything else.
 */
export function parseYoutubeId(text: string): string | null {
  const input = text.trim();
  if (ID.test(input)) return input;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be") id = segments[0] ?? null;
  else if (HOSTS.includes(host)) {
    if (segments[0] === "watch") id = url.searchParams.get("v");
    else if (PATHS.includes(segments[0] ?? "")) id = segments[1] ?? null;
  }
  return id && ID.test(id) ? id : null;
}

const NOISE = /\s*[([](?:official\s*(?:music\s*)?(?:video|audio|clip|visualizer|lyric video)|lyrics?|letra|hd|hq|4k|audio|video\s*clip|clipe oficial|videoclipe)[)\]]\s*/gi;

/**
 * Artist and title from a video's title and channel: "Artista - Música (Official Video)" splits
 * on the dash; otherwise the channel (minus " - Topic"/"VEVO") is the artist.
 */
export function splitVideoTitle(title: string, uploader?: string | null): { artist: string; title: string } {
  const clean = title.replace(NOISE, " ").replace(/\s+/g, " ").trim();
  const dash = clean.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) return { artist: dash[1].trim(), title: dash[2].trim() };
  const channel = (uploader ?? "").replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim();
  return { artist: channel || "YouTube", title: clean || title };
}
