//! Turns transcripts into decisions: wake word detection, keyword matching and the
//! short "awake" window that follows "Hey Jarvis".

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use crate::settings::{Activation, AppEntry, VoiceCommand};

/// How long Jarvis waits for a keyword after hearing "Hey Jarvis" on its own.
pub const AWAKE_WINDOW: Duration = Duration::from_secs(8);
/// The same app is not relaunched by repeated keywords within this interval.
const RELAUNCH_COOLDOWN: Duration = Duration::from_secs(4);

/// Ways Whisper writes "Jarvis" in Portuguese besides the near-exact spelling.
const WAKE_ALIASES: [&str; 7] = ["jarbas", "jarvas", "djarvis", "jarviz", "javis", "javiz", "jarves"];

/// Words between the play verb and the name that say nothing about which playlist.
const PLAY_FILLER: [&str; 17] =
    ["a", "o", "as", "os", "um", "uma", "da", "do", "de", "na", "no", "pra", "para", "playlist", "radio", "estacao", "musica"];
/// Whisper's vocabulary hint for the player: the Vice City stations' names.
const STATION_NAMES: [&str; 7] = ["Flash FM", "Wave 103", "V-Rock", "Fever 105", "Emotion 98.3", "Radio Espantoso", "Wildstyle"];

/// Keywords and the first phrases of each command, for Whisper's vocabulary hint (whisper.cpp
/// drops the start of a prompt that is too long, so it stays short and without repeats).
pub fn command_vocabulary<'a>(apps: &'a [AppEntry], commands: &'a [VoiceCommand]) -> impl Iterator<Item = String> + 'a {
    let mut seen = HashSet::new();
    apps.iter()
        .flat_map(|app| app.keywords.iter().cloned())
        .chain(commands.iter().filter(|command| command.kind == "window").flat_map(|command| command.phrases.iter().take(2).cloned()))
        .chain(
            commands
                .iter()
                .filter(|command| !matches!(command.kind.as_str(), "window" | "verbs" | "playVerbs"))
                .flat_map(|command| command.phrases.first().cloned()),
        )
        .chain(STATION_NAMES.iter().map(|name| name.to_string()))
        .filter(move |phrase| seen.insert(normalize(phrase)))
}

/// The verbs that say "open", "close" and "play" (single words, normalised).
struct Verbs {
    open: Vec<String>,
    close: Vec<String>,
    play: Vec<String>,
}

impl Verbs {
    fn new(commands: &[VoiceCommand]) -> Self {
        let words = |kind: &str, target: &str| -> Vec<String> {
            commands
                .iter()
                .filter(|command| command.kind == kind && command.target == target)
                .flat_map(|command| command.phrases.iter().map(|phrase| normalize(phrase).trim().to_string()))
                .filter(|word| !word.is_empty())
                .collect()
        };
        Self { open: words("verbs", "open"), close: words("verbs", "close"), play: words("playVerbs", "") }
    }

    fn opens_or_closes(&self, token: &str) -> bool {
        self.open.iter().chain(&self.close).any(|verb| verb == token)
    }
}

/// The words after `from` that name something, fillers dropped.
fn named_after(tokens: &[String], from: usize) -> Option<String> {
    let words: Vec<&str> = tokens[from.min(tokens.len())..].iter().map(String::as_str).filter(|word| !PLAY_FILLER.contains(word)).collect();
    (!words.is_empty()).then(|| words.join(" "))
}

/// An action said with its exact words ("próxima música", "pausa o pomodoro", a phrase the user
/// made for a playlist): the command, where its phrase starts, and how many words it has.
/// Word for word, since a one-letter slip is another command here ("toca a playlist X" is not
/// "troca a playlist"); the longest phrase wins, then the earliest.
fn match_action<'a>(tokens: &[String], commands: &'a [VoiceCommand]) -> Option<(&'a VoiceCommand, usize, usize)> {
    let mut best: Option<(&VoiceCommand, usize, usize)> = None;
    for command in commands.iter().filter(|command| matches!(command.kind.as_str(), "music" | "pomodoro" | "playlist")) {
        for phrase in &command.phrases {
            let words = tokenize(phrase);
            if words.is_empty() {
                continue;
            }
            let Some(position) = tokens.windows(words.len()).position(|window| window == words.as_slice()) else { continue };
            if best.is_none_or(|(_, at, length)| words.len() > length || (words.len() == length && position < at)) {
                best = Some((command, position, words.len()));
            }
        }
    }
    best
}

