/** A song as listed on a station: what is searched for on YouTube when it plays. */
export interface Track {
  artist: string;
  title: string;
  /** Search override, for songs made for the game whose uploads need context. */
  query?: string;
  /** A pasted YouTube link: played as is, no search. */
  videoId?: string;
}

export interface Station {
  id: string;
  name: string;
  genre: string;
  host: string;
  tracks: Track[];
  /** Created in jv_T4p3 (YouTube links): it can be renamed, edited and deleted. */
  custom?: boolean;
}

/** Made for the game: searched together with its name. */
const game = (artist: string, title: string): Track => ({ artist, title, query: `${artist} - ${title} GTA Vice City` });

/**
 * The music stations of GTA: Vice City (2002), songs in the in-game order of the original PC/PS2
 * release (source: GrandTheftWiki, "Radio Stations in GTA Vice City"). The talk stations, K-Chat
 * and VCPR, have no music and are left out.
 */
export const STATIONS: Station[] = [
  {
    id: "wildstyle",
    name: "Wildstyle",
    genre: "Hip Hop/Electro",
    host: "Mr. Magic",
    tracks: [
      { artist: "Trouble Funk", title: "Pump Me Up" },
      { artist: "Davy DMX", title: "One for the Treble" },
      { artist: "Cybotron", title: "Clear" },
      { artist: "Hashim", title: "Al-Naafiysh (The Soul)" },
      { artist: "Herbie Hancock", title: "Rockit" },
      { artist: "Afrika Bambaataa & the Soulsonic Force", title: "Looking for the Perfect Beat" },
      { artist: "2 Live Crew", title: "Get It Girl" },
      { artist: "Run-D.M.C.", title: "Rock Box" },
      { artist: "Mantronix", title: "Bassline" },
      { artist: "Tyrone Brunson", title: "The Smurf" },
      { artist: "Whodini", title: "Magic's Wand" },
      { artist: "Zapp", title: "More Bounce to the Ounce" },
      { artist: "Grandmaster Flash and the Furious Five", title: "The Message" },
      { artist: "Kurtis Blow", title: "The Breaks" },
      { artist: "Man Parrish", title: "Hip Hop, Be Bop (Don't Stop)" },
    ],
  },
  {
    id: "flash",
    name: "Flash FM",
    genre: "Pop/Rock",
    host: "Toni",
    tracks: [
      { artist: "Hall and Oates", title: "Out of Touch" },
      { artist: "Wang Chung", title: "Dance Hall Days" },
      { artist: "Michael Jackson", title: "Billie Jean" },
      { artist: "Laura Branigan", title: "Self Control" },
      { artist: "Go West", title: "Call Me" },
      { artist: "INXS", title: "Kiss the Dirt (Falling Down the Mountain)" },
      { artist: "Bryan Adams", title: "Run to You" },
      { artist: "Electric Light Orchestra", title: "Four Little Diamonds" },
      { artist: "Yes", title: "Owner of a Lonely Heart" },
      { artist: "The Buggles", title: "Video Killed the Radio Star" },
      { artist: "Aneka", title: "Japanese Boy" },
      { artist: "Talk Talk", title: "Life's What You Make It" },
      { artist: "The Outfield", title: "Your Love" },
      { artist: "Joe Jackson", title: "Stepping Out" },
      { artist: "The Fixx", title: "One Thing Leads to Another" },
      { artist: "Lionel Richie", title: "Running With The Night" },
    ],
  },
  {
    id: "fever",
    name: "Fever 105",
    genre: "Soul/Disco/R&B",
    host: "Oliver “Ladykiller” Biscuit",
    tracks: [
      { artist: "The Whispers", title: "And the Beat Goes On" },
      { artist: "Fat Larry's Band", title: "Act Like You Know" },
      { artist: "Oliver Cheatham", title: "Get Down Saturday Night" },
      { artist: "The Pointer Sisters", title: "Automatic" },
      { artist: "René & Angela", title: "I'll Be Good" },
      { artist: "Mary Jane Girls", title: "All Night Long" },
      { artist: "Rick James", title: "Ghetto Life" },
      { artist: "Michael Jackson", title: "Wanna Be Startin' Somethin'" },
      { artist: "Evelyn King", title: "Shame" },
      { artist: "Teena Marie", title: "Behind the Groove" },
      { artist: "Mtume", title: "Juicy Fruit" },
      { artist: "Kool & The Gang", title: "Summer Madness" },
      { artist: "Indeep", title: "Last Night a DJ Saved My Life" },
    ],
  },
  {
    id: "vrock",
    name: "V-Rock",
    genre: "Hard Rock/Metal",
    host: "Lazlow",
    tracks: [
      { artist: "Twisted Sister", title: "I Wanna Rock" },
      { artist: "Mötley Crüe", title: "Too Young to Fall in Love" },
      { artist: "Quiet Riot", title: "Cum on Feel the Noize" },
      { artist: "The Cult", title: "She Sells Sanctuary" },
      { artist: "Ozzy Osbourne", title: "Bark at the Moon" },
      game("Love Fist", "Dangerous Bastard"),
      { artist: "Iron Maiden", title: "2 Minutes to Midnight" },
      { artist: "Loverboy", title: "Working for the Weekend" },
      { artist: "Alcatrazz", title: "God Bless Video" },
      { artist: "Tesla", title: "Cumin' Atcha Live" },
      { artist: "Autograph", title: "Turn Up the Radio" },
      { artist: "Megadeth", title: "Peace Sells" },
      { artist: "Anthrax", title: "Madhouse" },
      { artist: "Slayer", title: "Raining Blood" },
      { artist: "Judas Priest", title: "You've Got Another Thing Comin'" },
      game("Love Fist", "Fist Fury"),
      { artist: "David Lee Roth", title: "Yankee Rose" },
    ],
  },
  {
    id: "espantoso",
    name: "Radio Espantoso",
    genre: "Latin Jazz",
    host: "Pepe",
    tracks: [
      { artist: "Cachao", title: "A Gozar Con Mi Combo" },
      game("Alpha Banditos", "The Bull Is Wrong"),
      game("Tres Apenas como eso", "Yo Te Mire"),
      { artist: "Deodato", title: "Latin Flute" },
      { artist: "Mongo Santamaría", title: "Mama Papa Tu" },
      { artist: "Mongo Santamaría", title: "Me and You Baby (Picao y Tostao)" },
      { artist: "Machito and his Afro-Cubans", title: "Mambo Mucho Mambo" },
      game("Unaesta", "La Vida es Una Lenteja"),
      { artist: "Lonnie Liston Smith", title: "Expansions" },
      { artist: "Irakere", title: "Aguanile" },
      { artist: "Deodato", title: "Super Strut" },
      { artist: "Xavier Cugat and his Orchestra", title: "Jamay" },
      { artist: "Beny Moré", title: "Maracaïbo Oriental" },
      { artist: "Tito Puente and his Orchestra", title: "Mambo Gozón" },
    ],
  },
  {
    id: "emotion",
    name: "Emotion 98.3",
    genre: "Power Ballads",
    host: "Fernando Martinez",
    tracks: [
      { artist: "Foreigner", title: "Waiting for a Girl Like You" },
      { artist: "Kate Bush", title: "Wow" },
      { artist: "Squeeze", title: "Tempted" },
      { artist: "REO Speedwagon", title: "Keep On Loving You" },
      { artist: "Cutting Crew", title: "(I Just) Died in Your Arms" },
      { artist: "Roxy Music", title: "More Than This" },
      { artist: "Toto", title: "Africa" },
      { artist: "Mr. Mister", title: "Broken Wings" },
      { artist: "John Waite", title: "Missing You" },
      { artist: "Jan Hammer", title: "Crockett's Theme" },
      { artist: "Night Ranger", title: "Sister Christian" },
      { artist: "Luther Vandross", title: "Never Too Much" },
    ],
  },
  {
    id: "wave",
    name: "Wave 103",
    genre: "New Wave/Synthpop",
    host: "Adam First",
    tracks: [
      { artist: "Frankie Goes to Hollywood", title: "Two Tribes" },
      { artist: "Sigue Sigue Sputnik", title: "Love Missile F1-11" },
      { artist: "Gary Numan", title: "Cars" },
      { artist: "The Human League", title: "(Keep Feeling) Fascination" },
      { artist: "Blondie", title: "Atomic" },
      { artist: "Nena", title: "99 Luftballons" },
      { artist: "Kim Wilde", title: "Kids in America" },
      { artist: "Tears for Fears", title: "Pale Shelter" },
      { artist: "Corey Hart", title: "Sunglasses at Night" },
      { artist: "ABC", title: "Poison Arrow" },
      { artist: "A Flock of Seagulls", title: "I Ran (So Far Away)" },
      { artist: "The Psychedelic Furs", title: "Love My Way" },
      { artist: "Animotion", title: "Obsession" },
      { artist: "Spandau Ballet", title: "Gold" },
      { artist: "Thomas Dolby", title: "Hyperactive!" },
      { artist: "Romeo Void", title: "Never Say Never" },
    ],
  },
];

export const searchQuery = (track: Track) => track.query ?? `${track.artist} - ${track.title}`;

export function findStation(id: string): Station | undefined {
  return STATIONS.find((station) => station.id === id);
}
