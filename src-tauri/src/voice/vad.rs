//! Energy-based voice activity detection: cuts the 16 kHz stream into utterances so Whisper
//! only runs when someone speaks.

use std::collections::VecDeque;

pub const SAMPLE_RATE: usize = 16_000;
/// 30 ms analysis frames.
const FRAME: usize = SAMPLE_RATE * 30 / 1000;
/// Audio kept from before the detected start (the first syllable is usually quiet).
const PREROLL_FRAMES: usize = 10;
/// Speech starts when at least this many of the last `START_WINDOW` frames are voiced.
const START_VOICED: usize = 3;
const START_WINDOW: usize = 5;
/// ~660 ms of silence ends an utterance.
const END_SILENCE_FRAMES: usize = 22;
/// Trailing silence kept in the segment.
const TAIL_FRAMES: usize = 8;
/// Utterances are cut at 10 s.
const MAX_FRAMES: usize = 10_000 / 30;
/// Shorter bursts (clicks, coughs) are dropped.
const MIN_VOICED_FRAMES: usize = 8;
/// Absolute floor for the speech threshold (RMS).
const MIN_THRESHOLD: f32 = 0.006;

pub struct Vad {
    pending: Vec<f32>,
    preroll: VecDeque<Vec<f32>>,
    recent: VecDeque<bool>,
    segment: Vec<f32>,
    in_speech: bool,
    voiced_frames: usize,
    silent_frames: usize,
    frames: usize,
    noise_floor: f32,
}

impl Default for Vad {
    fn default() -> Self {
        Self {
            pending: Vec::with_capacity(FRAME * 4),
            preroll: VecDeque::with_capacity(PREROLL_FRAMES + 1),
            recent: VecDeque::with_capacity(START_WINDOW + 1),
            segment: Vec::new(),
            in_speech: false,
            voiced_frames: 0,
            silent_frames: 0,
            frames: 0,
            noise_floor: 0.004,
        }
    }
}