/// Lowercase, no accents, punctuation turned into spaces.
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars().flat_map(char::to_lowercase) {
        let c = match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        };
        out.push(c);
    }
    out
}

pub fn tokenize(text: &str) -> Vec<String> {
    normalize(text).split_whitespace().map(str::to_string).collect()
}

fn levenshtein(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut current = vec![i + 1; b.len() + 1];
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != *cb);
            current[j + 1] = (previous[j] + cost).min(previous[j + 1] + 1).min(current[j] + 1);
        }
        previous = current;
    }
    previous[b.len()]
}

/// Equal, or one edit apart for words long enough that a single typo is not a different word.
fn similar(a: &str, b: &str) -> bool {
    a == b || (a.chars().count().min(b.chars().count()) >= 5 && levenshtein(a, b) <= 1)
}

fn is_wake_word(text: &str) -> bool {
    similar(text, "jarvis") || WAKE_ALIASES.contains(&text)
}

/// The wake word alone or glued to "hey" ("redjarvis", "rejaviz", "heyjarvis").
fn is_wake_token(token: &str) -> bool {
    let chars: Vec<char> = token.chars().collect();
    (0..chars.len().saturating_sub(4)).any(|start| {
        (5..=7)
            .filter(|len| start + len <= chars.len())
            .any(|len| is_wake_word(&chars[start..start + len].iter().collect::<String>()))
    })
}

/// Position right after the wake word ("hey jarvis", "ei jarvis", "jarbas"...), if present.
pub fn find_wake(tokens: &[String]) -> Option<usize> {
    tokens.iter().position(|token| is_wake_token(token)).map(|index| index + 1)
}

/// Where `keyword` occurs in `tokens`: word by word ("vs code"), or written together ("vscode").
fn keyword_position(tokens: &[String], keyword: &[String]) -> Option<usize> {
    if keyword.is_empty() || tokens.is_empty() {
        return None;
    }
    if tokens.len() >= keyword.len() {
        let found = (0..=tokens.len() - keyword.len())
            .find(|&start| keyword.iter().enumerate().all(|(i, word)| similar(&tokens[start + i], word)));
        if found.is_some() {
            return found;
        }
    }
    let compact = keyword.concat();
    (0..tokens.len()).find(|&start| {
        (1..=3.min(tokens.len() - start)).any(|len| similar(&tokens[start..start + len].concat(), &compact))
    })
}

/// Length and position of `keyword` in `tokens`, if it occurs.
fn score(tokens: &[String], keyword: &str) -> Option<(usize, usize)> {
    let keyword = tokenize(keyword);
    keyword_position(tokens, &keyword).map(|position| (keyword.concat().len(), position))
}

/// The longest (most specific) keyword wins, then the earliest one.
fn beats(candidate: (usize, usize), best: Option<(usize, usize)>) -> bool {
    best.is_none_or(|(length, position)| candidate.0 > length || (candidate.0 == length && candidate.1 < position))
}

/// What a keyword points at: a program to launch, a JARVIS window, or a group of windows.
#[derive(Clone, Copy)]
pub enum Target<'a> {
    App(&'a AppEntry),
    Window(&'a VoiceCommand),
    Group(&'a VoiceCommand),
}

/// The app, window or group whose keyword appears in `tokens`, and where that keyword starts.
pub fn match_target<'a>(tokens: &[String], apps: &'a [AppEntry], commands: &'a [VoiceCommand]) -> Option<(Target<'a>, usize)> {
    let mut best: Option<(Target<'a>, (usize, usize))> = None;
    let windows = commands.iter().filter(|command| command.kind == "window");
    let groups = commands.iter().filter(|command| command.kind == "group");
    // JARVIS's own windows first: on an exact tie with a program's keyword, the window wins.
    let candidates = windows
        .flat_map(|window| window.phrases.iter().map(move |phrase| (Target::Window(window), phrase.as_str())))
        .chain(groups.flat_map(|group| group.phrases.iter().map(move |phrase| (Target::Group(group), phrase.as_str()))))
        .chain(apps.iter().flat_map(|app| app.keywords.iter().map(move |keyword| (Target::App(app), keyword.as_str()))));
    for (target, keyword) in candidates {
        if let Some(found) = score(tokens, keyword)
            && beats(found, best.map(|(_, scored)| scored))
        {
            best = Some((target, found));
        }
    }
    best.map(|(target, (_, position))| (target, position))
}

/// The app whose keyword appears in `tokens` (windows aside).
pub fn match_app<'a>(tokens: &[String], apps: &'a [AppEntry]) -> Option<&'a AppEntry> {
    let mut best: Option<(&AppEntry, (usize, usize))> = None;
    for app in apps {
        for keyword in &app.keywords {
            if let Some(found) = score(tokens, keyword)
                && beats(found, best.map(|(_, scored)| scored))
            {
                best = Some((app, found));
            }
        }
    }
    best.map(|(app, _)| app)
}

/// "fecha o relógio" closes; "abre…" or no verb opens. The verb closest before the keyword
/// decides; failing that, one after it ("o relógio, pode fechar").
fn wants_close(tokens: &[String], keyword_at: usize, verbs: &Verbs) -> bool {
    let verb = |token: &String| {
        if verbs.close.contains(token) {
            Some(true)
        } else if verbs.open.contains(token) {
            Some(false)
        } else {
            None
        }
    };
    tokens[..keyword_at]
        .iter()
        .rev()
        .find_map(verb)
        .or_else(|| tokens[keyword_at..].iter().find_map(verb))
        .unwrap_or(false)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Ignore,
    /// Wake word heard without a keyword: start the awake window.
    Wake,
    Launch { app_id: String },
    /// Open or close a JARVIS window (widget or app).
    Window { kind: String, open: bool },
    /// "Close" said about an external program: JARVIS only launches those.
    CannotClose { app_id: String },
    /// Close every widget, every app, or every window ("widgets", "apps", "all").
    CloseGroup { group: String },
    /// Control jv_T4p3: "next", "previous", "pause", "resume", "nextPlaylist", "previousPlaylist",
    /// or "play" (with the playlist named, if any; the UI knows the user's playlists).
    Music { action: String, target: Option<String> },
    /// Control the Pomodoro: "start", "pause", "reset", "skip", "longer", "shorter".
    Pomodoro { action: String },
}

/// Conversation state across utterances.
#[derive(Default)]
pub struct Session {
    awake_until: Option<Instant>,
    launched_at: HashMap<String, Instant>,
}

impl Session {
    pub fn is_awake(&self, now: Instant) -> bool {
        self.awake_until.is_some_and(|until| now < until)
    }

    /// Ends an elapsed awake window; returns true when that happens.
    pub fn expire(&mut self, now: Instant) -> bool {
        if self.awake_until.is_some_and(|until| now >= until) {
            self.awake_until = None;
            return true;
        }
        false
    }

    /// What `transcript` asks for, given the programs (`apps`) and the voice commands.
    pub fn decide(&mut self, transcript: &str, activation: Activation, apps: &[AppEntry], commands: &[VoiceCommand], now: Instant) -> Decision {
        let tokens = tokenize(transcript);
        let wake = find_wake(&tokens);
        let scope: &[String] = match activation {
            // Holding the button already says "I'm talking to Jarvis": no wake word needed.
            Activation::Always | Activation::PushToTalk => &tokens,
            // The wake word itself stays in: it is part of "Jarvis Mark" and "Jarvis Code".
            Activation::WakeWord => match wake {
                Some(after) => &tokens[after - 1..],
                None if self.is_awake(now) => &tokens,
                None => return Decision::Ignore,
            },
        };
        let verbs = Verbs::new(commands);

        // A group word without a closing verb ("Jarvis, tudo bem?") is no command at all.
        let matched = match_target(scope, apps, commands)
            .filter(|&(target, position)| !matches!(target, Target::Group(_)) || wants_close(scope, position, &verbs));
        // Opening or closing something with its verb ("abre a fita", "fecha o pomodoro") wins;
        // otherwise an action ("pausa o pomodoro", "próxima música", "toca a Flash FM").
        let commanding = matched.is_some() && scope.iter().any(|token| verbs.opens_or_closes(token));
        if !commanding && let Some(decision) = self.action(scope, commands, &verbs, now) {
            return decision;
        }

        let Some((target, position)) = matched else {
            if activation == Activation::WakeWord && wake.is_some() {
                self.awake_until = Some(now + AWAKE_WINDOW);
                return Decision::Wake;
            }
            return Decision::Ignore;
        };
        let close = wants_close(scope, position, &verbs);

        let (key, decision) = match target {
            Target::Group(group) => (format!("group:{}", group.target), Decision::CloseGroup { group: group.target.clone() }),
            Target::App(app) if close => {
                self.awake_until = None;
                return Decision::CannotClose { app_id: app.id.clone() };
            }
            Target::App(app) => (app.id.clone(), Decision::Launch { app_id: app.id.clone() }),
            Target::Window(window) => {
                // Opening right after closing (or the reverse) is a new command, not a repeat.
                self.launched_at.remove(&format!("window:{}:{}", window.target, !close));
                (format!("window:{}:{close}", window.target), Decision::Window { kind: window.target.clone(), open: !close })
            }
        };
        self.fire(key, decision, now)
    }