fn rms(frame: &[f32]) -> f32 {
    (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt()
}

/// Whether a push-to-talk recording holds enough voiced audio to be worth transcribing:
/// Whisper tends to invent words for silence and clicks.
pub fn contains_speech(samples: &[f32]) -> bool {
    samples.chunks_exact(FRAME).filter(|frame| rms(frame) > MIN_THRESHOLD).count() >= MIN_VOICED_FRAMES
}

impl Vad {
    /// Feeds 16 kHz mono samples; returns the utterances completed by them.
    pub fn push(&mut self, samples: &[f32]) -> Vec<Vec<f32>> {
        let mut done = Vec::new();
        self.pending.extend_from_slice(samples);
        let mut offset = 0;
        while self.pending.len() - offset >= FRAME {
            let frame = self.pending[offset..offset + FRAME].to_vec();
            offset += FRAME;
            if let Some(segment) = self.frame(frame) {
                done.push(segment);
            }
        }
        self.pending.drain(..offset);
        done
    }

    fn frame(&mut self, frame: Vec<f32>) -> Option<Vec<f32>> {
        let rms = rms(&frame);
        let voiced = rms > (self.noise_floor * 3.0).max(MIN_THRESHOLD);

        if !self.in_speech {
            if !voiced {
                // Track the background level only while nobody speaks.
                self.noise_floor = (self.noise_floor * 0.97 + rms * 0.03).clamp(0.0015, 0.05);
            }
            self.recent.push_back(voiced);
            if self.recent.len() > START_WINDOW {
                self.recent.pop_front();
            }
            self.preroll.push_back(frame);
            if self.preroll.len() > PREROLL_FRAMES {
                self.preroll.pop_front();
            }
            if self.recent.iter().filter(|v| **v).count() >= START_VOICED {
                self.in_speech = true;
                self.segment = self.preroll.drain(..).flatten().collect();
                self.voiced_frames = self.recent.iter().filter(|v| **v).count();
                self.silent_frames = 0;
                self.frames = self.segment.len() / FRAME;
                self.recent.clear();
            }
            return None;
        }

        self.segment.extend_from_slice(&frame);
        self.frames += 1;
        if voiced {
            self.voiced_frames += 1;
            self.silent_frames = 0;
        } else {
            self.silent_frames += 1;
        }

        if self.silent_frames >= END_SILENCE_FRAMES || self.frames >= MAX_FRAMES {
            self.in_speech = false;
            let trailing = self.silent_frames.saturating_sub(TAIL_FRAMES) * FRAME;
            let mut segment = std::mem::take(&mut self.segment);
            segment.truncate(segment.len() - trailing.min(segment.len()));
            let enough = self.voiced_frames >= MIN_VOICED_FRAMES;
            self.voiced_frames = 0;
            self.silent_frames = 0;
            return enough.then_some(segment);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(seconds: f32, amplitude: f32) -> Vec<f32> {
        (0..(seconds * SAMPLE_RATE as f32) as usize)
            .map(|i| amplitude * (i as f32 * 2.0 * std::f32::consts::PI * 220.0 / SAMPLE_RATE as f32).sin())
            .collect()
    }

    fn noise(seconds: f32, amplitude: f32) -> Vec<f32> {
        let mut seed = 7u32;
        (0..(seconds * SAMPLE_RATE as f32) as usize)
            .map(|_| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                amplitude * ((seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0)
            })
            .collect()
    }

    #[test]
    fn silence_and_background_noise_produce_nothing() {
        let mut vad = Vad::default();
        assert!(vad.push(&vec![0.0; SAMPLE_RATE * 2]).is_empty());
        assert!(vad.push(&noise(3.0, 0.004)).is_empty());
    }

    #[test]
    fn one_utterance_between_silences() {
        let mut vad = Vad::default();
        let mut audio = noise(1.0, 0.003);
        audio.extend(tone(1.2, 0.2));
        audio.extend(noise(1.5, 0.003));
        let segments = vad.push(&audio);
        assert_eq!(segments.len(), 1);
        let seconds = segments[0].len() as f32 / SAMPLE_RATE as f32;
        // 1.2 s of speech + pre-roll + kept tail, minus the frames needed to confirm the start.
        assert!((1.2..1.9).contains(&seconds), "segment length {seconds}s");
        assert!(!vad.in_speech);
    }

    #[test]
    fn fed_in_small_chunks_gives_the_same_result() {
        let mut vad = Vad::default();
        let mut audio = vec![0.0; SAMPLE_RATE];
        audio.extend(tone(0.8, 0.2));
        audio.extend(vec![0.0; SAMPLE_RATE]);
        let segments: Vec<_> = audio.chunks(160).flat_map(|chunk| vad.push(chunk)).collect();
        assert_eq!(segments.len(), 1);
    }

    #[test]
    fn short_clicks_are_dropped() {
        let mut vad = Vad::default();
        let mut audio = vec![0.0; SAMPLE_RATE];
        audio.extend(tone(0.12, 0.3));
        audio.extend(vec![0.0; SAMPLE_RATE]);
        assert!(vad.push(&audio).is_empty());
    }

    #[test]
    fn push_to_talk_recordings_need_speech() {
        assert!(!contains_speech(&vec![0.0; SAMPLE_RATE]));
        assert!(!contains_speech(&noise(1.0, 0.004)));
        let mut click = vec![0.0; SAMPLE_RATE / 2];
        click.extend(tone(0.12, 0.3));
        assert!(!contains_speech(&click));
        assert!(contains_speech(&tone(0.6, 0.2)));
    }

    #[test]
    fn long_speech_is_cut_at_the_maximum() {
        let mut vad = Vad::default();
        let segments = vad.push(&tone(12.0, 0.2));
        assert_eq!(segments.len(), 1);
        assert!(segments[0].len() <= (MAX_FRAMES + PREROLL_FRAMES) * FRAME);
    }
}