    /// A music or Pomodoro action, or a play verb and what to play.
    fn action(&mut self, scope: &[String], commands: &[VoiceCommand], verbs: &Verbs, now: Instant) -> Option<Decision> {
        let play = |name: Option<String>| (format!("music:play:{}", name.as_deref().unwrap_or_default()), Decision::Music { action: "play".into(), target: name });
        let (key, decision) = match match_action(scope, commands) {
            Some((command, position, words)) => match command.kind.as_str() {
                "pomodoro" => (format!("pomodoro:{}", command.target), Decision::Pomodoro { action: command.target.clone() }),
                "playlist" => play(Some(command.target.clone())),
                _ => {
                    // "muda a playlist para a Wave": straight to the one named.
                    let end = position + words;
                    let named = (command.target == "nextPlaylist" && scope.get(end).is_some_and(|word| word == "para" || word == "pra"))
                        .then(|| named_after(scope, end + 1))
                        .flatten();
                    match named {
                        Some(name) => play(Some(name)),
                        None => (format!("music:{}", command.target), Decision::Music { action: command.target.clone(), target: None }),
                    }
                }
            },
            None => {
                let verb = scope.iter().position(|token| verbs.play.contains(token))?;
                play(named_after(scope, verb + 1))
            }
        };
        Some(self.fire(key, decision, now))
    }

    /// Runs a decision unless the same one just ran (Whisper may hear one command twice).
    fn fire(&mut self, key: String, decision: Decision, now: Instant) -> Decision {
        if self.launched_at.get(&key).is_some_and(|at| now.duration_since(*at) < RELAUNCH_COOLDOWN) {
            return Decision::Ignore;
        }
        self.awake_until = None;
        self.launched_at.insert(key, now);
        decision
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{default_apps, default_voice_commands, VoiceCommand};

    fn launch(id: &str) -> Decision {
        Decision::Launch { app_id: id.into() }
    }

    #[test]
    fn normalizes_accents_and_punctuation() {
        assert_eq!(tokenize("Ei, Jarvis! Abra o código."), vec!["ei", "jarvis", "abra", "o", "codigo"]);
    }

    #[test]
    fn detects_wake_word_variants() {
        for phrase in ["Hey Jarvis", "ei jarvis", "Rei Jarbas", "Jarvis,", "hey jarvas", "Ei, Jarvys.", "redjarvis, abre", "Rejáviz"] {
            assert!(find_wake(&tokenize(phrase)).is_some(), "{phrase}");
        }
        for phrase in ["jardins bonitos", "obrigado", "java", "javascript", "arvores", ""] {
            assert!(find_wake(&tokenize(phrase)).is_none(), "{phrase}");
        }
    }

    #[test]
    fn matches_keywords_tolerantly() {
        let apps = default_apps();
        let id = |text: &str| match_app(&tokenize(text), &apps).map(|app| app.id.as_str());
        assert_eq!(id("abre o navegador por favor"), Some("browser"));
        assert_eq!(id("abrir o navegadô"), Some("browser"));
        assert_eq!(id("abre o VS Code"), Some("vscode"));
        assert_eq!(id("abre o vscode"), Some("vscode"));
        assert_eq!(id("abra o windows terminal"), Some("terminal"));
        assert_eq!(id("abre o Claude Code"), Some("claude"));
        assert_eq!(id("abre o cloud code"), Some("claude"));
        assert_eq!(id("que horas são"), None);
    }

    #[test]
    fn longest_keyword_wins() {
        let apps = default_apps();
        // "claude code" (claude) is longer than the overlapping "code"-free keywords elsewhere.
        assert_eq!(match_app(&tokenize("claude code"), &apps).unwrap().id, "claude");
        // "visual studio code" beats nothing else but must still match as a phrase.
        assert_eq!(match_app(&tokenize("abre o visual studio code"), &apps).unwrap().id, "vscode");
    }

    #[test]
    fn wake_word_mode_requires_the_wake_word() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let now = Instant::now();
        assert_eq!(session.decide("abre o navegador", Activation::WakeWord, &apps, &commands, now), Decision::Ignore);
        assert_eq!(session.decide("Hey Jarvis, abre o navegador", Activation::WakeWord, &apps, &commands, now), launch("browser"));
    }

    #[test]
    fn wake_word_then_keyword_within_the_window() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let now = Instant::now();
        assert_eq!(session.decide("Hey Jarvis.", Activation::WakeWord, &apps, &commands, now), Decision::Wake);
        assert!(session.is_awake(now));
        let later = now + Duration::from_secs(3);
        assert_eq!(session.decide("navegador", Activation::WakeWord, &apps, &commands, later), launch("browser"));
        assert!(!session.is_awake(later), "a launch closes the window");
    }

    #[test]
    fn awake_window_expires() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let now = Instant::now();
        session.decide("ei jarvis", Activation::WakeWord, &apps, &commands, now);
        let late = now + AWAKE_WINDOW + Duration::from_millis(1);
        assert!(session.expire(late));
        assert!(!session.expire(late));
        assert_eq!(session.decide("navegador", Activation::WakeWord, &apps, &commands, late), Decision::Ignore);
    }

    #[test]
    fn push_to_talk_needs_no_wake_word() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let now = Instant::now();
        assert_eq!(session.decide("abre o vs code", Activation::PushToTalk, &apps, &commands, now), launch("vscode"));
        assert_eq!(session.decide("Hey Jarvis, abre o navegador", Activation::PushToTalk, &apps, &commands, now), launch("browser"));
        assert_eq!(session.decide("Hey Jarvis.", Activation::PushToTalk, &apps, &commands, now), Decision::Ignore);
        assert!(!session.is_awake(now), "no awake window: every hold is a command of its own");
    }

    fn window(kind: &str, open: bool) -> Decision {
        Decision::Window { kind: kind.into(), open }
    }

    #[test]
    fn opens_and_closes_jarvis_windows() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let mut at = Instant::now();
        let mut say = |text: &str| {
            at += RELAUNCH_COOLDOWN;
            session.decide(text, Activation::PushToTalk, &apps, &commands, at)
        };
        assert_eq!(say("abre o relógio"), window("clock", true));
        assert_eq!(say("Fecha o relógio."), window("clock", false));
        assert_eq!(say("mostra a bateria"), window("battery", true));
        assert_eq!(say("abrir a calculadora"), window("calculator", true));
        assert_eq!(say("fechar a calculadora, por favor"), window("calculator", false));
        assert_eq!(say("pomodoro"), window("pomodoro", true));
        // Starting the timer is a Pomodoro action; naming it alone opens its window.
        assert_eq!(say("inicia o timer"), Decision::Pomodoro { action: "start".into() });
        assert_eq!(say("timer"), window("pomodoro", true));
        assert_eq!(say("abre o editor de markdown"), window("markdown", true));
        assert_eq!(say("fecha o mark down"), window("markdown", false));
        assert_eq!(say("abre o código"), window("code", true));
        assert_eq!(say("o código, pode fechar"), window("code", false));
        assert_eq!(say("abre o Jarvis Mark"), window("markdown", true));
        assert_eq!(say("abre o Jarvis Marc"), window("markdown", true));
        assert_eq!(say("fecha o Jarvis Code"), window("code", false));
        assert_eq!(say("abre o jarvis code"), window("code", true));
        assert_eq!(say("abre o tape"), window("music", true));
        assert_eq!(say("fecha o player"), window("music", false));
        assert_eq!(say("abre o player de música"), window("music", true));
        assert_eq!(say("abre a fita"), window("tape", true));
        assert_eq!(say("fecha a fita cassete"), window("tape", false));
        // "terminal" is jv_sh, inside JARVIS; Windows Terminal answers to its full name.
        assert_eq!(say("abre o terminal"), window("shell", true));
        assert_eq!(say("fecha o terminal"), window("shell", false));
        assert_eq!(say("abre o windows terminal"), Decision::Launch { app_id: "terminal".into() });
        assert_eq!(say("abre o mini player"), window("miniplayer", true));
        assert_eq!(say("fecha o miniplayer"), window("miniplayer", false));
        // The closest verb before the keyword decides.
        assert_eq!(say("fecha o pomodoro e abre o relógio"), window("pomodoro", false));
        assert_eq!(say("que horas são"), Decision::Ignore);
    }

    #[test]
    fn programs_win_their_longer_keywords_and_are_never_closed() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let now = Instant::now();
        // "editor de código" is VS Code's keyword; the JARVIS editor answers to "código".
        assert_eq!(session.decide("abre o editor de código", Activation::Always, &apps, &commands, now), launch("vscode"));
        assert_eq!(session.decide("abre o vs code", Activation::Always, &apps, &commands, now + RELAUNCH_COOLDOWN), launch("vscode"));
        // Closing an external program is not supported: it must not open it either.
        assert_eq!(session.decide("fecha o vs code", Activation::Always, &apps, &commands, now), Decision::CannotClose { app_id: "vscode".into() });
    }

    #[test]
    fn window_commands_follow_the_wake_word() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let now = Instant::now();
        assert_eq!(session.decide("fecha o relógio", Activation::WakeWord, &apps, &commands, now), Decision::Ignore);
        assert_eq!(session.decide("Hey Jarvis, fecha o relógio", Activation::WakeWord, &apps, &commands, now), window("clock", false));
        assert_eq!(session.decide("Ei Jarvis.", Activation::WakeWord, &apps, &commands, now), Decision::Wake);
        assert_eq!(session.decide("abre a calculadora", Activation::WakeWord, &apps, &commands, now + Duration::from_secs(2)), window("calculator", true));
        assert!(!session.is_awake(now + Duration::from_secs(2)), "a command closes the awake window");
    }

    #[test]
    fn app_names_that_start_with_the_wake_word() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let now = Instant::now();
        // "Jarvis Code" is both the wake word and the app's name.
        assert_eq!(session.decide("Jarvis Code", Activation::WakeWord, &apps, &commands, now), window("code", true));
        assert_eq!(session.decide("Hey Jarvis, abre o Jarvis Mark.", Activation::WakeWord, &apps, &commands, now), window("markdown", true));
        assert_eq!(session.decide("Jarvis, fecha o Jarvis Mark", Activation::WakeWord, &apps, &commands, now), window("markdown", false));
        assert_eq!(session.decide("Hey Jarvis.", Activation::WakeWord, &apps, &commands, now), Decision::Wake);
        assert_eq!(session.decide("Hey Jarvis, abre o navegador", Activation::WakeWord, &apps, &commands, now), launch("browser"));
    }

    #[test]
    fn window_cooldown_only_stops_repeats() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let now = Instant::now();
        let second = Duration::from_secs(1);
        assert_eq!(session.decide("abre o relógio", Activation::Always, &apps, &commands, now), window("clock", true));
        assert_eq!(session.decide("relógio", Activation::Always, &apps, &commands, now + second), Decision::Ignore);
        assert_eq!(session.decide("fecha o relógio", Activation::Always, &apps, &commands, now + second * 2), window("clock", false));
        assert_eq!(session.decide("abre o relógio", Activation::Always, &apps, &commands, now + second * 3), window("clock", true));
    }

    fn close_group(group: &str) -> Decision {
        Decision::CloseGroup { group: group.into() }
    }

    #[test]
    fn closes_every_widget_every_app_or_everything() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let mut at = Instant::now();
        let mut say = |text: &str| {
            at += RELAUNCH_COOLDOWN;
            session.decide(text, Activation::PushToTalk, &apps, &commands, at)
        };
        assert_eq!(say("fecha todos os widgets"), close_group("widgets"));
        assert_eq!(say("fechar os widgets"), close_group("widgets"));
        assert_eq!(say("Fechar todas as aplicações."), close_group("apps"));
        assert_eq!(say("fecha todos os aplicativos"), close_group("apps"));
        assert_eq!(say("fecha os apps"), close_group("apps"));
        assert_eq!(say("fecha todas as janelas"), close_group("all"));
        assert_eq!(say("fecha tudo"), close_group("all"));
        // Only closing: "abre os widgets" is no command.
        assert_eq!(say("abre os widgets"), Decision::Ignore);
        // A named window is more specific than a group word.
        assert_eq!(say("fecha a calculadora e os widgets"), window("calculator", false));
    }

    #[test]
    fn group_words_do_not_swallow_the_wake_word() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let now = Instant::now();
        assert_eq!(session.decide("Jarvis, tudo bem?", Activation::WakeWord, &apps, &commands, now), Decision::Wake);
        assert_eq!(session.decide("fecha todos os widgets", Activation::WakeWord, &apps, &commands, now), close_group("widgets"));
        assert_eq!(session.decide("Hey Jarvis, fecha todas as aplicações", Activation::WakeWord, &apps, &commands, now), close_group("apps"));
        assert_eq!(session.decide("tudo certo por aqui", Activation::Always, &apps, &commands, now), Decision::Ignore);
    }

    fn music(action: &str, target: Option<&str>) -> Decision {
        Decision::Music { action: action.into(), target: target.map(str::to_string) }
    }

    #[test]
    fn controls_the_music() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let mut at = Instant::now();
        let mut say = |text: &str| {
            at += RELAUNCH_COOLDOWN;
            session.decide(text, Activation::PushToTalk, &apps, &commands, at)
        };
        assert_eq!(say("próxima música"), music("next", None));
        assert_eq!(say("Pula essa música, por favor."), music("next", None));
        assert_eq!(say("volta a música"), music("previous", None));
        assert_eq!(say("música anterior"), music("previous", None));
        assert_eq!(say("para a música"), music("pause", None));
        assert_eq!(say("pausa a música"), music("pause", None));
        assert_eq!(say("continua a música"), music("resume", None));
        assert_eq!(say("muda a playlist"), music("nextPlaylist", None));
        assert_eq!(say("troca de rádio"), music("nextPlaylist", None));
        assert_eq!(say("rádio anterior"), music("previousPlaylist", None));
        assert_eq!(say("toca a Flash FM"), music("play", Some("flash fm")));
        assert_eq!(say("toca a playlist treino pesado"), music("play", Some("treino pesado")));
        assert_eq!(say("coloca a rádio Wave 103"), music("play", Some("wave 103")));
        assert_eq!(say("muda a playlist para a V-Rock"), music("play", Some("v rock")));
        assert_eq!(say("toca música"), music("play", None));
        // Windows keep their verbs: opening the cassette widget is not playing.
        assert_eq!(say("abre a fita"), window("tape", true));
    }

    #[test]
    fn plays_pauses_and_goes_back_in_few_words() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let mut at = Instant::now();
        let mut say = |text: &str| {
            at += RELAUNCH_COOLDOWN;
            session.decide(text, Activation::PushToTalk, &apps, &commands, at)
        };
        assert_eq!(say("Dá play."), music("resume", None));
        assert_eq!(say("play"), music("resume", None));
        assert_eq!(say("pausa"), music("pause", None));
        assert_eq!(say("pausar"), music("pause", None));
        assert_eq!(say("volta a música"), music("previous", None));
        assert_eq!(say("volta para a música anterior"), music("previous", None));
        // The longest phrase wins: these are not "pausa" nor "volta".
        assert_eq!(say("volta a tocar"), music("resume", None));
        assert_eq!(say("pausa o pomodoro"), pomodoro("pause"));
        // "abre o player" opens the window ("player" is not "play").
        assert_eq!(say("abre o player"), window("music", true));
    }

    fn pomodoro(action: &str) -> Decision {
        Decision::Pomodoro { action: action.into() }
    }

    #[test]
    fn controls_the_pomodoro() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let mut at = Instant::now();
        let mut say = |text: &str| {
            at += RELAUNCH_COOLDOWN;
            session.decide(text, Activation::PushToTalk, &apps, &commands, at)
        };
        assert_eq!(say("inicia o pomodoro"), pomodoro("start"));
        assert_eq!(say("começa o foco"), pomodoro("start"));
        assert_eq!(say("para o pomodoro"), pomodoro("pause"));
        assert_eq!(say("continua o pomodoro"), pomodoro("start"));
        assert_eq!(say("reinicia o pomodoro"), pomodoro("reset"));
        assert_eq!(say("pula a fase"), pomodoro("skip"));
        assert_eq!(say("mais cinco minutos"), pomodoro("longer"));
        assert_eq!(say("diminui o pomodoro"), pomodoro("shorter"));
        // Its window still opens and closes with the verbs.
        assert_eq!(say("abre o pomodoro"), window("pomodoro", true));
        assert_eq!(say("fecha o pomodoro"), window("pomodoro", false));
    }

    #[test]
    fn follows_the_commands_in_the_settings() {
        let apps = default_apps();
        let mut commands = default_voice_commands();
        let next = commands.iter_mut().find(|command| command.id == "music:next").unwrap();
        next.phrases = vec!["bora pra próxima".into()];
        let open = commands.iter_mut().find(|command| command.id == "verbs:open").unwrap();
        open.phrases.push("liga".into());
        commands.push(VoiceCommand {
            id: "custom-1".into(),
            kind: "playlist".into(),
            target: "Treino pesado".into(),
            label: "Hora de treinar".into(),
            phrases: vec!["hora de treinar".into()],
            builtin: false,
        });
        commands.push(VoiceCommand {
            id: "custom-2".into(),
            kind: "window".into(),
            target: "calculator".into(),
            label: String::new(),
            phrases: vec!["fazer contas".into()],
            builtin: false,
        });
        let mut session = Session::default();
        let mut at = Instant::now();
        let mut say = |text: &str| {
            at += RELAUNCH_COOLDOWN;
            session.decide(text, Activation::PushToTalk, &apps, &commands, at)
        };
        assert_eq!(say("próxima música"), Decision::Ignore);
        assert_eq!(say("bora pra próxima"), music("next", None));
        assert_eq!(say("hora de treinar"), music("play", Some("Treino pesado")));
        assert_eq!(say("fazer contas"), window("calculator", true));
        assert_eq!(say("fecha o fazer contas"), window("calculator", false));
        // A new verb counts as opening: and so "liga a fita" is not music.
        assert_eq!(say("liga a fita"), window("tape", true));
    }

    #[test]
    fn music_follows_the_wake_word_and_ignores_repeats() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let now = Instant::now();
        assert_eq!(session.decide("próxima música", Activation::WakeWord, &apps, &commands, now), Decision::Ignore);
        assert_eq!(session.decide("Hey Jarvis, próxima música", Activation::WakeWord, &apps, &commands, now), music("next", None));
        assert_eq!(session.decide("Hey Jarvis, próxima música", Activation::WakeWord, &apps, &commands, now + Duration::from_secs(1)), Decision::Ignore);
        assert_eq!(
            session.decide("Jarvis, toca a Emotion", Activation::WakeWord, &apps, &commands, now + Duration::from_secs(2)),
            music("play", Some("emotion"))
        );
    }

    #[test]
    fn vocabulary_includes_windows() {
        let words: Vec<String> = command_vocabulary(&default_apps(), &default_voice_commands()).collect();
        assert!(words.iter().any(|word| word == "navegador"));
        assert!(words.iter().any(|word| word == "relógio"));
        assert!(words.iter().any(|word| word == "calculadora"));
        assert!(words.iter().any(|word| word == "fita"));
        assert!(words.iter().any(|word| word == "próxima música"));
    }

    #[test]
    fn always_mode_and_cooldown() {
        let apps = default_apps();
        let commands = default_voice_commands();
        let mut session = Session::default();
        let now = Instant::now();
        assert_eq!(session.decide("abre o navegador", Activation::Always, &apps, &commands, now), launch("browser"));
        assert_eq!(session.decide("navegador", Activation::Always, &apps, &commands, now + Duration::from_secs(1)), Decision::Ignore);
        assert_eq!(session.decide("navegador", Activation::Always, &apps, &commands, now + Duration::from_secs(5)), launch("browser"));
    }
}
